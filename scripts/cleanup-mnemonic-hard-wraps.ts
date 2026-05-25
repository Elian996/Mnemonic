import fs from "node:fs/promises";
import path from "node:path";
import { MnemonicStatus, type LevelTag, type MnemonicSourceType, type Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { markdownToPlainText, renderMnemonicMarkdown } from "../src/lib/wiki-links/renderer";
import { syncEntryWikiLinks } from "../src/lib/wiki-links/resolve";

const APPLY = process.argv.includes("--apply");
const ADMIN_EMAIL = process.env.MNEMONIC_CLEANUP_ACTOR_EMAIL ?? "maoshangjian2021@163.com";
const reportDir = path.join(process.cwd(), "tmp", "mnemonic-line-wrap-cleanup");
const backupDir = path.join(process.cwd(), "tmp", "backups");
const reportPath = path.join(reportDir, "latest.json");
const backupAction = "MNEMONIC_LINE_WRAP_CLEANUP";

type Entry = {
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
    levelTags: LevelTag[];
  };
};

type JoinFix = {
  before: string;
  after: string;
};

type Plan = {
  entry: Entry;
  nextContentMarkdown: string;
  fixes: JoinFix[];
  changed: boolean;
};

type ReportItem = {
  entryId: string;
  wordId: string;
  word: string;
  slug: string;
  levelTags: LevelTag[];
  sourceType: MnemonicSourceType;
  status: MnemonicStatus;
  reason: string;
  fixCount: number;
  fixes: JoinFix[];
  beforeMarkdown: string;
  afterMarkdown: string;
};

type CleanupReport = {
  version: 1;
  status: "planned" | "complete";
  createdAt: string;
  updatedAt: string;
  applied: boolean;
  totalEntries: number;
  candidateEntries: number;
  updatedEntries: number;
  backupPath: string | null;
  rules: string[];
  items: ReportItem[];
};

const sectionHeadingOnly =
  /^(?:#{1,6}\s*)?(?:划分|带你背|记忆卡|例句|相关单词|词根词缀积累|词汇扩充|问汇扩充|常见搭配|图片|释义|巧记|联想)[:：]\s*$/u;
const sectionHeadingStart =
  /^(?:#{1,6}\s*)?(?:划分|带你背|记忆卡|例句|相关单词|词根词缀积累|词汇扩充|问汇扩充|常见搭配|图片|释义|巧记|联想|对比辨析)[:：]/u;
const logicalLineStart =
  /^(?:[-*+]\s+|\d+[.)、]\s+|[A-Za-z][A-Za-z -]{1,40}[:：]|针对第\s*\d+\s*个|针对整个|综合考虑|词根词缀积累|巧记|例句|相关单词|对比辨析|ps\.|PS\.|当\s*\S+\s*表示|通过|联系|切换思路|图中|由\s|把\s|末尾)/u;
const wikiWordLine = /^\s*\[\[\s*word\s*:/iu;
const markdownImageLine = /^\s*!\[[^\]]*\]\([^)]+\)\s*$/u;
const terminalPunctuation = /[。！？；;：:.?!]$/u;
const partOfSpeechLineEnd =
  /(?:^|[，,；;：:。\s>])(?:表示|即|意为|为|是|作|称为|对应|含义)?\s*(?:n|v|vt|vi|adj|adv|prep|conj|pron|num|art|int)\.\s*$/iu;
const incompleteConnectorEnd =
  /(?:再|以及|并且|而且|然后|接着|因此|所以|因为|如果|表示|得到|进行|可以|能够|用来|作为|称为|理解为|联想到|对应|即|则|就是|也就是|采用)$/u;
const cjk = /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/u;
const startsWithContinuationPunctuation = /^[，,、。；;：:）)】\]》」』]/u;

async function main() {
  await fs.mkdir(reportDir, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });

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

  const entries = await prisma.mnemonicEntry.findMany({
    where: { status: { not: MnemonicStatus.ARCHIVED } },
    select: {
      id: true,
      title: true,
      splitText: true,
      contentMarkdown: true,
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
    orderBy: [{ targetWord: { word: "asc" } }]
  });

  const plans = entries.map((entry) => {
    const normalized = normalizeHardWraps(entry.contentMarkdown);
    return {
      entry,
      nextContentMarkdown: normalized.markdown,
      fixes: normalized.fixes,
      changed: normalized.markdown !== entry.contentMarkdown
    };
  });
  const changedPlans = plans.filter((plan) => plan.changed && plan.fixes.length > 0);

  const backupPath = APPLY && changedPlans.length ? await writeBackup(changedPlans) : null;
  let updatedEntries = 0;

  const initialReport = buildReport(entries.length, changedPlans, backupPath, "planned");
  if (APPLY || changedPlans.length > 0) {
    await fs.writeFile(reportPath, JSON.stringify(initialReport, null, 2));
  }

  console.log(`模式：${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor.username} <${actor.email}>`);
  console.log(`扫描记忆卡：${entries.length}`);
  console.log(`疑似硬换行：${changedPlans.length}`);
  for (const plan of changedPlans.slice(0, 80)) {
    console.log(`- ${plan.entry.targetWord.word}: ${plan.fixes.length} 处`);
    for (const fix of plan.fixes.slice(0, 2)) {
      console.log(`  ${oneLine(fix.before)} -> ${oneLine(fix.after)}`);
    }
  }
  if (changedPlans.length > 80) console.log(`... 另有 ${changedPlans.length - 80} 张`);

  if (!APPLY) return;

  for (const plan of changedPlans) {
    const contentHtml = await renderMnemonicMarkdown(plan.nextContentMarkdown);
    const plainText = markdownToPlainText(
      [plan.entry.splitText ? `划分：${plan.entry.splitText}` : "", plan.nextContentMarkdown]
        .filter(Boolean)
        .join("\n\n")
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
      await syncEntryWikiLinks(plan.entry.id, actor.id, tx as Prisma.TransactionClient);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: backupAction,
          entityType: "MnemonicEntry",
          entityId: plan.entry.id,
          metadataJson: {
            wordId: plan.entry.targetWord.id,
            word: plan.entry.targetWord.word,
            fixCount: plan.fixes.length,
            rule: "join_visual_hard_wraps"
          }
        }
      });
    });
    updatedEntries += 1;
  }

  const finalReport = buildReport(entries.length, changedPlans, backupPath, "complete", updatedEntries);
  await fs.writeFile(reportPath, JSON.stringify(finalReport, null, 2));
  console.log(`\n已完成：整理 ${updatedEntries} 张记忆卡。`);
  if (backupPath) console.log(`备份：${backupPath}`);
  console.log(`报告：${reportPath}`);
}

function normalizeHardWraps(markdown: string) {
  const lines = markdown
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim());
  const fixes: JoinFix[] = [];
  let current = lines;

  for (let pass = 0; pass < 4; pass += 1) {
    const next: string[] = [];
    let changed = false;

    for (const rawLine of current) {
      const line = rawLine.trim();
      if (!line) {
        if (next.length && next[next.length - 1] !== "") next.push("");
        continue;
      }

      if (!next.length || next[next.length - 1] === "") {
        next.push(line);
        continue;
      }

      const previous = next[next.length - 1];
      if (shouldJoin(previous, line)) {
        const joined = joinLines(previous, line);
        fixes.push({ before: `${previous}\n${line}`, after: joined });
        next[next.length - 1] = joined;
        changed = true;
      } else {
        next.push(line);
      }
    }

    current = trimBlankEdges(next);
    if (!changed) break;
  }

  return {
    markdown: current.join("\n").replace(/\n{3,}/gu, "\n\n").trim(),
    fixes
  };
}

function shouldJoin(previous: string, next: string) {
  if (!previous || !next) return false;
  if (sectionHeadingOnly.test(previous)) return false;
  if (/^(?:对比辨析|ps\.|PS\.)/u.test(previous)) return false;
  if (sectionHeadingStart.test(next)) return false;
  if (wikiWordLine.test(previous) || wikiWordLine.test(next)) return false;
  if (markdownImageLine.test(previous)) return false;
  if (partOfSpeechLineEnd.test(previous) && cjk.test(next[0] ?? "")) return true;
  if (incompleteConnectorEnd.test(previous)) return true;
  if (logicalLineStart.test(next)) return false;
  if (terminalPunctuation.test(previous.trim())) return false;
  if (startsWithContinuationPunctuation.test(next.trim())) return true;
  return displayWidth(previous) >= 34;
}

function joinLines(previous: string, next: string) {
  const left = previous.trimEnd();
  const right = next.trimStart();
  if (!left) return right;
  if (!right) return left;

  const last = left[left.length - 1] ?? "";
  const first = right[0] ?? "";
  const needsSpace = !(cjk.test(last) && cjk.test(first)) && !startsWithContinuationPunctuation.test(right);
  return `${left}${needsSpace ? " " : ""}${right}`;
}

function displayWidth(value: string) {
  let width = 0;
  for (const char of value) width += cjk.test(char) ? 2 : 1;
  return width;
}

function trimBlankEdges(lines: string[]) {
  const next = [...lines];
  while (next[0] === "") next.shift();
  while (next[next.length - 1] === "") next.pop();
  return next;
}

function buildReport(
  totalEntries: number,
  changedPlans: Plan[],
  backupPath: string | null,
  status: CleanupReport["status"],
  updatedEntries = 0
): CleanupReport {
  const now = new Date().toISOString();
  return {
    version: 1,
    status,
    createdAt: now,
    updatedAt: now,
    applied: APPLY,
    totalEntries,
    candidateEntries: changedPlans.length,
    updatedEntries,
    backupPath,
    rules: [
      "只在结构节点换行：划分、带你背、词根词缀积累、例句、相关单词等标题单独成行。",
      "带你背正文按完整句/完整逻辑行组织；句内不手动硬断，交给界面自动换行。",
      "词性缩写后继续接释义时不换行，例如“表示 n.\\n废除”整理为“表示 n. 废除”。",
      "连接词或“采用”后不换行，例如“再\\n加上”“采用\\n词根词缀分析”。",
      "图片可以单独成行；图片 Markdown 后面的正文不会被粘到图片同一行。",
      "保留以句号、分号、冒号、问号、感叹号结束的自然段换行。",
      "合并视觉换行造成的句内断裂，例如“核\\n心”“接\\n触”“专\\n家”。"
    ],
    items: changedPlans.map((plan) => ({
      entryId: plan.entry.id,
      wordId: plan.entry.targetWord.id,
      word: plan.entry.targetWord.word,
      slug: plan.entry.targetWord.slug,
      levelTags: plan.entry.targetWord.levelTags,
      sourceType: plan.entry.sourceType,
      status: plan.entry.status,
      reason: "句内硬换行被合并为自然段内连续文本",
      fixCount: plan.fixes.length,
      fixes: plan.fixes,
      beforeMarkdown: plan.entry.contentMarkdown,
      afterMarkdown: plan.nextContentMarkdown
    }))
  };
}

async function writeBackup(plans: Plan[]) {
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const backupPath = path.join(backupDir, `mnemonic-line-wrap-cleanup-${stamp}.json`);
  await fs.writeFile(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        count: plans.length,
        action: backupAction,
        entries: plans.map((plan) => ({
          id: plan.entry.id,
          word: plan.entry.targetWord.word,
          slug: plan.entry.targetWord.slug,
          title: plan.entry.title,
          splitText: plan.entry.splitText,
          contentMarkdown: plan.entry.contentMarkdown,
          nextContentMarkdown: plan.nextContentMarkdown,
          fixes: plan.fixes
        }))
      },
      null,
      2
    )
  );
  return backupPath;
}

function oneLine(value: string) {
  return value.replace(/\s+/gu, " ").slice(0, 180);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
