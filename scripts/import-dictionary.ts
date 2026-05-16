import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { PrismaClient, WordStatus } from "@prisma/client";
import { slugify } from "../src/lib/slug";

const prisma = new PrismaClient();
const fileArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const fullDictionaryPath = path.join(process.cwd(), "data", "ecdict.full.csv");
const input = fileArg ?? (fs.existsSync(fullDictionaryPath) ? fullDictionaryPath : path.join(process.cwd(), "data", "ecdict.csv"));
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Number.POSITIVE_INFINITY;
const overwrite = process.argv.includes("--overwrite");
const batchSize = 2000;

async function main() {
  if (!fs.existsSync(input)) {
    throw new Error(`Dictionary file not found: ${input}`);
  }

  const existingWords = new Map(
    (
      await prisma.word.findMany({
        select: {
          word: true,
          phoneticUk: true,
          phoneticUs: true,
          partOfSpeech: true,
          meaningCn: true,
          meaningEn: true,
          shortMeaningCn: true,
          frequencyRank: true
        }
      })
    ).map((word) => [word.word, word])
  );

  const rl = readline.createInterface({
    input: fs.createReadStream(input, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  let header = true;
  let created = 0;
  let filledExisting = 0;
  let seen = 0;
  let skipped = 0;
  const batch: Array<{
    word: string;
    slug: string;
    phoneticUk: string | null;
    phoneticUs: string | null;
    partOfSpeech: string;
    meaningCn: string;
    meaningEn: string | null;
    shortMeaningCn: string;
    levelTags: never[];
    frequencyRank: number | null;
    difficulty: number;
    status: WordStatus;
  }> = [];

  for await (const line of rl) {
    if (header) {
      header = false;
      continue;
    }
    if (!line.trim() || seen >= limit) break;
    const row = parseCsvLine(line);
    const originalWord = (row[0] ?? "").trim();
    const word = cleanWord(originalWord);
    const phonetic = normalizePhonetic(row[1] ?? "");
    const definition = cleanText(row[2] ?? "");
    const rawTranslation = row[3] ?? "";
    const translation = cleanupTranslation(row[3] ?? "");
    const partOfSpeech = normalizePos([row[4] ?? "", translation, definition].join("\n"));
    const dictionarySignals = {
      collins: toRank(row[5] ?? ""),
      oxford: toRank(row[6] ?? ""),
      tag: (row[7] ?? "").trim(),
      bnc: toRank(row[8] ?? ""),
      frq: toRank(row[9] ?? "")
    };
    const frequencyRank = dictionarySignals.frq ?? dictionarySignals.bnc;
    if (!isImportableWord(originalWord, word, phonetic, rawTranslation, translation, partOfSpeech, dictionarySignals)) {
      skipped += 1;
      continue;
    }

    const meaningCn = compactMeaning(translation);
    const existing = existingWords.get(word);
    if (existing) {
      const updateData = {
        phoneticUk: overwrite || !existing.phoneticUk ? phonetic || null : existing.phoneticUk,
        phoneticUs: overwrite || !existing.phoneticUs ? phonetic || null : existing.phoneticUs,
        partOfSpeech: overwrite || !existing.partOfSpeech ? partOfSpeech : existing.partOfSpeech,
        meaningCn: overwrite || !existing.meaningCn ? meaningCn : existing.meaningCn,
        meaningEn: overwrite || !existing.meaningEn ? definition || null : existing.meaningEn,
        shortMeaningCn: overwrite || !existing.shortMeaningCn ? shortMeaning(meaningCn) : existing.shortMeaningCn,
        frequencyRank: overwrite || !existing.frequencyRank ? frequencyRank : existing.frequencyRank
      };
      if (hasChanged(existing, updateData)) {
        await prisma.word.update({ where: { word }, data: updateData });
        existingWords.set(word, { word, ...updateData });
        filledExisting += 1;
      }
    } else {
      batch.push({
          word,
          slug: slugify(word),
          phoneticUk: phonetic || null,
          phoneticUs: phonetic || null,
          partOfSpeech,
          meaningCn,
          meaningEn: definition || null,
          shortMeaningCn: shortMeaning(meaningCn),
          levelTags: [],
          frequencyRank,
          difficulty: 3,
          status: WordStatus.EMPTY
      });
      if (batch.length >= batchSize) {
        created += await flushBatch(batch);
      }
    }
    seen += 1;
    if (seen % 10000 === 0) console.log(`Processed ${seen} words. created=${created}, filledExisting=${filledExisting}, skipped=${skipped}`);
  }

  created += await flushBatch(batch);
  console.log(`Dictionary import complete. processed=${seen}, created=${created}, filledExisting=${filledExisting}, skipped=${skipped}`);
}

function parseCsvLine(line: string) {
  const result: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  result.push(value);
  return result;
}

function cleanWord(value: string) {
  return value.trim().toLowerCase();
}

function cleanText(value: string) {
  return value.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
}

async function flushBatch(
  batch: Array<{
    word: string;
    slug: string;
    phoneticUk: string | null;
    phoneticUs: string | null;
    partOfSpeech: string;
    meaningCn: string;
    meaningEn: string | null;
    shortMeaningCn: string;
    levelTags: never[];
    frequencyRank: number | null;
    difficulty: number;
    status: WordStatus;
  }>
) {
  if (!batch.length) return 0;
  const { count } = await prisma.word.createMany({ data: batch.splice(0, batch.length), skipDuplicates: true });
  return count;
}

function normalizePhonetic(value: string) {
  const text = value.trim().replace(/^\/|\/$/g, "");
  return text ? `/${text}/` : "";
}

function normalizePos(value: string) {
  const normalized = value.replace(/\bvt\./g, "v.").replace(/\bvi\./g, "v.");
  const matches = Array.from(normalized.matchAll(/\b(n|v|adj|adv|prep|conj|pron|abbr|int)\./g)).map((match) => match[0]);
  return Array.from(new Set(matches)).join("/") || "n.";
}

function cleanupTranslation(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes("[网络]"))
    .filter((line) => !/^\s*\[(计|地名|医|化|经|法|生|军|矿|植|动|航|天|数)\]/.test(line))
    .map((line) =>
      line
        .replace(/\[[^\]]+]/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/【[^】]+】/g, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .join("\n")
    .trim();
}

function compactMeaning(value: string) {
  const groups = new Map<string, string[]>();
  for (const line of value.split("\n").map((item) => item.trim()).filter(Boolean)) {
    const normalized = line.replace(/\bvt\./g, "v.").replace(/\bvi\./g, "v.");
    const match = normalized.match(/^(n|v|adj|adv|prep|conj|pron|abbr|int|suf)\.\s*(.+)$/);
    const pos = match?.[1] ? `${match[1]}.` : "";
    const body = match?.[2] ?? normalized;
    const terms = body
      .split(/[；;，,、]/)
      .map((item) => item.replace(/\([^)]{0,24}\)/g, "").trim())
      .filter(Boolean)
      .filter((item) => !item.includes("=") && !item.includes("等于"))
      .filter((item) => item.length <= 18);
    const key = pos || "释义";
    const current = groups.get(key) ?? [];
    groups.set(key, [...current, ...terms]);
  }

  const output = Array.from(groups.entries())
    .map(([pos, terms]) => {
      const unique = Array.from(new Set(terms)).slice(0, pos === "v." ? 18 : 10);
      if (!unique.length) return "";
      return pos === "释义" ? unique.join("；") : `${pos} ${unique.join("；")}`;
    })
    .filter(Boolean)
    .slice(0, 4)
    .join("；");

  return output || value.replace(/\n/g, "；").slice(0, 120);
}

function shortMeaning(value: string) {
  return value.split(/[；;，,、]/)[0]?.replace(/^(n|v|adj|adv|prep|conj|pron|abbr|int)\.\s*/, "").trim() || value.slice(0, 12) || "未填写";
}

function isImportableWord(
  originalWord: string,
  word: string,
  phonetic: string,
  rawTranslation: string,
  translation: string,
  partOfSpeech: string,
  signals: { collins: number | null; oxford: number | null; tag: string; bnc: number | null; frq: number | null }
) {
  if (!/^[a-z]{2,32}$/.test(originalWord)) return false;
  if (!/^[a-z]{2,32}$/.test(word)) return false;
  if (!phonetic) return false;
  if (!translation) return false;
  if (!partOfSpeech) return false;
  if (/abbr\./i.test(rawTranslation)) return false;
  if (/人名|男子名|女子名|城市|州名|地名|网络/.test(rawTranslation)) return false;
  if (translation.length > 900) return false;
  const rankSignal = Boolean(signals.bnc && signals.frq && signals.bnc < 35000 && signals.frq < 35000);
  return Boolean(signals.tag || signals.collins || signals.oxford || rankSignal);
}

function toRank(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function hasChanged(
  existing: {
    phoneticUk: string | null;
    phoneticUs: string | null;
    partOfSpeech: string;
    meaningCn: string;
    meaningEn: string | null;
    shortMeaningCn: string;
    frequencyRank: number | null;
  },
  updateData: {
    phoneticUk: string | null;
    phoneticUs: string | null;
    partOfSpeech: string;
    meaningCn: string;
    meaningEn: string | null;
    shortMeaningCn: string;
    frequencyRank: number | null;
  }
) {
  return Object.entries(updateData).some(([key, value]) => existing[key as keyof typeof updateData] !== value);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
