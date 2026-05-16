import { MnemonicSourceType, MnemonicStatus, UserRole, WordStatus } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { markdownToPlainText, renderMnemonicMarkdown } from "../src/lib/wiki-links/renderer";
import { syncEntryWikiLinks } from "../src/lib/wiki-links/resolve";

type WordRecord = {
  id: string;
  word: string;
  slug: string;
  partOfSpeech: string;
  meaningCn: string;
  shortMeaningCn: string;
  exampleSentence: string | null;
  exampleTranslation: string | null;
};

type EntryRecord = {
  id: string;
  title: string;
  splitText: string | null;
  contentMarkdown: string;
  targetWord: WordRecord;
};

type SuffixRule = {
  suffix: string;
  name: string;
  description: string;
  candidates: (word: string) => string[];
};

const APPLY = process.argv.includes("--apply");
const SAMPLE_SIZE = 30;
const adminEmail = process.env.MNEMONIC_BACKFILL_ACTOR_EMAIL ?? "maoshangjian2021@163.com";
const cuePattern =
  /已经记忆|记忆过|熟悉单词|联想到|容易想到|容易联想|词根词缀|词根词|后缀|前缀|派生|名词形式|形容词形式|副词形式|动词形式/u;
const wordLinkPattern = /\[\[\s*word\s*:\s*([^|\]\s]+)(?:\|[^\]]+)?\]\]/giu;
const relatedMarkerPattern = /\n*相关单词[:：]/u;
const structuralTokens = new Set([
  "a",
  "an",
  "the",
  "be",
  "been",
  "being",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "for",
  "from",
  "with",
  "as",
  "and",
  "or",
  "but",
  "can",
  "could",
  "may",
  "might",
  "must",
  "shall",
  "should",
  "will",
  "would",
  "word",
  "root",
  "prefix",
  "suffix",
  "adj",
  "adv",
  "noun",
  "verb"
]);

const suffixRules: SuffixRule[] = [
  {
    suffix: "ness",
    name: "-ness 名词后缀",
    description: "表示状态、性质",
    candidates: (word) => {
      const stem = word.slice(0, -4);
      return unique([stem, stem.replace(/i$/u, "y")]);
    }
  },
  {
    suffix: "less",
    name: "-less 形容词后缀",
    description: "表示没有、缺少",
    candidates: (word) => [word.slice(0, -4)]
  },
  {
    suffix: "ful",
    name: "-ful 形容词后缀",
    description: "表示充满、有……性质",
    candidates: (word) => [word.slice(0, -3)]
  },
  {
    suffix: "able",
    name: "-able 形容词后缀",
    description: "表示能够……的、值得……的",
    candidates: (word) => {
      const stem = word.slice(0, -4);
      return unique([stem, `${stem}e`]);
    }
  },
  {
    suffix: "ible",
    name: "-ible 形容词后缀",
    description: "表示能够……的、可……的",
    candidates: (word) => [word.slice(0, -4)]
  },
  {
    suffix: "ment",
    name: "-ment 名词后缀",
    description: "表示行为、结果或状态",
    candidates: (word) => [word.slice(0, -4)]
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
      partOfSpeech: true,
      meaningCn: true,
      shortMeaningCn: true,
      exampleSentence: true,
      exampleTranslation: true
    }
  });
  const wordsByText = new Map(words.map((word) => [word.word.toLowerCase(), word]));
  const entries = await prisma.mnemonicEntry.findMany({
    where: {
      sourceType: MnemonicSourceType.OFFICIAL,
      status: { not: MnemonicStatus.ARCHIVED }
    },
    select: {
      id: true,
      title: true,
      splitText: true,
      contentMarkdown: true,
      targetWord: {
        select: {
          id: true,
          word: true,
          slug: true,
          partOfSpeech: true,
          meaningCn: true,
          shortMeaningCn: true,
          exampleSentence: true,
          exampleTranslation: true
        }
      }
    },
    orderBy: [{ createdAt: "asc" }]
  });
  const officialWordIds = new Set(entries.map((entry) => entry.targetWord.id));
  const officialWordsByText = new Map(
    words
      .filter((word) => officialWordIds.has(word.id))
      .map((word) => [word.word.toLowerCase(), word])
  );
  const existingEntryWordIds = new Set(entries.map((entry) => entry.targetWord.id));

  const linkPlans = buildLinkPlans(entries, officialWordsByText);
  const derivedPlans = buildDerivedPlans(words, wordsByText, officialWordIds, existingEntryWordIds);

  printPlanSummary(actor, linkPlans, derivedPlans);
  if (!APPLY) return;

  let updated = 0;
  let created = 0;
  for (const plan of linkPlans) {
    await updateEntryRelatedWords(plan.entry, plan.nextRelatedWords, actor.id);
    updated += 1;
  }
  for (const plan of derivedPlans) {
    await createDerivedEntry(plan.word, plan.baseWord, plan.rule, actor.id);
    created += 1;
  }

  console.log(`\n已完成：更新现有记忆卡 ${updated} 张，新建派生记忆卡 ${created} 张。`);
}

function buildLinkPlans(entries: EntryRecord[], officialWordsByText: Map<string, WordRecord>) {
  const plans: Array<{
    entry: EntryRecord;
    existingRelatedWords: string[];
    inferredRelatedWords: string[];
    nextRelatedWords: string[];
  }> = [];

  for (const entry of entries) {
    const target = entry.targetWord.word.toLowerCase();
    const existingRelatedWords = extractRelatedWords(entry.contentMarkdown).filter((word) => word !== target);
    const inferredRelatedWords = inferRelatedWords(entry, officialWordsByText).filter((word) => word !== target);
    const nextRelatedWords = unique([...existingRelatedWords, ...inferredRelatedWords]);
    const normalizedCurrent = unique(existingRelatedWords);

    if (!sameList(normalizedCurrent, nextRelatedWords) || extractRelatedWords(entry.contentMarkdown).includes(target)) {
      plans.push({ entry, existingRelatedWords: normalizedCurrent, inferredRelatedWords, nextRelatedWords });
    }
  }

  return plans;
}

function inferRelatedWords(entry: EntryRecord, officialWordsByText: Map<string, WordRecord>) {
  const body = stripExamplesAndRelated(entry.contentMarkdown);
  const segments = body.split(/[\n。；;！!？?]+/u);
  const related: string[] = [];

  for (const segment of segments) {
    if (!cuePattern.test(segment)) continue;
    for (const token of explicitRelatedWordTokens(segment)) {
      const normalized = token.toLowerCase();
      const word = officialWordsByText.get(normalized);
      if (!word) continue;
      if (normalized === entry.targetWord.word.toLowerCase()) continue;
      related.push(word.word.toLowerCase());
    }
  }

  return unique(related);
}

function explicitRelatedWordTokens(segment: string) {
  const tokens: string[] = [];
  const patterns = [
    /([a-z][a-z-]{1,38})\s*为\s*(?:已经)?记忆过(?:的)?(?:单词)?/giu,
    /([a-z][a-z-]{1,38})\s*为\s*熟悉(?:的)?单词/giu,
    /(?:已经记忆过的|记忆过的|熟悉(?:的)?)单词\s*([a-z][a-z-]{1,38})/giu,
    /联想到(?:已经记忆过的|记忆过的|熟悉(?:的)?)?单词\s*([a-z][a-z-]{1,38})/giu,
    /单词\s*([a-z][a-z-]{1,38})\s*(?:n|v|vt|vi|adj|adv|pron)\./giu,
    /([a-z][a-z-]{1,38})\s*(?:n|v|vt|vi|adj|adv|pron)\.[^，。；;]*?(?:已经记忆|记忆过|联想到|熟悉单词)/giu
  ];

  for (const pattern of patterns) {
    for (const match of segment.matchAll(pattern)) {
      const token = String(match[1] ?? "").trim().toLowerCase();
      if (isLinkableToken(token)) tokens.push(token);
    }
  }

  return unique(tokens);
}

function isLinkableToken(token: string) {
  if (!token) return false;
  if (!/^[a-z][a-z-]{1,38}$/u.test(token)) return false;
  return !structuralTokens.has(token);
}

function buildDerivedPlans(
  words: WordRecord[],
  wordsByText: Map<string, WordRecord>,
  officialWordIds: Set<string>,
  existingEntryWordIds: Set<string>
) {
  const plans: Array<{ word: WordRecord; baseWord: WordRecord; rule: SuffixRule }> = [];

  for (const word of words) {
    const normalizedWord = word.word.toLowerCase();
    if (existingEntryWordIds.has(word.id)) continue;
    if (!/^[a-z]{4,38}$/u.test(normalizedWord)) continue;

    for (const rule of suffixRules) {
      if (!normalizedWord.endsWith(rule.suffix) || normalizedWord.length <= rule.suffix.length + 1) continue;
      const baseWord = rule.candidates(normalizedWord)
        .map((candidate) => wordsByText.get(candidate))
        .find((candidate): candidate is WordRecord => Boolean(candidate && officialWordIds.has(candidate.id)));
      if (!baseWord) continue;
      plans.push({ word, baseWord, rule });
      break;
    }
  }

  return plans;
}

async function updateEntryRelatedWords(entry: EntryRecord, relatedWords: string[], actorId: string) {
  const contentMarkdown = withRelatedWordLinks(entry.contentMarkdown, relatedWords);
  const contentHtml = await renderMnemonicMarkdown(contentMarkdown);
  const plainText = markdownToPlainText(contentMarkdown);

  await prisma.$transaction(async (tx) => {
    await tx.mnemonicEntryVersion.create({
      data: {
        mnemonicEntryId: entry.id,
        contentMarkdown: entry.contentMarkdown,
        splitText: entry.splitText,
        title: entry.title,
        editorId: actorId
      }
    });
    await tx.mnemonicEntry.update({
      where: { id: entry.id },
      data: { contentMarkdown, contentHtml, plainText }
    });
    await syncEntryWikiLinks(entry.id, actorId, tx);
    await tx.auditLog.create({
      data: {
        actorId,
        action: "MNEMONIC_RELATED_BACKFILL",
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: { relatedWords }
      }
    });
  });
}

async function createDerivedEntry(word: WordRecord, baseWord: WordRecord, rule: SuffixRule, actorId: string) {
  const contentMarkdown = buildDerivedMarkdown(word, baseWord, rule);
  const contentHtml = await renderMnemonicMarkdown(contentMarkdown);
  const plainText = markdownToPlainText(contentMarkdown);

  await prisma.$transaction(async (tx) => {
    const latest = await tx.mnemonicEntry.findFirst({
      where: { targetWordId: word.id, sourceType: MnemonicSourceType.OFFICIAL, status: { not: MnemonicStatus.ARCHIVED } },
      orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
      select: { sortOrder: true }
    });
    const entry = await tx.mnemonicEntry.create({
      data: {
        targetWordId: word.id,
        authorId: actorId,
        sourceType: MnemonicSourceType.OFFICIAL,
        status: MnemonicStatus.APPROVED,
        title: `${word.word} 记忆卡片`,
        splitText: `${baseWord.word} | ${rule.suffix}`,
        contentMarkdown,
        contentHtml,
        plainText,
        isPublic: true,
        sortOrder: (latest?.sortOrder ?? -1) + 1
      }
    });
    await tx.word.update({
      where: { id: word.id },
      data: { status: WordStatus.PUBLISHED }
    });
    await syncEntryWikiLinks(entry.id, actorId, tx);
    await tx.auditLog.create({
      data: {
        actorId,
        action: "MNEMONIC_DERIVED_BACKFILL",
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: { word: word.word, baseWord: baseWord.word, suffix: rule.suffix }
      }
    });
  });
}

function buildDerivedMarkdown(word: WordRecord, baseWord: WordRecord, rule: SuffixRule) {
  const targetMeaning = compactMeaning(word.meaningCn || word.shortMeaningCn);
  const baseMeaning = compactMeaning(baseWord.meaningCn || baseWord.shortMeaningCn);
  const example = [word.exampleSentence, word.exampleTranslation].filter(Boolean).join("\n");
  const exampleBlock = example ? `\n\n例句：\n${example}` : "";

  return [
    "带你背：",
    `${baseWord.word} 为已经记忆过的单词，表示 ${baseMeaning}；${rule.name}，${rule.description}。由此记住 ${word.word} 表示 ${targetMeaning}。`,
    "",
    "词根词缀积累：",
    `${rule.name}：${rule.description}。`,
    exampleBlock,
    "",
    "相关单词：",
    `[[word:${baseWord.word.toLowerCase()}]]`
  ]
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function withRelatedWordLinks(content: string, relatedWords: string[]) {
  const cleanContent = stripRelatedWordBlock(content).trimEnd();
  const uniqueRelated = unique(relatedWords.map((word) => word.toLowerCase())).filter(Boolean);
  if (!uniqueRelated.length) return cleanContent.trim();

  return [cleanContent, "相关单词：", ...uniqueRelated.map((word) => `[[word:${word}]]`)].join("\n").trim();
}

function stripRelatedWordBlock(markdown: string) {
  const marker = markdown.search(relatedMarkerPattern);
  if (marker === -1) return markdown;
  return markdown.slice(0, marker);
}

function stripExamplesAndRelated(markdown: string) {
  const withoutRelated = stripRelatedWordBlock(markdown);
  const exampleMarker = withoutRelated.search(/\n*例句[:：]/u);
  if (exampleMarker === -1) return withoutRelated;
  return withoutRelated.slice(0, exampleMarker);
}

function extractRelatedWords(markdown: string) {
  const marker = markdown.search(relatedMarkerPattern);
  const scope = marker === -1 ? "" : markdown.slice(marker);
  return unique(
    Array.from(scope.matchAll(wordLinkPattern))
      .map((match) => String(match[1] ?? "").trim().toLowerCase())
      .filter(Boolean)
  );
}

function compactMeaning(value: string) {
  return value
    .replace(/\s+/gu, "")
    .replace(/；/gu, "，")
    .replace(/;+/gu, "，")
    .replace(/,+/gu, "，")
    .replace(/，$/u, "")
    .slice(0, 80);
}

function printPlanSummary(
  actor: { email: string; username: string },
  linkPlans: ReturnType<typeof buildLinkPlans>,
  derivedPlans: ReturnType<typeof buildDerivedPlans>
) {
  console.log(`模式：${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor.username} <${actor.email}>`);
  console.log(`将更新现有记忆卡：${linkPlans.length} 张`);
  console.log(`将新建派生记忆卡：${derivedPlans.length} 张`);

  console.log("\n现有记忆卡补链接样例：");
  for (const plan of linkPlans.slice(0, SAMPLE_SIZE)) {
    const added = plan.nextRelatedWords.filter((word) => !plan.existingRelatedWords.includes(word));
    const removedSelf = extractRelatedWords(plan.entry.contentMarkdown).includes(plan.entry.targetWord.word.toLowerCase());
    console.log(`- ${plan.entry.targetWord.word}: +[${added.join(", ")}]${removedSelf ? "，移除自链接" : ""}`);
  }

  console.log("\n派生词新建样例：");
  for (const plan of derivedPlans.slice(0, SAMPLE_SIZE)) {
    console.log(`- ${plan.word.word} <= ${plan.baseWord.word} + ${plan.rule.suffix} (${plan.word.shortMeaningCn})`);
  }
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function sameList(first: string[], second: string[]) {
  return first.length === second.length && first.every((item, index) => item === second[index]);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
