import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { hasRole } from "@/lib/permissions";
import { repositoryWordPackExcludeActionForScope } from "@/lib/repository-word-pack";
import { recordRepositoryPackExclusions } from "@/lib/repository-pack-exclusions";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const packScope = typeof body === "object" && body ? String((body as { packScope?: unknown }).packScope ?? "").trim() : "";
  const rawWordIds = typeof body === "object" && body ? (body as { wordIds?: unknown }).wordIds : null;
  const wordIds = Array.isArray(rawWordIds) ? rawWordIds.map((value) => String(value)) : [];

  if (!wordIds.length || !repositoryWordPackExcludeActionForScope(packScope)) {
    return NextResponse.json({ error: "词包移出参数不完整。" }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!hasRole(user, UserRole.ADMIN)) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 403 });
  }

  const result = await recordRepositoryPackExclusions({
    actorId: user!.id,
    wordIds,
    packScope
  });

  return NextResponse.json(
    {
      ok: true,
      packScope,
      removedCount: result.removedCount,
      removedWordIds: result.removedWordIds
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
