import fs from "node:fs/promises";
import path from "node:path";
import { type Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");
const ADMIN_EMAIL = process.env.MNEMONIC_CLEANUP_ACTOR_EMAIL ?? "maoshangjian2021@163.com";
const reportDir = path.join(process.cwd(), "tmp", "person-name-sense-cleanup");
const backupDir = path.join(process.cwd(), "tmp", "backups");
const reportPath = path.join(reportDir, "latest.json");
const action = "PERSON_NAME_SENSE_CLEANUP";

type WordRecord = {
  id: string;
  word: string;
  slug: string;
  partOfSpeech: string;
  meaningCn: string;
  shortMeaningCn: string;
};

type Plan = {
  word: WordRecord;
  removed: string[];
  next: {
    meaningCn: string;
    shortMeaningCn: string;
  };
};

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

  const words = await prisma.word.findMany({
    where: {
      OR: [
        { meaningCn: { contains: "人名" } },
        { meaningCn: { contains: "姓氏" } },
        { meaningCn: { contains: "男子名" } },
        { meaningCn: { contains: "女子名" } },
        { shortMeaningCn: { contains: "人名" } },
        { shortMeaningCn: { contains: "姓氏" } },
        { shortMeaningCn: { contains: "男子名" } },
        { shortMeaningCn: { contains: "女子名" } }
      ]
    },
    select: { id: true, word: true, slug: true, partOfSpeech: true, meaningCn: true, shortMeaningCn: true },
    orderBy: { word: "asc" }
  });

  const plans = words
    .map(buildPlan)
    .filter((plan): plan is Plan => Boolean(plan));

  const backupPath = APPLY && plans.length ? await writeBackup(plans) : null;
  await writeReport({ plans, backupPath, status: APPLY ? "planned" : "dry-run" });

  console.log(`模式：${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor.username} <${actor.email}>`);
  console.log(`扫描含人名提示的单词：${words.length}`);
  console.log(`待清理：${plans.length}`);
  for (const plan of plans.slice(0, 40)) {
    console.log(`- ${plan.word.word}: 移除 ${plan.removed.join(" | ")} -> ${plan.next.meaningCn}`);
  }
  if (plans.length > 40) console.log(`... 另有 ${plans.length - 40} 个`);

  if (!APPLY) return;

  let updated = 0;
  for (const plan of plans) {
    await prisma.$transaction(async (tx) => {
      await tx.word.update({
        where: { id: plan.word.id },
        data: plan.next
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action,
          entityType: "Word",
          entityId: plan.word.id,
          metadataJson: {
            word: plan.word.word,
            removed: plan.removed,
            before: {
              meaningCn: plan.word.meaningCn,
              shortMeaningCn: plan.word.shortMeaningCn
            },
            after: plan.next
          } satisfies Prisma.InputJsonValue
        }
      });
    });
    updated += 1;
  }

  await writeReport({ plans, backupPath, status: "complete", updated });
  console.log(`\n已完成：清理 ${updated} 个单词里夹带的人名义项。`);
  if (backupPath) console.log(`备份：${backupPath}`);
  console.log(`报告：${reportPath}`);
}

function buildPlan(word: WordRecord) {
  const { prefix, body } = splitPrefix(word.meaningCn);
  const pieces = splitTopLevelSemicolons(body)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const kept: string[] = [];
  const removed: string[] = [];

  for (const piece of pieces) {
    if (isHumanNameSense(piece)) removed.push(piece);
    else kept.push(piece);
  }

  if (!removed.length || !kept.length) return null;
  const meaningCn = `${prefix}${kept.join("；")}`.trim();
  const shortMeaningCn = kept.slice(0, 2).join("；") || word.shortMeaningCn;
  if (meaningCn === word.meaningCn && shortMeaningCn === word.shortMeaningCn) return null;
  return { word, removed, next: { meaningCn, shortMeaningCn } };
}

function splitPrefix(value: string) {
  const match = value.match(/^((?:n|v|adj|adv|prep|conj|pron|num|art|int|interj|abbr|aux|det|modal)\.\s+)(.*)$/iu);
  if (!match) return { prefix: "", body: value.trim() };
  return { prefix: match[1], body: match[2].trim() };
}

function splitTopLevelSemicolons(value: string) {
  const pieces: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of value) {
    if (char === "（" || char === "(") depth += 1;
    if ((char === "）" || char === ")") && depth > 0) depth -= 1;
    if (char === "；" && depth === 0) {
      pieces.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  pieces.push(current);
  return pieces;
}

function isHumanNameSense(piece: string) {
  if (/^人名(?:[；;，,、\s]|$)/u.test(piece)) return true;
  if (/（[^）]*(?:人名|男子名|女子名|姓氏)[^）]*）/u.test(piece)) return true;
  if (/\([^)]*(?:人名|男子名|女子名|姓氏)[^)]*\)/u.test(piece)) return true;
  return false;
}

async function writeBackup(plans: Plan[]) {
  const backupPath = path.join(
    backupDir,
    `person-name-sense-cleanup-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`
  );
  await fs.writeFile(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        action,
        count: plans.length,
        words: plans.map((plan) => ({
          id: plan.word.id,
          word: plan.word.word,
          slug: plan.word.slug,
          before: {
            meaningCn: plan.word.meaningCn,
            shortMeaningCn: plan.word.shortMeaningCn
          },
          after: plan.next,
          removed: plan.removed
        }))
      },
      null,
      2
    )
  );
  return backupPath;
}

async function writeReport({
  plans,
  backupPath,
  status,
  updated = 0
}: {
  plans: Plan[];
  backupPath: string | null;
  status: "dry-run" | "planned" | "complete";
  updated?: number;
}) {
  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        version: 1,
        status,
        applied: APPLY,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        plannedUpdates: plans.length,
        updatedWords: updated,
        backupPath,
        rules: [
          "只在同一释义中还有非人名义项可保留时，移除人名/姓氏/男子名/女子名义项。",
          "人名是唯一释义的词不硬改，避免写成空释义。"
        ],
        items: plans.map((plan) => ({
          id: plan.word.id,
          word: plan.word.word,
          slug: plan.word.slug,
          removed: plan.removed,
          before: {
            meaningCn: plan.word.meaningCn,
            shortMeaningCn: plan.word.shortMeaningCn
          },
          after: plan.next
        }))
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
