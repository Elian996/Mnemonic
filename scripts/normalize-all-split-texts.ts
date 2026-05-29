import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../src/lib/db";
import {
  aiExtensionDraftSource,
  isParentheticalSplitTextValidForWord,
  normalizeSplitTextForWord,
  readDraftPayload
} from "../src/lib/ai-extension-route-fill";
import { markdownToPlainText } from "../src/lib/wiki-links/renderer";

const apply = process.argv.includes("--apply");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(process.cwd(), "tmp", "split-text-normalization");

type EntryRecord = Awaited<ReturnType<typeof readEntryRecords>>[number];
type DraftRecord = Awaited<ReturnType<typeof readDraftRecords>>[number];

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const [entries, drafts, admin] = await Promise.all([
    readEntryRecords(),
    readDraftRecords(),
    prisma.user.findFirst({
      where: { role: UserRole.ADMIN, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true }
    })
  ]);
  if (apply && !admin) throw new Error("找不到 active admin，不能写入划分修复审计日志。");

  const snapshotPath = path.join(outputDir, `before-${timestamp}.json`);
  await fs.writeFile(
    snapshotPath,
    JSON.stringify(
      {
        entries,
        drafts
      },
      null,
      2
    )
  );

  const entryPlans = entries
    .map(planEntry)
    .filter((plan): plan is NonNullable<ReturnType<typeof planEntry>> => Boolean(plan));
  const draftPlans = drafts
    .map(planDraft)
    .filter((plan): plan is NonNullable<ReturnType<typeof planDraft>> => Boolean(plan));
  const planPath = path.join(outputDir, `plan-${apply ? "apply" : "dry-run"}-${timestamp}.json`);
  await fs.writeFile(
    planPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        apply,
        entryCount: entries.length,
        draftCount: drafts.length,
        entryUpdates: entryPlans.length,
        draftUpdates: draftPlans.length,
        entryPlans,
        draftPlans
      },
      null,
      2
    )
  );

  if (apply && (entryPlans.length || draftPlans.length)) {
    const adminId = admin?.id;
    if (!adminId) throw new Error("找不到 active admin，不能写入划分修复审计日志。");
    await prisma.$transaction(
      async (tx) => {
        for (const plan of entryPlans) {
          const entry = entries.find((item) => item.id === plan.id);
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
              splitText: plan.nextSplitText,
              plainText: markdownToPlainText(
                [plan.nextSplitText ? `划分：${plan.nextSplitText}` : "", entry.contentMarkdown].filter(Boolean).join("\n\n")
              )
            }
          });
        }

        for (const plan of draftPlans) {
          const draft = drafts.find((item) => item.id === plan.id);
          if (!draft) continue;
          const data: Prisma.ImportDraftUpdateInput = {
            splitText: plan.nextSplitText
          };
          if (draft.source === aiExtensionDraftSource) {
            data.agentPayload = {
              ...(readDraftPayload(draft.agentPayload) ?? {}),
              splitText: plan.nextSplitText ?? ""
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
            action: "MNEMONIC_SPLIT_TEXT_NORMALIZE",
            entityType: "SplitTextBatch",
            entityId: timestamp,
            metadataJson: {
              entryUpdates: entryPlans.length,
              draftUpdates: draftPlans.length,
              snapshotPath,
              planPath
            } satisfies Prisma.InputJsonObject
          }
        });
      },
      { timeout: 60_000 }
    );
  }

  console.log(`模式：${apply ? "apply" : "dry-run"}`);
  console.log(`扫描单词卡：${entries.length}`);
  console.log(`扫描导入草稿：${drafts.length}`);
  console.log(`计划修单词卡划分：${entryPlans.length}`);
  console.log(`计划修导入草稿划分：${draftPlans.length}`);
  console.log(`备份快照：${snapshotPath}`);
  console.log(`计划文件：${planPath}`);
  console.log("前 40 个单词卡修复：");
  for (const plan of entryPlans.slice(0, 40)) {
    console.log(`- ${plan.word} [${plan.status}/${plan.sourceType}]: "${plan.currentSplitText}" -> "${plan.nextSplitText ?? ""}" (${plan.reason})`);
  }
  if (draftPlans.length) {
    console.log("前 20 个导入草稿修复：");
    for (const plan of draftPlans.slice(0, 20)) {
      console.log(`- ${plan.word} [${plan.source}]: "${plan.currentSplitText}" -> "${plan.nextSplitText ?? ""}" (${plan.reason})`);
    }
  }
}

async function readEntryRecords() {
  return prisma.mnemonicEntry.findMany({
    where: {
      splitText: { not: null }
    },
    select: {
      id: true,
      title: true,
      splitText: true,
      contentMarkdown: true,
      sourceType: true,
      status: true,
      targetWord: { select: { word: true, slug: true } }
    },
    orderBy: [{ updatedAt: "desc" }]
  });
}

async function readDraftRecords() {
  return prisma.importDraft.findMany({
    where: {
      splitText: { not: null }
    },
    select: {
      id: true,
      source: true,
      status: true,
      word: true,
      splitText: true,
      agentPayload: true
    },
    orderBy: [{ updatedAt: "desc" }]
  });
}

function planEntry(entry: EntryRecord) {
  const currentSplitText = entry.splitText?.trim() ?? "";
  if (!currentSplitText) return null;
  const normalized = normalizeLooseSplitText(currentSplitText, entry.targetWord.word);
  const nextSplitText = normalized.value || null;
  if (nextSplitText === currentSplitText) return null;
  return {
    id: entry.id,
    word: entry.targetWord.word,
    slug: entry.targetWord.slug,
    status: entry.status,
    sourceType: entry.sourceType,
    currentSplitText,
    nextSplitText,
    reason: normalized.reason
  };
}

function planDraft(draft: DraftRecord) {
  const currentSplitText = draft.splitText?.trim() ?? "";
  if (!currentSplitText) return null;
  const normalized = normalizeLooseSplitText(currentSplitText, draft.word);
  const nextSplitText = normalized.value || null;
  if (nextSplitText === currentSplitText) return null;
  return {
    id: draft.id,
    word: draft.word,
    source: draft.source,
    status: draft.status,
    currentSplitText,
    nextSplitText,
    reason: normalized.reason
  };
}

function normalizeLooseSplitText(splitText: string, word: string) {
  const target = word.trim().toLowerCase().replace(/-/g, "");
  if (isParentheticalSplitTextValidForWord(splitText, word)) {
    return {
      value: splitText.trim(),
      reason: "already-parenthetical"
    };
  }
  const direct = normalizeSplitTextForWord(splitText, word);
  if (direct) {
    return {
      value: direct,
      reason: splitText.trim() === direct ? "already-normal" : "format"
    };
  }

  const cleaned = splitText
    .replace(/^\s*划分\s*[:：]\s*/u, "")
    .replace(/｜/gu, "|")
    .replace(/[–—]/gu, "-")
    .trim();
  const operation = normalizeOperationSplit(cleaned, target);
  if (operation) return { value: operation, reason: "operation" };

  const structuralText = cleaned
    .replace(/[（(][^)）]*[)）]/gu, "")
    .replace(/去\s*[a-z]/giu, "")
    .replace(/drop\s*[a-z]/giu, "");
  const groups = structuralText.match(/[a-z]+/giu)?.map((group) => group.toLowerCase()) ?? [];
  if (groups.length >= 2 && groups.join("") === target) {
    return {
      value: groups.join(" | "),
      reason: "hyphen-or-space"
    };
  }
  const transformedGroups = normalizeSpellingChangeGroups(groups, target);
  if (transformedGroups) {
    return {
      value: transformedGroups,
      reason: "spelling-change"
    };
  }

  return {
    value: "",
    reason: "invalid-clear"
  };
}

function normalizeOperationSplit(splitText: string, target: string) {
  const lower = splitText.toLowerCase();
  const dropLetterMatch = lower.match(/^([a-z]+)\s*-\s*([a-z])\s*\+\s*-?([a-z]+)$/u);
  if (dropLetterMatch) {
    const [, base, letter, suffix] = dropLetterMatch;
    const stem = base.endsWith(letter) ? base.slice(0, -letter.length) : base.replace(new RegExp(`${letter}$`, "u"), "");
    const candidate = splitTextFromParts(target, stem, suffix);
    if (candidate) return candidate;
  }

  const yToIMatch = lower.match(/^([a-z]+)\s*(?::|,)?\s*y\s*(?:->|→)\s*i\s*\+\s*-?([a-z]+)$/u);
  if (yToIMatch) {
    const [, base, suffix] = yToIMatch;
    if (base.endsWith("y")) {
      const candidate = splitTextFromParts(target, `${base.slice(0, -1)}i`, suffix);
      if (candidate) return candidate;
    }
  }

  const plusMatch = lower.match(/^([a-z]+)\s*\+\s*-?([a-z]+)$/u);
  if (plusMatch) {
    const [, base, suffix] = plusMatch;
    const candidate = splitTextFromParts(target, base, suffix);
    if (candidate) return candidate;
  }

  return "";
}

function normalizeSpellingChangeGroups(groups: string[], target: string) {
  if (groups.length < 2) return "";
  const suffix = groups[groups.length - 1];
  const baseParts = groups.slice(0, -1);
  const base = baseParts.join("");

  if (base.endsWith("e")) {
    const stem = base.slice(0, -1);
    const candidate = splitTextFromParts(target, replaceBasePartsWithStem(baseParts, stem).join(" | "), suffix);
    if (candidate) return candidate;
  }

  if (base.endsWith("y")) {
    const stem = `${base.slice(0, -1)}i`;
    const candidate = splitTextFromParts(target, replaceBasePartsWithStem(baseParts, stem).join(" | "), suffix);
    if (candidate) return candidate;

    const dropYStem = base.slice(0, -1);
    const dropYCandidate = splitTextFromParts(target, replaceBasePartsWithStem(baseParts, dropYStem).join(" | "), suffix);
    if (dropYCandidate) return dropYCandidate;
  }

  const last = base.at(-1) ?? "";
  if (last && isDoubleConsonantCandidate(last)) {
    const stem = `${base}${last}`;
    const candidate = splitTextFromParts(target, replaceBasePartsWithStem(baseParts, stem).join(" | "), suffix);
    if (candidate) return candidate;
  }

  return "";
}

function replaceBasePartsWithStem(parts: string[], stem: string) {
  const previousLength = parts.slice(0, -1).join("").length;
  return [...parts.slice(0, -1), stem.slice(previousLength)];
}

function isDoubleConsonantCandidate(letter: string) {
  return /^[bcdfghjklmnpqrstvwxyz]$/iu.test(letter);
}

function splitTextFromParts(target: string, ...parts: string[]) {
  const candidate = parts
    .flatMap((part) => part.split("|"))
    .map((part) => part.trim().replace(/^-+|-+$/gu, ""))
    .filter(Boolean)
    .join(" | ");
  return normalizeSplitTextForWord(candidate, target);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
