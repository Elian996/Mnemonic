import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApiRole } from "@/lib/api-auth";
import { extractBatchImageImportPayloads } from "@/lib/import-drafts/image-extraction";
import { normalizeAgentImportPayload } from "@/lib/import-drafts/normalize";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const guard = await requireApiRole(UserRole.ADMIN, { hidden: true });
  if (guard.response) return guard.response;

  try {
    const formData = await request.formData();
    const file = formData.get("image");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传图片文件" }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "文件必须是图片" }, { status: 400 });
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
