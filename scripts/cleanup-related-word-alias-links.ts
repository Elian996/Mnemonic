import { MnemonicStatus, UserRole } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { markdownToPlainText, renderMnemonicMarkdown } from "../src/lib/wiki-links/renderer";
import { syncEntryWikiLinks } from "../src/lib/wiki-links/resolve";

const APPLY = process.argv.includes("--apply");
const adminEmail = process.env.MNEMONIC_CLEANUP_ACTOR_EMAIL ?? "maoshangjian2021@163.com";
const wordLinkPattern = /\[\[\s*word\s*:\s*([^|\]\s]+)(?:\|[^\]]+)?\]\]/giu;
const relatedMarkerPattern = /\n*相关单词[:：]/u;
const aliasToWordPatterns = [
  /通过\s*([a-z][a-z-]{1,38})\s*的(?:字形|发音|音形|字母|拼写|形式|形状)[^。；;\n]{0,100}?联想到(?:已经记忆过的|记忆过的|熟悉(?:的)?)?单词\s*([a-z][a-z-]{1,38})/giu,
  /\b([a-z][a-z-]{1,38})\b\s*的(?:字形|发音|音形|字母|拼写|形式|形状)[^。；;\n]{0,100}?联想到(?:已经记忆过的|记忆过的|熟悉(?:的)?)?单词\s*([a-z][a-z-]{1,38})/giu
];

type Entry = {
  id: string;
  title: string;
  splitText: string | null;
  contentMarkdown: string;
  targetWord: { word: string };
};

type Replacement = {
  alias: string;
  actual: string;
  match: string;
};

async function main() {
  const actor =
    (await prisma.user.findFirst({
      where: { email: adminEmail, status: "ACTIVE" },
      select: { id: true, email: true, username: true }
    })) ??
    (await prisma.user.findFirst({
      where: { OR: [{ role: UserRole.ADMIN }, { role: UserRole.EDITOR }], status: "ACTIVE" },
      orderBy: [{ createdAt: "asc" }],
      select: { id: true, email: true, username: true }
    }));
  if (!actor) throw new Error("找不到可用于批量更新的管理员/编辑账号。");

  const words = await prisma.word.findMany({ select: { word: true } });
  const wordsByText = new Set(words.map((word) => word.word.toLowerCase()));
  const entries = await prisma.mnemonicEntry.findMany({
    where: { status: { not: MnemonicStatus.ARCHIVED } },
    select: {
      id: true,
      title: true,
      splitText: true,
      contentMarkdown: true,
      targetWord: { select: { word: true } }
    },
    orderBy: [{ createdAt: "asc" }]
  });

  const plans = entries
    .map((entry) => buildPlan(entry, wordsByText))
    .filter((plan): plan is NonNullable<typeof plan> => Boolean(plan));

  console.log(`模式：${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor.username} <${actor.email}>`);
  console.log(`将修复相关单词链接：${plans.length} 张`);
  console.log(`删除误链：${plans.reduce((sum, plan) => sum + plan.remove.length, 0)} 个`);
  console.log(`补入正确链接：${plans.reduce((sum, plan) => sum + plan.added.length, 0)} 个`);
  console.log("\n样例：");
  for (const plan of plans.slice(0, 40)) {
    console.log(`- ${plan.entry.targetWord.word}: 删除 ${plan.remove.join(", ")}${plan.added.length ? `；补入 ${plan.added.join(", ")}` : ""}`);
  }

  if (!APPLY) return;

  let updated = 0;
  for (const plan of plans) {
    const contentMarkdown = withRelatedWordLinks(plan.entry.contentMarkdown, plan.nextRelatedWords);
    const contentHtml = await renderMnemonicMarkdown(contentMarkdown);
    const plainText = markdownToPlainText([plan.entry.splitText ? `划分：${plan.entry.splitText}` : "", contentMarkdown].filter(Boolean).join("\n\n"));

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
        data: { contentMarkdown, contentHtml, plainText }
      });
      await syncEntryWikiLinks(plan.entry.id, actor.id, tx);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "MNEMONIC_RELATED_ALIAS_CLEANUP",
          entityType: "MnemonicEntry",
          entityId: plan.entry.id,
          metadataJson: {
            word: plan.entry.targetWord.word,
            remove: plan.remove,
            added: plan.added,
            matches: plan.matches
          }
        }
      });
    });
    updated += 1;
  }

  console.log(`\n已完成：修复 ${updated} 张记忆卡的相关单词链接。`);
}

function buildPlan(entry: Entry, wordsByText: Set<string>) {
  const currentRelatedWords = extractRelatedWords(entry.contentMarkdown).filter((word) => word !== entry.targetWord.word.toLowerCase());
  if (!currentRelatedWords.length) return null;

  const body = stripRelatedWordBlock(entry.contentMarkdown);
  const replacements = findAliasReplacements(body, wordsByText, entry.targetWord.word.toLowerCase())
    .filter((replacement) => currentRelatedWords.includes(replacement.alias));
  if (!replacements.length) return null;

  const remove = unique(replacements.map((replacement) => replacement.alias));
  const add = unique(
    replacements
      .map((replacement) => replacement.actual)
      .filter((word) => word !== entry.targetWord.word.toLowerCase())
  );
  const nextRelatedWords = unique(currentRelatedWords.filter((word) => !remove.includes(word)).concat(add));
  const added = add.filter((word) => !currentRelatedWords.includes(word));
  if (sameList(currentRelatedWords, nextRelatedWords)) return null;

  return { entry, currentRelatedWords, nextRelatedWords, remove, added, matches: replacements };
}

function findAliasReplacements(body: string, wordsByText: Set<string>, targetWord: string) {
  const replacements: Replacement[] = [];
  const seen = new Set<string>();
  for (const pattern of aliasToWordPatterns) {
    for (const match of body.matchAll(pattern)) {
      const alias = String(match[1] ?? "").trim().toLowerCase();
      const actual = String(match[2] ?? "").trim().toLowerCase();
      if (!alias || !actual || alias === actual || actual === targetWord || !wordsByText.has(actual)) continue;
      const key = `${alias}->${actual}`;
      if (seen.has(key)) continue;
      seen.add(key);
      replacements.push({ alias, actual, match: String(match[0] ?? "").replace(/\s+/gu, " ").trim() });
    }
  }
  return replacements;
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

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function sameList(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
