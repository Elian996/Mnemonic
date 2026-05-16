import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const sampleSize = Number(process.argv.find((arg) => arg.startsWith("--sample="))?.split("=")[1] ?? 40);

async function main() {
  const words = await prisma.word.findMany({
    select: {
      id: true,
      word: true,
      meaningCn: true,
      shortMeaningCn: true,
      phoneticUk: true,
      phoneticUs: true,
      partOfSpeech: true,
      status: true,
      _count: {
        select: {
          mnemonicEntries: true,
          bookmarks: true,
          reviewCards: true,
          wordMarks: true
        }
      }
    },
    orderBy: { word: "asc" }
  });
  const dictionaryWords = await loadDictionaryWords();
  const missingDictionary = words.filter((word) => !dictionaryWords.has(word.word.toLowerCase()));
  const emptyMeaning = words.filter((word) => !word.meaningCn.trim());
  const missingPosPrefix = words.filter(
    (word) => word.meaningCn.trim() && !/^(n|v|adj|adv|prep|conj|pron|abbr|int|num|art|aux)\.\s*/i.test(word.meaningCn)
  );
  const likelyPlaceholders = missingDictionary.filter(
    (word) =>
      word.status === "EMPTY" &&
      !word.phoneticUk &&
      !word.phoneticUs &&
      (!word.meaningCn.trim() || !looksLikeStandaloneWord(word.word))
  );

  const report = {
    total: words.length,
    ecdictRawMatches: words.length - missingDictionary.length,
    missingDictionary: missingDictionary.length,
    emptyMeaning: emptyMeaning.length,
    missingPosPrefix: missingPosPrefix.length,
    likelyBadPlaceholders: likelyPlaceholders.length,
    missingDictionaryWithRelations: missingDictionary.filter(hasRelations).length,
    emptyMeaningWithRelations: emptyMeaning.filter(hasRelations).length,
    samples: {
      missingDictionary: summarize(missingDictionary),
      emptyMeaning: summarize(emptyMeaning),
      missingPosPrefix: summarize(missingPosPrefix),
      likelyBadPlaceholders: summarize(likelyPlaceholders)
    }
  };

  console.log(JSON.stringify(report, null, 2));
}

async function loadDictionaryWords() {
  const dictionaryWords = new Set<string>();
  const filePath = path.join(process.cwd(), "data", "ecdict.full.csv");
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  let header = true;
  for await (const line of rl) {
    if (header) {
      header = false;
      continue;
    }
    const word = line.split(",", 1)[0]?.trim().toLowerCase();
    if (word) dictionaryWords.add(word);
  }
  return dictionaryWords;
}

function hasRelations(word: { _count: Record<string, number> }) {
  return Object.values(word._count).some(Boolean);
}

function looksLikeStandaloneWord(value: string) {
  if (!/^[a-z][a-z-]{1,38}$/i.test(value)) return false;
  if (/^[a-z]{2,5}$/i.test(value) && !/[aeiouy]/i.test(value)) return false;
  return true;
}

function summarize<T extends { word: string; meaningCn: string; _count: Record<string, number> }>(words: T[]) {
  return words.slice(0, sampleSize).map((word) => ({
    word: word.word,
    meaningCn: word.meaningCn,
    relations: word._count
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
