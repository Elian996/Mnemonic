import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApiRole } from "@/lib/api-auth";
import { normalizeAgentImportPayload } from "@/lib/import-drafts/normalize";
import { extractImageImportPayload } from "@/lib/import-drafts/image-extraction";
import { checkRateLimit, rateLimitResponse, requestRateLimitKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
const MAX_IMPORT_IMAGE_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  const rateLimit = checkRateLimit({
    key: requestRateLimitKey("api:import:image", request.headers),
    limit: 20,
    windowMs: 10 * 60 * 1000
  });
  if (!rateLimit.allowed) return rateLimitResponse("图片识别太频繁，请稍后再试。", rateLimit.retryAfterSeconds);

  const guard = await requireApiRole(UserRole.ADMIN, { hidden: true });
  if (guard.response) return guard.response;

  try {
    if (requestBodyTooLarge(request, MAX_IMPORT_IMAGE_BYTES + 1024 * 1024)) {
      return NextResponse.json({ error: "图片太大，请控制在 12MB 以内。" }, { status: 413 });
    }
    const formData = await request.formData();
    const file = formData.get("image");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传图片文件" }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "文件必须是图片" }, { status: 400 });
    }
    if (file.size > MAX_IMPORT_IMAGE_BYTES) {
      return NextResponse.json({ error: "图片太大，请控制在 12MB 以内。" }, { status: 413 });
    }

    const imageBytes = Buffer.from(await file.arrayBuffer());
    const payload = await extractImageImportPayload({
      imageBytes,
      filename: file.name || "memory-card.png",
      mimeType: file.type || "image/png",
      apiKey: request.headers.get("x-mnemonic-ai-key")?.trim() || undefined,
      baseUrl: request.headers.get("x-mnemonic-ai-base-url")?.trim() || undefined,
      model: request.headers.get("x-mnemonic-ai-model")?.trim() || undefined
    });
    const normalized = await normalizeAgentImportPayload(payload);
    const draft = await prisma.importDraft.create({ data: normalized });

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "图片导入失败" },
      { status: 400 }
    );
  }
}

function requestBodyTooLarge(request: Request, maxBytes: number) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
}
