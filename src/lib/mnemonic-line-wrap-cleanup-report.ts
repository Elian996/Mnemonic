import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type { LevelTag, MnemonicSourceType, MnemonicStatus } from "@prisma/client";

export type MnemonicLineWrapJoinFix = {
  before: string;
  after: string;
};

export type MnemonicLineWrapCleanupItem = {
  entryId: string;
  wordId: string;
  word: string;
  slug: string;
  levelTags: LevelTag[];
  sourceType: MnemonicSourceType;
  status: MnemonicStatus;
  reason: string;
  fixCount: number;
  fixes: MnemonicLineWrapJoinFix[];
  beforeMarkdown: string;
  afterMarkdown: string;
};

export type MnemonicLineWrapCleanupReport = {
  version: 1;
  status: "planned" | "complete";
  createdAt: string;
  updatedAt: string;
  applied: boolean;
  totalEntries: number;
  candidateEntries: number;
  updatedEntries: number;
  backupPath: string | null;
  rules: string[];
  items: MnemonicLineWrapCleanupItem[];
};

const latestReportPath = path.join(process.cwd(), "tmp", "mnemonic-line-wrap-cleanup", "latest.json");

export async function readMnemonicLineWrapCleanupReport(): Promise<MnemonicLineWrapCleanupReport | null> {
  try {
    const content = await fs.readFile(latestReportPath, "utf8");
    return JSON.parse(content) as MnemonicLineWrapCleanupReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
