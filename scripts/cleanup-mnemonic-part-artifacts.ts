import fs from "node:fs/promises";
import path from "node:path";
import { MnemonicStatus } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { markdownToPlainText, renderMnemonicMarkdown } from "../src/lib/wiki-links/renderer";
import { syncEntryWikiLinks } from "../src/lib/wiki-links/resolve";

const APPLY = process.argv.includes("--apply");
const EXACT_PART_LINE = /^\s*Part\d+\s*$/iu;
const DAY_LINE = /^\s*DAY\d*\s*$/iu;
const EXAMPLE_HEADING = /^例句[:：]\s*$/u;

type Entry = {
  id: string;
  title: string;
  splitText: string | null;
  contentMarkdown: string;
  targetWord: { word: string };
};

type Plan = {
  entry: Entry;
  nextContentMarkdown: string;
  removals: Array<{
    startLine: number;
    endLine: number;
    preview: string[];
  }>;
};

async function main() {
  const actor =
    (await prisma.user.findFirst({
      where: { email: "maoshangjian2021@163.com", status: "ACTIVE" },
      select: { id: true, username: true, email: true }
    })) ??
    (await prisma.user.findFirst({
      where: { role: "ADMIN", status: "ACTIVE" },
      select: { id: true, username: true, email: true }
    }));
  if (!actor) throw new Error("找不到管理员账号。");

  const entries = await prisma.mnemonicEntry.findMany({
    where: {
      status: { not: MnemonicStatus.ARCHIVED },
      contentMarkdown: { contains: "Part", mode: "insensitive" }
    },
    select: {
      id: true,
      title: true,
      splitText: true,
      contentMarkdown: true,
      targetWord: { select: { word: true } }
    },
    orderBy: [{ targetWord: { word: "asc" } }]
  });

  const plans = entries
    .map((entry) => planCleanup(entry))
    .filter((plan): plan is Plan => plan !== null && plan.nextContentMarkdown !== plan.entry.contentMarkdown);

  console.log(`模式：${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor.username} <${actor.email}>`);
  console.log(`将清理含孤立 Part 标记的记忆卡：${plans.length} 张`);
  for (const plan of plans) {
    const ranges = plan.removals.map((item) => `${item.startLine}-${item.endLine}`).join(", ");
    console.log(`- ${plan.entry.targetWord.word}: 删除行 ${ranges}`);
    for (const removal of plan.removals) {
      console.log(`  ${removal.preview.join(" | ")}`);
    }
  }

  if (!APPLY) return;

  const backupPath = await writeBackup(plans);
  console.log(`\n备份：${backupPath}`);

  let updated = 0;
  for (const plan of plans) {
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
      await syncEntryWikiLinks(plan.entry.id, actor.id, tx);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "MNEMONIC_PART_ARTIFACT_CLEANUP",
          entityType: "MnemonicEntry",
          entityId: plan.entry.id,
          metadataJson: {
            word: plan.entry.targetWord.word,
            removals: plan.removals.map((item) => ({
              startLine: item.startLine,
              endLine: item.endLine,
              preview: item.preview
            }))
          }
        }
      });
    });
    updated += 1;
  }

  console.log(`\n已完成：清理 ${updated} 张记忆卡。`);
}

function planCleanup(entry: Entry): Plan | null {
  const normalized = entry.contentMarkdown.replace(/\r\n?/gu, "\n");
  const lines = normalized.split("\n");
  const removals: Plan["removals"] = [];
  let cursor = 0;
  const kept: Array<{ index: number; line: string }> = [];

  while (cursor < lines.length) {
    if (!EXACT_PART_LINE.test(lines[cursor])) {
      kept.push({ index: cursor, line: lines[cursor] });
      cursor += 1;
      continue;
    }

    let start = cursor;
    const prevNonBlank = findPreviousNonBlank(lines, cursor);
    if (prevNonBlank >= 0 && DAY_LINE.test(lines[prevNonBlank])) {
      start = prevNonBlank;
      while (kept.length && kept[kept.length - 1].index >= start) kept.pop();
    }

    const end = findRemovalEnd(lines, cursor);
    removals.push({
      startLine: start + 1,
      endLine: end,
      preview: lines
        .slice(start, end)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 8)
    });
    cursor = end;
  }

  if (!removals.length) return null;
  return {
    entry,
    nextContentMarkdown: normalizeBlankLines(kept.map((item) => item.line).join("\n")),
    removals
  };
}

function findRemovalEnd(lines: string[], partIndex: number) {
  let nextNonBlank = partIndex + 1;
  while (nextNonBlank < lines.length && !lines[nextNonBlank].trim()) nextNonBlank += 1;

  if (nextNonBlank < lines.length && EXAMPLE_HEADING.test(lines[nextNonBlank])) {
    return partIndex + 1;
  }

  for (let index = partIndex + 1; index < lines.length; index += 1) {
    if (EXAMPLE_HEADING.test(lines[index])) return index;
  }

  return partIndex + 1;
}

function findPreviousNonBlank(lines: string[], index: number) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (lines[cursor].trim()) return cursor;
  }
  return -1;
}

function normalizeBlankLines(value: string) {
  return value
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

async function writeBackup(plans: Plan[]) {
  const backupDir = path.join(process.cwd(), "tmp", "backups");
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const backupPath = path.join(backupDir, `mnemonic-part-artifacts-${stamp}.json`);
  await fs.writeFile(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        count: plans.length,
        entries: plans.map((plan) => ({
          id: plan.entry.id,
          word: plan.entry.targetWord.word,
          title: plan.entry.title,
          splitText: plan.entry.splitText,
          contentMarkdown: plan.entry.contentMarkdown,
          removals: plan.removals
        }))
      },
      null,
      2
    )
  );
  return backupPath;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
