import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../src/lib/db";
import {
  aiExtensionDraftSource,
  isParentheticalSplitTextValidForWord,
  readDraftPayload
} from "../src/lib/ai-extension-route-fill";
import { markdownToPlainText } from "../src/lib/wiki-links/renderer";

const apply = process.argv.includes("--apply");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(process.cwd(), "tmp", "split-text-normalization");
const defaultPlanPath = path.join(outputDir, "plan-apply-2026-05-28T07-19-50-999Z.json");
const sourcePlanPath = process.argv.slice(2).find((arg) => arg.endsWith(".json")) ?? defaultPlanPath;

type PlanFile = {
  entryPlans: Array<{
    id: string;
    word: string;
    currentSplitText: string;
    nextSplitText: string | null;
  }>;
  draftPlans: Array<{
    id: string;
    word: string;
    currentSplitText: string;
    nextSplitText: string | null;
  }>;
};

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const sourcePlan = JSON.parse(await fs.readFile(sourcePlanPath, "utf8")) as PlanFile;

  const entryCandidates = sourcePlan.entryPlans.filter((plan) =>
    shouldRestoreParentheticalSplit(plan.currentSplitText, plan.word)
  );
  const draftCandidates = sourcePlan.draftPlans.filter((plan) =>
    shouldRestoreParentheticalSplit(plan.currentSplitText, plan.word)
  );

  const [entries, drafts, admin] = await Promise.all([
    prisma.mnemonicEntry.findMany({
      where: { id: { in: entryCandidates.map((plan) => plan.id) } },
      select: {
        id: true,
        title: true,
        splitText: true,
        contentMarkdown: true,
        sourceType: true,
        status: true,
        targetWord: { select: { word: true, slug: true } }
      }
    }),
    prisma.importDraft.findMany({
      where: { id: { in: draftCandidates.map((plan) => plan.id) } },
      select: {
        id: true,
        source: true,
        status: true,
        word: true,
        splitText: true,
        agentPayload: true
      }
    }),
    prisma.user.findFirst({
      where: { role: UserRole.ADMIN, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true }
    })
  ]);

  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  const entryRestorePlans = entryCandidates
    .map((candidate) => {
      const entry = entryById.get(candidate.id);
      if (!entry) return null;
      if (!isParentheticalSplitTextValidForWord(candidate.currentSplitText, entry.targetWord.word)) return null;
      if ((entry.splitText ?? "") === candidate.currentSplitText) return null;
      return {
        id: entry.id,
        word: entry.targetWord.word,
        slug: entry.targetWord.slug,
        status: entry.status,
        sourceType: entry.sourceType,
        currentSplitText: entry.splitText,
        restoredSplitText: candidate.currentSplitText
      };
    })
    .filter((plan): plan is NonNullable<typeof plan> => Boolean(plan));
  const draftRestorePlans = draftCandidates
    .map((candidate) => {
      const draft = draftById.get(candidate.id);
      if (!draft) return null;
      if (!isParentheticalSplitTextValidForWord(candidate.currentSplitText, draft.word)) return null;
      if ((draft.splitText ?? "") === candidate.currentSplitText) return null;
      return {
        id: draft.id,
        word: draft.word,
        source: draft.source,
        status: draft.status,
        currentSplitText: draft.splitText,
        restoredSplitText: candidate.currentSplitText
      };
    })
    .filter((plan): plan is NonNullable<typeof plan> => Boolean(plan));

  const snapshotPath = path.join(outputDir, `parenthetical-restore-before-${timestamp}.json`);
  const restorePlanPath = path.join(outputDir, `parenthetical-restore-plan-${apply ? "apply" : "dry-run"}-${timestamp}.json`);
  await fs.writeFile(snapshotPath, JSON.stringify({ entries, drafts }, null, 2));
  await fs.writeFile(
    restorePlanPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        apply,
        sourcePlanPath,
        entryUpdates: entryRestorePlans.length,
        draftUpdates: draftRestorePlans.length,
        entryRestorePlans,
        draftRestorePlans
      },
      null,
      2
    )
  );

  if (apply && (entryRestorePlans.length || draftRestorePlans.length)) {
    const adminId = admin?.id;
    if (!adminId) throw new Error("找不到 active admin，不能写入括号划分恢复审计日志。");
    await prisma.$transaction(
      async (tx) => {
        for (const plan of entryRestorePlans) {
          const entry = entryById.get(plan.id);
          if (!entry) continue;
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
              splitText: plan.restoredSplitText,
              plainText: markdownToPlainText(`划分：${plan.restoredSplitText}\n\n${entry.contentMarkdown}`)
            }
          });
        }

        for (const plan of draftRestorePlans) {
          const draft = draftById.get(plan.id);
          if (!draft) continue;
          const data: Prisma.ImportDraftUpdateInput = {
            splitText: plan.restoredSplitText
          };
          if (draft.source === aiExtensionDraftSource) {
            data.agentPayload = {
              ...(readDraftPayload(draft.agentPayload) ?? {}),
              splitText: plan.restoredSplitText
            } satisfies Prisma.InputJsonObject;
          }
          await tx.importDraft.update({
            where: { id: draft.id },
            data
          });
        }

        await tx.auditLog.create({
          data: {
            actorId: adminId,
            action: "MNEMONIC_SPLIT_TEXT_PARENTHESES_RESTORE",
            entityType: "SplitTextBatch",
            entityId: timestamp,
            metadataJson: {
              entryUpdates: entryRestorePlans.length,
              draftUpdates: draftRestorePlans.length,
              sourcePlanPath,
              snapshotPath,
              restorePlanPath
            } satisfies Prisma.InputJsonObject
          }
        });
      },
      { timeout: 60_000 }
    );
  }

  console.log(`模式：${apply ? "apply" : "dry-run"}`);
  console.log(`来源计划：${sourcePlanPath}`);
  console.log(`可恢复单词卡括号划分：${entryRestorePlans.length}`);
  console.log(`可恢复导入草稿括号划分：${draftRestorePlans.length}`);
  console.log(`备份快照：${snapshotPath}`);
  console.log(`恢复计划：${restorePlanPath}`);
  console.log("前 40 个单词卡恢复：");
  for (const plan of entryRestorePlans.slice(0, 40)) {
    console.log(`- ${plan.word}: "${plan.currentSplitText ?? ""}" -> "${plan.restoredSplitText}"`);
  }
  if (draftRestorePlans.length) {
    console.log("前 20 个导入草稿恢复：");
    for (const plan of draftRestorePlans.slice(0, 20)) {
      console.log(`- ${plan.word}: "${plan.currentSplitText ?? ""}" -> "${plan.restoredSplitText}"`);
    }
  }
}

function shouldRestoreParentheticalSplit(splitText: string, word: string) {
  return /[()（）]/u.test(splitText) && isParentheticalSplitTextValidForWord(splitText, word);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
