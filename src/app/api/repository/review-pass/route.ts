import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { repositoryReviewPassActionForScope } from "@/lib/repository-review";
import { checkRateLimit, rateLimitResponse, requestRateLimitKey } from "@/lib/security/rate-limit";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/security/request-body";

export async function POST(request: Request) {
  const rateLimit = checkRateLimit({
    key: requestRateLimitKey("api:repository:review-pass", request.headers),
    limit: 120,
    windowMs: 60 * 1000
  });
  if (!rateLimit.allowed) return rateLimitResponse("标记太频繁，请稍后再试。", rateLimit.retryAfterSeconds);

  const body = await readBody(request);
  if (body instanceof NextResponse) return body;
  const wordId = typeof body === "object" && body ? String((body as { wordId?: unknown }).wordId ?? "").trim() : "";
  const scope = typeof body === "object" && body ? String((body as { scope?: unknown }).scope ?? "").trim() : "";
  const passed = typeof body === "object" && body ? Boolean((body as { passed?: unknown }).passed) : false;
  const action = repositoryReviewPassActionForScope(scope);

  if (!wordId || !action) {
    return NextResponse.json({ error: "标记参数不完整。" }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!hasRole(user, UserRole.EDITOR)) {
    return NextResponse.json({ error: "需要编辑权限。" }, { status: 403 });
  }

  const word = await prisma.word.findUnique({
    where: { id: wordId },
    select: { id: true, word: true }
  });
  if (!word) {
    return NextResponse.json({ error: "单词不存在。" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.deleteMany({
      where: {
        actorId: user!.id,
        action,
        entityType: "Word",
        entityId: wordId
      }
    });

    if (passed) {
      await tx.auditLog.create({
        data: {
          actorId: user!.id,
          action,
          entityType: "Word",
          entityId: wordId,
          metadataJson: {
            scope,
            word: word.word,
            marker: "repository-review-pass"
          }
        }
      });
    }
  });

  return NextResponse.json(
    { ok: true, wordId, passed },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

async function readBody(request: Request) {
  try {
    return await readJsonBody(request, 32 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "标记内容过大。" }, { status: 413 });
    }
    return null;
  }
}
