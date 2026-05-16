import fs from "node:fs";
import path from "node:path";
import type { MnemonicLogicAuditIssue, MnemonicLogicAuditReport } from "../src/lib/mnemonic-logic-audit-report";

const outputDir = stringArg("--output-dir") ?? path.join(process.cwd(), "tmp", "mnemonic-logic-audit");
const reportPath = path.join(outputDir, "latest.json");
const checkpointPath = path.join(outputDir, "gpt-checkpoint.json");
const inputPath = stringArg("--input");
const reset = process.argv.includes("--reset");

type ManualBatch = {
  model: string;
  totalEntries: number;
  auditedEntryIds: string[];
  issues: MnemonicLogicAuditIssue[];
};

if (!inputPath) {
  console.error("Usage: tsx scripts/record-gpt-mnemonic-logic-audit.ts --input=tmp/file.json");
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

const input = JSON.parse(fs.readFileSync(inputPath, "utf8")) as ManualBatch;
const previous = reset ? null : readReport(reportPath);
const checkpoint = reset ? { auditedEntryIds: [] as string[] } : readCheckpoint(checkpointPath);
const previousIssues = previous?.issues ?? [];
const issues = mergeIssues(previousIssues, input.issues);
const auditedIds = new Set<string>([...checkpoint.auditedEntryIds, ...input.auditedEntryIds]);
const auditedEntries = auditedIds.size;
const now = new Date().toISOString();

const report: MnemonicLogicAuditReport = {
  version: 1,
  status: "running",
  createdAt: previous?.createdAt ?? now,
  updatedAt: now,
  model: input.model,
  totalEntries: input.totalEntries,
  auditedEntries,
  issueEntries: new Set(issues.map((issue) => issue.entryId)).size,
  issues,
  failedBatches: previous?.failedBatches ?? []
};

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
fs.writeFileSync(checkpointPath, JSON.stringify({ auditedEntryIds: [...auditedIds].sort(), updatedAt: now }, null, 2));
console.log(`已记录：读过 ${auditedEntries}/${report.totalEntries}，问题卡 ${report.issueEntries}，报告 ${reportPath}`);

function readReport(filePath: string) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as MnemonicLogicAuditReport;
}

function readCheckpoint(filePath: string) {
  if (!fs.existsSync(filePath)) return { auditedEntryIds: [] as string[] };
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { auditedEntryIds?: string[] };
  return { auditedEntryIds: Array.isArray(parsed.auditedEntryIds) ? parsed.auditedEntryIds : [] };
}

function mergeIssues(existing: MnemonicLogicAuditIssue[], incoming: MnemonicLogicAuditIssue[]) {
  const seen = new Set<string>();
  const merged: MnemonicLogicAuditIssue[] = [];
  for (const issue of [...existing, ...incoming]) {
    const key = [issue.entryId, issue.issueType, issue.reason, issue.evidence].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(issue);
  }
  return merged.sort((left, right) => left.word.localeCompare(right.word));
}

function stringArg(name: string) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
