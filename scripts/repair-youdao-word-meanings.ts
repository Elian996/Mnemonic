import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { type Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");
const LIMIT = numberArg("--limit");
const ONLY = stringArg("--word");
const ADMIN_EMAIL = process.env.MNEMONIC_CLEANUP_ACTOR_EMAIL ?? "maoshangjian2021@163.com";
const reportDir = path.join(process.cwd(), "tmp", "youdao-word-meaning-repair");
const backupDir = path.join(process.cwd(), "tmp", "backups");
const reportPath = path.join(reportDir, "latest.json");
const action = "YOUDAO_WORD_MEANING_REPAIR";

type WordRecord = {
  id: string;
  word: string;
  slug: string;
  phoneticUk: string | null;
  phoneticUs: string | null;
  partOfSpeech: string;
  meaningCn: string;
  shortMeaningCn: string;
  meaningEn: string | null;
};

type YoudaoEntry = {
  partOfSpeech: string;
  translation: string;
};

type Plan = {
  word: WordRecord;
  sourceUrl: string;
  entries: YoudaoEntry[];
  next: {
    partOfSpeech: string;
    meaningCn: string;
    shortMeaningCn: string;
  };
};

type SkippedItem = {
  word: string;
  slug: string;
  reason: string;
  sourceUrl: string;
};

const noisyMeaningPattern =
  /\[(?:机|医|化|计|经|法|生|军|矿|植|动|航|天|数|物|地|农|建|电|工|语|音|网|网络|地名|人名)\]|（[^）]{0,20}人名）|\([^)]{0,20}人名\)|^\s*(?:\[[^\]]+\]|【[^】]+】)/u;

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
    where: ONLY
      ? { slug: normalizeSlug(ONLY) }
      : {
          OR: [
            { meaningCn: { contains: "[" } },
            { meaningCn: { contains: "【" } },
            { meaningCn: { contains: "人名" } },
            { shortMeaningCn: { contains: "[" } },
            { shortMeaningCn: { contains: "【" } },
            { shortMeaningCn: { contains: "人名" } }
          ]
        },
    select: {
      id: true,
      word: true,
      slug: true,
      phoneticUk: true,
      phoneticUs: true,
      partOfSpeech: true,
      meaningCn: true,
      shortMeaningCn: true,
      meaningEn: true
    },
    orderBy: { word: "asc" },
    take: LIMIT
  });
  const candidates = words.filter(
    (word) =>
      noisyMeaningPattern.test(word.meaningCn) || noisyMeaningPattern.test(word.shortMeaningCn)
  );

  const plans: Plan[] = [];
  const skipped: SkippedItem[] = [];

  console.log(`模式：${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor.username} <${actor.email}>`);
  console.log(`候选单词：${candidates.length}`);

  for (const [index, word] of candidates.entries()) {
    const sourceUrl = youdaoUrl(word.word);
    try {
      const lookup = await lookupYoudao(word.word);
      if (!lookup.entries.length) {
        skipped.push({ word: word.word, slug: word.slug, reason: "有道未返回可用简明释义或仅有人名义项", sourceUrl });
        continue;
      }

      const next = buildWordFields(lookup.entries);
      if (!next.meaningCn) {
        skipped.push({ word: word.word, slug: word.slug, reason: "有道释义清洗后为空", sourceUrl });
        continue;
      }

      if (
        sameValue(word.partOfSpeech, next.partOfSpeech) &&
        sameValue(word.meaningCn, next.meaningCn) &&
        sameValue(word.shortMeaningCn, next.shortMeaningCn)
      ) {
        continue;
      }

      plans.push({
        word,
        sourceUrl,
        entries: lookup.entries,
        next
      });

      if ((index + 1) % 50 === 0) console.log(`已查询 ${index + 1}/${candidates.length}`);
      await sleep(90);
    } catch (error) {
      skipped.push({
        word: word.word,
        slug: word.slug,
        reason: error instanceof Error ? error.message : "有道查询失败",
        sourceUrl
      });
    }
  }

  const backupPath = APPLY && plans.length ? await writeBackup(plans) : null;
  await writeReport({ plans, skipped, backupPath, status: APPLY ? "planned" : "dry-run" });

  console.log(`待更新：${plans.length}`);
  for (const plan of plans.slice(0, 40)) {
    console.log(`- ${plan.word.word}: ${plan.word.meaningCn} -> ${plan.next.meaningCn}`);
  }
  if (plans.length > 40) console.log(`... 另有 ${plans.length - 40} 个`);
  console.log(`跳过：${skipped.length}`);

  if (!APPLY) return;

  let updated = 0;
  for (const plan of plans) {
    await prisma.$transaction(async (tx) => {
      await tx.word.update({
        where: { id: plan.word.id },
        data: plan.next
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action,
          entityType: "Word",
          entityId: plan.word.id,
          metadataJson: {
            word: plan.word.word,
            sourceUrl: plan.sourceUrl,
            before: {
              partOfSpeech: plan.word.partOfSpeech,
              meaningCn: plan.word.meaningCn,
              shortMeaningCn: plan.word.shortMeaningCn
            },
            after: plan.next
          } satisfies Prisma.InputJsonValue
        }
      });
    });
    updated += 1;
  }

  await writeReport({ plans, skipped, backupPath, status: "complete", updated });
  console.log(`\n已完成：更新 ${updated} 个单词释义。`);
  if (backupPath) console.log(`备份：${backupPath}`);
  console.log(`报告：${reportPath}`);
}

async function lookupYoudao(word: string) {
  const sourceUrl = youdaoUrl(word);
  const response = await fetch(sourceUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
    }
  });
  if (!response.ok) throw new Error(`有道返回 ${response.status}`);

  const html = await response.text();
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const entries = Array.from(document.querySelectorAll("ul.basic li.word-exp"))
    .map((item) => {
      const partOfSpeech = cleanText(item.querySelector(".pos")?.textContent ?? "");
      const translation = cleanText(item.querySelector(".trans")?.textContent ?? "");
      return { partOfSpeech: normalizePart(partOfSpeech), translation };
    })
    .filter((entry) => entry.partOfSpeech && entry.translation)
    .filter((entry) => !isPersonNameDefinition(entry.translation))
    .map((entry) => ({
      partOfSpeech: entry.partOfSpeech,
      translation: cleanupTranslation(entry.translation)
    }))
    .filter((entry) => entry.translation);

  return { sourceUrl, entries };
}

function buildWordFields(entries: YoudaoEntry[]) {
  const partOfSpeech = Array.from(new Set(entries.map((entry) => entry.partOfSpeech))).join("/");
  const meaningCn = entries
    .map((entry) => `${entry.partOfSpeech} ${entry.translation}`)
    .join("；")
    .replace(/\s+/gu, " ")
    .trim();
  return {
    partOfSpeech,
    meaningCn,
    shortMeaningCn: shortMeaning(meaningCn)
  };
}

function cleanupTranslation(value: string) {
  return cleanText(value)
    .replace(/[;,]/gu, "；")
    .replace(/\s*；\s*/gu, "；")
    .replace(/\s*，\s*/gu, "，")
    .replace(/\s*\/\s*/gu, "/")
    .replace(/\s+/gu, " ")
    .trim();
}

function shortMeaning(value: string) {
  const withoutPerson = value
    .split("；")
    .filter((part) => !isPersonNameDefinition(part))
    .join("；");
  const withoutPos = withoutPerson.replace(/^(?:n|v|adj|adv|prep|conj|pron|num|art|int|abbr)\.\s*/iu, "");
  const pieces = withoutPos
    .split(/[；;，,。]/u)
    .map((item) => item.replace(/^(?:n|v|adj|adv|prep|conj|pron|num|art|int|abbr)\.\s*/iu, "").trim())
    .filter(Boolean)
    .filter((item) => !isPersonNameDefinition(item))
    .slice(0, 2);
  return pieces.join("；") || withoutPos.slice(0, 22) || "未填写";
}

function isPersonNameDefinition(value: string) {
  return /人名/u.test(value);
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
    .replace(/<[^>]+>/gu, "")
    .replace(/\u00a0/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function sameValue(left: string | null, right: string | null) {
  return (left ?? "").trim() === (right ?? "").trim();
}

function youdaoUrl(word: string) {
  return `https://dict.youdao.com/result?word=${encodeURIComponent(word)}&lang=en`;
}

function normalizeSlug(value: string) {
  return value.trim().toLowerCase().replace(/\s+/gu, "-");
}

async function writeBackup(plans: Plan[]) {
  const backupPath = path.join(
    backupDir,
    `youdao-word-meaning-repair-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`
  );
  await fs.writeFile(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        action,
        count: plans.length,
        words: plans.map((plan) => ({
          id: plan.word.id,
          word: plan.word.word,
          slug: plan.word.slug,
          before: {
            partOfSpeech: plan.word.partOfSpeech,
            meaningCn: plan.word.meaningCn,
            shortMeaningCn: plan.word.shortMeaningCn,
            meaningEn: plan.word.meaningEn
          },
          after: plan.next,
          sourceUrl: plan.sourceUrl,
          youdaoEntries: plan.entries
        }))
      },
      null,
      2
    )
  );
  return backupPath;
}

async function writeReport({
  plans,
  skipped,
  backupPath,
  status,
  updated = 0
}: {
  plans: Plan[];
  skipped: SkippedItem[];
  backupPath: string | null;
  status: "dry-run" | "planned" | "complete";
  updated?: number;
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
        candidateWords: plans.length + skipped.length,
        plannedUpdates: plans.length,
        updatedWords: updated,
        skippedWords: skipped.length,
        backupPath,
        source: "网易有道词典网页简明释义",
        rules: [
          "只处理现有中文释义或短释义中带领域/噪声标签的词，如 [机]、[电]、[医]、[网络]、[人名]。",
          "从有道词典页面读取简明释义，并按词性合并为 meaningCn。",
          "过滤有道返回的人名义项，例如“（Barking）（德、美）巴尔金（人名）”。",
          "同步更新 partOfSpeech、meaningCn、shortMeaningCn。"
        ],
        items: plans.map((plan) => ({
          id: plan.word.id,
          word: plan.word.word,
          slug: plan.word.slug,
          sourceUrl: plan.sourceUrl,
          before: {
            partOfSpeech: plan.word.partOfSpeech,
            meaningCn: plan.word.meaningCn,
            shortMeaningCn: plan.word.shortMeaningCn
          },
          after: plan.next,
          youdaoEntries: plan.entries
        })),
        skipped
      },
      null,
      2
    )
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringArg(name: string) {
  return process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function numberArg(name: string) {
  const value = stringArg(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
