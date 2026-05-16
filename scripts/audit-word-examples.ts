import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

type WordExample = {
  id: string;
  word: string;
  partOfSpeech: string;
  meaningCn: string;
  meaningEn: string | null;
  exampleSentence: string | null;
  exampleTranslation: string | null;
};

type Correction = {
  id: string;
  reason: string;
  exampleSentence: string;
  exampleTranslation: string;
};

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const limit = numberArg("--limit") ?? Number.POSITIVE_INFINITY;
const batchSize = numberArg("--batch-size") ?? 80;
const concurrency = numberArg("--concurrency") ?? 4;
const requestTimeoutMs = numberArg("--request-timeout-ms") ?? 120000;
const checkpointPath = stringArg("--checkpoint") ?? path.join(process.cwd(), "tmp", "word-examples-audit-checkpoint.json");
const issueLogPath = stringArg("--issue-log") ?? path.join(process.cwd(), "tmp", "word-examples-audit-issues.jsonl");

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

const apiKey = firstFilled(process.env.AI_AUTOFILL_API_KEY, process.env.AI_AGENT_API_KEY, process.env.OPENAI_API_KEY);
const baseUrl = firstFilled(process.env.AI_AUTOFILL_BASE_URL, process.env.AI_AGENT_BASE_URL, "https://api.openai.com/v1");
const model = stringArg("--model") ?? firstFilled(process.env.AI_AUTOFILL_MODEL, process.env.AI_AGENT_MODEL, "gpt-4.1-mini");

async function main() {
  if (!apiKey) throw new Error("Missing AI API key.");

  const words = await prisma.word.findMany({
    where: {
      AND: [
        { NOT: { exampleSentence: null } },
        { NOT: { exampleSentence: "" } },
        { NOT: { exampleTranslation: null } },
        { NOT: { exampleTranslation: "" } }
      ]
    },
    select: {
      id: true,
      word: true,
      partOfSpeech: true,
      meaningCn: true,
      meaningEn: true,
      exampleSentence: true,
      exampleTranslation: true
    },
    orderBy: { word: "asc" },
    take: Number.isFinite(limit) ? limit : undefined
  });

  console.log(`Auditing examples: targets=${words.length}, batchSize=${batchSize}, concurrency=${concurrency}, model=${model}, dryRun=${dryRun}`);
  if (!words.length) return;

  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  const checkpoint = readCheckpoint(checkpointPath);
  const doneIdSet = new Set(checkpoint.doneIds);
  const batches: WordExample[][] = [];
  let skipped = 0;

  for (let index = 0; index < words.length; index += batchSize) {
    const batch = words.slice(index, index + batchSize).filter((word) => {
      if (doneIdSet.has(word.id)) {
        skipped += 1;
        return false;
      }
      return true;
    });
    if (batch.length) batches.push(batch);
  }

  let nextBatchIndex = 0;
  let audited = 0;
  let corrected = 0;
  let rejected = 0;

  async function processNextBatch() {
    while (nextBatchIndex < batches.length) {
      const batchNumber = nextBatchIndex + 1;
      const batch = batches[nextBatchIndex];
      nextBatchIndex += 1;
      const corrections = await requestAudit(batch, batchNumber);
      const validCorrections = new Map<string, Correction>();

      for (const correction of corrections) {
        const word = batch.find((item) => item.id === correction.id);
        if (!word) continue;
        const validation = validateCorrection(word, correction);
        if (validation === null) {
          validCorrections.set(word.id, normalizeCorrection(correction));
        } else {
          rejected += 1;
          fs.appendFileSync(
            issueLogPath,
            JSON.stringify({ word: word.word, reason: validation, correction, batchNumber, createdAt: new Date().toISOString() }) + "\n"
          );
        }
      }

      const validWords = batch.filter((word) => validCorrections.has(word.id));
      if (!dryRun && validWords.length) {
        await prisma.$transaction(
          validWords.map((word) => {
            const correction = validCorrections.get(word.id)!;
            return prisma.word.update({
              where: { id: word.id },
              data: {
                exampleSentence: correction.exampleSentence,
                exampleTranslation: correction.exampleTranslation
              }
            });
          })
        );
      }

      if (!dryRun) {
        checkpoint.doneIds.push(...batch.map((word) => word.id));
        fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
      }

      audited += batch.length;
      corrected += validWords.length;
      console.log(
        `Audited ${audited}/${words.length}; corrected=${corrected}; rejected=${rejected}; batch ${batchNumber}/${batches.length}${
          skipped ? ` (${skipped} skipped)` : ""
        }`
      );
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, () => processNextBatch()));
  console.log(`Audit complete. audited=${audited}, corrected=${corrected}, rejected=${rejected}, skipped=${skipped}`);
}

async function requestAudit(batch: WordExample[], batchNumber: number) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const items = batch.map((word) => ({
    id: word.id,
    word: word.word,
    partOfSpeech: word.partOfSpeech,
    meaningCn: word.meaningCn,
    meaningEn: word.meaningEn ?? "",
    exampleSentence: word.exampleSentence ?? "",
    exampleTranslation: word.exampleTranslation ?? ""
  }));

  const body = {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a conservative bilingual dictionary quality editor. Return only valid JSON. Only flag examples that are clearly wrong."
      },
      {
        role: "user",
        content: `Audit these dictionary examples for Chinese English learners.

Only mark an item invalid if the English sentence is clearly ungrammatical, unnatural, semantically wrong for the target word, does not use the exact target word, or the Chinese translation clearly mistranslates the sentence.
Do not mark an item invalid merely because it is simple, sensitive, uncommon, or not the most common sense.
For each invalid item, provide a corrected English sentence and faithful Simplified Chinese translation.
The corrected English sentence must contain the exact target word as written.
Avoid quotation marks; normal apostrophes inside English words are okay.

Return JSON:
{"invalid":[{"id":"...","reason":"short reason","exampleSentence":"...","exampleTranslation":"..."}]}

Batch: ${batchNumber}
Items:
${JSON.stringify(items)}`
      }
    ]
  };

  const payload = await fetchWithRetry(endpoint, body);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Audit response has no content.");
  const parsed = parseJsonObject(content) as { invalid?: Correction[] };
  return Array.isArray(parsed.invalid) ? parsed.invalid.map(normalizeCorrection) : [];
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
      if (!response.ok) throw new Error(`AI request failed: ${response.status} ${text.slice(0, 800)}`);
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

function validateCorrection(word: WordExample, correction: Correction) {
  const sentence = normalizeText(correction.exampleSentence);
  const translation = normalizeText(correction.exampleTranslation);
  if (!sentence) return "empty English sentence";
  if (!translation) return "empty Chinese translation";
  if (sentence.length > 180) return "English sentence is too long";
  if (translation.length > 140) return "Chinese translation is too long";
  if (/[\u4e00-\u9fff]/.test(sentence)) return "English sentence contains Chinese";
  if (!/[\u4e00-\u9fff]/.test(translation)) return "Chinese translation contains no Chinese";
  if (!/[.!?]$/.test(sentence)) return "English sentence must end with punctuation";
  if (!containsTargetWord(sentence, word.word)) return "English sentence does not contain the exact target word";
  if (/["“”‘’]/.test(sentence) || /'/.test(sentence.replace(/[A-Za-z]'[A-Za-z]/g, ""))) return "English sentence contains quotes";
  return null;
}

function containsTargetWord(sentence: string, target: string) {
  const escaped = escapeRegExp(target.trim());
  if (!escaped) return false;
  if (/^[a-z]+$/i.test(target)) {
    return new RegExp(`(^|[^A-Za-z])${escaped}([^A-Za-z]|$)`, "i").test(sentence);
  }
  return sentence.toLowerCase().includes(target.toLowerCase());
}

function normalizeCorrection(correction: Correction): Correction {
  return {
    id: String(correction.id ?? ""),
    reason: normalizeText(correction.reason),
    exampleSentence: normalizeText(correction.exampleSentence),
    exampleTranslation: normalizeText(correction.exampleTranslation)
  };
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, "")
    .trim();
}

function parseJsonObject(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const text = (fenced ?? content).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`No JSON object found in AI response: ${content.slice(0, 500)}`);
  return JSON.parse(text.slice(start, end + 1));
}

function readCheckpoint(filePath: string) {
  if (!fs.existsSync(filePath)) return { doneIds: [] as string[] };
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { doneIds?: string[] };
  return { doneIds: Array.isArray(parsed.doneIds) ? parsed.doneIds : [] };
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

function numberArg(name: string) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`))?.split("=")[1];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function stringArg(name: string) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return raw ? raw.slice(name.length + 1) : null;
}

function firstFilled(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
