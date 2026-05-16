import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { MnemonicSourceType, MnemonicStatus, type LevelTag } from "@prisma/client";
import {
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
  | "codex_p0_review";

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
    return appendApprovedCodexReviewIssues(JSON.parse(content) as MnemonicLogicAuditReport);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function updateMnemonicLogicAuditFixedWordIds(wordIds: string[], fixed: boolean) {
  const content = await fs.readFile(latestReportPath, "utf8");
  const report = JSON.parse(content) as MnemonicLogicAuditReport;
  const currentFixedWordIds = new Set(report.fixedWordIds ?? []);
  const changedWordIds: string[] = [];

  for (const wordId of wordIds) {
    const wasFixed = currentFixedWordIds.has(wordId);
    if (fixed) {
      currentFixedWordIds.add(wordId);
    } else {
      currentFixedWordIds.delete(wordId);
    }
    if (wasFixed !== fixed) changedWordIds.push(wordId);
  }

  const nextReport: MnemonicLogicAuditReport = {
    ...report,
    updatedAt: new Date().toISOString(),
    fixedWordIds: [...currentFixedWordIds]
  };
  await fs.writeFile(latestReportPath, `${JSON.stringify(nextReport, null, 2)}\n`);

  return {
    report: nextReport,
    changedWordIds,
    fixedWordIds: nextReport.fixedWordIds ?? []
  };
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
