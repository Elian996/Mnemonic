import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { MnemonicSourceType, MnemonicStatus, type LevelTag } from "@prisma/client";
import {
  type CodexP0ReviewState,
  codexP0ManualRestoreAction,
  codexP0RepairMarker,
  metadataHasCodexP0RepairMarker
} from "@/lib/codex-p0-repair";
import { prisma } from "@/lib/db";

export type MnemonicLogicIssueType =
  | "wrong_target"
  | "mixed_card"
  | "split_logic"
  | "meaning_mismatch"
  | "example_mismatch"
  | "related_word_mismatch"
  | "ocr_garbled"
  | "contradiction"
  | "incomplete"
  | "codex_p0_review"
  | "keyword_tree"
  | "keyword_sample_meaning"
  | "keyword_breakthrough";

export type MnemonicLogicIssueSeverity = "P0" | "P1" | "P2" | "P3";

export type MnemonicLogicAuditIssue = {
  entryId: string;
  wordId: string;
  word: string;
  slug: string;
  levelTags: LevelTag[];
  issueType: MnemonicLogicIssueType;
  severity: MnemonicLogicIssueSeverity;
  reason: string;
  evidence: string;
  suggestion: string;
};

export type MnemonicLogicAuditReport = {
  version: 1;
  status: "running" | "complete" | "failed";
  createdAt: string;
  updatedAt: string;
  model: string;
  totalEntries: number;
  auditedEntries: number;
  issueEntries: number;
  issues: MnemonicLogicAuditIssue[];
  fixedWordIds?: string[];
  codexP0ReviewStates?: Record<string, CodexP0ReviewState>;
  failedBatches: Array<{
    batchNumber: number;
    entryIds: string[];
    message: string;
  }>;
};

const latestReportPath = path.join(process.cwd(), "tmp", "mnemonic-logic-audit", "latest.json");

export async function readMnemonicLogicAuditReport(): Promise<MnemonicLogicAuditReport | null> {
  try {
    const content = await fs.readFile(latestReportPath, "utf8");
    return appendKeywordReviewIssues(
      await appendApprovedCodexReviewIssues(JSON.parse(content) as MnemonicLogicAuditReport)
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function updateMnemonicLogicAuditFixedWordIds(wordIds: string[], fixed: boolean) {
  const content = await fs.readFile(latestReportPath, "utf8");
  const report = JSON.parse(content) as MnemonicLogicAuditReport;
  const currentFixedWordIds = new Set(report.fixedWordIds ?? []);
  const currentReviewStates = { ...(report.codexP0ReviewStates ?? {}) };
  const changedWordIds: string[] = [];

  for (const wordId of wordIds) {
    const wasFixed = currentFixedWordIds.has(wordId);
    if (fixed) {
      currentFixedWordIds.add(wordId);
    } else {
      currentFixedWordIds.delete(wordId);
    }
    delete currentReviewStates[wordId];
    if (wasFixed !== fixed) changedWordIds.push(wordId);
  }

  const nextReport: MnemonicLogicAuditReport = {
    ...report,
    updatedAt: new Date().toISOString(),
    fixedWordIds: [...currentFixedWordIds],
    codexP0ReviewStates: currentReviewStates
  };
  await writeMnemonicLogicAuditReport(nextReport);

  return {
    report: nextReport,
    changedWordIds,
    fixedWordIds: nextReport.fixedWordIds ?? []
  };
}

export async function saveMnemonicLogicAuditFixedWordIds(
  wordIds: string[],
  scopedWordIds?: string[]
) {
  const content = await fs.readFile(latestReportPath, "utf8");
  const report = JSON.parse(content) as MnemonicLogicAuditReport;
  const currentFixedWordIds = new Set(report.fixedWordIds ?? []);
  const keywordReviewIssues = await getKeywordReviewIssues();
  const knownWordIds = new Set([
    ...report.issues.map((issue) => issue.wordId),
    ...keywordReviewIssues.map((issue) => issue.wordId),
    ...currentFixedWordIds
  ]);
  const scopedIds = new Set(
    (scopedWordIds?.length ? scopedWordIds : [...knownWordIds]).filter((wordId) =>
      knownWordIds.has(wordId)
    )
  );
  const requestedFixedIds = new Set(
    wordIds.filter((wordId) => knownWordIds.has(wordId) && scopedIds.has(wordId))
  );
  const nextFixedWordIds = new Set(
    [...currentFixedWordIds].filter((wordId) => !scopedIds.has(wordId))
  );
  for (const wordId of requestedFixedIds) {
    nextFixedWordIds.add(wordId);
  }

  const changedWordIds = symmetricDifference(currentFixedWordIds, nextFixedWordIds);
  const currentReviewStates = { ...(report.codexP0ReviewStates ?? {}) };
  for (const wordId of changedWordIds) {
    delete currentReviewStates[wordId];
  }

  const nextReport: MnemonicLogicAuditReport = {
    ...report,
    updatedAt: new Date().toISOString(),
    fixedWordIds: [...nextFixedWordIds].sort(),
    codexP0ReviewStates: currentReviewStates
  };
  await writeMnemonicLogicAuditReport(nextReport);

  return {
    report: nextReport,
    changedWordIds,
    fixedWordIds: nextReport.fixedWordIds ?? []
  };
}

export async function updateMnemonicLogicAuditCodexReviewStates(
  wordIds: string[],
  state: Omit<CodexP0ReviewState, "updatedAt"> | null
) {
  const content = await fs.readFile(latestReportPath, "utf8");
  const report = JSON.parse(content) as MnemonicLogicAuditReport;
  const currentFixedWordIds = new Set(report.fixedWordIds ?? []);
  const currentReviewStates = { ...(report.codexP0ReviewStates ?? {}) };
  const changedWordIds: string[] = [];
  const updatedAt = new Date().toISOString();

  for (const wordId of wordIds) {
    const previous = currentReviewStates[wordId];
    currentFixedWordIds.delete(wordId);
    if (state) {
      currentReviewStates[wordId] = { ...state, updatedAt };
      if (JSON.stringify(previous) !== JSON.stringify(currentReviewStates[wordId])) changedWordIds.push(wordId);
    } else {
      if (previous) changedWordIds.push(wordId);
      delete currentReviewStates[wordId];
    }
  }

  const nextReport: MnemonicLogicAuditReport = {
    ...report,
    updatedAt,
    fixedWordIds: [...currentFixedWordIds],
    codexP0ReviewStates: currentReviewStates
  };
  await writeMnemonicLogicAuditReport(nextReport);

  return {
    report: nextReport,
    changedWordIds,
    fixedWordIds: nextReport.fixedWordIds ?? [],
    codexP0ReviewStates: nextReport.codexP0ReviewStates ?? {}
  };
}

function symmetricDifference(left: Set<string>, right: Set<string>) {
  const changedWordIds: string[] = [];
  for (const wordId of left) {
    if (!right.has(wordId)) changedWordIds.push(wordId);
  }
  for (const wordId of right) {
    if (!left.has(wordId)) changedWordIds.push(wordId);
  }
  return changedWordIds.sort();
}

async function writeMnemonicLogicAuditReport(report: MnemonicLogicAuditReport) {
  const tempPath = `${latestReportPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.rename(tempPath, latestReportPath);
}

async function appendApprovedCodexReviewIssues(report: MnemonicLogicAuditReport) {
  const fixedWordIds = new Set(report.fixedWordIds ?? []);
  if (!fixedWordIds.size) return report;

  const existingWordIds = new Set(report.issues.map((issue) => issue.wordId));
  const codexApprovedCandidateIds = [...fixedWordIds].filter((wordId) => !existingWordIds.has(wordId));
  if (!codexApprovedCandidateIds.length) return report;

  const [entries, emptyLogs, manualRestoreLogs] = await Promise.all([
    prisma.mnemonicEntry.findMany({
      where: {
        targetWordId: { in: codexApprovedCandidateIds },
        sourceType: MnemonicSourceType.OFFICIAL,
        status: { not: MnemonicStatus.ARCHIVED },
        editorNote: { contains: codexP0RepairMarker }
      },
      select: {
        id: true,
        targetWord: {
          select: {
            id: true,
            word: true,
            slug: true,
            levelTags: true
          }
        }
      },
      orderBy: [{ targetWord: { word: "asc" } }]
    }),
    prisma.auditLog.findMany({
      where: { action: "CODEX_P0_SOURCE_EMPTY", entityId: { in: codexApprovedCandidateIds } },
      select: { entityId: true, metadataJson: true }
    }),
    prisma.auditLog.findMany({
      where: { action: codexP0ManualRestoreAction },
      select: { entityId: true }
    })
  ]);
  const entryWordIds = new Set(entries.map((entry) => entry.targetWord.id));
  const manuallyRestoredWordIds = new Set(manualRestoreLogs.map((log) => log.entityId));
  const approvedEmptyWordIds = Array.from(
    new Set(
      emptyLogs
        .filter((log) => metadataHasCodexP0RepairMarker(log.metadataJson))
        .filter((log) => !entryWordIds.has(log.entityId))
        .filter((log) => !manuallyRestoredWordIds.has(log.entityId))
        .map((log) => log.entityId)
    )
  );
  const emptyWords = approvedEmptyWordIds.length
    ? await prisma.word.findMany({
        where: { id: { in: approvedEmptyWordIds } },
        select: { id: true, word: true, slug: true, levelTags: true },
        orderBy: { word: "asc" }
      })
    : [];

  const codexReviewIssues: MnemonicLogicAuditIssue[] = entries.map((entry) => ({
    entryId: `codex-p0-review:${entry.id}`,
    wordId: entry.targetWord.id,
    word: entry.targetWord.word,
    slug: entry.targetWord.slug,
    levelTags: entry.targetWord.levelTags,
    issueType: "codex_p0_review",
    severity: "P0",
    reason: "Codex 按来源重做后已通过人工审核。",
    evidence: "该词来自 Codex P0 来源修复页，人工审核通过后写入已修。",
    suggestion: "已进入已修；后续如发现问题，可在 Codex 修复页撤回通过。"
  }));

  const emptyReviewIssues: MnemonicLogicAuditIssue[] = emptyWords.map((word) => ({
    entryId: `codex-p0-empty-review:${word.id}`,
    wordId: word.id,
    word: word.word,
    slug: word.slug,
    levelTags: word.levelTags,
    issueType: "codex_p0_review",
    severity: "P0",
    reason: "Codex 按规则留空后已通过人工审核。",
    evidence: "该词来自 Codex P0 来源修复页，人工确认留空后写入已修。",
    suggestion: "已进入已修；后续如补到可靠来源，可重新补正式卡。"
  }));

  if (!codexReviewIssues.length && !emptyReviewIssues.length) return report;

  const nextIssues = [...report.issues, ...codexReviewIssues, ...emptyReviewIssues];
  return {
    ...report,
    issues: nextIssues,
    issueEntries: new Set(nextIssues.map((issue) => issue.entryId)).size
  };
}

async function appendKeywordReviewIssues(report: MnemonicLogicAuditReport) {
  const keywordIssues = await getKeywordReviewIssues();
  if (!keywordIssues.length) return report;

  const existingEntryIds = new Set(report.issues.map((issue) => issue.entryId));
  const nextIssues = [
    ...report.issues,
    ...keywordIssues.filter((issue) => !existingEntryIds.has(issue.entryId))
  ];

  return {
    ...report,
    issues: nextIssues,
    issueEntries: new Set(nextIssues.map((issue) => issue.entryId)).size
  };
}

const keywordReviewGroups = [
  { type: "keyword_tree", label: "树/樹", aliases: ["树", "樹"] },
  { type: "keyword_sample_meaning", label: "样义/樣義", aliases: ["样义", "樣義", "樣义", "样義"] },
  { type: "keyword_breakthrough", label: "单词突围/單詞突圍", aliases: ["单词突围", "單詞突圍", "单词突圍", "單詞突围"] }
] as const;

const keywordReviewFields = [
  "title",
  "splitText",
  "contentMarkdown",
  "plainText",
  "contentHtml",
  "editorNote",
  "reviewNote"
] as const;

const keywordReviewFieldLabels: Record<(typeof keywordReviewFields)[number], string> = {
  title: "标题",
  splitText: "划分",
  contentMarkdown: "正文",
  plainText: "纯文本",
  contentHtml: "HTML",
  editorNote: "编辑备注",
  reviewNote: "审核备注"
};

async function getKeywordReviewIssues(): Promise<MnemonicLogicAuditIssue[]> {
  const entries = await prisma.mnemonicEntry.findMany({
    select: {
      id: true,
      status: true,
      sourceType: true,
      isPublic: true,
      title: true,
      splitText: true,
      contentMarkdown: true,
      plainText: true,
      contentHtml: true,
      editorNote: true,
      reviewNote: true,
      targetWord: {
        select: {
          id: true,
          word: true,
          slug: true,
          levelTags: true
        }
      }
    },
    orderBy: [{ targetWord: { word: "asc" } }, { sortOrder: "asc" }, { updatedAt: "desc" }]
  });

  return entries.flatMap((entry) => {
    const hits = collectKeywordHits(entry);
    if (!hits.length) return [];

    const statusLabel =
      entry.status === MnemonicStatus.ARCHIVED
        ? "这张命中卡片已归档，打开单词后可恢复、重建或检查当前活动卡。"
        : "打开单词卡后检查命中的记忆卡正文并修改。";

    return hits.map((hit) => ({
      entryId: `keyword-review:${hit.type}:${entry.id}`,
      wordId: entry.targetWord.id,
      word: entry.targetWord.word,
      slug: entry.targetWord.slug,
      levelTags: entry.targetWord.levelTags,
        issueType: hit.type,
      severity: "P1" as const,
      reason: `命中待改关键词：${hit.label}。`,
      evidence: `${keywordReviewFieldLabels[hit.field]}含“${hit.alias}”：${hit.snippet}`,
      suggestion: `${statusLabel} 来源：${entry.sourceType}${entry.isPublic ? " / public" : " / private"}。`
    }));
  });
}

function collectKeywordHits(entry: Record<(typeof keywordReviewFields)[number], string | null>) {
  return keywordReviewGroups.flatMap((group) => {
    const hit = findKeywordHit(entry, group.aliases);
    return hit ? [{ type: group.type, label: group.label, ...hit }] : [];
  });
}

function findKeywordHit(
  entry: Record<(typeof keywordReviewFields)[number], string | null>,
  aliases: readonly string[]
) {
  for (const field of keywordReviewFields) {
    const value = entry[field] ?? "";
    const alias = aliases.find((item) => value.includes(item));
    if (alias) return { field, alias, snippet: keywordSnippet(value, alias) };
  }
  return null;
}

function keywordSnippet(value: string, alias: string) {
  const clean = value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const index = clean.indexOf(alias);
  if (index < 0) return clean.slice(0, 72);
  const start = Math.max(0, index - 24);
  const end = Math.min(clean.length, index + alias.length + 44);
  return `${start > 0 ? "..." : ""}${clean.slice(start, end)}${end < clean.length ? "..." : ""}`;
}
