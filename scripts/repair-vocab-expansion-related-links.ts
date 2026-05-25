import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { MnemonicSourceType, MnemonicStatus, UserRole } from "@prisma/client";

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

const APPLY = process.argv.includes("--apply");
const INCLUDE_USER_ENTRIES = process.argv.includes("--include-user-entries");
const reportDir = path.join(process.cwd(), "tmp", "vocab-expansion-related-link-repair");
const backupDir = path.join(process.cwd(), "backups");
const adminEmail = process.env.MNEMONIC_REPAIR_ACTOR_EMAIL ?? process.env.MNEMONIC_BACKFILL_ACTOR_EMAIL;

type EntryRecord = {
  id: string;
  title: string;
  splitText: string | null;
  contentMarkdown: string;
  sourceType: MnemonicSourceType;
  status: MnemonicStatus;
  targetWord: {
    id: string;
    word: string;
    slug: string;
  };
};

type RepairPlan = {
  entry: EntryRecord;
  applyEligible: boolean;
  expansionWords: string[];
  beforeRelatedWords: string[];
  afterRelatedWords: string[];
  removedRelatedWords: string[];
  keptBecauseAnchored: string[];
  expansionSnippet: string;
};

const wordLinkPattern = /\[\[\s*word\s*:\s*([^|\]\s]+)(?:\|[^\]]+)?\]\]/giu;
const relatedMarkerPattern = /\n*相关单词[:：]/u;
const vocabExpansionMarkerPattern = /\n*(?:#{1,6}\s*)?(?:词汇扩充|问汇扩充)[:：]/u;
const sectionStopPattern =
  /^(?:#{1,6}\s*)?(?:相关单词|例句|常见搭配|对比辨析|词根词缀积累|字形联想积累|词汇辨析积累|带你背|巧记|图片|释义|划分|记忆卡|注意|总结)[:：]/u;
const vocabExpansionLinePattern = /^(?:#{1,6}\s*)?(?:词汇扩充|问汇扩充)[:：]\s*(.*)$/u;
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
  "adj",
  "adv",
  "n",
  "v",
  "vt",
  "vi",
  "prep",
  "pron",
  "conj",
  "num",
  "pl",
  "sb",
  "sth",
  "etc",
  "eg",
  "example",
  "word"
]);

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { markdownToPlainText, renderMnemonicMarkdown } = await import("../src/lib/wiki-links/renderer");
  const { syncEntryWikiLinks } = await import("../src/lib/wiki-links/resolve");

  try {
    await fs.mkdir(reportDir, { recursive: true });

    const words = await prisma.word.findMany({ select: { word: true } });
    const wordSet = new Set(words.map((word) => normalizeWord(word.word)).filter(Boolean));
    const entries = await prisma.mnemonicEntry.findMany({
      where: { status: { not: MnemonicStatus.ARCHIVED } },
      select: {
        id: true,
        title: true,
        splitText: true,
        contentMarkdown: true,
        sourceType: true,
        status: true,
        targetWord: { select: { id: true, word: true, slug: true } }
      },
      orderBy: [{ targetWord: { word: "asc" } }, { sourceType: "asc" }, { sortOrder: "asc" }]
    });

    const plans = entries.map((entry) => buildRepairPlan(entry, wordSet)).filter((plan): plan is RepairPlan => plan !== null);
    const applyPlans = plans.filter((plan) => plan.applyEligible);
    const protectedPlans = plans.filter((plan) => !plan.applyEligible);
    const runId = timestamp();
    const reportPath = path.join(reportDir, `${runId}-${APPLY ? "apply" : "dry-run"}.json`);
    let backupPath: string | null = null;

    if (APPLY && applyPlans.length) {
      const actor =
        (adminEmail
          ? await prisma.user.findFirst({
              where: { email: adminEmail, status: "ACTIVE" },
              select: { id: true, email: true, username: true }
            })
          : null) ??
        (await prisma.user.findFirst({
          where: { OR: [{ role: UserRole.ADMIN }, { role: UserRole.EDITOR }], status: "ACTIVE" },
          orderBy: [{ createdAt: "asc" }],
          select: { id: true, email: true, username: true }
        }));
      if (!actor) throw new Error("找不到可用于批量修复的管理员/编辑账号。");

      await fs.mkdir(backupDir, { recursive: true });
      backupPath = path.join(backupDir, `vocab-expansion-related-links-${runId}.json`);
      await fs.writeFile(
        backupPath,
        `${JSON.stringify(
          {
            createdAt: new Date().toISOString(),
            rule: "Remove related-word wiki links that came only from 词汇扩充 sections.",
            entries: applyPlans.map((plan) => ({
              entryId: plan.entry.id,
              word: plan.entry.targetWord.word,
              slug: plan.entry.targetWord.slug,
              title: plan.entry.title,
              splitText: plan.entry.splitText,
              sourceType: plan.entry.sourceType,
              status: plan.entry.status,
              contentMarkdown: plan.entry.contentMarkdown,
              beforeRelatedWords: plan.beforeRelatedWords,
              removedRelatedWords: plan.removedRelatedWords
            }))
          },
          null,
          2
        )}\n`
      );

      for (const plan of applyPlans) {
        const nextMarkdown = withRelatedWordBlock(plan.entry.contentMarkdown, plan.afterRelatedWords);
        const contentHtml = await renderMnemonicMarkdown(nextMarkdown);
        const plainText = markdownToPlainText(nextMarkdown);

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
            data: { contentMarkdown: nextMarkdown, contentHtml, plainText }
          });
          await syncEntryWikiLinks(plan.entry.id, actor.id, tx);
          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              action: "MNEMONIC_RELATED_VOCAB_EXPANSION_CLEANUP",
              entityType: "MnemonicEntry",
              entityId: plan.entry.id,
              metadataJson: {
                word: plan.entry.targetWord.word,
                removedRelatedWords: plan.removedRelatedWords,
                keptBecauseAnchored: plan.keptBecauseAnchored,
                rule: "词汇扩充里的单词不作为相关单词链接；只保留记忆路径中的基础词链接。"
              }
            }
          });
        });
      }
    }

    const report = {
      runId,
      mode: APPLY ? "apply" : "dry-run",
      generatedAt: new Date().toISOString(),
      scannedEntries: entries.length,
      candidateEntries: plans.length,
      applyEligibleEntries: applyPlans.length,
      protectedCandidateEntries: protectedPlans.length,
      removedLinkCount: applyPlans.reduce((sum, plan) => sum + plan.removedRelatedWords.length, 0),
      protectedLinkCount: protectedPlans.reduce((sum, plan) => sum + plan.removedRelatedWords.length, 0),
      backupPath,
      items: plans.map((plan) => ({
        entryId: plan.entry.id,
        word: plan.entry.targetWord.word,
        slug: plan.entry.targetWord.slug,
        sourceType: plan.entry.sourceType,
        status: plan.entry.status,
        applyEligible: plan.applyEligible,
        beforeRelatedWords: plan.beforeRelatedWords,
        removedRelatedWords: plan.removedRelatedWords,
        afterRelatedWords: plan.afterRelatedWords,
        keptBecauseAnchored: plan.keptBecauseAnchored,
        expansionWords: plan.expansionWords,
        expansionSnippet: plan.expansionSnippet
      }))
    };

    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await fs.writeFile(path.join(reportDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);

    console.log(
      JSON.stringify(
        {
          mode: report.mode,
          scannedEntries: report.scannedEntries,
          candidateEntries: report.candidateEntries,
          applyEligibleEntries: report.applyEligibleEntries,
          protectedCandidateEntries: report.protectedCandidateEntries,
          removedLinkCount: report.removedLinkCount,
          protectedLinkCount: report.protectedLinkCount,
          reportPath,
          backupPath,
          sample: report.items.slice(0, 20).map((item) => ({
            word: item.word,
            sourceType: item.sourceType,
            removedRelatedWords: item.removedRelatedWords,
            keptBecauseAnchored: item.keptBecauseAnchored
          }))
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

function buildRepairPlan(entry: EntryRecord, wordSet: Set<string>): RepairPlan | null {
  const beforeRelatedWords = extractRelatedWords(entry.contentMarkdown);
  if (!beforeRelatedWords.length) return null;

  const expansion = extractVocabExpansion(entry.contentMarkdown, wordSet);
  if (!expansion.words.length) return null;

  const target = normalizeWord(entry.targetWord.word);
  const expansionWordSet = new Set(expansion.words);
  const expansionRelatedWords = beforeRelatedWords.filter((word) => word !== target && expansionWordSet.has(word));
  if (!expansionRelatedWords.length) return null;

  const keptBecauseAnchored = expansionRelatedWords.filter((word) => hasStrongMemoryAnchor(entry.contentMarkdown, word));
  const anchoredSet = new Set(keptBecauseAnchored);
  const removedRelatedWords = expansionRelatedWords.filter((word) => !anchoredSet.has(word));
  if (!removedRelatedWords.length) return null;

  const removeSet = new Set(removedRelatedWords);
  return {
    entry,
    applyEligible: entry.sourceType === MnemonicSourceType.OFFICIAL || INCLUDE_USER_ENTRIES,
    expansionWords: expansion.words,
    beforeRelatedWords,
    afterRelatedWords: beforeRelatedWords.filter((word) => !removeSet.has(word)),
    removedRelatedWords,
    keptBecauseAnchored,
    expansionSnippet: expansion.snippet
  };
}

function extractRelatedWords(markdown: string) {
  const marker = markdown.search(relatedMarkerPattern);
  if (marker === -1) return [];
  const scope = markdown.slice(marker);
  return unique(
    Array.from(scope.matchAll(wordLinkPattern))
      .map((match) => normalizeWord(match[1] ?? ""))
      .filter(Boolean)
  );
}

function extractVocabExpansion(markdown: string, wordSet: Set<string>) {
  const sections: string[] = [];
  let collecting = false;
  let current: string[] = [];

  for (const line of markdown.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const sectionStart = trimmed.match(vocabExpansionLinePattern);
    if (sectionStart) {
      if (current.length) sections.push(current.join("\n"));
      collecting = true;
      current = [sectionStart[1] ?? ""];
      continue;
    }

    if (collecting && sectionStopPattern.test(trimmed)) {
      if (current.length) sections.push(current.join("\n"));
      collecting = false;
      current = [];
      continue;
    }

    if (collecting) current.push(line);
  }

  if (current.length) sections.push(current.join("\n"));
  const snippet = sections.join("\n").replace(/\s+/gu, " ").trim();
  const words = unique(
    Array.from(snippet.matchAll(/\b[a-z][a-z-]{1,38}\b/giu))
      .map((match) => normalizeWord(match[0] ?? ""))
      .filter((word) => word && !structuralTokens.has(word) && wordSet.has(word))
  );
  return { words, snippet };
}

function hasStrongMemoryAnchor(markdown: string, word: string) {
  const body = memoryBodyBeforeExpansion(markdown);
  if (!body) return false;

  const token = String.raw`(?<![a-z-])${escapeRegExp(word)}(?![a-z-])`;
  const patterns = [
    new RegExp(String.raw`(?:用|通过|借助|利用)\s*${token}\s*(?:来)?记`, "iu"),
    new RegExp(String.raw`在记忆(?:单词)?\s*${token}[^。；;\n]{0,50}(?:时)?(?:已经)?接触过`, "iu"),
    new RegExp(String.raw`(?:记忆|掌握)(?:单词)?\s*${token}`, "iu"),
    new RegExp(String.raw`${token}\s*(?:为|是)(?:已经)?(?:记忆过的|熟悉的|学过的)?(?:单词)?`, "iu"),
    new RegExp(String.raw`(?:已经记忆过的|记忆过的|熟悉的|学过的)单词\s*${token}`, "iu"),
    new RegExp(String.raw`(?:联想到|想到|可联想到|可以联想到|容易想到|容易联想到)[^。；;\n]{0,40}${token}`, "iu"),
    new RegExp(String.raw`${token}\s*(?:作|做|表示|意思是|意为)`, "iu"),
    new RegExp(String.raw`${token}\s*[（(][^\n)）]{0,40}[)）]\s*\+`, "iu"),
    new RegExp(String.raw`\+\s*${token}`, "iu"),
    new RegExp(String.raw`${token}\s*(?:加|加上|加后缀|加前缀|变成|变为)`, "iu")
  ];
  return patterns.some((pattern) => pattern.test(body));
}

function memoryBodyBeforeExpansion(markdown: string) {
  const expansionIndex = markdown.search(vocabExpansionMarkerPattern);
  const relatedIndex = markdown.search(relatedMarkerPattern);
  const cutPoints = [expansionIndex, relatedIndex].filter((index) => index >= 0);
  const end = cutPoints.length ? Math.min(...cutPoints) : markdown.length;
  return markdown.slice(0, end).replace(/\[\[[^\]\n]+?\]\]/gu, " ").replace(/\s+/gu, " ").trim();
}

function withRelatedWordBlock(markdown: string, relatedWords: string[]) {
  const body = stripRelatedWordBlock(markdown).trimEnd();
  const uniqueRelatedWords = unique(relatedWords.map(normalizeWord).filter(Boolean));
  if (!uniqueRelatedWords.length) return body.trim();
  return [body, "相关单词：", ...uniqueRelatedWords.map((word) => `[[word:${word}]]`)].join("\n").trim();
}

function stripRelatedWordBlock(markdown: string) {
  const marker = markdown.search(relatedMarkerPattern);
  if (marker === -1) return markdown;
  return markdown.slice(0, marker);
}

function normalizeWord(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z]+$/gu, "")
    .replace(/[^a-z-]/gu, "");
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    if (process.env[key]) continue;
    process.env[key] = unquote(trimmed.slice(equalsIndex + 1).trim());
  }
}

function unquote(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
