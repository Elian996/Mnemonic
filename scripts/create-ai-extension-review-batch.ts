import fs from "node:fs/promises";
import path from "node:path";
import { ImportDraftStatus, Prisma, UserRole } from "@prisma/client";
import {
  aiExtensionDraftSource,
  candidateToDraftPayload,
  getAiExtensionBatchCandidates
} from "../src/lib/ai-extension-route-fill";
import { prisma } from "../src/lib/db";

const apply = process.argv.includes("--apply");
const limit = numberArg("--limit");
const minConfidence = numberArg("--min-confidence") ?? 0.85;
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(process.cwd(), "tmp", "ai-extension-route-fill");

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const [beforeDrafts, activeAdmin] = await Promise.all([
    prisma.importDraft.findMany({
      where: { source: aiExtensionDraftSource },
      orderBy: [{ createdAt: "desc" }]
    }),
    prisma.user.findFirst({
      where: { role: UserRole.ADMIN, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true }
    })
  ]);
  if (apply && !activeAdmin) throw new Error("找不到 active admin，不能写入 AI 延伸待审审计日志。");

  const beforeSnapshotPath = path.join(outputDir, `import-drafts-before-${timestamp}.json`);
  await fs.writeFile(beforeSnapshotPath, JSON.stringify(beforeDrafts, null, 2));

  const candidates = await getAiExtensionBatchCandidates({
    limit,
    minConfidence,
    skipExistingDrafts: true
  });
  const plan = {
    createdAt: new Date().toISOString(),
    apply,
    minConfidence,
    limit: limit ?? null,
    candidateCount: candidates.length,
    beforeDraftCount: beforeDrafts.length,
    candidates: candidates.map((candidate) => ({
      baseWordId: candidate.baseWordId,
      baseWord: candidate.baseWord,
      targetWordId: candidate.targetWordId,
      targetWord: candidate.targetWord,
      targetMeaning: candidate.targetMeaning,
      routeType: candidate.routeType,
      ruleKey: candidate.ruleKey,
      ruleLabel: candidate.ruleLabel,
      confidence: candidate.confidence,
      splitText: candidate.splitText,
      explanation: candidate.explanation
    }))
  };
  const planPath = path.join(outputDir, `plan-${apply ? "apply" : "dry-run"}-${timestamp}.json`);
  await fs.writeFile(planPath, JSON.stringify(plan, null, 2));

  let created = 0;
  if (apply && candidates.length) {
    const adminId = activeAdmin?.id;
    if (!adminId) throw new Error("找不到 active admin，不能写入 AI 延伸待审审计日志。");
    await prisma.$transaction(
      async (tx) => {
        for (const chunk of chunks(candidates, 400)) {
          await tx.importDraft.createMany({
            data: chunk.map((candidate) => ({
              source: aiExtensionDraftSource,
              status: ImportDraftStatus.DRAFT,
              word: candidate.targetWord,
              meaningCn: candidate.targetMeaning,
              shortMeaningCn: candidate.targetMeaning,
              splitText: candidate.splitText,
              title: `${candidate.targetWord} AI 延伸记忆卡`,
              contentMarkdown: candidate.contentMarkdown,
              rawText: candidate.explanation,
              agentPayload: candidateToDraftPayload(candidate) satisfies Prisma.InputJsonValue
            }))
          });
          await tx.auditLog.createMany({
            data: chunk.map((candidate) => ({
              actorId: adminId,
              action: "AI_EXTENSION_ROUTE_FILL_BATCH_DRAFT_CREATE",
              entityType: "Word",
              entityId: candidate.targetWordId,
              metadataJson: {
                baseWordId: candidate.baseWordId,
                baseWord: candidate.baseWord,
                targetWord: candidate.targetWord,
                ruleKey: candidate.ruleKey,
                confidence: candidate.confidence
              } satisfies Prisma.InputJsonObject
            }))
          });
          created += chunk.length;
        }
      },
      { timeout: 60_000 }
    );
  }

  console.log(`模式：${apply ? "apply" : "dry-run"}`);
  console.log(`候选数：${candidates.length}`);
  console.log(`写入待审：${created}`);
  console.log(`已有 AI 延伸草稿快照：${beforeSnapshotPath}`);
  console.log(`计划文件：${planPath}`);
  console.log("前 20 个候选：");
  for (const candidate of candidates.slice(0, 20)) {
    console.log(`- ${candidate.baseWord} -> ${candidate.targetWord} (${candidate.ruleLabel}, ${Math.round(candidate.confidence * 100)}%)`);
  }
}

function numberArg(name: string) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  const value = inline ? inline.slice(prefix.length) : process.argv[process.argv.indexOf(name) + 1];
  if (!value || value === name) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
