import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { MnemonicStatus, Prisma, UserRole } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { markdownToPlainText, renderMnemonicMarkdown } from "../src/lib/wiki-links/renderer";
import { syncEntryWikiLinks } from "../src/lib/wiki-links/resolve";
import type { MnemonicLogicAuditIssue, MnemonicLogicAuditReport } from "../src/lib/mnemonic-logic-audit-report";

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

const command = process.argv[2] ?? "status";
const latestReportPath = path.join(process.cwd(), "tmp", "mnemonic-logic-audit", "latest.json");
const workflowDir = path.join(process.cwd(), "tmp", "logic-audit-card-repair");
const severityRank = new Map([
  ["P0", 0],
  ["P1", 1],
  ["P2", 2],
  ["P3", 3]
]);

type RepairDecision = "repaired" | "confirmed_ok" | "skipped";

type RepairPlan = {
  repairs: Array<{
    wordId: string;
    entryId: string;
    beforeHash: string;
    decision: RepairDecision;
    reason: string;
    changeSummary: string;
    nextSplitText?: string | null;
    nextContentMarkdown?: string;
    markFixed?: boolean;
  }>;
};

type IssueGroup = {
  wordId: string;
  word: string;
  slug: string;
  levelTags: string[];
  primarySeverity: string;
  primaryIssueType: string;
  issues: MnemonicLogicAuditIssue[];
};

async function main() {
  await fs.mkdir(workflowDir, { recursive: true });

  if (command === "status") {
    await printStatus();
    return;
  }

  if (command === "next") {
    await exportNext();
    return;
  }

  if (command === "apply") {
    await applyRepairs();
    return;
  }

  throw new Error(`Unknown command: ${command}. Use status, next, or apply.`);
}

async function printStatus() {
  const report = await readRawReport();
  const groups = groupRemainingIssues(report);
  const issueWordIds = new Set(report.issues.map((issue) => issue.wordId));
  const fixedWordIds = new Set((report.fixedWordIds ?? []).filter((wordId) => issueWordIds.has(wordId)));
  const bySeverity = countBy(groups, (group) => group.primarySeverity);
  const byIssueType = countBy(groups, (group) => group.primaryIssueType);

  console.log(
    JSON.stringify(
      {
        report: latestReportPath,
        status: report.status,
        totalEntries: report.totalEntries,
        auditedEntries: report.auditedEntries,
        issueRows: report.issues.length,
        issueWords: issueWordIds.size,
        fixedIssueWords: fixedWordIds.size,
        remainingIssueWords: groups.length,
        bySeverity,
        byIssueType,
        nextWords: groups.slice(0, 12).map((group) => ({
          word: group.word,
          severity: group.primarySeverity,
          issueType: group.primaryIssueType,
          reason: group.issues[0]?.reason ?? ""
        }))
      },
      null,
      2
    )
  );
}

async function exportNext() {
  const limit = numberArg("--limit") ?? 8;
  const out = stringArg("--out") ?? path.join(workflowDir, `next-${timestamp()}.json`);
  const report = await readRawReport();
  const groups = groupRemainingIssues(report).slice(0, limit);
  const wordIds = groups.map((group) => group.wordId);
  const entries = await prisma.mnemonicEntry.findMany({
    where: {
      targetWordId: { in: wordIds },
      status: { not: MnemonicStatus.ARCHIVED }
    },
    select: {
      id: true,
      title: true,
      splitText: true,
      contentMarkdown: true,
      plainText: true,
      sourceType: true,
      status: true,
      isOfficialRecommended: true,
      sortOrder: true,
      updatedAt: true,
      targetWord: {
        select: {
          id: true,
          word: true,
          slug: true,
          levelTags: true,
          partOfSpeech: true,
          meaningCn: true,
          meaningEn: true,
          shortMeaningCn: true,
          exampleSentence: true,
          exampleTranslation: true
        }
      }
    },
    orderBy: [{ targetWord: { word: "asc" } }, { sourceType: "asc" }, { sortOrder: "asc" }]
  });
  const entriesByWordId = groupBy(entries, (entry) => entry.targetWord.id);
  const payload = {
    generatedAt: new Date().toISOString(),
    instructions: [
      "Read and repair one word at a time.",
      "Do not use broad regex/bulk rewrite rules to mutate card text.",
      "Only mark a word fixed after manually checking its current card, issue evidence, dictionary fields, examples, and related-word block.",
      "Traditional-character and OCR alerts are hints only; inspect the full card before editing.",
      "Prepare an apply JSON with one explicit repair item per word when edits are ready."
    ],
    remainingBeforeExport: groupRemainingIssues(report).length,
    items: groups.map((group) => ({
      word: group.word,
      wordId: group.wordId,
      slug: group.slug,
      levelTags: group.levelTags,
      issues: group.issues,
      entries: (entriesByWordId.get(group.wordId) ?? []).map((entry) => ({
        entryId: entry.id,
        beforeHash: entryHash(entry),
        title: entry.title,
        splitText: entry.splitText,
        contentMarkdown: entry.contentMarkdown,
        sourceType: entry.sourceType,
        status: entry.status,
        isOfficialRecommended: entry.isOfficialRecommended,
        sortOrder: entry.sortOrder,
        updatedAt: entry.updatedAt.toISOString(),
        alerts: detectAttentionHints(entry.contentMarkdown, entry.splitText ?? ""),
        dictionary: {
          partOfSpeech: entry.targetWord.partOfSpeech,
          meaningCn: entry.targetWord.meaningCn,
          meaningEn: entry.targetWord.meaningEn ?? "",
          shortMeaningCn: entry.targetWord.shortMeaningCn,
          exampleSentence: entry.targetWord.exampleSentence ?? "",
          exampleTranslation: entry.targetWord.exampleTranslation ?? ""
        }
      }))
    }))
  };

  await fs.writeFile(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Exported ${groups.length} words to ${out}`);
}

async function applyRepairs() {
  const input = stringArg("--input");
  if (!input) throw new Error("Missing --input=path/to/repair-plan.json");

  const plan = JSON.parse(await fs.readFile(path.resolve(input), "utf8")) as RepairPlan;
  if (!Array.isArray(plan.repairs) || !plan.repairs.length) throw new Error("Repair plan has no repairs.");

  const runId = timestamp();
  const report = await readRawReport();
  const issueWordIds = new Set(report.issues.map((issue) => issue.wordId));
  const fixedWordIds = new Set(report.fixedWordIds ?? []);
  const actor = await findActor();
  const runDir = path.join(workflowDir, "runs");
  const backupDir = path.join(workflowDir, "backups");
  await fs.mkdir(runDir, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });

  const entryIds = plan.repairs.map((repair) => repair.entryId);
  const entries = await prisma.mnemonicEntry.findMany({
    where: { id: { in: entryIds } },
    select: {
      id: true,
      targetWordId: true,
      title: true,
      splitText: true,
      contentMarkdown: true,
      contentHtml: true,
      plainText: true,
      targetWord: { select: { id: true, word: true, slug: true, levelTags: true } }
    }
  });
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const backup = [];
  const results = [];

  for (const repair of plan.repairs) {
    const entry = entryById.get(repair.entryId);
    if (!entry) throw new Error(`Entry not found: ${repair.entryId}`);
    if (entry.targetWordId !== repair.wordId) {
      throw new Error(`Repair wordId does not match entry target: ${repair.entryId}`);
    }
    if (!issueWordIds.has(repair.wordId)) {
      throw new Error(`Word is not in the logic-audit issue set: ${entry.targetWord.word}`);
    }
    if (entryHash(entry) !== repair.beforeHash) {
      throw new Error(`Before hash mismatch for ${entry.targetWord.word}; re-export and re-read this word.`);
    }

    backup.push({
      word: entry.targetWord.word,
      wordId: repair.wordId,
      entryId: entry.id,
      title: entry.title,
      splitText: entry.splitText,
      contentMarkdown: entry.contentMarkdown,
      contentHtml: entry.contentHtml,
      plainText: entry.plainText
    });

    if (repair.decision === "skipped") {
      results.push({
        word: entry.targetWord.word,
        entryId: entry.id,
        decision: repair.decision,
        changed: false,
        markedFixed: false,
        reason: repair.reason
      });
      continue;
    }

    const nextSplitText =
      repair.decision === "repaired" && Object.prototype.hasOwnProperty.call(repair, "nextSplitText")
        ? (repair.nextSplitText?.trim() || null)
        : entry.splitText;
    const nextContentMarkdown =
      repair.decision === "repaired" && typeof repair.nextContentMarkdown === "string"
        ? normalizeMarkdown(repair.nextContentMarkdown)
        : entry.contentMarkdown;
    const changed = nextSplitText !== entry.splitText || nextContentMarkdown !== entry.contentMarkdown;

    if (repair.decision === "repaired" && !changed) {
      throw new Error(`Repair for ${entry.targetWord.word} is marked repaired but has no content/split change.`);
    }

    if (changed) {
      const contentHtml = await renderMnemonicMarkdown(nextContentMarkdown);
      const plainText = markdownToPlainText(
        [nextSplitText ? `划分：${nextSplitText}` : "", nextContentMarkdown].filter(Boolean).join("\n\n")
      );

      await prisma.$transaction(async (tx) => {
        await tx.mnemonicEntryVersion.create({
          data: {
            mnemonicEntryId: entry.id,
            title: entry.title,
            splitText: entry.splitText,
            contentMarkdown: entry.contentMarkdown,
            editorId: actor.id
          }
        });
        await tx.mnemonicEntry.update({
          where: { id: entry.id },
          data: {
            splitText: nextSplitText,
            contentMarkdown: nextContentMarkdown,
            contentHtml,
            plainText
          }
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: "CODEX_LOGIC_AUDIT_MANUAL_REPAIR",
            entityType: "MnemonicEntry",
            entityId: entry.id,
            metadataJson: {
              word: entry.targetWord.word,
              wordId: repair.wordId,
              reason: repair.reason,
              changeSummary: repair.changeSummary,
              beforeHash: repair.beforeHash,
              afterHash: hashParts(nextSplitText, nextContentMarkdown)
            } satisfies Prisma.InputJsonObject
          }
        });
        await syncEntryWikiLinks(entry.id, actor.id, tx);
      });
    } else {
      await prisma.auditLog.create({
        data: {
          actorId: actor.id,
          action: "CODEX_LOGIC_AUDIT_CONFIRMED_OK",
          entityType: "MnemonicEntry",
          entityId: entry.id,
          metadataJson: {
            word: entry.targetWord.word,
            wordId: repair.wordId,
            reason: repair.reason,
            changeSummary: repair.changeSummary,
            beforeHash: repair.beforeHash
          } satisfies Prisma.InputJsonObject
        }
      });
    }

    const shouldMarkFixed = repair.markFixed !== false;
    if (shouldMarkFixed) fixedWordIds.add(repair.wordId);
    results.push({
      word: entry.targetWord.word,
      entryId: entry.id,
      decision: repair.decision,
      changed,
      markedFixed: shouldMarkFixed,
      reason: repair.reason,
      changeSummary: repair.changeSummary
    });
  }

  const backupPath = path.join(backupDir, `${runId}.json`);
  await fs.writeFile(backupPath, `${JSON.stringify({ runId, createdAt: new Date().toISOString(), backup }, null, 2)}\n`);

  const nextReport: MnemonicLogicAuditReport = {
    ...report,
    updatedAt: new Date().toISOString(),
    fixedWordIds: [...fixedWordIds].sort()
  };
  await writeRawReport(nextReport);

  const summaryPath = path.join(runDir, `${runId}.json`);
  await fs.writeFile(
    summaryPath,
    `${JSON.stringify(
      {
        runId,
        createdAt: new Date().toISOString(),
        input: path.resolve(input),
        backupPath,
        results
      },
      null,
      2
    )}\n`
  );
  await writeLatestSummary(results, summaryPath, backupPath);
  console.log(`Applied ${results.length} decisions. Summary: ${summaryPath}`);
  console.log(`Backup: ${backupPath}`);
}

async function readRawReport() {
  return JSON.parse(await fs.readFile(latestReportPath, "utf8")) as MnemonicLogicAuditReport;
}

async function writeRawReport(report: MnemonicLogicAuditReport) {
  const tempPath = `${latestReportPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.rename(tempPath, latestReportPath);
}

function groupRemainingIssues(report: MnemonicLogicAuditReport): IssueGroup[] {
  const fixedWordIds = new Set(report.fixedWordIds ?? []);
  const grouped = new Map<string, IssueGroup>();
  for (const issue of report.issues) {
    if (fixedWordIds.has(issue.wordId)) continue;
    const group =
      grouped.get(issue.wordId) ??
      ({
        wordId: issue.wordId,
        word: issue.word,
        slug: issue.slug,
        levelTags: issue.levelTags,
        primarySeverity: issue.severity,
        primaryIssueType: issue.issueType,
        issues: []
      } satisfies IssueGroup);
    group.issues.push(issue);
    group.primarySeverity = mostSevere(group.primarySeverity, issue.severity);
    if (severityRank.get(issue.severity) === severityRank.get(group.primarySeverity)) {
      group.primaryIssueType = issue.issueType;
    }
    grouped.set(issue.wordId, group);
  }
  return [...grouped.values()].sort(compareIssueGroups);
}

function compareIssueGroups(left: IssueGroup, right: IssueGroup) {
  const severity = (severityRank.get(left.primarySeverity) ?? 99) - (severityRank.get(right.primarySeverity) ?? 99);
  if (severity !== 0) return severity;
  return left.word.localeCompare(right.word, "en");
}

function mostSevere(left: string, right: string) {
  return (severityRank.get(right) ?? 99) < (severityRank.get(left) ?? 99) ? right : left;
}

function entryHash(entry: { splitText: string | null; contentMarkdown: string }) {
  return hashParts(entry.splitText, entry.contentMarkdown);
}

function hashParts(splitText: string | null, contentMarkdown: string) {
  return crypto.createHash("sha256").update(JSON.stringify({ splitText, contentMarkdown })).digest("hex");
}

async function findActor() {
  const actor = await prisma.user.findFirst({
    where: { role: UserRole.ADMIN },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  if (!actor) throw new Error("No ADMIN user found for audit/version records.");
  return actor;
}

function detectAttentionHints(contentMarkdown: string, splitText: string) {
  const text = `${splitText}\n${contentMarkdown}`;
  const traditionalHits = [...new Set([...text.matchAll(/[樹樣樣義詞單圖這個為會後對裡與來開門題錯語記聯關係應實說讓從壓]/gu)].map((match) => match[0]))];
  const ocrHits = [
    /\b[a-z]{1,3}\d+[a-z]{1,3}\b/iu,
    /[丨｜]/u,
    /={2,}\s*PAGE\s*\d+\s*={2,}/iu,
    /EDU[CE]ATI?O?n|FOREST\s+EDU[CE]ATI?O?n|树成林/u,
    /表示w\s*/u,
    /骨絡/u
  ]
    .filter((pattern) => pattern.test(text))
    .map((pattern) => String(pattern));
  return {
    traditionalChars: traditionalHits,
    ocrPatterns: ocrHits
  };
}

function normalizeMarkdown(value: string) {
  return value.replace(/\r\n?/gu, "\n").trim();
}

async function writeLatestSummary(
  results: Array<{
    word: string;
    decision: RepairDecision;
    changed: boolean;
    markedFixed: boolean;
    reason: string;
    changeSummary?: string;
  }>,
  summaryPath: string,
  backupPath: string
) {
  const lines = [
    "# Logic Audit Card Repair Latest Run",
    "",
    `- Updated at: ${new Date().toISOString()}`,
    `- Run report: ${summaryPath}`,
    `- Backup: ${backupPath}`,
    "",
    "## Decisions",
    "",
    ...results.map(
      (result) =>
        `- ${result.word}: ${result.decision}${result.changed ? ", changed" : ""}${result.markedFixed ? ", marked fixed" : ""} — ${result.changeSummary || result.reason}`
    ),
    ""
  ];
  await fs.writeFile(path.join(workflowDir, "latest-summary.md"), lines.join("\n"));
}

function countBy<T>(items: T[], keyFn: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K) {
  const grouped = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

function stringArg(name: string) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArg(name: string) {
  const value = stringArg(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    if (process.env[key]) continue;
    process.env[key] = unquote(trimmed.slice(equalsIndex + 1).trim());
  }
}

function unquote(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
