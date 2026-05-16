import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApiRole } from "@/lib/api-auth";
import { extractMarkdownImportPayloads } from "@/lib/import-drafts/markdown-extraction";
import { normalizeAgentImportPayload } from "@/lib/import-drafts/normalize";

export const runtime = "nodejs";

type MarkdownImportRequest = {
  contentMarkdown?: string;
  filename?: string;
};

export async function POST(request: Request) {
  const guard = await requireApiRole(UserRole.ADMIN, { hidden: true });
  if (guard.response) return guard.response;

  try {
    const body = (await request.json()) as MarkdownImportRequest;
    const contentMarkdown = String(body.contentMarkdown || "").trim();
    if (!contentMarkdown) {
      return NextResponse.json({ error: "请粘贴 Markdown 内容，或选择 .md/.txt 文件。" }, { status: 400 });
    }

    const payloads = await extractMarkdownImportPayloads({
      markdown: contentMarkdown,
      filename: body.filename,
      apiKey: request.headers.get("x-mnemonic-ai-key")?.trim() || undefined,
      baseUrl: request.headers.get("x-mnemonic-ai-base-url")?.trim() || undefined,
      model: request.headers.get("x-mnemonic-ai-model")?.trim() || undefined
    });
    if (!payloads.length) {
      return NextResponse.json({ error: "AI 没有识别到可导入的单词卡片，请检查格式后重试。" }, { status: 400 });
    }

    const normalized = await Promise.all(payloads.map((payload) => normalizeAgentImportPayload(payload)));
    const drafts = await prisma.$transaction(normalized.map((draft) => prisma.importDraft.create({ data: draft })));

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
      { error: error instanceof Error ? error.message : "Markdown 批量导入失败" },
      { status: 400 }
    );
  }
}
