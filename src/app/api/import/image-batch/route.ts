import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApiRole } from "@/lib/api-auth";
import { extractBatchImageImportPayloads } from "@/lib/import-drafts/image-extraction";
import { normalizeAgentImportPayload } from "@/lib/import-drafts/normalize";
import { checkRateLimit, rateLimitResponse, requestRateLimitKey } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
const MAX_IMPORT_IMAGE_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  const rateLimit = checkRateLimit({
    key: requestRateLimitKey("api:import:image-batch", request.headers),
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
    const payloads = await extractBatchImageImportPayloads({
      imageBytes,
      filename: file.name || "memory-cards.png",
      mimeType: file.type || "image/png",
      apiKey: request.headers.get("x-mnemonic-ai-key")?.trim() || undefined,
      baseUrl: request.headers.get("x-mnemonic-ai-base-url")?.trim() || undefined,
      model: request.headers.get("x-mnemonic-ai-model")?.trim() || undefined
    });
    if (!payloads.length) {
      return NextResponse.json({ error: "没有识别到可导入的单词卡片，请换一张更清晰的截图。" }, { status: 400 });
    }

    const normalized = await Promise.all(payloads.map((payload) => normalizeAgentImportPayload(payload)));
    const drafts = await prisma.$transaction(
      normalized.map((draft) => prisma.importDraft.create({ data: draft }))
    );

    return NextResponse.json(
      {
        count: drafts.length,
        drafts: drafts.map((draft) => ({
          id: draft.id,
          word: draft.word,
          previewUrl: `/imports/${draft.id}`
        }))
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "批量图片导入失败" },
      { status: 400 }
    );
  }
}

function requestBodyTooLarge(request: Request, maxBytes: number) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
}
