import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { saveMnemonicLogicAuditFixedWordIds } from "@/lib/mnemonic-logic-audit-report";
import { hasRole } from "@/lib/permissions";
import { repairProgressWorkloadAuditAction } from "@/lib/repository-workload";
import { checkRateLimit, rateLimitResponse, requestRateLimitKey } from "@/lib/security/rate-limit";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/security/request-body";

const maxRepairProgressWords = 10000;

export async function POST(request: Request) {
  const rateLimit = checkRateLimit({
    key: requestRateLimitKey("api:mnemonic-logic-audit:repair-progress", request.headers),
    limit: 30,
    windowMs: 60 * 1000
  });
  if (!rateLimit.allowed) return rateLimitResponse("保存太频繁，请稍后再试。", rateLimit.retryAfterSeconds);

  const body = await readBody(request);
  if (body instanceof NextResponse) return body;
  const fixedWordIds = parseWordIds(body, "fixedWordIds");
  const scopedWordIds = parseWordIds(body, "scopedWordIds");

  if (fixedWordIds.length > maxRepairProgressWords || scopedWordIds.length > maxRepairProgressWords) {
    return NextResponse.json({ error: "一次保存的审计标记过多。" }, { status: 413 });
  }

  const user = await getSessionUser();
  if (!hasRole(user, UserRole.EDITOR)) {
    return NextResponse.json({ error: "需要编辑权限。" }, { status: 403 });
  }

  const update = await saveMnemonicLogicAuditFixedWordIds(fixedWordIds, scopedWordIds);
  if (update.changedWordIds.length) {
    await prisma.auditLog.create({
      data: {
        actorId: user!.id,
        action: repairProgressWorkloadAuditAction,
        entityType: "MnemonicLogicAuditReport",
        entityId: "latest",
        metadataJson: {
          changedWordIds: update.changedWordIds,
          fixedCount: update.fixedWordIds.length,
          scopedCount: scopedWordIds.length
        }
      }
    });
  }

  return NextResponse.json(
    {
      ok: true,
      changedWordIds: update.changedWordIds,
      fixedWordIds: update.fixedWordIds,
      updatedAt: update.report.updatedAt
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

async function readBody(request: Request) {
  try {
    return await readJsonBody(request, 1024 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "审计标记内容过大。" }, { status: 413 });
    }
    return null;
  }
}

function parseWordIds(body: unknown, key: "fixedWordIds" | "scopedWordIds") {
  if (!body || typeof body !== "object") return [];
  const rawWordIds = (body as { fixedWordIds?: unknown; scopedWordIds?: unknown })[key];
  if (!Array.isArray(rawWordIds)) return [];

  return Array.from(
    new Set(
      rawWordIds
        .map((wordId) => (typeof wordId === "string" ? wordId.trim() : ""))
        .filter(Boolean)
    )
  );
}
