import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type { LevelTag, MnemonicSourceType, MnemonicStatus } from "@prisma/client";

export type MnemonicMissingImageItem = {
  entryId: string;
  wordId: string;
  word: string;
  slug: string;
  levelTags: LevelTag[];
  sourceType: MnemonicSourceType;
  status: MnemonicStatus;
  cueMatches: string[];
  preview: string;
  reason: string;
  contentMarkdown: string;
};

export type MnemonicMissingImageReport = {
  version: 1;
  status: "complete";
  createdAt: string;
  updatedAt: string;
  totalEntries: number;
  scannedEntries: number;
  imageBackedEntries: number;
  candidateEntries: number;
  rules: string[];
  items: MnemonicMissingImageItem[];
};

const latestReportPath = path.join(process.cwd(), "tmp", "mnemonic-missing-images", "latest.json");

export async function readMnemonicMissingImageReport(): Promise<MnemonicMissingImageReport | null> {
  try {
    const content = await fs.readFile(latestReportPath, "utf8");
    return JSON.parse(content) as MnemonicMissingImageReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
