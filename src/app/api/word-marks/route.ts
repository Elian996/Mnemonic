import { NextResponse } from "next/server";
import { WordMarkState } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { persistWordMarkStates } from "@/lib/services/word-mark-service";

const validStates = new Set<string>(Object.values(WordMarkState));
const MAX_CHANGES = 1000;

type WordMarkChange = [string, WordMarkState | null];

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const changes = parseChanges(body);
  if (!changes.length) {
    return NextResponse.json({ error: "Invalid word mark." }, { status: 400 });
  }
  if (changes.length > MAX_CHANGES) {
    return NextResponse.json({ error: "一次保存的单词标记过多。" }, { status: 413 });
  }

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }
  await persistWordMarkStates(user.id, changes);

  return NextResponse.json(
    {
      ok: true,
      changes: changes.map(([wordId, state]) => ({
        wordId,
        markState: state,
        isBookmarked: state === WordMarkState.UNKNOWN
      })),
      markState: changes.length === 1 ? changes[0][1] : undefined,
      isBookmarked: changes.length === 1 ? changes[0][1] === WordMarkState.UNKNOWN : undefined
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

function parseChanges(body: unknown): WordMarkChange[] {
  if (!body || typeof body !== "object") return [];

  const rawChanges = "changes" in body ? (body as { changes?: unknown }).changes : undefined;
  if (Array.isArray(rawChanges)) {
    return rawChanges.flatMap((item) => {
      const wordId = typeof item?.wordId === "string" ? item.wordId.trim() : "";
      const state = parseState(item?.state);
      return wordId && state !== undefined ? ([[wordId, state]] satisfies WordMarkChange[]) : [];
    });
  }

  const wordId = typeof (body as { wordId?: unknown }).wordId === "string" ? (body as { wordId: string }).wordId.trim() : "";
  const state = parseState((body as { state?: unknown }).state);
  return wordId && state !== undefined ? [[wordId, state]] : [];
}

function parseState(value: unknown) {
  if (value === null) return null;
  return typeof value === "string" && validStates.has(value) ? (value as WordMarkState) : undefined;
}
