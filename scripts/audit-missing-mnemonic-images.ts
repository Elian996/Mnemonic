import fs from "node:fs/promises";
import path from "node:path";
import { MnemonicStatus, type LevelTag, type MnemonicSourceType } from "@prisma/client";
import { prisma } from "../src/lib/db";

const reportDir = path.join(process.cwd(), "tmp", "mnemonic-missing-images");
const reportPath = path.join(reportDir, "latest.json");

type Entry = {
  id: string;
  contentMarkdown: string;
  contentHtml: string;
  sourceType: MnemonicSourceType;
  status: MnemonicStatus;
  targetWord: {
    id: string;
    word: string;
    slug: string;
    levelTags: LevelTag[];
  };
};

type MissingImageItem = {
  entryId: string;
  wordId: string;
  word: string;
  slug: string;
  levelTags: LevelTag[];
  sourceType: MnemonicSourceType;
  status: MnemonicStatus;
  cueMatches: string[];
  preview: string;
  reason: string;
  contentMarkdown: string;
};

type MissingImageReport = {
  version: 1;
  status: "complete";
  createdAt: string;
  updatedAt: string;
  totalEntries: number;
  scannedEntries: number;
  imageBackedEntries: number;
  candidateEntries: number;
  rules: string[];
  items: MissingImageItem[];
};

const directCuePattern =
  /如下图|如上图|如图|下图|上图|图中|图里|图上|图下|图所示|所示(?:的)?图|见图|看图|这张图|那张图|这幅图|那幅图|图片中|图中的|图上的|图下的|箭头所示|图中箭头|示意图/gu;
const headingCuePattern = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:图片|配图|图示|示意图)\s*[:：]/gu;
const renderedImagePattern = /!\[[^\]]*\]\([^)]+\)|<img\b|<figure\b|data:image\//iu;

async function main() {
  await fs.mkdir(reportDir, { recursive: true });

  const entries = await prisma.mnemonicEntry.findMany({
    where: { status: { not: MnemonicStatus.ARCHIVED } },
    select: {
      id: true,
      contentMarkdown: true,
      contentHtml: true,
      sourceType: true,
      status: true,
      targetWord: {
        select: {
          id: true,
          word: true,
          slug: true,
          levelTags: true
        }
      }
    },
    orderBy: [{ targetWord: { word: "asc" } }, { updatedAt: "desc" }]
  });

  let scannedEntries = 0;
  let imageBackedEntries = 0;
  const items: MissingImageItem[] = [];

  for (const entry of entries) {
    const matches = cueMatches(entry.contentMarkdown);
    if (!matches.length) continue;

    scannedEntries += 1;
    if (hasRenderedImage(entry)) {
      imageBackedEntries += 1;
      continue;
    }

    items.push({
      entryId: entry.id,
      wordId: entry.targetWord.id,
      word: entry.targetWord.word,
      slug: entry.targetWord.slug,
      levelTags: entry.targetWord.levelTags,
      sourceType: entry.sourceType,
      status: entry.status,
      cueMatches: matches,
      preview: cuePreview(entry.contentMarkdown, matches[0] ?? ""),
      reason: "正文出现“如下图 / 如图 / 图中 / 示意图”等指图语句，但未检测到图片 Markdown 或 HTML 图片。",
      contentMarkdown: entry.contentMarkdown
    });
  }

  const now = new Date().toISOString();
  const report: MissingImageReport = {
    version: 1,
    status: "complete",
    createdAt: now,
    updatedAt: now,
    totalEntries: entries.length,
    scannedEntries,
    imageBackedEntries,
    candidateEntries: items.length,
    rules: [
      "命中“如下图、如图、下图、上图、图中、图里、见图、看图、示意图、箭头所示”等明确指图表达。",
      "命中单独的“图片：、配图：、图示：、示意图：”结构行。",
      "已经包含图片 Markdown、HTML <img>/<figure> 或 data:image 的卡片不列入缺图结果。",
      "只整理疑似缺图清单，不自动生成或替换图片内容。"
    ],
    items
  };

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log(`扫描记忆卡：${entries.length}`);
  console.log(`含指图语句：${scannedEntries}`);
  console.log(`已有图片：${imageBackedEntries}`);
  console.log(`疑似缺图：${items.length}`);
  for (const item of items.slice(0, 80)) {
    console.log(`- ${item.word}: ${item.cueMatches.join("、")}｜${oneLine(item.preview)}`);
  }
  if (items.length > 80) console.log(`... 另有 ${items.length - 80} 张`);
  console.log(`报告：${reportPath}`);
}

function cueMatches(markdown: string) {
  const matches = new Set<string>();
  for (const match of markdown.matchAll(directCuePattern)) matches.add(match[0]);
  for (const match of markdown.matchAll(headingCuePattern)) {
    const normalized = match[0].replace(/^[\s\n#]+/gu, "").trim();
    if (normalized) matches.add(normalized);
  }
  return [...matches];
}

function hasRenderedImage(entry: Entry) {
  return renderedImagePattern.test(entry.contentMarkdown) || renderedImagePattern.test(entry.contentHtml);
}

function cuePreview(markdown: string, cue: string) {
  const normalized = markdown.replace(/\r\n?/gu, "\n").trim();
  const index = cue ? normalized.indexOf(cue) : -1;
  if (index < 0) return normalized.slice(0, 260);

  const start = Math.max(0, index - 120);
  const end = Math.min(normalized.length, index + cue.length + 180);
  return `${start > 0 ? "..." : ""}${normalized.slice(start, end)}${end < normalized.length ? "..." : ""}`;
}

function oneLine(value: string) {
  return value.replace(/\s+/gu, " ").slice(0, 220);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
