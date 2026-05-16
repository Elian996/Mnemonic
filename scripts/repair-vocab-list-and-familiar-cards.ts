import fs from "node:fs";
import path from "node:path";
import { MnemonicSourceType, MnemonicStatus, PrismaClient, WordStatus, type LevelTag } from "@prisma/client";
import { ensureWordNode } from "../src/lib/wiki-links/resolve";
import { markdownToPlainText, renderMnemonicMarkdown } from "../src/lib/wiki-links/renderer";

const prisma = new PrismaClient();
const backupPath = path.join(process.cwd(), "backups", "mnemonic-before-inflected-word-cleanup-20260511082058.json");
const sourceDir = path.join(process.cwd(), "data", "vocab-categories");
const sourceFiles = [
  "level_2.txt",
  "level_3.txt",
  "compulsory.txt",
  "high_school.txt",
  "gaokao_3500.txt",
  "cet4.txt",
  "cet6.txt"
];

const familiarQuantityWords = [
  "a",
  "an",
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "thousand",
  "million",
  "billion",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth",
  "thirtieth",
  "fortieth",
  "fiftieth",
  "sixtieth",
  "seventieth",
  "eightieth",
  "ninetieth",
  "hundredth",
  "thousandth",
  "millionth",
  "billionth",
  "half",
  "quarter",
  "dozen",
  "once",
  "twice",
  "double"
];

type BackupWord = {
  id: string;
  word: string;
  slug: string;
  phoneticUk: string | null;
  phoneticUs: string | null;
  audioUkUrl: string | null;
  audioUsUrl: string | null;
  partOfSpeech: string;
  meaningCn: string;
  meaningEn: string | null;
  shortMeaningCn: string;
  exampleSentence: string | null;
  exampleTranslation: string | null;
  levelTags: LevelTag[];
  frequencyRank: number | null;
  difficulty: number;
  status: WordStatus;
  createdAt: string;
  updatedAt: string;
};

async function main() {
  if (!fs.existsSync(backupPath)) throw new Error(`Missing backup: ${backupPath}`);
  const actor = await prisma.user.findFirst({
    where: { OR: [{ role: "ADMIN" }, { role: "EDITOR" }], status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, username: true }
  });
  if (!actor) throw new Error("找不到可用于批量修复的管理员/编辑账号。");

  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8")) as { words: BackupWord[] };
  const restored = await restoreInflectedWordsWithoutLevelTags(backup.words, actor.id);
  const sourceRemoved = removeInflectedWordsFromSources(new Set(backup.words.map((word) => word.word.toLowerCase())));
  const familiarCards = await createFamiliarQuantityCards(actor.id);

  console.log(`Restored inflected words without level tags: ${restored}`);
  console.log(`Removed source-list inflected lines: ${sourceRemoved}`);
  console.log(`Created familiar quantity cards: ${familiarCards}`);
}

async function restoreInflectedWordsWithoutLevelTags(words: BackupWord[], actorId: string) {
  let restored = 0;
  for (const word of words) {
    const existing = await prisma.word.findUnique({
      where: { word: word.word },
      select: { id: true, levelTags: true }
    });
    if (existing) {
      if (existing.levelTags.length) {
        await prisma.word.update({
          where: { id: existing.id },
          data: { levelTags: [] }
        });
      }
      continue;
    }

    await prisma.word.create({
      data: {
        id: word.id,
        word: word.word,
        slug: word.slug,
        phoneticUk: word.phoneticUk,
        phoneticUs: word.phoneticUs,
        audioUkUrl: word.audioUkUrl,
        audioUsUrl: word.audioUsUrl,
        partOfSpeech: word.partOfSpeech,
        meaningCn: word.meaningCn,
        meaningEn: word.meaningEn,
        shortMeaningCn: word.shortMeaningCn,
        exampleSentence: word.exampleSentence,
        exampleTranslation: word.exampleTranslation,
        levelTags: [],
        frequencyRank: word.frequencyRank,
        difficulty: word.difficulty,
        status: word.status,
        createdAt: new Date(word.createdAt),
        updatedAt: new Date(word.updatedAt)
      }
    });
    await prisma.auditLog.create({
      data: {
        actorId,
        action: "WORD_RESTORE_AS_UNLEVELED_INFLECTION",
        entityType: "Word",
        entityId: word.id,
        metadataJson: {
          word: word.word,
          previousLevelTags: word.levelTags
        }
      }
    });
    restored += 1;
  }
  return restored;
}

function removeInflectedWordsFromSources(words: Set<string>) {
  let removed = 0;
  for (const file of sourceFiles) {
    const filePath = path.join(sourceDir, file);
    if (!fs.existsSync(filePath)) continue;
    const original = fs.readFileSync(filePath, "utf8");
    const lines = original.split(/\r?\n/);
    const filtered = lines.filter((line) => !words.has(line.trim().toLowerCase()));
    removed += lines.length - filtered.length;
    if (filtered.length !== lines.length) {
      fs.writeFileSync(filePath, `${filtered.join("\n").replace(/\n+$/u, "")}\n`);
    }
  }
  return removed;
}

async function createFamiliarQuantityCards(actorId: string) {
  const contentMarkdown = "熟悉单词，略";
  const contentHtml = await renderMnemonicMarkdown(contentMarkdown);
  const plainText = markdownToPlainText(contentMarkdown);
  const words = await prisma.word.findMany({
    where: {
      word: { in: familiarQuantityWords },
      levelTags: { isEmpty: false },
      mnemonicEntries: { none: { status: { not: MnemonicStatus.ARCHIVED } } }
    },
    select: {
      id: true,
      word: true,
      status: true
    },
    orderBy: { word: "asc" }
  });

  let created = 0;
  for (const word of words) {
    await prisma.$transaction(async (tx) => {
      const entry = await tx.mnemonicEntry.create({
        data: {
          targetWordId: word.id,
          authorId: actorId,
          sourceType: MnemonicSourceType.OFFICIAL,
          status: MnemonicStatus.APPROVED,
          title: `${word.word} 熟悉单词`,
          splitText: "",
          contentMarkdown,
          contentHtml,
          plainText,
          isPublic: true,
          isOfficialRecommended: true,
          sortOrder: 0,
          editorScore: 1
        }
      });
      await tx.word.update({
        where: { id: word.id },
        data: { status: WordStatus.PUBLISHED }
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "MNEMONIC_FAMILIAR_QUANTITY_CARD_CREATE",
          entityType: "MnemonicEntry",
          entityId: entry.id,
          metadataJson: { word: word.word, wordId: word.id }
        }
      });
    });
    await ensureWordNode(word.id);
    created += 1;
  }
  return created;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
