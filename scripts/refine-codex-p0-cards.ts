import fs from "node:fs";
import path from "node:path";
import { MnemonicSourceType, MnemonicStatus, Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { syncEntryWikiLinks } from "@/lib/wiki-links/resolve";
import { markdownToPlainText, renderMnemonicMarkdown } from "@/lib/wiki-links/renderer";

const apply = process.argv.includes("--apply");
const marker = "codex-p0-source-repair-2026-05-15";
const refineMarker = "codex-p0-refine-v2-links-layout-no-examples-2026-05-15";
const adminEmail = process.env.MNEMONIC_CLEANUP_ACTOR_EMAIL ?? "maoshangjian2021@163.com";
const backupDir = path.join(process.cwd(), "backups");
const reportDir = path.join(process.cwd(), "tmp/p0-source-repair");
const minLinkedWordLength = 2;

type ActiveEntry = {
  id: string;
  title: string;
  splitText: string | null;
  contentMarkdown: string;
  editorNote: string | null;
  targetWord: {
    id: string;
    word: string;
    slug: string;
    exampleSentence: string | null;
    exampleTranslation: string | null;
  };
};

type WordRef = {
  word: string;
  slug: string;
};

type Plan = {
  entry: ActiveEntry;
  nextContentMarkdown: string;
  addedLinks: string[];
  contentChanged: boolean;
  clearExample: boolean;
};

async function main() {
  const actor = await resolveActor();
  const entries = await prisma.mnemonicEntry.findMany({
    where: {
      sourceType: MnemonicSourceType.OFFICIAL,
      status: { not: MnemonicStatus.ARCHIVED },
      editorNote: { contains: marker }
    },
    select: {
      id: true,
      title: true,
      splitText: true,
      contentMarkdown: true,
      editorNote: true,
      targetWord: {
        select: {
          id: true,
          word: true,
          slug: true,
          exampleSentence: true,
          exampleTranslation: true
        }
      }
    },
    orderBy: [{ targetWord: { word: "asc" } }]
  });
  const words = await prisma.word.findMany({
    select: { word: true, slug: true },
    orderBy: { word: "asc" }
  });
  const wordByLower = new Map(words.map((word) => [word.word.toLowerCase(), word]));
  const plans = entries.map((entry) => buildPlan(entry, wordByLower));
  const changedPlans = plans.filter((plan) => plan.contentChanged || plan.clearExample);
  const backupPath = await writeBackup(entries);
  const reportPath = writeReport(plans, backupPath);

  printSummary(plans, backupPath, reportPath, actor.email ?? actor.username);

  if (!apply) return;

  let updatedEntries = 0;
  let clearedExamples = 0;
  let linksAdded = 0;

  for (const plan of changedPlans) {
    const contentHtml = plan.contentChanged ? await renderMnemonicMarkdown(plan.nextContentMarkdown) : undefined;
    const plainText = plan.contentChanged
      ? markdownToPlainText([plan.entry.splitText ? `划分：${plan.entry.splitText}` : "", plan.nextContentMarkdown].filter(Boolean).join("\n\n"))
      : undefined;

    await prisma.$transaction(async (tx) => {
      if (plan.contentChanged) {
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
            plainText,
            editorNote: appendEditorNote(plan.entry.editorNote, refineMarker)
          }
        });
        await syncEntryWikiLinks(plan.entry.id, actor.id, tx);
        updatedEntries += 1;
        linksAdded += plan.addedLinks.length;
      }

      if (plan.clearExample) {
        await tx.word.update({
          where: { id: plan.entry.targetWord.id },
          data: {
            exampleSentence: null,
            exampleTranslation: null
          }
        });
        clearedExamples += 1;
      }

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "CODEX_P0_SOURCE_REFINE_V2",
          entityType: "MnemonicEntry",
          entityId: plan.entry.id,
          metadataJson: {
            marker,
            refineMarker,
            word: plan.entry.targetWord.word,
            contentChanged: plan.contentChanged,
            clearExample: plan.clearExample,
            addedLinks: plan.addedLinks,
            backupPath,
            reportPath
          } satisfies Prisma.InputJsonObject
        }
      });
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        targetEntries: entries.length,
        changedEntries: updatedEntries,
        clearedExamples,
        linksAdded,
        backupPath,
        reportPath
      },
      null,
      2
    )
  );
}

async function resolveActor() {
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
  return actor;
}

function buildPlan(entry: ActiveEntry, wordByLower: Map<string, WordRef>): Plan {
  const formatted = formatMnemonicMarkdown(entry.contentMarkdown);
  const linkResult = addContextualWordLinks(formatted, entry.targetWord.word, wordByLower);
  return {
    entry,
    nextContentMarkdown: linkResult.markdown,
    addedLinks: linkResult.addedLinks,
    contentChanged: linkResult.markdown !== entry.contentMarkdown,
    clearExample: Boolean(entry.targetWord.exampleSentence || entry.targetWord.exampleTranslation)
  };
}

function formatMnemonicMarkdown(markdown: string) {
  const sections = markdown
    .replace(/\r\n?/gu, "\n")
    .split(/\n{2,}/gu)
    .map((section) => formatSection(section))
    .filter(Boolean);
  return sections.join("\n\n").trim();
}

function formatSection(section: string) {
  let text = section
    .normalize("NFKC")
    .replace(/\u00a0/gu, " ")
    .replace(/[ \t]*\n+[ \t]*/gu, " ")
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/gu, "$1$2")
    .replace(/\s+([，。；：、])/gu, "$1")
    .replace(/([，。；：、])\s+/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();

  if (!text) return "";

  text = text.replace(/^带你背[:：]\s*/u, "带你背：\n");
  text = text.replace(/^例句[:：]\s*/u, "例句：\n");
  text = insertBreaks(text, [
    /针对第\s*\d+\s*个元素/gu,
    /针对整个单词/gu,
    /(?:^|[;；]\s*)(综合考虑|综台考虑|结合[^;；。]{0,40}?再综合考虑)/gu,
    /(?:^|[;；]\s*)(\d+\s*(?:联系|由|综合考虑))/gu,
    /词根词缀(?:分析|积累)[:：]/gu,
    /巧记[:：]/gu,
    /常见搭配[:：]/gu,
    /词汇扩充[:：]/gu,
    /例句[:：]/gu
  ]);
  text = text
    .replace(/带你背：\s+/gu, "带你背：\n")
    .replace(/例句：\s+/gu, "例句：\n")
    .replace(/(针对第\s*\d+\s*个元素)\n(词根词缀分析[:：]?)/gu, "$1$2")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  return text;
}

function insertBreaks(text: string, patterns: RegExp[]) {
  let output = text;
  for (const pattern of patterns) {
    output = output.replace(pattern, (...args: unknown[]) => {
      const match = String(args[0]);
      const offset = Number(args[args.length - 2]);
      const prefix = match.match(/^[;；]\s*/u)?.[0] ?? "";
      const clean = match.slice(prefix.length);
      if (offset === 0 || output[offset - 1] === "\n") return match;
      return `${prefix}\n${clean}`;
    });
  }
  return output;
}

function addContextualWordLinks(markdown: string, targetWord: string, wordByLower: Map<string, WordRef>) {
  const targetLower = targetWord.toLowerCase();
  const candidates = extractContextualCandidates(markdown)
    .map((candidate) => candidate.toLowerCase())
    .filter((candidate) => candidate !== targetLower)
    .filter((candidate) => candidate.length >= minLinkedWordLength)
    .filter((candidate) => wordByLower.has(candidate));
  const uniqueCandidates = Array.from(new Set(candidates)).sort((left, right) => right.length - left.length || left.localeCompare(right));
  let output = markdown;
  const addedLinks: string[] = [];

  for (const candidate of uniqueCandidates) {
    if (hasWordLink(output, candidate)) continue;
    const word = wordByLower.get(candidate);
    if (!word) continue;
    const next = replaceFirstWordOutsideWikiLink(output, word.word);
    if (next === output) continue;
    output = next;
    addedLinks.push(word.word);
  }

  return { markdown: output, addedLinks };
}

function extractContextualCandidates(markdown: string) {
  const text = candidateSourceText(markdown).replace(/\[\[[^\]\n]+?\]\]/gu, " ");
  const candidates: string[] = [];
  const patterns = [
    /\b([a-z][a-z-]{1,38})\b\s*(?:为|是)(?:前面)?(?:已经)?(?:记忆过的)?(?:熟悉的?)?单词/giu,
    /\b([a-z][a-z-]{1,38})\b\s*(?:为|是)(?:已经)?(?:记忆过的)?(?:熟悉的?)?(?:adj|n|v|adv|pron|prep|conj)\.?/giu,
    /(?:记忆单词|熟悉单词|熟悉的单词|记忆过的单词)\s*([a-z][a-z-]{1,38})/giu,
    /联想到(?:一个)?(?:已经记忆过的|记忆过的|熟悉的|以及记忆过的)?(?:熟悉)?单词\s*([a-z][a-z-]{1,38})/giu,
    /\b([a-z][a-z-]{1,38})\b\s*(?:n|v|vt|vi|w|adj|adv|pron|prep|conj)\.?(?=[\u4e00-\u9fff])/giu,
    /常见搭配[:：]\s*([a-z][a-z-]{1,38})/giu
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const word = match[1];
      if (word) candidates.push(cleanCandidate(word));
    }
  }

  return candidates.filter(Boolean);
}

function candidateSourceText(markdown: string) {
  const [beforeExplicitExample] = markdown.split(/\n例句[:：]/u);
  let source = stripVocabExpansionSections(beforeExplicitExample ?? markdown);
  const inlineExampleIndex = source.search(
    /(?:^|[\s;；。])(?:[0-9]{2,4}\s*)?(?:B[fJ&5]*|BJ[&5J]*|M\|5|ĐJT|够句|例句|[*/]?[A-Za-z0-9]{1,5}\]|[向狗够]\s*)[:：]\s*(?=[A-Z])/u
  );
  if (inlineExampleIndex > 40) source = source.slice(0, inlineExampleIndex).trim();

  const explicitRelatedSections = Array.from(markdown.matchAll(/常见搭配[:：][^\n。]+/gu)).map((match) => match[0]);
  return [source, ...explicitRelatedSections].filter(Boolean).join("\n");
}

function stripVocabExpansionSections(markdown: string) {
  return markdown.replace(
    /\n*(?:词汇扩充|问汇扩充)[:：][\s\S]*?(?=\n(?:相关单词|例句|常见搭配|对比辨析|词根词缀积累|巧记|图片|释义|划分|记忆卡|注意|总结)[:：]|\n{2,}|$)/gu,
    ""
  );
}

function cleanCandidate(candidate: string) {
  return candidate.toLowerCase().replace(/^-+|-+$/gu, "");
}

function hasWordLink(markdown: string, word: string) {
  const escaped = escapeRegExp(word);
  return new RegExp(String.raw`\[\[\s*word\s*:\s*${escaped}(?:[|\]\s])`, "iu").test(markdown);
}

function replaceFirstWordOutsideWikiLink(markdown: string, word: string) {
  const chunks = markdown.split(/(\[\[[^\]\n]+?\]\])/gu);
  const escaped = escapeRegExp(word);
  const pattern = new RegExp(String.raw`(?<![A-Za-z])(${escaped})(?![A-Za-z])`, "iu");
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (chunk.startsWith("[[") && chunk.endsWith("]]")) continue;
    if (!pattern.test(chunk)) continue;
    chunks[index] = chunk.replace(pattern, (match) => {
      const label = match === word ? word : `${word}|${match}`;
      return `[[word:${label}]]`;
    });
    return chunks.join("");
  }
  return markdown;
}

async function writeBackup(entries: ActiveEntry[]) {
  fs.mkdirSync(backupDir, { recursive: true });
  const wordIds = entries.map((entry) => entry.targetWord.id);
  const snapshot = await prisma.word.findMany({
    where: { id: { in: wordIds } },
    include: {
      mnemonicEntries: {
        where: { sourceType: MnemonicSourceType.OFFICIAL },
        include: {
          versions: true,
          links: true,
          userCardOrders: true
        }
      }
    },
    orderBy: { word: "asc" }
  });
  const backupPath = path.join(backupDir, `mnemonic-before-p0-refine-v2-${Date.now()}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        marker,
        refineMarker,
        createdAt: new Date().toISOString(),
        words: snapshot
      },
      null,
      2
    )
  );
  return backupPath;
}

function writeReport(plans: Plan[], backupPath: string) {
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `refine-v2-${apply ? "apply" : "dry-run"}-${Date.now()}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        marker,
        refineMarker,
        backupPath,
        targetEntries: plans.length,
        contentChanged: plans.filter((plan) => plan.contentChanged).length,
        clearExamples: plans.filter((plan) => plan.clearExample).length,
        addedLinks: plans.reduce((sum, plan) => sum + plan.addedLinks.length, 0),
        entries: plans.map((plan) => ({
          word: plan.entry.targetWord.word,
          entryId: plan.entry.id,
          contentChanged: plan.contentChanged,
          clearExample: plan.clearExample,
          addedLinks: plan.addedLinks,
          before: plan.entry.contentMarkdown,
          after: plan.nextContentMarkdown
        }))
      },
      null,
      2
    )
  );
  return reportPath;
}

function printSummary(plans: Plan[], backupPath: string, reportPath: string, actor: string) {
  const sampleWords = new Set(["discern", "dome", "commit", "downgrade", "dreadful"]);
  console.log(`模式：${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor}`);
  console.log(`目标 Codex P0 卡片：${plans.length}`);
  console.log(`正文会调整：${plans.filter((plan) => plan.contentChanged).length}`);
  console.log(`独立例句会清空：${plans.filter((plan) => plan.clearExample).length}`);
  console.log(`补入词链：${plans.reduce((sum, plan) => sum + plan.addedLinks.length, 0)}`);
  console.log(`备份：${backupPath}`);
  console.log(`报告：${reportPath}`);
  console.log("\n样例：");
  for (const plan of plans.filter((item) => sampleWords.has(item.entry.targetWord.word.toLowerCase()))) {
    console.log(`\n--- ${plan.entry.targetWord.word}`);
    console.log(`links: ${plan.addedLinks.join(", ") || "(none)"}`);
    console.log(plan.nextContentMarkdown.slice(0, 1000));
  }
}

function appendEditorNote(current: string | null, note: string) {
  const parts = current
    ?.split("\n")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts?.includes(note)) return current ?? note;
  return [...(parts ?? []), note].join("\n");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
