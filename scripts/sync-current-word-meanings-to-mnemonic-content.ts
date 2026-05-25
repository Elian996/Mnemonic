import fs from "node:fs/promises";
import path from "node:path";
import { MnemonicStatus, type Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { markdownToPlainText, renderMnemonicMarkdown } from "../src/lib/wiki-links/renderer";

const APPLY = process.argv.includes("--apply");
const ONLY = stringArg("--word");
const ADMIN_EMAIL = process.env.MNEMONIC_CLEANUP_ACTOR_EMAIL ?? "maoshangjian2021@163.com";
const sourceReportPath = path.join(process.cwd(), "tmp", "youdao-word-meaning-repair", "latest.json");
const reportDir = path.join(process.cwd(), "tmp", "current-word-meaning-content-sync");
const backupDir = path.join(process.cwd(), "tmp", "backups");
const reportPath = path.join(reportDir, "latest.json");
const action = "CURRENT_WORD_MEANING_CONTENT_SYNC";

type WordRecord = {
  id: string;
  word: string;
  slug: string;
  meaningCn: string;
  shortMeaningCn: string;
};

type EntryRecord = {
  id: string;
  title: string;
  splitText: string | null;
  contentMarkdown: string;
  targetWord: WordRecord;
};

type YoudaoReportItem = {
  word: string;
  slug: string;
  sourceUrl: string;
  before: {
    partOfSpeech: string;
    meaningCn: string;
    shortMeaningCn: string;
  };
  youdaoEntries: Array<{
    partOfSpeech: string;
    translation: string;
  }>;
};

type Replacement = {
  word: string;
  source: "target-phrase" | "base-phrase" | "youdao-report-exact";
  before: string;
  after: string;
};

type EntryPlan = {
  entry: EntryRecord;
  replacements: Replacement[];
  nextContentMarkdown: string;
};

type ShortMeaningPlan = {
  id: string;
  word: string;
  slug: string;
  before: string;
  after: string;
};

const bracketLabelPattern = /(^|[；;，,、\s])\[(?!\[)[^\]\n]{1,12}\]\s*/gu;
const personNamePattern = /人名/u;
const hasNoisyLabelPattern = /(^|[；;，,、\s])\[(?!\[)[^\]\n]{1,12}\]\s*|【[^】]+】|（[^）]{0,20}人名）|\([^)]{0,20}人名\)/u;
const baseDefinitionPattern =
  /(\b([a-z][a-z-]{1,40})\b 为已经记忆过的单词，表示\s*)([^。\n]+?)(?=；(?:-[a-z]+|把\s+-?[a-z]+|加\s+-?[a-z]+|去掉|将\s+|词根|词缀)|。|\n)/giu;
const targetDefinitionPattern = /(由此记住\s+([a-z][a-z-]{1,40})\s+表示\s*)([^。\n]+)(?=。|\n)/giu;
const legacyTargetDefinitionPattern = /((?:即|故)表示(?:的是)?\s*)([^。\n]+)(?=。|\n)/giu;

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

  const words = await prisma.word.findMany({
    select: { id: true, word: true, slug: true, meaningCn: true, shortMeaningCn: true },
    orderBy: { word: "asc" }
  });
  const wordByText = new Map(words.map((word) => [word.word.toLowerCase(), word]));
  const reportItems = await readYoudaoReportItems();

  const entries = await prisma.mnemonicEntry.findMany({
    where: {
      status: { not: MnemonicStatus.ARCHIVED },
      ...(ONLY
        ? { targetWord: { slug: normalizeSlug(ONLY) } }
        : {
            OR: [
              { contentMarkdown: { contains: "[" } },
              { contentMarkdown: { contains: "【" } },
              { contentMarkdown: { contains: "人名" } }
            ]
          })
    },
    select: {
      id: true,
      title: true,
      splitText: true,
      contentMarkdown: true,
      targetWord: { select: { id: true, word: true, slug: true, meaningCn: true, shortMeaningCn: true } }
    },
    orderBy: [{ createdAt: "asc" }]
  });

  const entryPlans = entries
    .map((entry) => buildEntryPlan(entry, wordByText, reportItems))
    .filter((plan): plan is EntryPlan => Boolean(plan));

  const shortMeaningPlans = words
    .map((word) => {
      if (!hasNoisyLabel(word.shortMeaningCn) || personNamePattern.test(word.shortMeaningCn)) return null;
      const after = displayMeaning(word);
      if (!after || after === word.shortMeaningCn.trim()) return null;
      return { id: word.id, word: word.word, slug: word.slug, before: word.shortMeaningCn, after } satisfies ShortMeaningPlan;
    })
    .filter((plan): plan is ShortMeaningPlan => Boolean(plan));

  const backupPath = APPLY && (entryPlans.length || shortMeaningPlans.length) ? await writeBackup(entryPlans, shortMeaningPlans) : null;

  console.log(`模式：${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor.username} <${actor.email}>`);
  console.log(`扫描记忆卡正文：${entries.length} 张`);
  console.log(`待同步正文：${entryPlans.length} 张`);
  console.log(`待清理短释义展示：${shortMeaningPlans.length} 个单词`);
  console.log("\n样例：");
  for (const plan of entryPlans.slice(0, 35)) {
    const preview = plan.replacements.map((item) => `${item.word}: ${item.before} -> ${item.after}`).join(" | ");
    console.log(`- ${plan.entry.targetWord.word}: ${preview}`);
  }

  if (!APPLY) {
    await writeReport({ entryPlans, shortMeaningPlans, backupPath, status: "dry-run" });
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
        data: { contentMarkdown: plan.nextContentMarkdown, contentHtml, plainText }
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action,
          entityType: "MnemonicEntry",
          entityId: plan.entry.id,
          metadataJson: {
            word: plan.entry.targetWord.word,
            replacements: plan.replacements
          } satisfies Prisma.InputJsonValue
        }
      });
    });
    updatedEntries += 1;
  }

  for (const plan of shortMeaningPlans) {
    await prisma.$transaction(async (tx) => {
      await tx.word.update({ where: { id: plan.id }, data: { shortMeaningCn: plan.after } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "WORD_SHORT_MEANING_DISPLAY_CLEANUP",
          entityType: "Word",
          entityId: plan.id,
          metadataJson: { word: plan.word, before: plan.before, after: plan.after } satisfies Prisma.InputJsonValue
        }
      });
    });
    updatedWords += 1;
  }

  await writeReport({ entryPlans, shortMeaningPlans, backupPath, status: "complete", updatedEntries, updatedWords });
  console.log(`\n已完成：同步 ${updatedEntries} 张记忆卡正文，清理 ${updatedWords} 个短释义展示。`);
  if (backupPath) console.log(`备份：${backupPath}`);
  console.log(`报告：${reportPath}`);
}

function buildEntryPlan(entry: EntryRecord, wordByText: Map<string, WordRecord>, reportItems: YoudaoReportItem[]) {
  let nextContentMarkdown = entry.contentMarkdown;
  const replacements: Replacement[] = [];

  for (const item of reportItems) {
    const currentWord = wordByText.get(item.word.toLowerCase());
    const after = currentWord ? displayMeaning(currentWord) : youdaoDisplayMeaning(item);
    if (!after) continue;
    for (const before of oldMeaningVariants(item)) {
      if (!hasNoisyLabel(before) || !nextContentMarkdown.includes(before)) continue;
      nextContentMarkdown = nextContentMarkdown.split(before).join(after);
      replacements.push({ word: item.word, source: "youdao-report-exact", before, after });
    }
  }

  nextContentMarkdown = nextContentMarkdown.replace(baseDefinitionPattern, (full, prefix: string, wordText: string, before: string) => {
    if (!hasNoisyLabel(before)) return full;
    const word = wordByText.get(wordText.toLowerCase());
    const after = word ? displayMeaning(word) : "";
    if (!after || cleanText(before) === after) return full;
    replacements.push({ word: wordText.toLowerCase(), source: "base-phrase", before: cleanText(before), after });
    return `${prefix}${after}`;
  });

  nextContentMarkdown = nextContentMarkdown.replace(targetDefinitionPattern, (full, prefix: string, wordText: string, before: string) => {
    if (!hasNoisyLabel(before)) return full;
    const word = wordByText.get(wordText.toLowerCase());
    const after = word ? displayMeaning(word) : "";
    if (!after || cleanText(before) === after) return full;
    replacements.push({ word: wordText.toLowerCase(), source: "target-phrase", before: cleanText(before), after });
    return `${prefix}${after}`;
  });

  nextContentMarkdown = nextContentMarkdown.replace(legacyTargetDefinitionPattern, (full, prefix: string, before: string) => {
    if (!hasNoisyLabel(before)) return full;
    const after = displayMeaning(entry.targetWord);
    if (!after || cleanText(before) === after) return full;
    replacements.push({ word: entry.targetWord.word, source: "target-phrase", before: cleanText(before), after });
    return `${prefix}${after}`;
  });

  if (nextContentMarkdown === entry.contentMarkdown) return null;
  return { entry, replacements: uniqueReplacements(replacements), nextContentMarkdown };
}

function displayMeaning(word: WordRecord) {
  const short = cleanDisplayMeaning(word.shortMeaningCn);
  const source = !short || isOnlyPartOfSpeech(short) ? word.meaningCn : word.shortMeaningCn || word.meaningCn;
  return compactDisplayMeaning(cleanDisplayMeaning(source));
}

function youdaoDisplayMeaning(item: YoudaoReportItem) {
  const oldParts = normalizePartList(item.before.partOfSpeech);
  const preferred =
    item.youdaoEntries.find((entry) => oldParts.includes(normalizePart(entry.partOfSpeech))) ??
    item.youdaoEntries.find((entry) => normalizePart(entry.partOfSpeech) !== "adv.") ??
    item.youdaoEntries[0];
  return compactDisplayMeaning(cleanDisplayMeaning(preferred?.translation ?? ""));
}

function compactDisplayMeaning(value: string) {
  const pieces = value
    .split(/[；;]/u)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .filter((piece) => !personNamePattern.test(piece));
  return pieces.length ? pieces.slice(0, 2).join("；") : value;
}

function oldMeaningVariants(item: YoudaoReportItem) {
  return unique(
    [item.before.meaningCn, item.before.shortMeaningCn]
      .flatMap((value) => [value, stripLeadingPart(value)])
      .map(cleanText)
      .filter((value) => value.length >= 3)
  ).sort((left, right) => right.length - left.length);
}

function cleanDisplayMeaning(value: string) {
  let cleaned = stripLeadingPart(cleanText(value));
  for (let index = 0; index < 4; index += 1) {
    const next = cleaned.replace(bracketLabelPattern, "$1");
    if (next === cleaned) break;
    cleaned = next;
  }
  return cleaned
    .replace(/【[^】]+】/gu, "")
    .replace(/\s*；\s*/gu, "；")
    .replace(/\s*，\s*/gu, "，")
    .replace(/^[；;，,、\s]+|[；;，,、\s]+$/gu, "")
    .trim();
}

function hasNoisyLabel(value: string) {
  return hasNoisyLabelPattern.test(value);
}

function stripLeadingPart(value: string) {
  return cleanText(value).replace(/^(?:n|v|adj|adv|prep|conj|pron|num|art|int|abbr)\.\s*/iu, "").trim();
}

function isOnlyPartOfSpeech(value: string) {
  return /^(?:n|v|adj|adv|prep|conj|pron|num|art|int|abbr)\.?$/iu.test(value.trim());
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

async function readYoudaoReportItems() {
  try {
    const report = JSON.parse(await fs.readFile(sourceReportPath, "utf8")) as { items?: YoudaoReportItem[] };
    return report.items ?? [];
  } catch {
    return [];
  }
}

async function writeBackup(entryPlans: EntryPlan[], shortMeaningPlans: ShortMeaningPlan[]) {
  const backupPath = path.join(
    backupDir,
    `current-word-meaning-content-sync-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`
  );
  await fs.writeFile(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        action,
        entryCount: entryPlans.length,
        shortMeaningCount: shortMeaningPlans.length,
        entries: entryPlans.map((plan) => ({
          id: plan.entry.id,
          word: plan.entry.targetWord.word,
          slug: plan.entry.targetWord.slug,
          before: plan.entry.contentMarkdown,
          after: plan.nextContentMarkdown,
          replacements: plan.replacements
        })),
        shortMeanings: shortMeaningPlans
      },
      null,
      2
    )
  );
  return backupPath;
}

async function writeReport({
  entryPlans,
  shortMeaningPlans,
  backupPath,
  status,
  updatedEntries = 0,
  updatedWords = 0
}: {
  entryPlans: EntryPlan[];
  shortMeaningPlans: ShortMeaningPlan[];
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
        backupPath,
        plannedEntries: entryPlans.length,
        plannedShortMeanings: shortMeaningPlans.length,
        updatedEntries,
        updatedWords,
        rules: [
          "扫描所有未归档记忆卡正文中的领域标签/人名标签残留。",
          "同步“由此记住 target 表示 ...”中的目标词释义为当前词库短释义。",
          "同步“base 为已经记忆过的单词，表示 ...”中的基础词释义为当前词库短释义。",
          "短释义展示会去掉句首/分号后的领域标签，如 [机]、[电]、[建]。"
        ],
        entries: entryPlans.map((plan) => ({
          id: plan.entry.id,
          word: plan.entry.targetWord.word,
          slug: plan.entry.targetWord.slug,
          replacements: plan.replacements
        })),
        shortMeanings: shortMeaningPlans
      },
      null,
      2
    )
  );
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueReplacements(replacements: Replacement[]) {
  const seen = new Set<string>();
  return replacements.filter((replacement) => {
    const key = `${replacement.word}\u0000${replacement.source}\u0000${replacement.before}\u0000${replacement.after}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
