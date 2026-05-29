import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, UserRole } from "@prisma/client";
import {
  aiExtensionDraftSource,
  normalizeSplitTextForWord,
  readDraftPayload,
  type AiExtensionDraftPayload
} from "../src/lib/ai-extension-route-fill";
import { prisma } from "../src/lib/db";
import { markdownToPlainText } from "../src/lib/wiki-links/renderer";

const apply = process.argv.includes("--apply");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(process.cwd(), "tmp", "ai-extension-route-fill");

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const [drafts, admin] = await Promise.all([
    prisma.importDraft.findMany({
      where: { source: aiExtensionDraftSource },
      orderBy: [{ createdAt: "desc" }]
    }),
    prisma.user.findFirst({
      where: { role: UserRole.ADMIN, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true }
    })
  ]);
  if (apply && !admin) throw new Error("找不到 active admin，不能写入 AI 延伸划分修复审计日志。");

  const snapshotPath = path.join(outputDir, `split-normalization-before-${timestamp}.json`);
  await fs.writeFile(snapshotPath, JSON.stringify(drafts, null, 2));

  const payloadItems = drafts
    .map((draft) => ({ draft, payload: readDraftPayload(draft.agentPayload) }))
    .filter((item): item is { draft: typeof item.draft; payload: AiExtensionDraftPayload } => Boolean(item.payload));
  const wordIds = Array.from(new Set(payloadItems.map((item) => item.payload.targetWordId)));
  const [words, savedEntries] = await Promise.all([
    wordIds.length
      ? prisma.word.findMany({
          where: { id: { in: wordIds } },
          select: { id: true, word: true }
        })
      : [],
    prisma.mnemonicEntry.findMany({
      where: { editorNote: { contains: "ai-extension-review" } },
      select: {
        id: true,
        title: true,
        splitText: true,
        contentMarkdown: true,
        editorNote: true,
        targetWordId: true,
        status: true,
        targetWord: { select: { word: true } }
      }
    })
  ]);
  const wordById = new Map(words.map((word) => [word.id, word]));
  const entryById = new Map(savedEntries.map((entry) => [entry.id, entry]));
  const payloadByTargetWordId = new Map(payloadItems.map((item) => [item.payload.targetWordId, item.payload]));

  const plans = payloadItems
    .map(({ draft, payload }) => {
      const targetWord = wordById.get(payload.targetWordId)?.word || draft.word || payload.targetWord;
      const currentDraftSplit = draft.splitText ?? "";
      const currentPayloadSplit = payload.splitText;
      const nextSplitText =
        normalizeSplitTextForWord(currentDraftSplit, targetWord) ||
        splitTextFromPayload(payload, targetWord) ||
        normalizeSplitTextForWord(currentPayloadSplit, targetWord);
      const savedEntry = draft.savedEntryId ? entryById.get(draft.savedEntryId) : null;
      const shouldUpdateEntry =
        Boolean(savedEntry) &&
        savedEntry?.editorNote?.includes("ai-extension-review") === true &&
        normalizeSplitTextForWord(savedEntry.splitText, targetWord) !== nextSplitText;

      return {
        draftId: draft.id,
        status: draft.status,
        word: targetWord,
        payload,
        currentDraftSplit,
        currentPayloadSplit,
        nextSplitText,
        savedEntryId: savedEntry?.id ?? null,
        shouldUpdateDraft: currentDraftSplit !== nextSplitText || currentPayloadSplit !== nextSplitText,
        shouldUpdateEntry,
        entryStatus: savedEntry?.status ?? null
      };
    })
    .filter((plan) => plan.nextSplitText && (plan.shouldUpdateDraft || plan.shouldUpdateEntry));
  const plannedEntryIds = new Set(plans.map((plan) => plan.savedEntryId).filter(Boolean));
  const entryPlans = savedEntries
    .filter((entry) => !plannedEntryIds.has(entry.id))
    .map((entry) => {
      const targetWord = entry.targetWord.word;
      const payload = payloadByTargetWordId.get(entry.targetWordId);
      const nextSplitText =
        normalizeSplitTextForWord(entry.splitText, targetWord) ||
        (payload ? splitTextFromPayload(payload, targetWord) : "");
      return {
        entryId: entry.id,
        word: targetWord,
        status: entry.status,
        currentSplitText: entry.splitText ?? "",
        nextSplitText
      };
    })
    .filter((plan) => plan.nextSplitText && plan.currentSplitText !== plan.nextSplitText);

  const planPath = path.join(outputDir, `split-normalization-plan-${apply ? "apply" : "dry-run"}-${timestamp}.json`);
  await fs.writeFile(
    planPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        apply,
        source: aiExtensionDraftSource,
        draftCount: drafts.length,
        payloadDraftCount: payloadItems.length,
        plannedDraftUpdates: plans.filter((plan) => plan.shouldUpdateDraft).length,
        plannedSavedEntryUpdates: plans.filter((plan) => plan.shouldUpdateEntry).length + entryPlans.length,
        plans: plans.map((plan) => ({
          draftId: plan.draftId,
          status: plan.status,
          word: plan.word,
          currentDraftSplit: plan.currentDraftSplit,
          currentPayloadSplit: plan.currentPayloadSplit,
          nextSplitText: plan.nextSplitText,
          savedEntryId: plan.savedEntryId,
          entryStatus: plan.entryStatus,
          shouldUpdateDraft: plan.shouldUpdateDraft,
          shouldUpdateEntry: plan.shouldUpdateEntry
        })),
        entryPlans
      },
      null,
      2
    )
  );

  if (apply && (plans.length || entryPlans.length)) {
    const adminId = admin?.id;
    if (!adminId) throw new Error("找不到 active admin，不能写入 AI 延伸划分修复审计日志。");
    await prisma.$transaction(
      async (tx) => {
        for (const plan of plans) {
          if (plan.shouldUpdateDraft) {
            await tx.importDraft.update({
              where: { id: plan.draftId },
              data: {
                splitText: plan.nextSplitText,
                agentPayload: {
                  ...plan.payload,
                  splitText: plan.nextSplitText
                } satisfies Prisma.InputJsonObject
              }
            });
          }

          if (plan.shouldUpdateEntry && plan.savedEntryId) {
            const entry = await tx.mnemonicEntry.findUniqueOrThrow({
              where: { id: plan.savedEntryId }
            });
            if (entry.editorNote?.includes("ai-extension-review") !== true) continue;
            await tx.mnemonicEntryVersion.create({
              data: {
                mnemonicEntryId: entry.id,
                contentMarkdown: entry.contentMarkdown,
                splitText: entry.splitText,
                title: entry.title,
                editorId: adminId
              }
            });
            await tx.mnemonicEntry.update({
              where: { id: entry.id },
              data: {
                splitText: plan.nextSplitText,
                plainText: markdownToPlainText(
                  [plan.nextSplitText ? `划分：${plan.nextSplitText}` : "", entry.contentMarkdown].filter(Boolean).join("\n\n")
                )
              }
            });
          }
        }

        for (const plan of entryPlans) {
          const entry = await tx.mnemonicEntry.findUniqueOrThrow({
            where: { id: plan.entryId }
          });
          if (entry.editorNote?.includes("ai-extension-review") !== true) continue;
          await tx.mnemonicEntryVersion.create({
            data: {
              mnemonicEntryId: entry.id,
              contentMarkdown: entry.contentMarkdown,
              splitText: entry.splitText,
              title: entry.title,
              editorId: adminId
            }
          });
          await tx.mnemonicEntry.update({
            where: { id: entry.id },
            data: {
              splitText: plan.nextSplitText,
              plainText: markdownToPlainText(
                [plan.nextSplitText ? `划分：${plan.nextSplitText}` : "", entry.contentMarkdown].filter(Boolean).join("\n\n")
              )
            }
          });
        }

        await tx.auditLog.create({
          data: {
            actorId: adminId,
            action: "AI_EXTENSION_ROUTE_FILL_SPLIT_NORMALIZE",
            entityType: "ImportDraftBatch",
            entityId: timestamp,
            metadataJson: {
              source: aiExtensionDraftSource,
              draftUpdates: plans.filter((plan) => plan.shouldUpdateDraft).length,
              savedEntryUpdates: plans.filter((plan) => plan.shouldUpdateEntry).length,
              orphanEntryUpdates: entryPlans.length,
              snapshotPath,
              planPath
            } satisfies Prisma.InputJsonObject
          }
        });
      },
      { timeout: 60_000 }
    );
  }

  const invalidAfterPlan = payloadItems.filter(({ draft, payload }) => {
    const targetWord = wordById.get(payload.targetWordId)?.word || draft.word || payload.targetWord;
    const planned = plans.find((plan) => plan.draftId === draft.id);
    const splitText = planned?.nextSplitText ?? draft.splitText ?? payload.splitText;
    return Boolean(splitText) && !normalizeSplitTextForWord(splitText, targetWord);
  }).length;

  console.log(`模式：${apply ? "apply" : "dry-run"}`);
  console.log(`AI 延伸草稿：${drafts.length}`);
  console.log(`计划更新草稿：${plans.filter((plan) => plan.shouldUpdateDraft).length}`);
  console.log(`计划更新已批准/归档正式卡：${plans.filter((plan) => plan.shouldUpdateEntry).length + entryPlans.length}`);
  console.log(`计划后仍不合规划分：${invalidAfterPlan}`);
  console.log(`备份快照：${snapshotPath}`);
  console.log(`计划文件：${planPath}`);
  console.log("前 20 个更新：");
  for (const plan of plans.slice(0, 20)) {
    console.log(`- ${plan.word}: \"${plan.currentDraftSplit || plan.currentPayloadSplit}\" -> \"${plan.nextSplitText}\"`);
  }
  for (const plan of entryPlans.slice(0, Math.max(0, 20 - plans.length))) {
    console.log(`- ${plan.word} (${plan.status}): \"${plan.currentSplitText}\" -> \"${plan.nextSplitText}\"`);
  }
}

function splitTextFromPayload(payload: AiExtensionDraftPayload, targetWord: string) {
  const base = payload.baseWord.toLowerCase();
  const target = targetWord.toLowerCase();
  const parts = payload.ruleKey.split(":");

  if (payload.ruleKey.startsWith("prefix:")) {
    const prefix = parts[1] ?? "";
    return splitTextFromParts(target, prefix, base);
  }
  if (payload.ruleKey.startsWith("suffix:exact:")) {
    const suffix = parts.at(-1) ?? "";
    return splitTextFromParts(target, base, suffix);
  }
  if (payload.ruleKey.startsWith("suffix:drop-e:")) {
    const suffix = parts.at(-1) ?? "";
    const stem = base.endsWith("e") ? base.slice(0, -1) : base;
    return splitTextFromParts(target, stem, suffix);
  }
  if (payload.ruleKey.startsWith("suffix:y-i:")) {
    const suffix = parts.at(-1) ?? "";
    const stem = base.endsWith("y") ? base.slice(0, -1) : base;
    return splitTextFromParts(target, `${stem}i`, suffix);
  }
  if (payload.ruleKey === "suffix:le-ility") {
    return splitTextFromParts(target, target.slice(0, -"ity".length), "ity");
  }
  if (payload.ruleKey === "suffix:le-ly") {
    return splitTextFromParts(target, target.slice(0, -1), "y");
  }
  if (payload.ruleKey.startsWith("reverse-agent:")) {
    return splitTextFromParts(target, target);
  }

  return "";
}

function splitTextFromParts(target: string, ...parts: string[]) {
  return normalizeSplitTextForWord(parts.join(" | "), target);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
