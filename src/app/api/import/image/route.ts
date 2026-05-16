import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApiRole } from "@/lib/api-auth";
import { normalizeAgentImportPayload } from "@/lib/import-drafts/normalize";
import { extractImageImportPayload } from "@/lib/import-drafts/image-extraction";

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
