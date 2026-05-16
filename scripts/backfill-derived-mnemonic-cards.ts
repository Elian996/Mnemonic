import fs from "node:fs/promises";
import path from "node:path";
import {
  MemoryNodeType,
  MnemonicSourceType,
  MnemonicStatus,
  RelationType,
  UserRole,
  WordStatus,
  type Word
} from "@prisma/client";
import { prisma } from "../src/lib/db";
import { markdownToPlainText, renderMnemonicMarkdown } from "../src/lib/wiki-links/renderer";
import { syncEntryWikiLinks } from "../src/lib/wiki-links/resolve";

type WordRecord = Pick<Word, "id" | "word" | "slug" | "shortMeaningCn" | "meaningCn" | "exampleSentence" | "exampleTranslation"> & {
  mnemonicEntries: { id: string }[];
};

type DerivedPlan = {
  word: WordRecord;
  baseWord: WordRecord;
  rule: string;
  source: "memory-link" | "suffix-rule";
};

type SuffixRule = {
  rule: string;
  suffix: string;
  candidates: (word: string) => string[];
};

const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const adminEmail = process.env.MNEMONIC_BACKFILL_ACTOR_EMAIL ?? "maoshangjian2021@163.com";
const allowedMemoryLinkRules = new Set([
  "-iness -> -y",
  "-ness",
  "-less",
  "-ful",
  "-ship",
  "-hood",
  "-like",
  "-ward",
  "-wise"
]);

const suffixRules: SuffixRule[] = [
  {
    rule: "-ability <- -able",
    suffix: "ability",
    candidates: (word) => {
      const stem = word.slice(0, -7);
      return [`${stem}able`];
    }
  },
  {
    rule: "-ibility <- -ible",
    suffix: "ibility",
    candidates: (word) => {
      const stem = word.slice(0, -7);
      return [`${stem}ible`];
    }
  },
  {
    rule: "-iness -> -y",
    suffix: "iness",
    candidates: (word) => [`${word.slice(0, -5)}y`]
  },
  {
    rule: "-ness",
    suffix: "ness",
    candidates: (word) => {
      const stem = word.slice(0, -4);
      return unique([stem, stem.replace(/i$/u, "y")]);
    }
  },
  {
    rule: "-able",
    suffix: "able",
    candidates: (word) => {
      const stem = word.slice(0, -4);
      return unique([stem, `${stem}e`, stem.replace(/i$/u, "y")]);
    }
  },
  {
    rule: "-ible",
    suffix: "ible",
    candidates: (word) => {
      const stem = word.slice(0, -4);
      return unique([stem, `${stem}e`]);
    }
  },
  {
    rule: "-ation <- -ator",
    suffix: "ation",
    candidates: (word) => [`${word.slice(0, -5)}ator`]
  },
  {
    rule: "-ant <- -ator",
    suffix: "ant",
    candidates: (word) => [`${word.slice(0, -3)}ator`]
  }
];

async function main() {
  const actor =
    (await prisma.user.findFirst({
      where: { email: adminEmail, status: "ACTIVE" },
      select: { id: true, email: true, username: true }
    })) ??
    (await prisma.user.findFirst({
      where: {
        OR: [{ role: UserRole.ADMIN }, { role: UserRole.EDITOR }],
        status: "ACTIVE"
      },
      orderBy: [{ createdAt: "asc" }],
      select: { id: true, email: true, username: true }
    }));
  if (!actor) throw new Error("找不到可用于批量更新的管理员/编辑账号。");

  const words = await prisma.word.findMany({
    select: {
      id: true,
      word: true,
      slug: true,
      shortMeaningCn: true,
      meaningCn: true,
      exampleSentence: true,
      exampleTranslation: true,
      mnemonicEntries: {
        where: { sourceType: MnemonicSourceType.OFFICIAL, status: { not: MnemonicStatus.ARCHIVED } },
        select: { id: true }
      }
    }
  });
  const wordsBySlug = new Map(words.map((word) => [word.slug, word]));
  const wordsByText = new Map(words.map((word) => [word.word.toLowerCase(), word]));
  const plans = uniquePlans([
    ...(await buildMemoryLinkPlans(wordsBySlug)),
    ...buildSuffixPlans(words, wordsByText)
  ]).slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);

  const resultPath = await writePlanSnapshot(plans, APPLY);
  printSummary(actor, plans, resultPath);
  if (!APPLY) return;

  let created = 0;
  for (const plan of plans) {
    const stillMissing = await prisma.mnemonicEntry.count({
      where: {
        targetWordId: plan.word.id,
        sourceType: MnemonicSourceType.OFFICIAL,
        status: { not: MnemonicStatus.ARCHIVED }
      }
    });
    if (stillMissing) continue;

    await createDerivedEntry(plan, actor.id);
    created += 1;
  }

  console.log(`\n已创建派生记忆卡 ${created} 张。`);
}

async function buildMemoryLinkPlans(wordsBySlug: Map<string, WordRecord>): Promise<DerivedPlan[]> {
  const links = await prisma.memoryLink.findMany({
    where: {
      relationType: RelationType.SAME_ROOT,
      sourceMnemonicEntryId: null,
      sourceNode: { type: MemoryNodeType.WORD },
      targetNode: { type: MemoryNodeType.WORD },
      description: { contains: "可通过母词" }
    },
    include: { sourceNode: true, targetNode: true }
  });

  const plans: DerivedPlan[] = [];
  for (const link of links) {
    const word = wordsBySlug.get(link.sourceNode.slug);
    const baseWord = wordsBySlug.get(link.targetNode.slug);
    if (!word || !baseWord) continue;
    if (word.mnemonicEntries.length || !baseWord.mnemonicEntries.length) continue;

    const rule = parseRule(link.description ?? "") ?? "派生词";
    if (!allowedMemoryLinkRules.has(rule)) continue;
    plans.push({
      word,
      baseWord,
      rule,
      source: "memory-link"
    });
  }

  return plans;
}

function buildSuffixPlans(words: WordRecord[], wordsByText: Map<string, WordRecord>) {
  const plans: DerivedPlan[] = [];

  for (const word of words) {
    const normalizedWord = word.word.toLowerCase();
    if (word.mnemonicEntries.length || !/^[a-z]{4,38}$/u.test(normalizedWord)) continue;

    for (const rule of suffixRules.sort((a, b) => b.suffix.length - a.suffix.length)) {
      if (!normalizedWord.endsWith(rule.suffix) || normalizedWord.length <= rule.suffix.length + 2) continue;
      const baseWord = rule
        .candidates(normalizedWord)
        .map((candidate) => wordsByText.get(candidate))
        .find((candidate): candidate is WordRecord => Boolean(candidate && candidate.mnemonicEntries.length && candidate.word.length >= 4));
      if (!baseWord) continue;

      plans.push({ word, baseWord, rule: rule.rule, source: "suffix-rule" });
      break;
    }
  }

  return plans;
}

async function createDerivedEntry(plan: DerivedPlan, actorId: string) {
  const contentMarkdown = buildDerivedMarkdown(plan);
  const contentHtml = await renderMnemonicMarkdown(contentMarkdown);
  const plainText = markdownToPlainText(contentMarkdown);

  await prisma.$transaction(async (tx) => {
    const latest = await tx.mnemonicEntry.findFirst({
      where: {
        targetWordId: plan.word.id,
        sourceType: MnemonicSourceType.OFFICIAL,
        status: { not: MnemonicStatus.ARCHIVED }
      },
      orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
      select: { sortOrder: true }
    });
    const entry = await tx.mnemonicEntry.create({
      data: {
        targetWordId: plan.word.id,
        authorId: actorId,
        sourceType: MnemonicSourceType.OFFICIAL,
        status: MnemonicStatus.APPROVED,
        title: `${plan.word.word} 记忆卡片`,
        splitText: `${plan.baseWord.word} | ${plan.rule}`,
        contentMarkdown,
        contentHtml,
        plainText,
        isPublic: true,
        sortOrder: (latest?.sortOrder ?? -1) + 1
      }
    });
    await tx.word.update({
      where: { id: plan.word.id },
      data: { status: WordStatus.PUBLISHED }
    });
    await syncEntryWikiLinks(entry.id, actorId, tx);
    await tx.auditLog.create({
      data: {
        actorId,
        action: "MNEMONIC_DERIVED_CARD_BACKFILL",
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: {
          word: plan.word.word,
          baseWord: plan.baseWord.word,
          rule: plan.rule,
          source: plan.source
        }
      }
    });
  });
}

function buildDerivedMarkdown(plan: DerivedPlan) {
  const baseMeaning = compactMeaning(plan.baseWord.meaningCn || plan.baseWord.shortMeaningCn);
  const targetMeaning = compactMeaning(plan.word.meaningCn || plan.word.shortMeaningCn);
  const ruleDescription = describeRule(plan.rule, plan.baseWord.word, plan.word.word);
  const exampleBlock = [plan.word.exampleSentence, plan.word.exampleTranslation].filter(Boolean).join("\n");

  return [
    "带你背：",
    `${plan.baseWord.word} 为已经记忆过的单词，表示 ${baseMeaning}；${ruleDescription}。由此记住 ${plan.word.word} 表示 ${targetMeaning}。`,
    "",
    "词根词缀积累：",
    `${plan.rule}：${ruleDescription}。`,
    exampleBlock ? `\n例句：\n${exampleBlock}` : "",
    "",
    "相关单词：",
    `[[word:${plan.baseWord.word.toLowerCase()}]]`
  ]
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function describeRule(rule: string, baseWord: string, word: string) {
  if (rule === "-iness -> -y") return "把结尾 y 变 i，再加 -ness，表示状态、性质";
  if (rule === "-ness") return "加 -ness 构成名词，表示状态、性质";
  if (rule === "-ally") return "保留核心拼写并加 -ally，常构成副词，表示“以……方式、在……方面”";
  if (rule === "-ily -> -y") return "把结尾 y 变 i，再加 -ly，构成副词";
  if (rule === "-ly") return "加 -ly 构成副词，表示“以……方式”";
  if (rule === "-ing -> -e") return "去掉结尾 e 后加 -ing，表示动作、状态或相关事物";
  if (rule === "-ing doubled consonant") return "双写结尾辅音后加 -ing，表示动作、状态或相关事物";
  if (rule === "-ed doubled consonant") return "双写结尾辅音后加 -ed，表示已完成或具有某状态";
  if (rule === "-ied -> -y") return "把结尾 y 变 i，再加 -ed，表示已完成或具有某状态";
  if (rule === "plural -ies") return "把结尾 y 变 i，再加 -es，构成复数形式";
  if (rule === "-ship") return "加 -ship 构成名词，表示身份、关系或状态";
  if (rule === "-hood") return "加 -hood 构成名词，表示身份、时期或状态";
  if (rule === "-less") return "加 -less 构成形容词，表示没有、缺少";
  if (rule === "-ful") return "加 -ful 构成形容词，表示充满、具有";
  if (rule === "-ward") return "加 -ward 表示方向";
  if (rule === "-like") return "加 -like 表示像……一样";
  if (rule === "-wise") return "加 -wise 表示方向、方式或方面";
  if (rule === "-ability <- -able") return "把 -able 变成 -ability，表示能力、性质或程度";
  if (rule === "-ibility <- -ible") return "把 -ible 变成 -ibility，表示能力、性质或程度";
  if (rule === "-able") return "加 -able 构成形容词，表示能够……的、值得……的";
  if (rule === "-ible") return "加 -ible 构成形容词，表示能够……的、可……的";
  if (rule === "-ation <- -ator") return `保留 ${baseWord} 中的核心拼写，把表示器物/执行者的 -ator 换成 -ation，构成动作、过程或状态名词`;
  if (rule === "-ant <- -ator") return `保留 ${baseWord} 中的核心拼写，把 -ator 换成 -ant，常表示起作用的人或物、具有某性质的东西`;
  return `${word} 保留了 ${baseWord} 的核心拼写，可以作为同词族派生词一起记忆`;
}

function parseRule(description: string) {
  return description.match(/（(.+?)）/u)?.[1]?.trim();
}

function uniquePlans(plans: DerivedPlan[]) {
  const seen = new Set<string>();
  const uniquePlans: DerivedPlan[] = [];
  for (const plan of plans) {
    const key = plan.word.id;
    if (seen.has(key)) continue;
    seen.add(key);
    uniquePlans.push(plan);
  }
  return uniquePlans;
}

async function writePlanSnapshot(plans: DerivedPlan[], apply: boolean) {
  await fs.mkdir(path.join(process.cwd(), "tmp"), { recursive: true });
  const outputPath = path.join(process.cwd(), "tmp", `derived-mnemonic-cards-${apply ? "apply" : "dry-run"}-${Date.now()}.json`);
  await fs.writeFile(
    outputPath,
    JSON.stringify(
      {
        apply,
        count: plans.length,
        byRule: countBy(plans, (plan) => plan.rule),
        bySource: countBy(plans, (plan) => plan.source),
        examples: plans.slice(0, 120).map((plan) => ({
          word: plan.word.word,
          baseWord: plan.baseWord.word,
          rule: plan.rule,
          source: plan.source,
          meaning: plan.word.shortMeaningCn
        })),
        plans: plans.map((plan) => ({
          wordId: plan.word.id,
          word: plan.word.word,
          baseWordId: plan.baseWord.id,
          baseWord: plan.baseWord.word,
          rule: plan.rule,
          source: plan.source,
          meaning: plan.word.shortMeaningCn
        }))
      },
      null,
      2
    )
  );
  return outputPath;
}

function printSummary(actor: { email: string; username: string }, plans: DerivedPlan[], resultPath: string) {
  console.log(`模式：${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor.username} <${actor.email}>`);
  console.log(`候选派生记忆卡：${plans.length} 张`);
  console.log(`计划文件：${resultPath}`);
  console.log(`来源：${JSON.stringify(countBy(plans, (plan) => plan.source))}`);
  console.log(`规则：${JSON.stringify(countBy(plans, (plan) => plan.rule))}`);
  console.log("\n样例：");
  for (const plan of plans.slice(0, 40)) {
    console.log(`- ${plan.word.word} <= ${plan.baseWord.word} (${plan.rule})：${plan.word.shortMeaningCn}`);
  }
}

function countBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const name = key(item);
    acc[name] = (acc[name] ?? 0) + 1;
    return acc;
  }, {});
}

function compactMeaning(value: string) {
  const compacted = value
    .replace(/\s+/gu, "")
    .replace(/；/gu, "，")
    .replace(/;+/gu, "，")
    .replace(/,+/gu, "，")
    .replace(/，$/u, "");
  return compacted ? compacted.slice(0, 90) : "相关含义";
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
