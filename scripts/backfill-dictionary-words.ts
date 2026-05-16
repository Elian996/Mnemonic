import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { PrismaClient, WordStatus } from "@prisma/client";
import { slugify } from "../src/lib/slug";

const prisma = new PrismaClient();
const dictionaryPath = path.join(process.cwd(), "data", "ecdict.full.csv");
const batchSize = 2000;
const rankThreshold = Number(process.argv.find((arg) => arg.startsWith("--rank-threshold="))?.split("=")[1] ?? 50_000);

async function main() {
  if (!fs.existsSync(dictionaryPath)) {
    throw new Error(`Dictionary file not found: ${dictionaryPath}`);
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
    input: fs.createReadStream(dictionaryPath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  let header = true;
  let seen = 0;
  let created = 0;
  let filledExisting = 0;
  let skipped = 0;
  const batch: BackfillWord[] = [];

  for await (const line of rl) {
    if (header) {
      header = false;
      continue;
    }
    if (!line.trim()) continue;

    const row = toBackfillWord(parseCsvLine(line));
    if (!row) {
      skipped += 1;
      continue;
    }

    const existing = existingWords.get(row.word);
    if (existing) {
      const updateData = {
        phoneticUk: existing.phoneticUk || row.phoneticUk,
        phoneticUs: existing.phoneticUs || row.phoneticUs,
        partOfSpeech: existing.partOfSpeech || row.partOfSpeech,
        meaningCn: existing.meaningCn || row.meaningCn,
        meaningEn: existing.meaningEn || row.meaningEn,
        shortMeaningCn: existing.shortMeaningCn || row.shortMeaningCn,
        frequencyRank: existing.frequencyRank || row.frequencyRank
      };
      if (hasChanged(existing, updateData)) {
        await prisma.word.update({ where: { word: row.word }, data: updateData });
        existingWords.set(row.word, { word: row.word, ...updateData });
        filledExisting += 1;
      }
    } else {
      batch.push(row);
      existingWords.set(row.word, {
        word: row.word,
        phoneticUk: row.phoneticUk,
        phoneticUs: row.phoneticUs,
        partOfSpeech: row.partOfSpeech,
        meaningCn: row.meaningCn,
        meaningEn: row.meaningEn,
        shortMeaningCn: row.shortMeaningCn,
        frequencyRank: row.frequencyRank
      });
      if (batch.length >= batchSize) {
        created += await flushBatch(batch);
      }
    }

    seen += 1;
    if (seen % 10_000 === 0) {
      console.log(`Processed ${seen}. created=${created}, filledExisting=${filledExisting}, skipped=${skipped}`);
    }
  }

  created += await flushBatch(batch);
  console.log(`Dictionary backfill complete. processed=${seen}, created=${created}, filledExisting=${filledExisting}, skipped=${skipped}`);
}

type BackfillWord = {
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
};

function toBackfillWord(row: string[]): BackfillWord | null {
  const originalWord = (row[0] ?? "").trim();
  const word = originalWord.toLowerCase();
  const rawPhonetic = row[1] ?? "";
  const definition = cleanText(row[2] ?? "");
  const rawTranslation = row[3] ?? "";
  const translation = cleanupTranslation(rawTranslation);
  const partOfSpeech = normalizePos([row[4] ?? "", translation, definition].join("\n"));
  const signals = {
    collins: toRank(row[5] ?? ""),
    oxford: toRank(row[6] ?? ""),
    tag: (row[7] ?? "").trim(),
    bnc: toRank(row[8] ?? ""),
    frq: toRank(row[9] ?? "")
  };

  if (!isImportableWord(originalWord, word, rawPhonetic, rawTranslation, translation, partOfSpeech, signals)) return null;
  const meaningCn = compactMeaning(translation);
  const frequencyRank = signals.frq ?? signals.bnc;
  const phonetic = normalizePhonetic(rawPhonetic);

  return {
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
    difficulty: difficultyForRank(frequencyRank),
    status: WordStatus.EMPTY
  };
}

function parseCsvLine(line: string) {
  const result: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"" && line[i + 1] === "\"") {
      value += "\"";
      i += 1;
    } else if (char === "\"") {
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

function cleanText(value: string) {
  return value.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
}

function normalizePhonetic(value: string) {
  const text = value
    .trim()
    .replace(/^\/|\/$/g, "")
    .replace(/ә/g, "ə")
    .replace(/ɑ/g, "ɑ")
    .replace(/:/g, "ː")
    .replace(/'/g, "ˈ")
    .replace(/,/g, "ˌ");
  return text ? `/${text}/` : "";
}

function normalizePos(value: string) {
  const normalized = value
    .replace(/\bvt\./g, "v.")
    .replace(/\bvi\./g, "v.")
    .replace(/\ba\./g, "adj.")
    .replace(/\bs\./g, "adj.")
    .replace(/\br\./g, "adv.");
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
    const normalized = line
      .replace(/\bvt\./g, "v.")
      .replace(/\bvi\./g, "v.")
      .replace(/\ba\./g, "adj.")
      .replace(/\bs\./g, "adj.")
      .replace(/\br\./g, "adv.");
    const match = normalized.match(/^(n|v|adj|adv|prep|conj|pron|abbr|int|suf)\.\s*(.+)$/);
    const pos = match?.[1] ? `${match[1]}.` : "";
    const body = match?.[2] ?? normalized;
    const terms = body
      .split(/[；;，,、]/)
      .map((item) => item.replace(/\([^)]{0,24}\)/g, "").trim())
      .filter(Boolean)
      .filter((item) => !item.includes("=") && !item.includes("等于"))
      .filter((item) => item.length <= 24);
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
  if (originalWord !== word) return false;
  if (!/^[a-z]{2,32}$/.test(word)) return false;
  if (!phonetic.trim()) return false;
  if (!translation) return false;
  if (!partOfSpeech) return false;
  if (/abbr\./i.test(rawTranslation)) return false;
  if (/人名|男子名|女子名|城市|州名|地名|网络/.test(rawTranslation)) return false;
  if (translation.length > 900) return false;
  return Boolean(signals.tag || signals.collins || signals.oxford || (signals.frq && signals.frq < rankThreshold) || (signals.bnc && signals.bnc < rankThreshold));
}

function difficultyForRank(rank: number | null) {
  if (!rank) return 4;
  if (rank < 8_000) return 2;
  if (rank < 20_000) return 3;
  if (rank < 50_000) return 4;
  return 5;
}

function toRank(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function flushBatch(batch: BackfillWord[]) {
  if (!batch.length) return 0;
  const { count } = await prisma.word.createMany({ data: batch.splice(0, batch.length), skipDuplicates: true });
  return count;
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
