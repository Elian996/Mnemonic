import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { repositoryReviewPassActionForScope } from "@/lib/repository-review";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
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
