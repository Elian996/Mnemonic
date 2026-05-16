import fs from "node:fs";
import path from "node:path";
import { LevelTag, MnemonicStatus, PrismaClient, type LevelTag as LevelTagType } from "@prisma/client";
import type {
  MnemonicLogicAuditIssue,
  MnemonicLogicAuditReport,
  MnemonicLogicIssueSeverity,
  MnemonicLogicIssueType
} from "../src/lib/mnemonic-logic-audit-report";

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

const prisma = new PrismaClient();
const outputDir = stringArg("--output-dir") ?? path.join(process.cwd(), "tmp", "mnemonic-logic-audit");
const checkpointPath = stringArg("--checkpoint") ?? path.join(outputDir, "checkpoint.json");
const issuesPath = stringArg("--issues") ?? path.join(outputDir, "issues.jsonl");
const latestReportPath = path.join(outputDir, "latest.json");
const reset = process.argv.includes("--reset");
const limit = numberArg("--limit") ?? Number.POSITIVE_INFINITY;
const batchSize = numberArg("--batch-size") ?? 8;
const concurrency = numberArg("--concurrency") ?? 2;
const requestTimeoutMs = numberArg("--request-timeout-ms") ?? 180000;
const requestedLevel = parseLevelArg();

const apiKeyEnv = stringArg("--api-key-env");
const apiKey = apiKeyEnv
  ? process.env[apiKeyEnv]
  : firstFilled(process.env.AI_AUTOFILL_API_KEY, process.env.AI_AGENT_API_KEY, process.env.OPENAI_API_KEY);
const baseUrl = stringArg("--base-url") ?? firstFilled(process.env.AI_AUTOFILL_BASE_URL, process.env.AI_AGENT_BASE_URL, "https://api.openai.com/v1");
const model = stringArg("--model") ?? firstFilled(process.env.AI_AUTOFILL_MODEL, process.env.AI_AGENT_MODEL, "gpt-4.1-mini");

type EntryForAudit = {
  id: string;
  title: string;
  splitText: string | null;
  contentMarkdown: string;
  targetWord: {
    id: string;
    word: string;
    slug: string;
    levelTags: LevelTagType[];
    partOfSpeech: string;
    meaningCn: string;
    meaningEn: string | null;
    shortMeaningCn: string;
    exampleSentence: string | null;
    exampleTranslation: string | null;
  };
};

type Checkpoint = {
  startedAt: string;
  updatedAt: string;
  doneEntryIds: string[];
  failedBatches: MnemonicLogicAuditReport["failedBatches"];
};

type AiAuditedItem = {
  entryId: string;
  status: "ok" | "issue";
  issues?: Array<{
    issueType?: MnemonicLogicIssueType;
    severity?: MnemonicLogicIssueSeverity;
    reason?: string;
    evidence?: string;
    suggestion?: string;
  }>;
};

const issueTypes = new Set<MnemonicLogicIssueType>([
  "wrong_target",
  "mixed_card",
  "split_logic",
  "meaning_mismatch",
  "example_mismatch",
  "related_word_mismatch",
  "ocr_garbled",
  "contradiction",
  "incomplete"
]);
const severities = new Set<MnemonicLogicIssueSeverity>(["P0", "P1", "P2", "P3"]);

class FatalAiError extends Error {}

async function main() {
  if (!apiKey) throw new Error("Missing AI API key. Fill AI_AUTOFILL_API_KEY, AI_AGENT_API_KEY, or OPENAI_API_KEY.");

  fs.mkdirSync(outputDir, { recursive: true });
  if (reset) {
    removeIfExists(checkpointPath);
    removeIfExists(issuesPath);
    removeIfExists(latestReportPath);
  }

  const entries = await loadEntries();
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const checkpoint = readCheckpoint(checkpointPath);
  const doneIds = new Set(checkpoint.doneEntryIds);
  const issues = readIssues(issuesPath).filter((issue) => entryById.has(issue.entryId));
  const issueKeys = new Set(issues.map(issueKey));
  const pendingEntries = entries.filter((entry) => !doneIds.has(entry.id));
  const batches = chunk(pendingEntries, batchSize);

  await writeReport("running", entries, doneIds, issues, checkpoint.failedBatches);
  console.log(
    [
      `全量逻辑审计：targets=${entries.length}`,
      `pending=${pendingEntries.length}`,
      `batchSize=${batchSize}`,
      `concurrency=${concurrency}`,
      `model=${model}`,
      requestedLevel ? `level=${requestedLevel}` : "level=all"
    ].join(", ")
  );
  console.log("说明：该脚本只写审计报告，不会修改数据库。");

  let nextBatchIndex = 0;
  let auditedThisRun = 0;

  async function processNextBatch() {
    while (nextBatchIndex < batches.length) {
      const batchNumber = nextBatchIndex + 1;
      const batch = batches[nextBatchIndex];
      nextBatchIndex += 1;
      try {
        const auditedItems = await requestAudit(batch, batchNumber);
        validateAuditedItems(batch, auditedItems);
        const batchIssues = normalizeIssues(batch, auditedItems);
        for (const issue of batchIssues) {
          const key = issueKey(issue);
          if (issueKeys.has(key)) continue;
          issueKeys.add(key);
          issues.push(issue);
          fs.appendFileSync(issuesPath, JSON.stringify(issue) + "\n");
        }
        for (const entry of batch) doneIds.add(entry.id);
        auditedThisRun += batch.length;
        writeCheckpoint(checkpoint, doneIds);
        await writeReport("running", entries, doneIds, issues, checkpoint.failedBatches);
        console.log(
          `已读 ${doneIds.size}/${entries.length}; 本次 ${auditedThisRun}; 问题 ${new Set(issues.map((issue) => issue.entryId)).size}; batch ${batchNumber}/${batches.length}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        checkpoint.failedBatches.push({ batchNumber, entryIds: batch.map((entry) => entry.id), message });
        writeCheckpoint(checkpoint, doneIds);
        await writeReport(error instanceof FatalAiError ? "failed" : "running", entries, doneIds, issues, checkpoint.failedBatches);
        console.error(`Batch ${batchNumber} failed: ${message}`);
        if (error instanceof FatalAiError) throw error;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, () => processNextBatch()));
  await writeReport(doneIds.size >= entries.length ? "complete" : "failed", entries, doneIds, issues, checkpoint.failedBatches);
  console.log(`完成：已读 ${doneIds.size}/${entries.length}，问题卡 ${new Set(issues.map((issue) => issue.entryId)).size}，报告 ${latestReportPath}`);
}

async function loadEntries() {
  const entries = await prisma.mnemonicEntry.findMany({
    where: {
      status: { not: MnemonicStatus.ARCHIVED },
      targetWord: {
        AND: [
          { NOT: { levelTags: { isEmpty: true } } },
          requestedLevel ? { levelTags: { has: requestedLevel } } : {}
        ]
      }
    },
    select: {
      id: true,
      title: true,
      splitText: true,
      contentMarkdown: true,
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
    orderBy: [{ targetWord: { word: "asc" } }, { sortOrder: "asc" }, { updatedAt: "desc" }],
    take: Number.isFinite(limit) ? limit : undefined
  });

  return entries;
}

async function requestAudit(batch: EntryForAudit[], batchNumber: number) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const items = batch.map((entry) => ({
    entryId: entry.id,
    wordId: entry.targetWord.id,
    word: entry.targetWord.word,
    levelTags: entry.targetWord.levelTags,
    dictionary: {
      partOfSpeech: entry.targetWord.partOfSpeech,
      meaningCn: entry.targetWord.meaningCn,
      meaningEn: entry.targetWord.meaningEn ?? "",
      shortMeaningCn: entry.targetWord.shortMeaningCn,
      exampleSentence: entry.targetWord.exampleSentence ?? "",
      exampleTranslation: entry.targetWord.exampleTranslation ?? ""
    },
    mnemonic: {
      title: entry.title,
      splitText: entry.splitText ?? "",
      contentMarkdown: entry.contentMarkdown
    }
  }));

  const body = {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "你是极其严谨但保守的英语助记卡逻辑审稿人。只输出 JSON。你的任务不是关键词筛选，而是逐张、逐行、逐字阅读完整记忆卡正文，判断逻辑是否真的有问题。"
      },
      {
        role: "user",
        content: `请审计下面这一批英文单词记忆卡。

硬性要求：
1. 每个输入 item 都必须在 audited 数组里出现一次，不能跳过没有问题的卡。
2. 必须阅读 mnemonic.contentMarkdown 的完整原文，不要只看开头、结尾或显眼关键词。
3. 只标出清楚的逻辑错误：卡片主要在讲别的词、多张卡串线、拆分拼不回目标词、词根/词缀推理明显错误、释义和目标词不符、例句和翻译串入其他词、相关词明显不支持正文、OCR 乱码已经影响理解、前后矛盾、正文残缺。
4. 不要因为助记法牵强、文风幼稚、轻微错别字、标点问题、表达不够优美而报错，除非它导致逻辑错误。
5. evidence 必须引用卡片里的具体原文片段。

issueType 只能是：
wrong_target, mixed_card, split_logic, meaning_mismatch, example_mismatch, related_word_mismatch, ocr_garbled, contradiction, incomplete

severity：
P0 = 整张卡基本不能用或在讲别的词
P1 = 会误导记忆，必须优先修
P2 = 明显需要复核
P3 = 轻微但真实的逻辑问题

输出 JSON：
{
  "audited": [
    {
      "entryId": "输入里的 entryId",
      "status": "ok 或 issue",
      "issues": [
        {
          "issueType": "mixed_card",
          "severity": "P1",
          "reason": "一句话说明逻辑错误",
          "evidence": "引用原文片段",
          "suggestion": "建议如何修"
        }
      ]
    }
  ]
}

Batch: ${batchNumber}
Items:
${JSON.stringify(items)}`
      }
    ]
  };

  const payload = await fetchWithRetry(endpoint, body);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI audit response has no content.");
  const parsed = parseJsonObject(content) as { audited?: AiAuditedItem[] };
  if (!Array.isArray(parsed.audited)) throw new Error(`AI audit response missing audited array: ${content.slice(0, 500)}`);
  return parsed.audited;
}

function validateAuditedItems(batch: EntryForAudit[], auditedItems: AiAuditedItem[]) {
  const expected = new Set(batch.map((entry) => entry.id));
  const actual = new Set(auditedItems.map((item) => String(item.entryId ?? "")));
  const missing = [...expected].filter((id) => !actual.has(id));
  if (missing.length) throw new Error(`AI response skipped ${missing.length} entries: ${missing.slice(0, 5).join(", ")}`);
}

function normalizeIssues(batch: EntryForAudit[], auditedItems: AiAuditedItem[]) {
  const entryById = new Map(batch.map((entry) => [entry.id, entry]));
  const issues: MnemonicLogicAuditIssue[] = [];
  for (const item of auditedItems) {
    const entry = entryById.get(String(item.entryId ?? ""));
    if (!entry || item.status !== "issue" || !Array.isArray(item.issues)) continue;

    for (const rawIssue of item.issues) {
      const issueType = issueTypes.has(rawIssue.issueType as MnemonicLogicIssueType)
        ? (rawIssue.issueType as MnemonicLogicIssueType)
        : "contradiction";
      const severity = severities.has(rawIssue.severity as MnemonicLogicIssueSeverity)
        ? (rawIssue.severity as MnemonicLogicIssueSeverity)
        : "P2";
      const reason = normalizeText(rawIssue.reason).slice(0, 220);
      const evidence = normalizeText(rawIssue.evidence).slice(0, 260);
      const suggestion = normalizeText(rawIssue.suggestion).slice(0, 260);
      if (!reason || !evidence) continue;
      issues.push({
        entryId: entry.id,
        wordId: entry.targetWord.id,
        word: entry.targetWord.word,
        slug: entry.targetWord.slug,
        levelTags: entry.targetWord.levelTags,
        issueType,
        severity,
        reason,
        evidence,
        suggestion
      });
    }
  }
  return issues;
}

async function fetchWithRetry(endpoint: string, body: unknown) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      const text = await response.text();
      if (!response.ok) {
        const message = `AI request failed: ${response.status} ${text.slice(0, 1000)}`;
        if ([401, 402, 403].includes(response.status)) throw new FatalAiError(message);
        throw new Error(message);
      }
      return JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function writeReport(
  status: MnemonicLogicAuditReport["status"],
  entries: EntryForAudit[],
  doneIds: Set<string>,
  issues: MnemonicLogicAuditIssue[],
  failedBatches: MnemonicLogicAuditReport["failedBatches"]
) {
  const now = new Date().toISOString();
  const issueEntries = new Set(issues.map((issue) => issue.entryId));
  const report: MnemonicLogicAuditReport = {
    version: 1,
    status,
    createdAt: readReportCreatedAt() ?? now,
    updatedAt: now,
    model,
    totalEntries: entries.length,
    auditedEntries: doneIds.size,
    issueEntries: issueEntries.size,
    issues: [...issues].sort(compareIssue),
    failedBatches
  };
  fs.writeFileSync(latestReportPath, JSON.stringify(report, null, 2));
}

function readCheckpoint(filePath: string): Checkpoint {
  if (!fs.existsSync(filePath)) {
    return { startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), doneEntryIds: [], failedBatches: [] };
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<Checkpoint>;
  return {
    startedAt: parsed.startedAt ?? new Date().toISOString(),
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    doneEntryIds: Array.isArray(parsed.doneEntryIds)
      ? parsed.doneEntryIds
      : Array.isArray((parsed as { auditedEntryIds?: unknown }).auditedEntryIds)
        ? ((parsed as { auditedEntryIds: string[] }).auditedEntryIds)
        : [],
    failedBatches: Array.isArray(parsed.failedBatches) ? parsed.failedBatches : []
  };
}

function writeCheckpoint(checkpoint: Checkpoint, doneIds: Set<string>) {
  checkpoint.updatedAt = new Date().toISOString();
  checkpoint.doneEntryIds = [...doneIds].sort();
  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
}

function readIssues(filePath: string) {
  if (!fs.existsSync(filePath)) return [] as MnemonicLogicAuditIssue[];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MnemonicLogicAuditIssue);
}

function readReportCreatedAt() {
  if (!fs.existsSync(latestReportPath)) return null;
  try {
    return (JSON.parse(fs.readFileSync(latestReportPath, "utf8")) as { createdAt?: string }).createdAt ?? null;
  } catch {
    return null;
  }
}

function issueKey(issue: MnemonicLogicAuditIssue) {
  return [issue.entryId, issue.issueType, issue.reason, issue.evidence].join("\u0000");
}

function compareIssue(left: MnemonicLogicAuditIssue, right: MnemonicLogicAuditIssue) {
  const severityRank: Record<MnemonicLogicIssueSeverity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return severityRank[left.severity] - severityRank[right.severity] || left.word.localeCompare(right.word);
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseJsonObject(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const text = (fenced ?? content).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`No JSON object found in AI response: ${content.slice(0, 500)}`);
  return JSON.parse(text.slice(start, end + 1));
}

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const value = unquoteEnvValue(match[2].trim());
    if (value) process.env[match[1]] = value;
  }
}

function unquoteEnvValue(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

function parseLevelArg() {
  const raw = stringArg("--level");
  if (!raw) return null;
  const normalized = raw.toUpperCase();
  if (Object.values(LevelTag).includes(normalized as LevelTagType)) return normalized as LevelTagType;
  throw new Error(`Unknown level: ${raw}`);
}

function numberArg(name: string) {
  const value = Number(stringArg(name));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function stringArg(name: string) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function firstFilled(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
}

function removeIfExists(filePath: string) {
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
}

main()
  .catch((error) => {
    console.error(error instanceof FatalAiError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
