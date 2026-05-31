import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { hasRole } from "@/lib/permissions";
import { repositoryWordPackExcludeActionForScope } from "@/lib/repository-word-pack";
import { recordRepositoryPackExclusions } from "@/lib/repository-pack-exclusions";
import { checkRateLimit, rateLimitResponse, requestRateLimitKey } from "@/lib/security/rate-limit";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/security/request-body";

export async function POST(request: Request) {
  const rateLimit = checkRateLimit({
    key: requestRateLimitKey("api:repository:word-pack-exclusions", request.headers),
    limit: 60,
    windowMs: 60 * 1000
  });
  if (!rateLimit.allowed) return rateLimitResponse("词包操作太频繁，请稍后再试。", rateLimit.retryAfterSeconds);

  const body = await readBody(request);
  if (body instanceof NextResponse) return body;
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

async function readBody(request: Request) {
  try {
    return await readJsonBody(request, 256 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "词包操作内容过大。" }, { status: 413 });
    }
    return null;
  }
}
