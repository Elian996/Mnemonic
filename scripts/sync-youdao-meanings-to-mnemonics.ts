import fs from "node:fs/promises";
import path from "node:path";
import { MnemonicStatus, type Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { markdownToPlainText, renderMnemonicMarkdown } from "../src/lib/wiki-links/renderer";

const APPLY = process.argv.includes("--apply");
const ONLY = stringArg("--word");
const ADMIN_EMAIL = process.env.MNEMONIC_CLEANUP_ACTOR_EMAIL ?? "maoshangjian2021@163.com";
const sourceReportPath = path.join(process.cwd(), "tmp", "youdao-word-meaning-repair", "latest.json");
const reportDir = path.join(process.cwd(), "tmp", "youdao-mnemonic-meaning-sync");
const backupDir = path.join(process.cwd(), "tmp", "backups");
const reportPath = path.join(reportDir, "latest.json");
const action = "YOUDAO_MNEMONIC_MEANING_SYNC";

type YoudaoEntry = {
  partOfSpeech: string;
  translation: string;
};

type ReportItem = {
  id: string;
  word: string;
  slug: string;
  sourceUrl: string;
  before: {
    partOfSpeech: string;
    meaningCn: string;
    shortMeaningCn: string;
  };
  after: {
    partOfSpeech: string;
    meaningCn: string;
    shortMeaningCn: string;
  };
  youdaoEntries: YoudaoEntry[];
};

type SourceReport = {
  items: ReportItem[];
};

type EntryRecord = {
  id: string;
  targetWordId: string;
  title: string;
  splitText: string | null;
  contentMarkdown: string;
  targetWord: {
    word: string;
    slug: string;
  };
};

type EntryPlan = {
  entry: EntryRecord;
  item: ReportItem;
  replacements: string[];
  nextMeaning: string;
  nextContentMarkdown: string;
};

type WordShortPlan = {
  id: string;
  word: string;
  slug: string;
  before: string;
  after: string;
  sourceUrl: string;
};

async function main() {
  await fs.mkdir(reportDir, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });

  const actor =
    (await prisma.user.findFirst({
      where: { email: ADMIN_EMAIL, status: "ACTIVE" },
      select: { id: true, username: true, email: true }
    })) ??
    (await prisma.user.findFirst({
      where: { role: "ADMIN", status: "ACTIVE" },
      select: { id: true, username: true, email: true }
    }));
  if (!actor) throw new Error("找不到可用于批量更新的管理员账号。");

  const sourceReport = JSON.parse(await fs.readFile(sourceReportPath, "utf8")) as SourceReport;
  const items = sourceReport.items.filter((item) => !ONLY || item.slug === normalizeSlug(ONLY) || item.word.toLowerCase() === ONLY.toLowerCase());
  const itemById = new Map(items.map((item) => [item.id, item]));
  const ids = items.map((item) => item.id);

  const entries = await prisma.mnemonicEntry.findMany({
    where: {
      targetWordId: { in: ids },
      status: { not: MnemonicStatus.ARCHIVED }
    },
    select: {
      id: true,
      targetWordId: true,
      title: true,
      splitText: true,
      contentMarkdown: true,
      targetWord: { select: { word: true, slug: true } }
    },
    orderBy: [{ createdAt: "asc" }]
  });

  const entryPlans = entries
    .map((entry) => buildEntryPlan(entry, itemById.get(entry.targetWordId)))
    .filter((plan): plan is EntryPlan => Boolean(plan));

  const words = await prisma.word.findMany({
    where: { id: { in: ids } },
    select: { id: true, word: true, slug: true, shortMeaningCn: true }
  });
  const wordShortPlans = words
    .map((word) => {
      const item = itemById.get(word.id);
      if (!item) return null;
      const after = preferredCardMeaning(item);
      if (!after || word.shortMeaningCn.trim() === after) return null;
      return {
        id: word.id,
        word: word.word,
        slug: word.slug,
        before: word.shortMeaningCn,
        after,
        sourceUrl: item.sourceUrl
      } satisfies WordShortPlan;
    })
    .filter((plan): plan is WordShortPlan => Boolean(plan));

  const backupPath = APPLY && (entryPlans.length || wordShortPlans.length) ? await writeBackup(entryPlans, wordShortPlans) : null;

  console.log(`模式：${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor.username} <${actor.email}>`);
  console.log(`读取有道释义更新：${items.length} 个单词`);
  console.log(`待同步记忆卡正文：${entryPlans.length} 张`);
  console.log(`待优化短释义：${wordShortPlans.length} 个单词`);
  console.log("\n样例：");
  for (const plan of entryPlans.slice(0, 30)) {
    console.log(`- ${plan.entry.targetWord.word}: ${plan.replacements.join(" | ")} -> ${plan.nextMeaning}`);
  }

  if (!APPLY) {
    await writeReport({ entryPlans, wordShortPlans, backupPath, status: "dry-run" });
    return;
  }

  let updatedEntries = 0;
  let updatedWords = 0;
  for (const plan of entryPlans) {
    const contentHtml = await renderMnemonicMarkdown(plan.nextContentMarkdown);
    const plainText = markdownToPlainText(
      [plan.entry.splitText ? `划分：${plan.entry.splitText}` : "", plan.nextContentMarkdown].filter(Boolean).join("\n\n")
    );

    await prisma.$transaction(async (tx) => {
      await tx.mnemonicEntryVersion.create({
        data: {
          mnemonicEntryId: plan.entry.id,
          contentMarkdown: plan.entry.contentMarkdown,
          splitText: plan.entry.splitText,
          title: plan.entry.title,
          editorId: actor.id
        }
      });
      await tx.mnemonicEntry.update({
        where: { id: plan.entry.id },
        data: {
          contentMarkdown: plan.nextContentMarkdown,
          contentHtml,
          plainText
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action,
          entityType: "MnemonicEntry",
          entityId: plan.entry.id,
          metadataJson: {
            word: plan.entry.targetWord.word,
            sourceUrl: plan.item.sourceUrl,
            replacements: plan.replacements,
            nextMeaning: plan.nextMeaning
          } satisfies Prisma.InputJsonValue
        }
      });
    });
    updatedEntries += 1;
  }

  for (const plan of wordShortPlans) {
    await prisma.$transaction(async (tx) => {
      await tx.word.update({
        where: { id: plan.id },
        data: { shortMeaningCn: plan.after }
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "YOUDAO_WORD_SHORT_MEANING_SYNC",
          entityType: "Word",
          entityId: plan.id,
          metadataJson: {
            word: plan.word,
            sourceUrl: plan.sourceUrl,
            before: plan.before,
            after: plan.after
          } satisfies Prisma.InputJsonValue
        }
      });
    });
    updatedWords += 1;
  }

  await writeReport({ entryPlans, wordShortPlans, backupPath, status: "complete", updatedEntries, updatedWords });
  console.log(`\n已完成：同步 ${updatedEntries} 张记忆卡正文，优化 ${updatedWords} 个短释义。`);
  if (backupPath) console.log(`备份：${backupPath}`);
  console.log(`报告：${reportPath}`);
}

function buildEntryPlan(entry: EntryRecord, item: ReportItem | undefined) {
  if (!item) return null;
  const nextMeaning = preferredCardMeaning(item);
  if (!nextMeaning) return null;

  let nextContentMarkdown = entry.contentMarkdown;
  const replacements: string[] = [];
  for (const variant of oldMeaningVariants(item)) {
    if (!nextContentMarkdown.includes(variant)) continue;
    nextContentMarkdown = nextContentMarkdown.split(variant).join(nextMeaning);
    replacements.push(variant);
  }

  if (nextContentMarkdown === entry.contentMarkdown) return null;
  return { entry, item, replacements: unique(replacements), nextMeaning, nextContentMarkdown };
}

function preferredCardMeaning(item: ReportItem) {
  const oldParts = normalizePartList(item.before.partOfSpeech);
  const preferred =
    item.youdaoEntries.find((entry) => oldParts.includes(normalizePart(entry.partOfSpeech))) ??
    item.youdaoEntries.find((entry) => normalizePart(entry.partOfSpeech) !== "adv.") ??
    item.youdaoEntries[0];
  return compactTranslation(preferred?.translation ?? item.after.shortMeaningCn);
}

function compactTranslation(value: string) {
  const cleaned = cleanText(value);
  const semicolonPieces = cleaned
    .split(/[；;]/u)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .filter((piece) => !/人名/u.test(piece));
  if (semicolonPieces.length) return semicolonPieces.slice(0, 2).join("；");
  return cleaned;
}

function oldMeaningVariants(item: ReportItem) {
  const values = [item.before.meaningCn, item.before.shortMeaningCn]
    .flatMap((value) => [value, stripLeadingPart(value)])
    .map(cleanText)
    .filter((value) => value.length >= 3);
  return unique(values).sort((left, right) => right.length - left.length);
}

function stripLeadingPart(value: string) {
  return value.replace(/^(?:n|v|adj|adv|prep|conj|pron|num|art|int|abbr)\.\s*/iu, "").trim();
}

function normalizePartList(value: string) {
  return value
    .split(/[\/,，;；\s]+/u)
    .map(normalizePart)
    .filter(Boolean);
}

function normalizePart(value: string) {
  return value
    .replace(/\bvt\./giu, "v.")
    .replace(/\bvi\./giu, "v.")
    .replace(/\ba\./giu, "adj.")
    .replace(/\bs\./giu, "adj.")
    .replace(/\br\./giu, "adv.")
    .trim()
    .toLowerCase();
}

function cleanText(value: string) {
  return value
    .replace(/\u00a0/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

async function writeBackup(entryPlans: EntryPlan[], wordShortPlans: WordShortPlan[]) {
  const backupPath = path.join(
    backupDir,
    `youdao-mnemonic-meaning-sync-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`
  );
  await fs.writeFile(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        action,
        entryCount: entryPlans.length,
        wordShortMeaningCount: wordShortPlans.length,
        entries: entryPlans.map((plan) => ({
          id: plan.entry.id,
          word: plan.entry.targetWord.word,
          slug: plan.entry.targetWord.slug,
          before: plan.entry.contentMarkdown,
          after: plan.nextContentMarkdown,
          replacements: plan.replacements,
          nextMeaning: plan.nextMeaning,
          sourceUrl: plan.item.sourceUrl
        })),
        wordShortMeanings: wordShortPlans
      },
      null,
      2
    )
  );
  return backupPath;
}

async function writeReport({
  entryPlans,
  wordShortPlans,
  backupPath,
  status,
  updatedEntries = 0,
  updatedWords = 0
}: {
  entryPlans: EntryPlan[];
  wordShortPlans: WordShortPlan[];
  backupPath: string | null;
  status: "dry-run" | "complete";
  updatedEntries?: number;
  updatedWords?: number;
}) {
  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        version: 1,
        status,
        applied: APPLY,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sourceReportPath,
        backupPath,
        scannedWords: new Set([...entryPlans.map((plan) => plan.item.word), ...wordShortPlans.map((plan) => plan.word)]).size,
        plannedEntries: entryPlans.length,
        plannedWordShortMeanings: wordShortPlans.length,
        updatedEntries,
        updatedWords,
        rules: [
          "读取有道释义修复报告，定位被更新单词对应的记忆卡。",
          "只替换记忆卡正文中与旧中文释义完全匹配的片段，避免改动记忆逻辑和相关单词。",
          "卡片内短释义优先沿用原词性对应的有道义项，并过滤人名义项。"
        ],
        entries: entryPlans.map((plan) => ({
          id: plan.entry.id,
          word: plan.entry.targetWord.word,
          slug: plan.entry.targetWord.slug,
          replacements: plan.replacements,
          nextMeaning: plan.nextMeaning,
          sourceUrl: plan.item.sourceUrl
        })),
        wordShortMeanings: wordShortPlans
      },
      null,
      2
    )
  );
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeSlug(value: string) {
  return value.trim().toLowerCase().replace(/\s+/gu, "-");
}

function stringArg(name: string) {
  return process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
