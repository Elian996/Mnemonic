import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { requireApiRole } from "@/lib/api-auth";
import { getWordAutofill } from "@/lib/word-autofill";

export async function GET(request: Request) {
  const guard = await requireApiRole(UserRole.EDITOR);
  if (guard.response) return guard.response;

  const url = new URL(request.url);
  const word = url.searchParams.get("word") ?? "";
  const mode = url.searchParams.get("mode") ?? "fallback";
  const headerApiKey = request.headers.get("x-mnemonic-ai-key")?.trim() || undefined;
  const headerBaseUrl = request.headers.get("x-mnemonic-ai-base-url")?.trim() || undefined;
  const headerModel = request.headers.get("x-mnemonic-ai-model")?.trim() || undefined;
  try {
    const result = await getWordAutofill(word, {
      apiKey: headerApiKey,
      baseUrl: headerBaseUrl,
      model: headerModel,
      requireAi: mode === "ai"
    });
    return NextResponse.json({
      result,
      aiConfigured: Boolean(headerApiKey || process.env.AI_AUTOFILL_API_KEY || process.env.AI_AGENT_API_KEY || process.env.OPENAI_API_KEY)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 自动填写失败";
    return NextResponse.json(
      { result: null, error: message },
      { status: message.includes("未配置 AI") ? 400 : 502 }
    );
  }
}
