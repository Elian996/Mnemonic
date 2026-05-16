import fs from "node:fs/promises";
import path from "node:path";
import { MnemonicStatus, type Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { markdownToPlainText, renderMnemonicMarkdown } from "../src/lib/wiki-links/renderer";
import { syncEntryWikiLinks } from "../src/lib/wiki-links/resolve";

const APPLY = process.argv.includes("--apply");
const ADMIN_EMAIL = process.env.MNEMONIC_CLEANUP_ACTOR_EMAIL ?? "maoshangjian2021@163.com";

type Repair = {
  splitText: string | null;
  contentMarkdown: string;
  reason: string;
};

const REPAIRS: Record<string, Repair> = {
  abstinent: {
    splitText: "ab- | stin | -ent",
    reason: "清理正文里的旧划分行和全角竖线",
    contentMarkdown: [
      "带你背：",
      "abstain 表示自制、戒绝；-ent 是形容词/名词后缀。能克制欲望、戒绝某事的人或状态，就是 abstinent，即 adj.有节制的；禁欲的，也可作 n.禁欲者。",
      "",
      "相关单词：",
      "[[word:abstain]]"
    ].join("\n")
  },
  poultry: {
    splitText: null,
    reason: "重写只剩残片的空壳卡",
    contentMarkdown: ["带你背：", "poultry 和农场里饲养的鸡、鸭、鹅等动物绑定记忆。把这些供食用或产蛋的家禽作为一类整体来记，就是 poultry，表示 n.家禽。"].join("\n")
  }
};

async function main() {
  const actor =
    (await prisma.user.findFirst({
      where: { email: ADMIN_EMAIL, status: "ACTIVE" },
      select: { id: true, email: true, username: true }
    })) ??
    (await prisma.user.findFirst({
      where: { status: "ACTIVE" },
      orderBy: [{ createdAt: "asc" }],
      select: { id: true, email: true, username: true }
    }));
  if (!actor) throw new Error("找不到可用于批量更新的账号。");

  const entries = await prisma.mnemonicEntry.findMany({
    where: {
      status: { not: MnemonicStatus.ARCHIVED },
      targetWord: { slug: { in: Object.keys(REPAIRS) } }
    },
    select: {
      id: true,
      title: true,
      splitText: true,
      contentMarkdown: true,
      targetWord: { select: { word: true, slug: true } }
    },
    orderBy: [{ targetWord: { word: "asc" } }]
  });

  const plans = entries
    .map((entry) => {
      const repair = REPAIRS[entry.targetWord.slug];
      if (!repair) return null;
      if (entry.contentMarkdown === repair.contentMarkdown && (entry.splitText ?? null) === repair.splitText) return null;
      return { entry, repair };
    })
    .filter((plan): plan is { entry: (typeof entries)[number]; repair: Repair } => Boolean(plan));

  console.log(`模式：${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor.username} <${actor.email}>`);
  console.log(`将清理：${plans.length} 张`);
  for (const plan of plans) console.log(`- ${plan.entry.targetWord.word}: ${plan.repair.reason}`);
  if (!APPLY) return;

  const backupPath = await writeBackup(plans);
  console.log(`备份：${backupPath}`);

  let updated = 0;
  for (const plan of plans) {
    const contentHtml = await renderMnemonicMarkdown(plan.repair.contentMarkdown);
    const plainText = markdownToPlainText(
      [plan.repair.splitText ? `划分：${plan.repair.splitText}` : "", plan.repair.contentMarkdown].filter(Boolean).join("\n\n")
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
          splitText: plan.repair.splitText,
          contentMarkdown: plan.repair.contentMarkdown,
          contentHtml,
          plainText
        }
      });
      await syncEntryWikiLinks(plan.entry.id, actor.id, tx as Prisma.TransactionClient);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "MNEMONIC_FINAL_AUDIT_CARD_CLEANUP",
          entityType: "MnemonicEntry",
          entityId: plan.entry.id,
          metadataJson: {
            word: plan.entry.targetWord.word,
            reason: plan.repair.reason
          }
        }
      });
    });
    updated += 1;
  }

  console.log(`已完成：清理 ${updated} 张。`);
}

async function writeBackup(plans: { entry: { id: string; title: string; splitText: string | null; contentMarkdown: string; targetWord: { word: string } }; repair: Repair }[]) {
  const backupDir = path.join(process.cwd(), "tmp", "backups");
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const backupPath = path.join(backupDir, `mnemonic-final-audit-cards-${stamp}.json`);
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
          nextSplitText: plan.repair.splitText,
          nextContentMarkdown: plan.repair.contentMarkdown,
          reason: plan.repair.reason
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
