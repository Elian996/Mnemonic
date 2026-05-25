import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { type Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");
const LIMIT = numberArg("--limit");
const ONLY = stringArg("--word");
const ADMIN_EMAIL = process.env.MNEMONIC_CLEANUP_ACTOR_EMAIL ?? "maoshangjian2021@163.com";
const reportDir = path.join(process.cwd(), "tmp", "youdao-word-meaning-broad-repair");
const backupDir = path.join(process.cwd(), "tmp", "backups");
const cacheDir = path.join(process.cwd(), "tmp", "youdao-lookup-cache");
const reportPath = path.join(reportDir, "latest.json");
const action = "YOUDAO_WORD_MEANING_BROAD_REPAIR";

type WordRecord = {
  id: string;
  word: string;
  slug: string;
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
  reasons: string[];
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
  reasons: string[];
  reason: string;
  sourceUrl: string;
};

const standardMeaningPrefixPattern =
  /^(?:n|v|adj|adv|prep|conj|pron|num|art|int|interj|abbr|aux|det|modal)\.\s+/iu;
const legacyPartPrefixPattern =
  /^(?:n|v|adj|adv|prep|conj|pron|num|art|int|interj|abbr|aux|det|modal|a|s|r|vt|vi)\.\S/iu;
const noisyLabelPattern =
  /(^|[；;，,、\s])\[(?!\[)[^\]\n]{1,14}\]\s*|【[^】]+】|（[^）]{0,20}人名）|\([^)]{0,20}人名\)|\b人名\b|人名/u;
const domainLabelPattern = /(^|[；;，,、\s])\[(?!\[)[^\]\n]{1,14}\]\s*/gu;
const cjkPattern = /[\u3400-\u9fff]/u;

async function main() {
  await fs.mkdir(reportDir, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });

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
    where: ONLY ? { slug: normalizeSlug(ONLY) } : undefined,
    select: {
      id: true,
      word: true,
      slug: true,
      partOfSpeech: true,
      meaningCn: true,
      shortMeaningCn: true,
      meaningEn: true
    },
    orderBy: { word: "asc" }
  });
  const candidates = words
    .map((word) => ({ word, reasons: repairReasons(word) }))
    .filter((item) => item.reasons.length)
    .slice(0, LIMIT);

  const plans: Plan[] = [];
  const skipped: SkippedItem[] = [];

  console.log(`模式：${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor.username} <${actor.email}>`);
  console.log(`扫描单词：${words.length}`);
  console.log(`候选单词：${candidates.length}`);

  for (const [index, item] of candidates.entries()) {
    const sourceUrl = youdaoUrl(item.word.word);
    try {
      const lookup = await lookupYoudao(item.word.word, fallbackPartOfSpeech(item.word));
      if (!lookup.entries.length) {
        skipped.push({
          word: item.word.word,
          slug: item.word.slug,
          reasons: item.reasons,
          reason: "有道未返回可用简明释义或仅有人名义项",
          sourceUrl
        });
        continue;
      }

      const next = buildWordFields(lookup.entries);
      if (!next.meaningCn || !cjkPattern.test(next.meaningCn)) {
        skipped.push({
          word: item.word.word,
          slug: item.word.slug,
          reasons: item.reasons,
          reason: "有道释义清洗后为空或不含中文",
          sourceUrl
        });
        continue;
      }

      if (
        sameValue(item.word.partOfSpeech, next.partOfSpeech) &&
        sameValue(item.word.meaningCn, next.meaningCn) &&
        sameValue(item.word.shortMeaningCn, next.shortMeaningCn)
      ) {
        continue;
      }

      plans.push({
        word: item.word,
        reasons: item.reasons,
        sourceUrl,
        entries: lookup.entries,
        next
      });

      if ((index + 1) % 50 === 0 || index + 1 === candidates.length) {
        console.log(`已查询 ${index + 1}/${candidates.length}；待更新 ${plans.length}；跳过 ${skipped.length}`);
      }
      await sleep(80);
    } catch (error) {
      skipped.push({
        word: item.word.word,
        slug: item.word.slug,
        reasons: item.reasons,
        reason: error instanceof Error ? error.message : "有道查询失败",
        sourceUrl
      });
    }
  }

  const backupPath = APPLY && plans.length ? await writeBackup(plans) : null;
  await writeReport({ plans, skipped, backupPath, status: APPLY ? "planned" : "dry-run" });

  console.log(`待更新：${plans.length}`);
  for (const plan of plans.slice(0, 50)) {
    console.log(`- ${plan.word.word} [${plan.reasons.join(", ")}]: ${plan.word.meaningCn} -> ${plan.next.meaningCn}`);
  }
  if (plans.length > 50) console.log(`... 另有 ${plans.length - 50} 个`);
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
            reasons: plan.reasons,
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

function repairReasons(word: WordRecord) {
  const reasons: string[] = [];
  const meaning = word.meaningCn.trim();
  const shortMeaning = word.shortMeaningCn.trim();
  if (!word.partOfSpeech.trim()) reasons.push("缺少 partOfSpeech");
  if (!meaning) reasons.push("中文释义为空");
  if (!standardMeaningPrefixPattern.test(meaning)) reasons.push("中文释义缺少标准词性前缀");
  if (legacyPartPrefixPattern.test(meaning)) reasons.push("词性前缀后缺空格");
  if (noisyLabelPattern.test(meaning) || noisyLabelPattern.test(shortMeaning)) reasons.push("含领域/人名/噪声标签");
  if (looksTruncated(shortMeaning)) reasons.push("短释义疑似截断");
  if (looksTruncated(meaning)) reasons.push("完整释义疑似截断");
  return Array.from(new Set(reasons));
}

async function lookupYoudao(word: string, fallbackPart: string) {
  const sourceUrl = youdaoUrl(word);
  const cachePath = path.join(cacheDir, `${encodeURIComponent(word.toLowerCase())}.json`);
  const cached = await readCachedEntries(cachePath);
  if (cached) return { sourceUrl, entries: cached };

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
      const partOfSpeech = cleanText(item.querySelector(".pos")?.textContent ?? "") || fallbackPart;
      const translation = cleanText(item.querySelector(".trans")?.textContent ?? "");
      return { partOfSpeech: normalizePart(partOfSpeech), translation };
    })
    .filter((entry) => entry.partOfSpeech && entry.translation)
    .filter((entry) => !isPersonNameDefinition(entry.translation))
    .map((entry) => ({
      partOfSpeech: entry.partOfSpeech,
      translation: cleanupTranslation(entry.translation)
    }))
    .filter((entry) => entry.translation && cjkPattern.test(entry.translation));

  await fs.writeFile(cachePath, JSON.stringify(entries, null, 2));
  return { sourceUrl, entries };
}

async function readCachedEntries(cachePath: string) {
  try {
    const entries = JSON.parse(await fs.readFile(cachePath, "utf8")) as YoudaoEntry[];
    return Array.isArray(entries) && entries.length ? entries : null;
  } catch {
    return null;
  }
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
    shortMeaningCn: shortMeaning(entries)
  };
}

function cleanupTranslation(value: string) {
  let cleaned = cleanText(value)
    .replace(/[;,]/gu, "；")
    .replace(/\s*；\s*/gu, "；")
    .replace(/\s*，\s*/gu, "，")
    .replace(/\s*\/\s*/gu, "/")
    .replace(/\s+/gu, " ")
    .trim();

  for (let index = 0; index < 4; index += 1) {
    const next = cleaned.replace(domainLabelPattern, "$1");
    if (next === cleaned) break;
    cleaned = next;
  }

  return cleaned
    .replace(/【[^】]+】/gu, "")
    .replace(/^[；;，,、\s]+|[；;，,、\s]+$/gu, "")
    .trim();
}

function shortMeaning(entries: YoudaoEntry[]) {
  const pieces: string[] = [];
  for (const entry of entries) {
    for (const piece of entry.translation.split(/[；;]/u)) {
      const cleaned = cleanText(piece);
      if (!cleaned || isPersonNameDefinition(cleaned)) continue;
      pieces.push(cleaned);
      if (pieces.length >= 2) return pieces.join("；");
    }
  }
  return pieces.join("；") || "未填写";
}

function looksTruncated(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const opens = (trimmed.match(/[（(]/gu) ?? []).length;
  const closes = (trimmed.match(/[）)]/gu) ?? []).length;
  if (opens > closes) return true;
  if (/[；;,，、]$/u.test(trimmed)) return true;
  if (/^(?:n|v|adj|adv|prep|conj|pron|num|art|int|interj|abbr|aux|det|modal|a|s|r|vt|vi)\.?$/iu.test(trimmed)) return true;
  return false;
}

function isPersonNameDefinition(value: string) {
  return /人名/u.test(value) || /^\s*(?:n\.\s*)?人名[；;，,、\s]/u.test(value);
}

function normalizePart(value: string) {
  return value
    .replace(/\bvt\./giu, "v.")
    .replace(/\bvi\./giu, "v.")
    .replace(/\ba\./giu, "adj.")
    .replace(/\bs\./giu, "adj.")
    .replace(/\br\./giu, "adv.")
    .replace(/\binterj\./giu, "int.")
    .trim()
    .toLowerCase();
}

function fallbackPartOfSpeech(word: WordRecord) {
  const first = word.partOfSpeech
    .split(/[\/,，;；\s]+/u)
    .map(normalizePart)
    .find(Boolean);
  return first || "n.";
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
    `youdao-word-meaning-broad-repair-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`
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
          reasons: plan.reasons,
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
          "处理中文释义缺少 n./v./adj. 等标准词性前缀的单词。",
          "处理中文释义或短释义中带领域标签、人名义项、噪声标签的单词。",
          "处理短释义疑似被截断或释义为空的单词。",
          "从有道词典页面读取简明释义，过滤人名义项，并按词性合并为 meaningCn。"
        ],
        items: plans.map((plan) => ({
          id: plan.word.id,
          word: plan.word.word,
          slug: plan.word.slug,
          reasons: plan.reasons,
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
