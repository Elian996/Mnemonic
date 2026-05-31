import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApiRole } from "@/lib/api-auth";
import { normalizeAgentImportPayload } from "@/lib/import-drafts/normalize";
import { AgentImportPayload } from "@/lib/import-drafts/types";
import { checkRateLimit, rateLimitResponse, requestRateLimitKey } from "@/lib/security/rate-limit";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/security/request-body";

const IMPORT_DRAFT_BODY_LIMIT = 1024 * 1024;

export async function POST(request: Request) {
  const rateLimit = checkRateLimit({
    key: requestRateLimitKey("api:import:drafts", request.headers),
    limit: 120,
    windowMs: 60 * 1000
  });
  if (!rateLimit.allowed) return rateLimitResponse("导入太频繁，请稍后再试。", rateLimit.retryAfterSeconds);

  const guard = await requireApiRole(UserRole.ADMIN, { hidden: true });
  if (guard.response) return guard.response;

  try {
    const payload = await readJsonBody<AgentImportPayload>(request, IMPORT_DRAFT_BODY_LIMIT);
    const normalized = await normalizeAgentImportPayload(payload);
    const draft = await prisma.importDraft.create({
      data: normalized
    });

    return NextResponse.json(
      {
        id: draft.id,
        status: draft.status,
        previewUrl: `/imports/${draft.id}`,
        word: draft.word
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "导入内容过大。" }, { status: 413 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid import payload" },
      { status: 400 }
    );
  }
}

export async function GET() {
  const guard = await requireApiRole(UserRole.ADMIN, { hidden: true });
  if (guard.response) return guard.response;

  const drafts = await prisma.importDraft.findMany({
    orderBy: { createdAt: "desc" },
    take: 50
  });
  return NextResponse.json({ drafts });
}
