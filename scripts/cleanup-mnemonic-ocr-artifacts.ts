import { MnemonicSourceType, MnemonicStatus } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { markdownToPlainText, renderMnemonicMarkdown } from "../src/lib/wiki-links/renderer";
import { syncEntryWikiLinks } from "../src/lib/wiki-links/resolve";

const APPLY = process.argv.includes("--apply");
const PAGE_MARKER_LINE = /^[ \t]*={2,}\s*PAGE\s*\d+\s*={2,}[ \t]*\n?/gim;
const PAGE_MARKER_INLINE = /[ \t]*={2,}\s*PAGE\s*\d+\s*={2,}[ \t]*/giu;
const OCR_PHONETIC_LINE = /^[ \t]*#?\s*[A-Za-z0-9/]{1,6}\s*:\s*[^\u4e00-\u9fff\n]*[/'][^\u4e00-\u9fff\n]*\n?/gmu;
const OCR_LINE_PREFIX = /^(\s*)(?:[A-Za-z0-9/]{2,6})\s*:\s+(?=[A-Za-z])/gm;
const OCR_HASH_PREFIX = /(^|[\s。；;])#\s*[A-Za-z0-9/]{1,8}\s*:\s*/gmu;
const OCR_HASH_TOKEN = /(^|[\s。；;])#\s*[A-Za-z0-9/]{1,8}\b\s*/gmu;
const OCR_INLINE_PREFIX = /(^|[\n。；;]\s*)(?:[A-Za-z0-9/]{1,6})\s*:\s+(?=[A-Za-z])/gmu;
const WATERMARK_LINE =
  /^[ \t]*(?:\(?EDU[CE]ATI?O?n\)?|FOREST\s+EDU[CE]ATI?O?n|树成林(?:教育|教侖)?|成林|ماو)[ \t]*(?:\n|$)/gmu;
const WATERMARK_INLINE = /[ \t]*(?:FOREST\s+EDU[CE]ATI?O?n|树成林(?:教育|教侖)?|ماو)[ \t]*/gu;
const WATERMARK_FRAGMENT = /^(\s*)成林(?=\s*针对)/gmu;

type Entry = {
  id: string;
  title: string;
  splitText: string | null;
  contentMarkdown: string;
  targetWord: { word: string };
};

async function main() {
  const actor = await prisma.user.findFirst({
    where: { email: "maoshangjian2021@163.com", status: "ACTIVE" },
    select: { id: true, username: true, email: true }
  }) ?? await prisma.user.findFirst({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true, username: true, email: true }
  });
  if (!actor) throw new Error("找不到管理员账号。");

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
    .map((entry) => {
      const nextSplitText = cleanSplitText(entry);
      const nextContentMarkdown = cleanContentMarkdown(entry.contentMarkdown);
      return { entry, nextSplitText, nextContentMarkdown };
    })
    .filter(
      (plan) =>
        plan.nextSplitText !== (plan.entry.splitText ?? "") ||
        plan.nextContentMarkdown !== plan.entry.contentMarkdown
    );

  const stats = summarize(plans);
  console.log(`模式：${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor.username} <${actor.email}>`);
  console.log(`将清洗记忆卡：${plans.length} 张`);
  console.log(JSON.stringify(stats, null, 2));
  console.log("\n样例：");
  for (const plan of plans.slice(0, 30)) {
    console.log(`- ${plan.entry.targetWord.word}: ${changedKinds(plan.entry, plan.nextSplitText, plan.nextContentMarkdown).join(", ")}`);
  }

  if (!APPLY) return;

  let updated = 0;
  for (const plan of plans) {
    const contentHtml = await renderMnemonicMarkdown(plan.nextContentMarkdown);
    const plainText = markdownToPlainText([plan.nextSplitText ? `划分：${plan.nextSplitText}` : "", plan.nextContentMarkdown].filter(Boolean).join("\n\n"));
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
          splitText: plan.nextSplitText,
          contentMarkdown: plan.nextContentMarkdown,
          contentHtml,
          plainText
        }
      });
      await syncEntryWikiLinks(plan.entry.id, actor.id, tx);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "MNEMONIC_OCR_CLEANUP",
          entityType: "MnemonicEntry",
          entityId: plan.entry.id,
          metadataJson: { word: plan.entry.targetWord.word, changes: changedKinds(plan.entry, plan.nextSplitText, plan.nextContentMarkdown) }
        }
      });
    });
    updated += 1;
  }

  console.log(`\n已完成：清洗 ${updated} 张记忆卡。`);
}

function cleanContentMarkdown(markdown: string) {
  return markdown
    .replace(/\r\n?/gu, "\n")
    .replace(PAGE_MARKER_LINE, "")
    .replace(PAGE_MARKER_INLINE, " ")
    .replace(OCR_PHONETIC_LINE, "")
    .replace(OCR_LINE_PREFIX, "$1")
    .replace(OCR_HASH_PREFIX, "$1")
    .replace(OCR_HASH_TOKEN, "$1")
    .replace(OCR_INLINE_PREFIX, "$1")
    .replace(WATERMARK_LINE, "")
    .replace(WATERMARK_INLINE, " ")
    .replace(WATERMARK_FRAGMENT, "$1")
    .replace(/\bbonc\b/giu, "bone")
    .replace(/骨絡/gu, "骨骼")
    .replace(/表示w\s*/gu, "表示 v.")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function cleanSplitText(entry: Entry) {
  const splitText = (entry.splitText ?? "")
    .replace(/[丨｜]/gu, "|")
    .replace(/\s+I\s+/gu, " | ")
    .replace(/\s{2,}/gu, " ")
    .trim();

  if (entry.targetWord.word.toLowerCase() === "transplant" && /urans\s+lplant/iu.test(splitText)) {
    return "trans | plant";
  }

  return splitText;
}

function summarize(plans: Array<{ entry: Entry; nextSplitText: string; nextContentMarkdown: string }>) {
  return {
    pageMarkers: plans.filter((plan) => PAGE_MARKER_LINE.test(resetRegex(plan.entry.contentMarkdown, PAGE_MARKER_LINE)) || PAGE_MARKER_INLINE.test(resetRegex(plan.entry.contentMarkdown, PAGE_MARKER_INLINE))).length,
    ocrPhoneticLines: plans.filter((plan) => OCR_PHONETIC_LINE.test(resetRegex(plan.entry.contentMarkdown, OCR_PHONETIC_LINE))).length,
    ocrPrefixes: plans.filter((plan) => OCR_LINE_PREFIX.test(resetRegex(plan.entry.contentMarkdown, OCR_LINE_PREFIX)) || OCR_HASH_PREFIX.test(resetRegex(plan.entry.contentMarkdown, OCR_HASH_PREFIX)) || OCR_HASH_TOKEN.test(resetRegex(plan.entry.contentMarkdown, OCR_HASH_TOKEN)) || OCR_INLINE_PREFIX.test(resetRegex(plan.entry.contentMarkdown, OCR_INLINE_PREFIX))).length,
    watermarks: plans.filter((plan) => WATERMARK_LINE.test(resetRegex(plan.entry.contentMarkdown, WATERMARK_LINE)) || WATERMARK_INLINE.test(resetRegex(plan.entry.contentMarkdown, WATERMARK_INLINE)) || WATERMARK_FRAGMENT.test(resetRegex(plan.entry.contentMarkdown, WATERMARK_FRAGMENT))).length,
    bonc: plans.filter((plan) => /\bbonc\b/iu.test(plan.entry.contentMarkdown)).length,
    boneChinese: plans.filter((plan) => /骨絡/u.test(plan.entry.contentMarkdown)).length,
    badVerbMarker: plans.filter((plan) => /表示w\s*/u.test(plan.entry.contentMarkdown)).length,
    splitText: plans.filter((plan) => plan.nextSplitText !== (plan.entry.splitText ?? "")).length
  };
}

function changedKinds(entry: Entry, splitText: string, contentMarkdown: string) {
  const kinds: string[] = [];
  if (/={2,}\s*PAGE\s*\d+\s*={2,}/iu.test(entry.contentMarkdown)) kinds.push("删 PAGE");
  if (OCR_PHONETIC_LINE.test(resetRegex(entry.contentMarkdown, OCR_PHONETIC_LINE))) kinds.push("删音标残留行");
  if (/^\s*[A-Za-z0-9/]{2,6}\s*:\s+(?=[A-Za-z])/m.test(entry.contentMarkdown) || OCR_HASH_PREFIX.test(resetRegex(entry.contentMarkdown, OCR_HASH_PREFIX)) || OCR_HASH_TOKEN.test(resetRegex(entry.contentMarkdown, OCR_HASH_TOKEN)) || OCR_INLINE_PREFIX.test(resetRegex(entry.contentMarkdown, OCR_INLINE_PREFIX))) kinds.push("删乱码前缀");
  if (/(?:\(?EDU[CE]ATI?O?n|FOREST\s+EDU[CE]ATI?O?n|树成林(?:教育|教侖)?|ماو)/iu.test(entry.contentMarkdown) || /^\s*成林(?=\s*针对)/mu.test(entry.contentMarkdown)) kinds.push("删水印");
  if (/\bbonc\b/iu.test(entry.contentMarkdown)) kinds.push("bonc→bone");
  if (/骨絡/u.test(entry.contentMarkdown)) kinds.push("骨絡→骨骼");
  if (/表示w\s*/u.test(entry.contentMarkdown)) kinds.push("表示w→表示 v.");
  if (splitText !== (entry.splitText ?? "")) kinds.push("修划分");
  if (contentMarkdown !== entry.contentMarkdown && !kinds.length) kinds.push("清理空行");
  return kinds;
}

function resetRegex(value: string, regex: RegExp) {
  regex.lastIndex = 0;
  return value;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
