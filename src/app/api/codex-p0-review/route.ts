import { NextResponse } from "next/server";
import { MnemonicSourceType, MnemonicStatus, Prisma, UserRole } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import {
  codexP0ManualRestoreAction,
  codexP0RepairMarker,
  codexP0ReviewAuditAction,
  metadataHasCodexP0RepairMarker
} from "@/lib/codex-p0-repair";
import { prisma } from "@/lib/db";
import { updateMnemonicLogicAuditFixedWordIds } from "@/lib/mnemonic-logic-audit-report";
import { hasRole } from "@/lib/permissions";

const maxChanges = 1000;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const wordIds = parseWordIds(body);
  const approved = typeof body === "object" && body !== null ? Boolean((body as { approved?: unknown }).approved) : false;

  if (!wordIds.length) {
    return NextResponse.json({ error: "没有可审核的单词。" }, { status: 400 });
  }
  if (wordIds.length > maxChanges) {
    return NextResponse.json({ error: "一次批量审核的单词过多。" }, { status: 413 });
  }

  const user = await getSessionUser();
  if (!hasRole(user, UserRole.EDITOR)) {
    return NextResponse.json({ error: "需要编辑权限。" }, { status: 403 });
  }

  const reviewableWordIds = await getReviewableCodexP0WordIds();
  const validWordIds = wordIds.filter((wordId) => reviewableWordIds.has(wordId));
  if (!validWordIds.length) {
    return NextResponse.json({ error: "这些单词不属于当前 Codex P0 人工审核范围。" }, { status: 400 });
  }

  const update = await updateMnemonicLogicAuditFixedWordIds(validWordIds, approved);
  await prisma.auditLog.create({
    data: {
      actorId: user!.id,
      action: codexP0ReviewAuditAction,
      entityType: "MnemonicLogicAuditReport",
      entityId: "latest",
      metadataJson: {
        marker: codexP0RepairMarker,
        approved,
        requestedWordIds: wordIds,
        appliedWordIds: validWordIds,
        changedWordIds: update.changedWordIds
      } satisfies Prisma.InputJsonObject
    }
  });

  return NextResponse.json(
    {
      ok: true,
      approved,
      wordIds: validWordIds,
      changedWordIds: update.changedWordIds,
      fixedWordIds: update.fixedWordIds
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

function parseWordIds(body: unknown) {
  if (!body || typeof body !== "object") return [];
  const rawWordIds = (body as { wordIds?: unknown }).wordIds;
  if (!Array.isArray(rawWordIds)) return [];
  return Array.from(
    new Set(rawWordIds.map((wordId) => (typeof wordId === "string" ? wordId.trim() : "")).filter(Boolean))
  );
}

async function getReviewableCodexP0WordIds() {
  const [entries, emptyLogs, manualRestoreLogs] = await Promise.all([
    prisma.mnemonicEntry.findMany({
      where: {
        sourceType: MnemonicSourceType.OFFICIAL,
        status: { not: MnemonicStatus.ARCHIVED },
        editorNote: { contains: codexP0RepairMarker }
      },
      select: { targetWordId: true }
    }),
    prisma.auditLog.findMany({
      where: { action: "CODEX_P0_SOURCE_EMPTY" },
      select: { entityId: true, metadataJson: true }
    }),
    prisma.auditLog.findMany({
      where: { action: codexP0ManualRestoreAction },
      select: { entityId: true }
    })
  ]);
  const manuallyRestoredWordIds = new Set(manualRestoreLogs.map((log) => log.entityId));
  const reviewableWordIds = new Set(entries.map((entry) => entry.targetWordId));

  for (const log of emptyLogs) {
    if (!metadataHasCodexP0RepairMarker(log.metadataJson)) continue;
    if (manuallyRestoredWordIds.has(log.entityId)) continue;
    reviewableWordIds.add(log.entityId);
  }

  return reviewableWordIds;
}
