import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { WordMarkState } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const validMarkStates = new Set<string>(Object.values(WordMarkState));
const MAX_ITEMS = 5000;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    marks?: Record<string, unknown>;
    bookmarkedWordIds?: unknown[];
  };
  const marks = parseMarks(body.marks);
  const bookmarkedWordIds = parseWordIds(body.bookmarkedWordIds);

  if (marks.length > MAX_ITEMS || bookmarkedWordIds.length > MAX_ITEMS) {
    return NextResponse.json({ error: "同步数量过多。" }, { status: 413 });
  }
  const requestedWordIds = Array.from(new Set([...marks.map(([wordId]) => wordId), ...bookmarkedWordIds]));
  const existingWordIds = new Set(
    (
      await prisma.word.findMany({
        where: { id: { in: requestedWordIds } },
        select: { id: true }
      })
    ).map((word) => word.id)
  );
  const validMarks = marks.filter(([wordId]) => existingWordIds.has(wordId));
  const validBookmarkedWordIds = bookmarkedWordIds.filter((wordId) => existingWordIds.has(wordId));

  await prisma.$transaction(async (tx) => {
    for (const [wordId, state] of validMarks) {
      await tx.wordMark.upsert({
        where: { userId_wordId: { userId: user.id, wordId } },
        update: { state },
        create: { userId: user.id, wordId, state }
      });
      if (state === WordMarkState.UNKNOWN) {
        const existing = await tx.bookmark.findFirst({
          where: { userId: user.id, wordId, mnemonicEntryId: null },
          select: { id: true }
        });
        if (!existing) {
          await tx.bookmark.create({ data: { userId: user.id, wordId } });
        }
      } else {
        await tx.bookmark.deleteMany({ where: { userId: user.id, wordId, mnemonicEntryId: null } });
      }
    }

    for (const wordId of validBookmarkedWordIds) {
      await tx.wordMark.upsert({
        where: { userId_wordId: { userId: user.id, wordId } },
        update: { state: WordMarkState.UNKNOWN },
        create: { userId: user.id, wordId, state: WordMarkState.UNKNOWN }
      });
      const existing = await tx.bookmark.findFirst({
        where: { userId: user.id, wordId, mnemonicEntryId: null },
        select: { id: true }
      });
      if (!existing) {
        await tx.bookmark.create({ data: { userId: user.id, wordId } });
      }
    }
  });

  revalidatePath("/me");

  return NextResponse.json({
    ok: true,
    markCount: validMarks.length,
    bookmarkCount: validBookmarkedWordIds.length
  });
}

function parseMarks(value: Record<string, unknown> | undefined) {
  if (!value || typeof value !== "object") return [];

  return Object.entries(value)
    .filter((entry): entry is [string, WordMarkState] => {
      const [wordId, state] = entry;
      return Boolean(wordId) && typeof state === "string" && validMarkStates.has(state);
    })
    .slice(0, MAX_ITEMS);
}

function parseWordIds(value: unknown[] | undefined) {
  if (!Array.isArray(value)) return [];

  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))).slice(0, MAX_ITEMS);
}
