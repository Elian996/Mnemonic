import fs from "node:fs";
import path from "node:path";
import { LevelTag, PrismaClient, WordStatus } from "@prisma/client";
import { slugify } from "../src/lib/slug";

const prisma = new PrismaClient();
const sourceDir = path.join(process.cwd(), "data", "vocab-categories");
const dictionaryPath = path.join(process.cwd(), "data", "ecdict.full.csv");

const sources: Array<{ file: string; tag: LevelTag; label: string }> = [
  { file: "level_2.txt", tag: "LEVEL_2", label: "二级" },
  { file: "level_3.txt", tag: "LEVEL_3", label: "三级" },
  { file: "high_school.txt", tag: "HIGH_SCHOOL", label: "高中词汇" },
  { file: "gaokao_3500.txt", tag: "GAOKAO_3500", label: "高考3500" },
  { file: "cet4.txt", tag: "CET4", label: "四级" },
  { file: "cet6.txt", tag: "CET6", label: "六级" }
];

async function main() {
  const dictionary = loadDictionaryRows(dictionaryPath);

  for (const source of sources) {
    await prisma.$executeRawUnsafe(`UPDATE "Word" SET "levelTags" = array_remove("levelTags", '${source.tag}'::"LevelTag")`);
  }

  for (const source of sources) {
    const words = readWords(path.join(sourceDir, source.file));
    const created = await ensureWordsExist(words, dictionary);
    let matched = 0;
    let updated = 0;

    for (let index = 0; index < words.length; index += 500) {
      const chunk = words.slice(index, index + 500);
      const rows = await prisma.word.findMany({
        where: { word: { in: chunk } },
        select: { id: true, word: true, levelTags: true }
      });
      matched += rows.length;

      for (const row of rows) {
        if (row.levelTags.includes(source.tag)) continue;
        await prisma.word.update({
          where: { id: row.id },
          data: { levelTags: [...row.levelTags, source.tag] }
        });
        updated += 1;
      }
    }

    console.log(`${source.label}: source=${words.length}, created=${created}, matched=${matched}, updated=${updated}`);
  }
}

async function ensureWordsExist(words: string[], dictionary: Map<string, DictionaryRow>) {
  const existing = await prisma.word.findMany({
    where: { word: { in: words } },
    select: { word: true }
  });
  const existingWords = new Set(existing.map((row) => row.word));
  const missingRows = words
    .filter((word) => !existingWords.has(word))
    .map((word) => dictionary.get(word))
    .filter((row): row is DictionaryRow => Boolean(row));

  if (!missingRows.length) return 0;

  const { count } = await prisma.word.createMany({
    data: missingRows.map((row) => ({
      word: row.word,
      slug: slugify(row.word),
      phoneticUk: row.phonetic || null,
      phoneticUs: row.phonetic || null,
      partOfSpeech: row.partOfSpeech,
      meaningCn: row.meaningCn,
      meaningEn: row.meaningEn || null,
      shortMeaningCn: row.shortMeaningCn,
      levelTags: [],
      frequencyRank: row.frequencyRank,
      difficulty: 3,
      status: WordStatus.EMPTY
    })),
    skipDuplicates: true
  });

  return count;
}

function readWords(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing vocabulary source: ${filePath}`);
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
}

type DictionaryRow = {
  word: string;
  phonetic: string;
  partOfSpeech: string;
  meaningCn: string;
  meaningEn: string;
  shortMeaningCn: string;
  frequencyRank: number | null;
};

function loadDictionaryRows(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing dictionary source: ${filePath}`);
  }

  const rows = new Map<string, DictionaryRow>();
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;

    const row = parseCsvLine(line);
    const word = (row[0] ?? "").trim().toLowerCase();
    if (!/^[a-z]{2,32}$/.test(word) || rows.has(word)) continue;

    const meaningCn = compactMeaning(cleanupTranslation(row[3] ?? ""));
    if (!meaningCn) continue;

    rows.set(word, {
      word,
      phonetic: normalizePhonetic(row[1] ?? ""),
      partOfSpeech: normalizePos(row[4] ?? row[3] ?? ""),
      meaningCn,
      meaningEn: cleanText(row[2] ?? ""),
      shortMeaningCn: shortMeaning(meaningCn),
      frequencyRank: toRank(row[9] ?? "") ?? toRank(row[8] ?? "")
    });
  }
  return rows;
}

function parseCsvLine(line: string) {
  const result: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      value += '"';
      index += 1;
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

function normalizePhonetic(value: string) {
  const text = value.trim().replace(/^\/|\/$/g, "");
  return text ? `/${text}/` : "";
}

function normalizePos(value: string) {
  const normalized = value.replace(/\bvt\./g, "v.").replace(/\bvi\./g, "v.");
  const matches = Array.from(normalized.matchAll(/\b(n|v|adj|adv|prep|conj|pron|abbr|int|num)\./g)).map((match) => match[0]);
  return Array.from(new Set(matches)).join("/") || "n.";
}

function cleanText(value: string) {
  return value.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
}

function cleanupTranslation(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
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
  const terms = value
    .replace(/\n/g, "；")
    .split(/[；;，,、]/)
    .map((item) => item.replace(/^(n|v|adj|adv|prep|conj|pron|abbr|int|num)\.\s*/, "").replace(/\([^)]{0,24}\)/g, "").trim())
    .filter(Boolean)
    .filter((item) => !item.includes("=") && !item.includes("等于"));
  return Array.from(new Set(terms)).slice(0, 12).join("；") || value.replace(/\n/g, "；").slice(0, 120);
}

function shortMeaning(value: string) {
  return value.split(/[；;，,、]/)[0]?.trim() || value.slice(0, 12) || "未填写";
}

function toRank(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
