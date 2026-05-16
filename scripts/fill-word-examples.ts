import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

type TargetWord = {
  id: string;
  word: string;
  partOfSpeech: string;
  meaningCn: string;
  meaningEn: string | null;
  exampleSentence: string | null;
  exampleTranslation: string | null;
};

type GeneratedExample = {
  id: string;
  exampleSentence: string;
  exampleTranslation: string;
};

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const overwrite = process.argv.includes("--overwrite");
const limit = numberArg("--limit") ?? Number.POSITIVE_INFINITY;
const batchSize = numberArg("--batch-size") ?? 60;
const concurrency = numberArg("--concurrency") ?? 1;
const maxRetries = numberArg("--max-retries") ?? 3;
const requestTimeoutMs = numberArg("--request-timeout-ms") ?? 120000;
const checkpointPath = stringArg("--checkpoint") ?? path.join(process.cwd(), "tmp", "word-examples-checkpoint.json");
const failureLogPath = stringArg("--failure-log") ?? path.join(process.cwd(), "tmp", "word-examples-failures.jsonl");

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

const apiKey = firstFilled(process.env.AI_AUTOFILL_API_KEY, process.env.AI_AGENT_API_KEY, process.env.OPENAI_API_KEY);
const baseUrl = firstFilled(process.env.AI_AUTOFILL_BASE_URL, process.env.AI_AGENT_BASE_URL, "https://api.openai.com/v1");
const model = stringArg("--model") ?? firstFilled(process.env.AI_AUTOFILL_MODEL, process.env.AI_AGENT_MODEL, "gpt-4.1-mini");
const fallbackModel = stringArg("--fallback-model") ?? firstFilled(process.env.AI_AUTOFILL_MODEL, process.env.AI_AGENT_MODEL, model);

async function main() {
  if (!apiKey) {
    throw new Error("Missing AI API key. Fill AI_AUTOFILL_API_KEY, AI_AGENT_API_KEY, or OPENAI_API_KEY.");
  }

  const words = await prisma.word.findMany({
    where: overwrite
      ? {}
      : {
          OR: [
            { exampleSentence: null },
            { exampleSentence: "" },
            { exampleTranslation: null },
            { exampleTranslation: "" }
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

  console.log(
    `Preparing examples: targets=${words.length}, batchSize=${batchSize}, concurrency=${concurrency}, model=${model}, fallbackModel=${fallbackModel}, dryRun=${dryRun}, overwrite=${overwrite}`
  );

  if (!words.length) return;

  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  const checkpoint = readCheckpoint(checkpointPath);
  const backupPath = path.join(process.cwd(), "tmp", `word-examples-backup-${Date.now()}.json`);
  if (!dryRun) {
    fs.writeFileSync(backupPath, JSON.stringify(words, null, 2));
    console.log(`Backup written: ${backupPath}`);
  }

  let updated = 0;
  let failed = 0;
  let skippedFromCheckpoint = 0;
  let nextBatchIndex = 0;
  const doneIdSet = new Set(checkpoint.doneIds);
  const batches: TargetWord[][] = [];

  for (let index = 0; index < words.length; index += batchSize) {
    const batch = words.slice(index, index + batchSize).filter((word) => {
      const done = doneIdSet.has(word.id);
      if (done) skippedFromCheckpoint += 1;
      return !done;
    });
    if (!batch.length) continue;
    batches.push(batch);
  }

  async function processNextBatch() {
    while (nextBatchIndex < batches.length) {
      const batchNumber = nextBatchIndex + 1;
      const batch = batches[nextBatchIndex];
      nextBatchIndex += 1;
      await processBatch(batch, batchNumber, batches.length);
    }
  }

  async function processBatch(batch: TargetWord[], batchNumber: number, totalBatches: number) {
    const failures: Array<{ word: string; reason: string }> = [];

    const generated = await generateWithRetries(batch);
    const valid = new Map<string, GeneratedExample>();

    for (const word of batch) {
      const example = generated.find((item) => item.id === word.id);
      const validation = example ? validateExample(word, example) : "missing generated example";
      if (validation === null && example) {
        valid.set(word.id, normalizeExample(example));
      } else {
        failures.push({ word: word.word, reason: validation ?? "unknown validation failure" });
      }
    }

    if (failures.length) {
      failed += failures.length;
      console.warn(`Batch ${batchNumber}/${totalBatches} had ${failures.length} unresolved example(s): ${JSON.stringify(failures.slice(0, 8))}`);
      if (!dryRun) {
        fs.appendFileSync(
          failureLogPath,
          failures.map((failure) => JSON.stringify({ ...failure, batchNumber, createdAt: new Date().toISOString() })).join("\n") + "\n"
        );
      }
    }

    if (dryRun) {
      console.log(
        JSON.stringify(
          batch.slice(0, 8).map((word) => ({ word: word.word, ...valid.get(word.id) })),
          null,
          2
        )
      );
    }

    const validWords = batch.filter((word) => valid.has(word.id));
    const updates = validWords.map((word) => {
      const example = valid.get(word.id);
      if (!example) throw new Error(`Missing validated example for ${word.word}`);
      return prisma.word.update({
        where: { id: word.id },
        data: {
          exampleSentence: example.exampleSentence,
          exampleTranslation: example.exampleTranslation
        }
      });
    });

    if (!dryRun && updates.length) {
      await prisma.$transaction(updates);
      checkpoint.doneIds.push(...validWords.map((word) => word.id));
      for (const word of validWords) doneIdSet.add(word.id);
      fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
    }

    updated += validWords.length;
    console.log(
      `${dryRun ? "Validated" : "Updated"} ${updated}/${words.length} examples; batch ${batchNumber}/${totalBatches}${
        skippedFromCheckpoint ? ` (${skippedFromCheckpoint} skipped)` : ""
      }${failed ? `; unresolved=${failed}` : ""}`
    );
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, () => processNextBatch()));

  console.log(
    `Example fill complete. ${dryRun ? "validated" : "updated"}=${updated}, unresolved=${failed}, skippedFromCheckpoint=${skippedFromCheckpoint}`
  );
}

async function generateWithRetries(batch: TargetWord[]) {
  let candidates = batch;
  const accepted = new Map<string, GeneratedExample>();
  const reasons = new Map<string, string>();

  for (let attempt = 1; attempt <= maxRetries && candidates.length; attempt += 1) {
    const response = await requestExamples(candidates, reasons, attempt);
    const byId = new Map(response.map((item) => [item.id, item]));
    for (let index = 0; index < candidates.length; index += 1) {
      const word = candidates[index];
      const byPosition = response.length === candidates.length ? { ...response[index], id: word.id } : undefined;
      const example = byId.get(word.id) ?? byPosition;
      const validation = example ? validateExample(word, example) : "missing generated example";
      if (validation === null && example) {
        accepted.set(word.id, normalizeExample(example));
        reasons.delete(word.id);
      } else {
        reasons.set(word.id, validation ?? "unknown validation failure");
      }
    }
    candidates = batch.filter((word) => !accepted.has(word.id));
  }

  for (const word of candidates) {
    let reason = reasons.get(word.id) ?? "batch generation did not produce a valid example";
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      const example = await requestOneExample(word, reason, attempt);
      const validation = validateExample(word, example);
      if (validation === null) {
        accepted.set(word.id, normalizeExample(example));
        reasons.delete(word.id);
        break;
      }
      reason = validation;
      reasons.set(word.id, validation);
    }
  }

  return Array.from(accepted.values());
}

async function requestExamples(batch: TargetWord[], reasons: Map<string, string>, attempt: number) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const compactItems = batch.map((word) => ({
    id: word.id,
    word: word.word,
    partOfSpeech: word.partOfSpeech,
    meaningCn: word.meaningCn,
    meaningEn: word.meaningEn ?? "",
    previousError: reasons.get(word.id) ?? undefined
  }));

  const body = {
    model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a strict bilingual English dictionary editor for Chinese learners. Write only correct, natural examples and faithful Simplified Chinese translations. Return only valid JSON."
      },
      {
        role: "user",
        content: `For each input item, create exactly one English example sentence and one Simplified Chinese translation.

Rules:
- Use the target word naturally in one of the listed dictionary meanings.
- Include the target word exactly as given, preserving spelling and form; capitalization is allowed only at sentence start.
- Do not write meta sentences about the word, spelling, or term.
- Prefer short self-contained sentences of 5 to 16 English words.
- Avoid quotations, Markdown, proper names, sensitive content, and unusual facts.
- For verbs, choose a frame that fits the verb's transitivity.
- For adjectives/adverbs, attach the word to a plausible noun or verb.
- The Chinese translation must translate the whole English sentence.
- If previousError is present, fix that exact problem.

Return JSON in this exact shape:
{"items":[{"id":"...","exampleSentence":"...","exampleTranslation":"..."}]}

Attempt: ${attempt}
Items:
${JSON.stringify(compactItems)}`
      }
    ]
  };

  const payload = await fetchWithRetry(endpoint, body);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI response has no message content.");
  const parsed = parseJsonObject(content) as { items?: GeneratedExample[] };
  if (!Array.isArray(parsed.items)) {
    throw new Error(`AI response JSON does not contain items array: ${content.slice(0, 500)}`);
  }
  return parsed.items.map(normalizeExample);
}

async function requestOneExample(word: TargetWord, previousError: string, attempt: number) {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const singleModel = fallbackModel && fallbackModel !== model && attempt === maxRetries ? fallbackModel : model;
  const body = {
    model: singleModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a strict bilingual English dictionary editor. Return one valid JSON object only. The example must be grammatically correct and natural."
      },
      {
        role: "user",
        content: `Create one English example sentence and one Simplified Chinese translation for this dictionary entry.

Entry:
${JSON.stringify({
  id: word.id,
  word: word.word,
  partOfSpeech: word.partOfSpeech,
  meaningCn: word.meaningCn,
  meaningEn: word.meaningEn ?? "",
  previousError,
  attempt
})}

Hard rules:
- The English sentence must contain the exact target word "${word.word}" as written.
- Do not use a different inflected form unless it is also exactly "${word.word}".
- Do not use quotation marks or meta language about the word itself.
- Keep the sentence natural, simple, and self-contained.
- Translate the whole sentence into Simplified Chinese.

Return exactly:
{"id":"${word.id}","exampleSentence":"...","exampleTranslation":"..."}`
      }
    ]
  };

  const payload = await fetchWithRetry(endpoint, body);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error(`AI single-item response has no content for ${word.word}.`);
  const parsed = parseJsonObject(content) as Partial<GeneratedExample>;
  return normalizeExample({
    id: word.id,
    exampleSentence: parsed.exampleSentence ?? "",
    exampleTranslation: parsed.exampleTranslation ?? ""
  });
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
        throw new Error(`AI request failed: ${response.status} ${text.slice(0, 800)}`);
      }
      return JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
    } catch (error) {
      lastError = error;
      const waitMs = 1000 * attempt * attempt;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function validateExample(word: TargetWord, example: GeneratedExample) {
  const sentence = normalizeText(example.exampleSentence);
  const translation = normalizeText(example.exampleTranslation);
  if (!sentence) return "empty English sentence";
  if (!translation) return "empty Chinese translation";
  if (sentence.length > 180) return "English sentence is too long";
  if (translation.length > 140) return "Chinese translation is too long";
  if (/[\u4e00-\u9fff]/.test(sentence)) return "English sentence contains Chinese";
  if (/["“”‘’]/.test(sentence) || /'/.test(sentence.replace(/[A-Za-z]'[A-Za-z]/g, ""))) {
    return "English sentence contains quotes";
  }
  if (!/[\u4e00-\u9fff]/.test(translation)) return "Chinese translation contains no Chinese";
  if (!/[.!?]$/.test(sentence)) return "English sentence must end with punctuation";
  if (!containsTargetWord(sentence, word.word)) return "English sentence does not contain the exact target word";
  if (isMetaSentence(sentence, word.word)) return "meta sentence about the word instead of a real example";
  if (/\b(foo|bar|baz|example|placeholder)\b/i.test(sentence)) return "placeholder-like sentence";
  if ((sentence.match(/\b[A-Za-z]+\b/g) ?? []).length < 3) return "English sentence is too short";
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

function isMetaSentence(sentence: string, target: string) {
  const escaped = escapeRegExp(target.trim());
  const patterns = [
    new RegExp(`\\bword\\s+${escaped}\\b`, "i"),
    new RegExp(`\\bterm\\s+${escaped}\\b`, "i"),
    new RegExp(`\\b${escaped}\\s+means\\b`, "i"),
    new RegExp(`\\b${escaped}\\s+is\\s+a\\s+word\\b`, "i")
  ];
  return patterns.some((pattern) => pattern.test(sentence));
}

function normalizeExample(example: GeneratedExample): GeneratedExample {
  return {
    id: String(example.id),
    exampleSentence: normalizeText(example.exampleSentence),
    exampleTranslation: normalizeText(example.exampleTranslation)
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
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = unquoteEnvValue(match[2].trim());
    if (value) process.env[key] = value;
  }
}

function unquoteEnvValue(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
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
