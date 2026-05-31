import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { hasPhoneticEncodingArtifact, normalizePhonetic } from "@/lib/phonetics";

const apply = process.argv.includes("--apply");
const action = "WORD_PHONETIC_ARTIFACT_REPAIR";
const outputDir = path.join(process.cwd(), "tmp", "phonetic-artifact-repair");

const prisma = new PrismaClient();

type WordRecord = {
  id: string;
  word: string;
  slug: string;
  phoneticUk: string | null;
  phoneticUs: string | null;
};

type Plan = {
  id: string;
  word: string;
  slug: string;
  before: {
    phoneticUk: string | null;
    phoneticUs: string | null;
  };
  after: {
    phoneticUk: string | null;
    phoneticUs: string | null;
  };
};

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const allWords = await prisma.word.findMany({
    select: {
      id: true,
      word: true,
      slug: true,
      phoneticUk: true,
      phoneticUs: true
    },
    orderBy: { word: "asc" }
  });
  const words = allWords.filter((word) => hasPhoneticEncodingArtifact(word.phoneticUk) || hasPhoneticEncodingArtifact(word.phoneticUs));

  const plans = words.map(buildPlan).filter((plan): plan is Plan => Boolean(plan));
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const reportPath = path.join(outputDir, `phonetic-artifact-repair-${timestamp}.json`);

  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        status: apply ? "planned-apply" : "dry-run",
        generatedAt: new Date().toISOString(),
        candidateCount: words.length,
        updateCount: plans.length,
        plans
      },
      null,
      2
    )
  );

  console.log(`候选异常音标：${words.length}`);
  console.log(`计划更新：${plans.length}`);
  console.log(`报告：${reportPath}`);

  if (!apply || !plans.length) return;

  const actor = await prisma.user.findFirst({
    where: { role: "ADMIN", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true }
  });
  if (!actor) throw new Error("找不到 active admin，不能写入审计日志。");

  await prisma.$transaction(
    async (tx) => {
      for (const plan of plans) {
        await tx.word.update({
          where: { id: plan.id },
          data: plan.after
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action,
            entityType: "Word",
            entityId: plan.id,
            metadataJson: plan as unknown as Prisma.InputJsonValue
          }
        });
      }
    },
    { timeout: 60_000 }
  );

  const remainingWords = await prisma.word.findMany({
    select: { phoneticUk: true, phoneticUs: true }
  });
  const remaining = remainingWords.filter(
    (word) => hasPhoneticEncodingArtifact(word.phoneticUk) || hasPhoneticEncodingArtifact(word.phoneticUs)
  ).length;

  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        status: "complete",
        generatedAt: new Date().toISOString(),
        candidateCount: words.length,
        updateCount: plans.length,
        remainingArtifactCount: remaining,
        actorEmail: actor.email,
        plans
      },
      null,
      2
    )
  );

  console.log(`已更新：${plans.length}`);
  console.log(`剩余异常音标：${remaining}`);
}

function buildPlan(word: WordRecord): Plan | null {
  const phoneticUk = cleanNullablePhonetic(word.phoneticUk);
  const phoneticUs = cleanNullablePhonetic(word.phoneticUs);
  const before = {
    phoneticUk: word.phoneticUk,
    phoneticUs: word.phoneticUs
  };
  const after = {
    phoneticUk,
    phoneticUs
  };

  if (before.phoneticUk === after.phoneticUk && before.phoneticUs === after.phoneticUs) return null;
  if (!hasPhoneticEncodingArtifact(before.phoneticUk) && !hasPhoneticEncodingArtifact(before.phoneticUs)) return null;

  return {
    id: word.id,
    word: word.word,
    slug: word.slug,
    before,
    after
  };
}

function cleanNullablePhonetic(value: string | null) {
  if (value === null) return null;
  const next = normalizePhonetic(value);
  return next || null;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
