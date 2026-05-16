import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { PrismaClient } from "@prisma/client";

type DictionaryEntry = {
  word: string;
  phonetic: string;
  partOfSpeech: string;
  meaningCn: string;
  meaningEn: string | null;
  shortMeaningCn: string;
};

const prisma = new PrismaClient();
const dictionaryPath = path.join(process.cwd(), "data", "ecdict.full.csv");
const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Number.POSITIVE_INFINITY;
const batchSize = 300;

const meaningOverrides: Record<string, Partial<DictionaryEntry>> = {
  pointless: {
    partOfSpeech: "adj.",
    meaningCn: "adj. 无意义的；无目标的；徒劳的；不得要领的；不尖的；钝的",
    shortMeaningCn: "无意义的；无目标的"
  }
};

async function main() {
  if (!fs.existsSync(dictionaryPath)) {
    throw new Error(`Dictionary file not found: ${dictionaryPath}`);
  }

  const words = await prisma.word.findMany({
    select: {
      id: true,
      word: true,
      phoneticUk: true,
      phoneticUs: true,
      partOfSpeech: true,
      meaningCn: true,
      meaningEn: true,
      shortMeaningCn: true
    },
    orderBy: { word: "asc" },
    take: Number.isFinite(limit) ? limit : undefined
  });
  const targetWords = new Set(words.map((word) => word.word.toLowerCase()));
  const dictionary = await loadDictionary(targetWords);
  const changes = words
    .map((word) => {
      const entry = dictionary.get(word.word.toLowerCase());
      if (!entry) return null;

      const next = {
        phoneticUk: word.phoneticUk || entry.phonetic || null,
        phoneticUs: word.phoneticUs || entry.phonetic || null,
        partOfSpeech: entry.partOfSpeech || word.partOfSpeech,
        meaningCn: entry.meaningCn,
        meaningEn: entry.meaningEn || word.meaningEn,
        shortMeaningCn: entry.shortMeaningCn
      };

      const changed =
        word.phoneticUk !== next.phoneticUk ||
        word.phoneticUs !== next.phoneticUs ||
        word.partOfSpeech !== next.partOfSpeech ||
        word.meaningCn !== next.meaningCn ||
        word.meaningEn !== next.meaningEn ||
        word.shortMeaningCn !== next.shortMeaningCn;

      return changed ? { id: word.id, word: word.word, before: word, after: next } : null;
    })
    .filter((change): change is NonNullable<typeof change> => Boolean(change));

  console.log(`Scanned ${words.length} words. dictionaryMatches=${dictionary.size}, changes=${changes.length}`);
  console.log(JSON.stringify(changes.slice(0, 12).map(({ word, before, after }) => ({
    word,
    before: {
      partOfSpeech: before.partOfSpeech,
      meaningCn: before.meaningCn,
      shortMeaningCn: before.shortMeaningCn
    },
    after: {
      partOfSpeech: after.partOfSpeech,
      meaningCn: after.meaningCn,
      shortMeaningCn: after.shortMeaningCn
    }
  })), null, 2));

  if (dryRun) return;

  const backupPath = path.join(process.cwd(), "tmp", `word-meanings-backup-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(words, null, 2));
  console.log(`Backup written: ${backupPath}`);

  let updated = 0;
  for (let index = 0; index < changes.length; index += batchSize) {
    const batch = changes.slice(index, index + batchSize);
    await prisma.$transaction(
      batch.map((change) =>
        prisma.word.update({
          where: { id: change.id },
          data: change.after
        })
      )
    );
    updated += batch.length;
    if (updated % 3000 === 0 || updated === changes.length) {
      console.log(`Updated ${updated}/${changes.length}`);
    }
  }

  console.log(`Meaning improvement complete. updated=${updated}, backup=${backupPath}`);
}

async function loadDictionary(targetWords: Set<string>) {
  const entries = new Map<string, DictionaryEntry>();
  const rl = readline.createInterface({
    input: fs.createReadStream(dictionaryPath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  let header = true;
  for await (const line of rl) {
    if (header) {
      header = false;
      continue;
    }
    if (!line.trim()) continue;

    const row = parseCsvLine(line);
    const word = cleanWord(row[0] ?? "");
    if (!targetWords.has(word) || entries.has(word)) continue;

    const translation = cleanupTranslation(row[3] ?? "");
    if (!translation) continue;

    const entry = buildEntry({
      word,
      phonetic: normalizePhonetic(row[1] ?? ""),
      definition: cleanText(row[2] ?? ""),
      translation,
      partOfSpeech: normalizePos([row[4] ?? "", translation, row[2] ?? ""].join("\n"))
    });
    entries.set(word, applyOverride(entry));
    if (entries.size === targetWords.size) break;
  }

  return entries;
}

function buildEntry(input: {
  word: string;
  phonetic: string;
  definition: string;
  translation: string;
  partOfSpeech: string;
}): DictionaryEntry {
  const meaningCn = compactDetailedMeaning(input.translation);
  return {
    word: input.word,
    phonetic: input.phonetic,
    partOfSpeech: input.partOfSpeech,
    meaningCn,
    meaningEn: input.definition || null,
    shortMeaningCn: shortMeaning(meaningCn)
  };
}

function applyOverride(entry: DictionaryEntry) {
  return { ...entry, ...(meaningOverrides[entry.word] ?? {}) };
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

function cleanWord(value: string) {
  return value.trim().toLowerCase();
}

function cleanText(value: string) {
  return value.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
}

function normalizePhonetic(value: string) {
  const text = value.trim().replace(/^\/|\/$/g, "");
  return text ? `/${text}/` : "";
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
        .replace(/\[(?:古|俚|口|美|英|罕|废|诗|方|贬|褒|正式|非正式|音|语法|亦作|常用|计|地名|医|化|经|法|生|军|矿|植|动|航|天|数)\]/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/【[^】]+】/g, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizePos(value: string) {
  const normalized = value
    .replace(/\bvt\./gi, "v.")
    .replace(/\bvi\./gi, "v.")
    .replace(/\ba\./gi, "adj.")
    .replace(/\bs\./gi, "adj.")
    .replace(/\br\./gi, "adv.");
  const matches = Array.from(
    normalized.matchAll(/\b(n|v|adj|adv|prep|conj|pron|abbr|int|num|art|aux)\./gi)
  ).map((match) => `${String(match[1]).toLowerCase()}.`);
  return Array.from(new Set(matches)).join("/") || "n.";
}

function compactDetailedMeaning(value: string) {
  const groups = new Map<string, string[]>();
  for (const line of value.split("\n").map((item) => item.trim()).filter(Boolean)) {
    const normalized = line
      .replace(/\bvt\./gi, "v.")
      .replace(/\bvi\./gi, "v.")
      .replace(/\ba\./gi, "adj.")
      .replace(/\bs\./gi, "adj.")
      .replace(/\br\./gi, "adv.")
      .replace(/,/g, "，")
      .replace(/;/g, "；");
    const match = normalized.match(/^(n|v|adj|adv|prep|conj|pron|abbr|int|num|art|aux|suf)\.\s*(.+)$/i);
    const pos = match?.[1] ? `${match[1].toLowerCase()}.` : "释义";
    const body = match?.[2] ?? normalized;
    const terms = body
      .split(/[；;，,、]/)
      .map((item) => item.replace(/\([^)]{0,32}\)/g, "").trim())
      .filter(Boolean)
      .filter((item) => !item.includes("=") && !item.includes("等于"))
      .filter((item) => item.length <= 32);
    const current = groups.get(pos) ?? [];
    groups.set(pos, [...current, ...terms]);
  }

  const seenTerms = new Set<string>();
  const output = Array.from(groups.entries())
    .map(([pos, terms]) => {
      const unique = Array.from(new Set(terms)).filter((term) => {
        const key = term.replace(/\s+/g, "");
        if (seenTerms.has(key)) return false;
        seenTerms.add(key);
        return true;
      }).slice(0, pos === "v." ? 22 : 16);
      if (!unique.length) return "";
      return pos === "释义" ? unique.join("；") : `${pos} ${unique.join("；")}`;
    })
    .filter(Boolean)
    .slice(0, 6)
    .join("；");

  return output || value.replace(/\n/g, "；").slice(0, 260);
}

function shortMeaning(value: string) {
  const withoutPos = value.replace(/^(n|v|adj|adv|prep|conj|pron|abbr|int|num|art|aux)\.\s*/i, "");
  const parts = withoutPos
    .split(/[；;，,、。]/)
    .map((item) => item.replace(/^(n|v|adj|adv|prep|conj|pron|abbr|int|num|art|aux)\.\s*/i, "").trim())
    .filter(Boolean)
    .filter((item) => item.length <= 12)
    .slice(0, 2);
  return parts.join("；") || withoutPos.slice(0, 16) || "未填写";
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
