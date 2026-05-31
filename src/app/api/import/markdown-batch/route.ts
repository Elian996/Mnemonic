import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApiRole } from "@/lib/api-auth";
import { extractMarkdownImportPayloads } from "@/lib/import-drafts/markdown-extraction";
import { normalizeAgentImportPayload } from "@/lib/import-drafts/normalize";
import { checkRateLimit, rateLimitResponse, requestRateLimitKey } from "@/lib/security/rate-limit";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/security/request-body";

export const runtime = "nodejs";
const MARKDOWN_IMPORT_BODY_LIMIT = 2 * 1024 * 1024;

type MarkdownImportRequest = {
  contentMarkdown?: string;
  filename?: string;
};

export async function POST(request: Request) {
  const rateLimit = checkRateLimit({
    key: requestRateLimitKey("api:import:markdown-batch", request.headers),
    limit: 20,
    windowMs: 10 * 60 * 1000
  });
  if (!rateLimit.allowed) return rateLimitResponse("Markdown 识别太频繁，请稍后再试。", rateLimit.retryAfterSeconds);

  const guard = await requireApiRole(UserRole.ADMIN, { hidden: true });
  if (guard.response) return guard.response;

  try {
    const body = await readJsonBody<MarkdownImportRequest>(request, MARKDOWN_IMPORT_BODY_LIMIT);
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
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Markdown 内容过大，请拆成多次导入。" }, { status: 413 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Markdown 批量导入失败" },
      { status: 400 }
    );
  }
}
