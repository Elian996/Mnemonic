import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type { LevelTag, MnemonicSourceType, MnemonicStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export type LogicAuditRepairReviewItem = {
  entryId: string;
  wordId: string;
  word: string;
  slug: string;
  shortMeaningCn: string;
  meaningCn: string;
  levelTags: LevelTag[];
  sourceType: MnemonicSourceType;
  status: MnemonicStatus;
  runId: string;
  runCreatedAt: string;
  runSummaryPath: string;
  backupPath: string | null;
  reason: string;
  changeSummary: string;
  beforeSplitText: string | null;
  afterSplitText: string | null;
  beforePreview: string;
  afterPreview: string;
};

type RawRepairRun = {
  runId?: unknown;
  createdAt?: unknown;
  backupPath?: unknown;
  results?: unknown;
};

type RawRepairResult = {
  word?: unknown;
  entryId?: unknown;
  decision?: unknown;
  changed?: unknown;
  reason?: unknown;
  changeSummary?: unknown;
};

type RawBackupFile = {
  backup?: unknown;
};

type RawBackupEntry = {
  entryId?: unknown;
  splitText?: unknown;
  contentMarkdown?: unknown;
};

type RepairRecord = {
  entryId: string;
  word: string;
  runId: string;
  runCreatedAt: string;
  runSummaryPath: string;
  backupPath: string | null;
  reason: string;
  changeSummary: string;
  beforeSplitText: string | null;
  beforeMarkdown: string;
};

const repairRunDir = path.join(process.cwd(), "tmp", "logic-audit-card-repair", "runs");

export async function readLogicAuditRepairReviewItems(): Promise<LogicAuditRepairReviewItem[]> {
  const records = await readRepairRecords();
  if (!records.length) return [];

  const entryIds = records.map((record) => record.entryId);
  const entries = await prisma.mnemonicEntry.findMany({
    where: { id: { in: entryIds } },
    select: {
      id: true,
      splitText: true,
      contentMarkdown: true,
      sourceType: true,
      status: true,
      targetWord: {
        select: {
          id: true,
          word: true,
          slug: true,
          shortMeaningCn: true,
          meaningCn: true,
          levelTags: true
        }
      }
    }
  });
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));

  return records
    .map((record) => {
      const entry = entryById.get(record.entryId);
      if (!entry) return null;

      return {
        entryId: record.entryId,
        wordId: entry.targetWord.id,
        word: entry.targetWord.word || record.word,
        slug: entry.targetWord.slug,
        shortMeaningCn: entry.targetWord.shortMeaningCn,
        meaningCn: entry.targetWord.meaningCn,
        levelTags: entry.targetWord.levelTags,
        sourceType: entry.sourceType,
        status: entry.status,
        runId: record.runId,
        runCreatedAt: record.runCreatedAt,
        runSummaryPath: record.runSummaryPath,
        backupPath: record.backupPath,
        reason: record.reason,
        changeSummary: record.changeSummary,
        beforeSplitText: record.beforeSplitText,
        afterSplitText: entry.splitText,
        beforePreview: previewMarkdown(record.beforeMarkdown),
        afterPreview: previewMarkdown(entry.contentMarkdown)
      } satisfies LogicAuditRepairReviewItem;
    })
    .filter((item): item is LogicAuditRepairReviewItem => item !== null)
    .sort((left, right) => {
      const byRun = left.runCreatedAt.localeCompare(right.runCreatedAt);
      if (byRun !== 0) return byRun;
      return left.word.localeCompare(right.word);
    });
}

async function readRepairRecords() {
  let filenames: string[];
  try {
    filenames = await fs.readdir(repairRunDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const recordsByEntryId = new Map<string, RepairRecord>();
  for (const filename of filenames.filter((name) => name.endsWith(".json")).sort()) {
    const runSummaryPath = path.join(repairRunDir, filename);
    const run = parseObject<RawRepairRun>(await readJson(runSummaryPath));
    const runId = stringValue(run.runId) || filename.replace(/\.json$/, "");
    const runCreatedAt = stringValue(run.createdAt) || runId;
    const backupPath = stringValue(run.backupPath);
    const backupByEntryId = backupPath ? await readBackupEntries(backupPath) : new Map<string, RawBackupEntry>();
    const results = Array.isArray(run.results) ? run.results : [];

    for (const rawResult of results) {
      const result = parseObject<RawRepairResult>(rawResult);
      const entryId = stringValue(result.entryId);
      if (!entryId || result.decision !== "repaired" || result.changed !== true) continue;

      const backup = backupByEntryId.get(entryId);
      recordsByEntryId.set(entryId, {
        entryId,
        word: stringValue(result.word),
        runId,
        runCreatedAt,
        runSummaryPath,
        backupPath: backupPath || null,
        reason: stringValue(result.reason),
        changeSummary: stringValue(result.changeSummary),
        beforeSplitText: nullableStringValue(backup?.splitText),
        beforeMarkdown: stringValue(backup?.contentMarkdown)
      });
    }
  }

  return [...recordsByEntryId.values()];
}

async function readBackupEntries(backupPath: string) {
  const backupByEntryId = new Map<string, RawBackupEntry>();
  try {
    const parsed = parseObject<RawBackupFile>(await readJson(backupPath));
    const entries = Array.isArray(parsed.backup) ? parsed.backup : [];
    for (const rawEntry of entries) {
      const entry = parseObject<RawBackupEntry>(rawEntry);
      const entryId = stringValue(entry.entryId);
      if (entryId) backupByEntryId.set(entryId, entry);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return backupByEntryId;
}

async function readJson(filePath: string) {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
}

function parseObject<T extends Record<string, unknown>>(value: unknown) {
  return value && typeof value === "object" ? (value as T) : ({} as T);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableStringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function previewMarkdown(value: string) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= 520) return compacted;
  return `${compacted.slice(0, 520)}...`;
}
