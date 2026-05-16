import fs from "node:fs";
import path from "node:path";
import { MnemonicSourceType, MnemonicStatus, Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { syncEntryWikiLinks } from "@/lib/wiki-links/resolve";
import { markdownToPlainText, renderMnemonicMarkdown } from "@/lib/wiki-links/renderer";
import { parseWikiLinks } from "@/lib/wiki-links/parser";

const apply = process.argv.includes("--apply");
const marker = "codex-p0-source-repair-2026-05-15";
const refineMarker = "codex-p0-refine-v3-related-block-no-card-examples-2026-05-15";
const adminEmail = process.env.MNEMONIC_CLEANUP_ACTOR_EMAIL ?? "maoshangjian2021@163.com";
const backupDir = path.join(process.cwd(), "backups");
const reportDir = path.join(process.cwd(), "tmp/p0-source-repair");

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

type BackupWord = {
  id: string;
  word: string;
  exampleSentence: string | null;
  exampleTranslation: string | null;
};

type Plan = {
  entry: ActiveEntry;
  nextContentMarkdown: string;
  relatedWords: string[];
  restoredExampleSentence: string | null;
  restoredExampleTranslation: string | null;
  contentChanged: boolean;
  exampleChanged: boolean;
};

async function main() {
  const actor = await resolveActor();
  const exampleBackupPath = resolveExampleBackupPath();
  const backupWords = readBackupWords(exampleBackupPath);
  const backupByWordId = new Map(backupWords.map((word) => [word.id, word]));
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

  const plans = entries.map((entry) => buildPlan(entry, backupByWordId.get(entry.targetWord.id)));
  const changedPlans = plans.filter((plan) => plan.contentChanged || plan.exampleChanged);
  const backupPath = await writeBackup(entries);
  const reportPath = writeReport(plans, backupPath, exampleBackupPath);

  printSummary(plans, backupPath, reportPath, exampleBackupPath, actor.email ?? actor.username);

  if (!apply) return;

  let updatedEntries = 0;
  let restoredExamples = 0;
  let relatedWords = 0;

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
        relatedWords += plan.relatedWords.length;
      }

      if (plan.exampleChanged) {
        await tx.word.update({
          where: { id: plan.entry.targetWord.id },
          data: {
            exampleSentence: plan.restoredExampleSentence,
            exampleTranslation: plan.restoredExampleTranslation
          }
        });
        restoredExamples += 1;
      }

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "CODEX_P0_SOURCE_REFINE_V3",
          entityType: "MnemonicEntry",
          entityId: plan.entry.id,
          metadataJson: {
            marker,
            refineMarker,
            word: plan.entry.targetWord.word,
            contentChanged: plan.contentChanged,
            exampleChanged: plan.exampleChanged,
            relatedWords: plan.relatedWords,
            backupPath,
            exampleBackupPath,
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
        restoredExamples,
        relatedWords,
        backupPath,
        exampleBackupPath,
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

function buildPlan(entry: ActiveEntry, backupWord: BackupWord | undefined): Plan {
  const relatedWords = extractRelatedWords(entry.contentMarkdown, entry.targetWord.word);
  const body = stripCardExamples(stripWikiSyntax(stripRelatedWordBlock(entry.contentMarkdown)));
  const nextContentMarkdown = withRelatedWordBlock(body, relatedWords);
  const restoredExampleSentence = cleanFixedExample(backupWord?.exampleSentence ?? entry.targetWord.exampleSentence, "sentence");
  const restoredExampleTranslation = cleanFixedExample(backupWord?.exampleTranslation ?? entry.targetWord.exampleTranslation, "translation");
  return {
    entry,
    nextContentMarkdown,
    relatedWords,
    restoredExampleSentence,
    restoredExampleTranslation,
    contentChanged: nextContentMarkdown !== entry.contentMarkdown,
    exampleChanged:
      entry.targetWord.exampleSentence !== restoredExampleSentence ||
      entry.targetWord.exampleTranslation !== restoredExampleTranslation
  };
}

function extractRelatedWords(markdown: string, currentWord: string) {
  const current = currentWord.toLowerCase();
  return Array.from(
    new Set(
      parseWikiLinks(markdown)
        .filter((link) => link.nodeType === "WORD" || link.namespace === "word")
        .map((link) => link.target.trim().toLowerCase())
        .filter((word) => word && word !== current)
    )
  );
}

function stripRelatedWordBlock(markdown: string) {
  return markdown.replace(/\n*相关单词[:：][\s\S]*$/u, "").trimEnd();
}

function stripWikiSyntax(markdown: string) {
  return markdown.replace(/\[\[\s*word\s*:\s*([^|\]\s]+)(?:\|([^\]]+))?\]\]/giu, (_match, target: string, alias: string | undefined) =>
    String(alias || target).trim()
  );
}

function stripCardExamples(markdown: string) {
  let body = markdown.replace(/\r\n?/gu, "\n").trim();
  const cutIndexes = [
    indexOfRegex(body, /\n+\s*例句[:：][\s\S]*$/u),
    indexOfRegex(body, /(?:^|[\s;；。])(?:[0-9]{1,4}(?:\/[0-9A-Za-z])?|\/[0-9A-Za-z])[:：]\s*(?=[A-Z])/u),
    indexOfRegex(body, /(?:^|[\s;；。])(?:[0-9]{1,4}\s*)?(?:B[fJ&5]*|BJ[&5J]*|M\|5|ĐJT|够句|例句|[*/]?[A-Za-z0-9]{1,8}\]|[A-Za-z][A-Za-z0-9&|/*]{0,8}|[向狗够]\s*)[:：]\s*(?=[A-Z])/u),
    indexOfRegex(body, /(?:^|[;；。]\s*)(?:[A-Z][A-Za-z0-9'’",\-\s]+?\.)\s*[\u4e00-\u9fff]/u)
  ].filter((index) => index >= 0);

  if (cutIndexes.length) body = body.slice(0, Math.min(...cutIndexes)).trimEnd();

  return body
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/[;；]\s*$/u, ";")
    .trim();
}

function indexOfRegex(value: string, pattern: RegExp) {
  const match = pattern.exec(value);
  return match?.index ?? -1;
}

function withRelatedWordBlock(body: string, relatedWords: string[]) {
  if (!relatedWords.length) return body.trim();
  return [body.trim(), ["相关单词：", ...relatedWords.map((word) => `[[word:${word}]]`)].join("\n")]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function cleanFixedExample(value: string | null | undefined, kind: "sentence" | "translation") {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/gu, " ")
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/gu, "$1$2")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return null;
  if (kind === "sentence") {
    return cleaned.replace(/^Ihave\b/u, "I have").replace(/(\.)\s+[a-z][a-z-]{1,38}$/u, "$1");
  }
  return cleaned.replace(/([。！？])\s+[A-Za-z][A-Za-z-]{1,38}$/u, "$1");
}

function resolveExampleBackupPath() {
  const explicit = process.argv.find((arg) => arg.startsWith("--example-backup="))?.slice("--example-backup=".length);
  if (explicit) return path.resolve(process.cwd(), explicit);
  const files = fs
    .readdirSync(backupDir)
    .filter((file) => /^mnemonic-before-p0-refine-v2-\d+\.json$/u.test(file))
    .sort();
  const latest = files.at(-1);
  if (!latest) throw new Error("找不到 p0 refine v2 备份，无法恢复固定例句字段。");
  return path.join(backupDir, latest);
}

function readBackupWords(backupPath: string): BackupWord[] {
  const data = JSON.parse(fs.readFileSync(backupPath, "utf8")) as { words?: BackupWord[] };
  if (!Array.isArray(data.words)) throw new Error(`备份格式不正确：${backupPath}`);
  return data.words;
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
  const backupPath = path.join(backupDir, `mnemonic-before-p0-refine-v3-${Date.now()}.json`);
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

function writeReport(plans: Plan[], backupPath: string, exampleBackupPath: string) {
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `refine-v3-${apply ? "apply" : "dry-run"}-${Date.now()}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        marker,
        refineMarker,
        backupPath,
        exampleBackupPath,
        targetEntries: plans.length,
        contentChanged: plans.filter((plan) => plan.contentChanged).length,
        restoredExamples: plans.filter((plan) => plan.exampleChanged).length,
        relatedWords: plans.reduce((sum, plan) => sum + plan.relatedWords.length, 0),
        entries: plans.map((plan) => ({
          word: plan.entry.targetWord.word,
          entryId: plan.entry.id,
          contentChanged: plan.contentChanged,
          exampleChanged: plan.exampleChanged,
          relatedWords: plan.relatedWords,
          restoredExampleSentence: plan.restoredExampleSentence,
          restoredExampleTranslation: plan.restoredExampleTranslation,
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

function printSummary(plans: Plan[], backupPath: string, reportPath: string, exampleBackupPath: string, actor: string) {
  const sampleWords = new Set(["discern", "dome", "commit", "downgrade", "dreadful"]);
  console.log(`模式：${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor}`);
  console.log(`目标 Codex P0 卡片：${plans.length}`);
  console.log(`正文会调整：${plans.filter((plan) => plan.contentChanged).length}`);
  console.log(`固定例句会恢复：${plans.filter((plan) => plan.exampleChanged).length}`);
  console.log(`相关单词总数：${plans.reduce((sum, plan) => sum + plan.relatedWords.length, 0)}`);
  console.log(`本次备份：${backupPath}`);
  console.log(`例句来源备份：${exampleBackupPath}`);
  console.log(`报告：${reportPath}`);
  console.log("\n样例：");
  for (const plan of plans.filter((item) => sampleWords.has(item.entry.targetWord.word.toLowerCase()))) {
    console.log(`\n--- ${plan.entry.targetWord.word}`);
    console.log(`related: ${plan.relatedWords.join(", ") || "(none)"}`);
    console.log(`fixed example: ${plan.restoredExampleSentence || "(none)"}`);
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

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
