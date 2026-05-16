import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { WordMarkState } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const wordId = typeof body.wordId === "string" ? body.wordId.trim() : "";
  const requestedState = typeof body.bookmarked === "boolean" ? body.bookmarked : null;

  if (!wordId) {
    return NextResponse.json({ error: "Invalid word." }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }
  const word = await prisma.word.findUnique({
    where: { id: wordId },
    select: { id: true, slug: true }
  });
  if (!word) {
    return NextResponse.json({ error: "Word not found." }, { status: 404 });
  }

  const existing = await prisma.bookmark.findFirst({
    where: { userId: user.id, wordId: word.id, mnemonicEntryId: null },
    select: { id: true }
  });
  const shouldBookmark = requestedState ?? !existing;

  const markState = await prisma.$transaction(async (tx) => {
    if (shouldBookmark) {
      await tx.wordMark.upsert({
        where: { userId_wordId: { userId: user.id, wordId: word.id } },
        update: { state: WordMarkState.UNKNOWN },
        create: { userId: user.id, wordId: word.id, state: WordMarkState.UNKNOWN }
      });
      const existingWordBookmark = await tx.bookmark.findFirst({
        where: { userId: user.id, wordId: word.id, mnemonicEntryId: null },
        select: { id: true }
      });
      if (!existingWordBookmark) {
        await tx.bookmark.create({ data: { userId: user.id, wordId: word.id } });
      }
      return WordMarkState.UNKNOWN;
    }

    await tx.bookmark.deleteMany({ where: { userId: user.id, wordId: word.id, mnemonicEntryId: null } });
    await tx.wordMark.deleteMany({ where: { userId: user.id, wordId: word.id, state: WordMarkState.UNKNOWN } });
    const currentMark = await tx.wordMark.findUnique({
      where: { userId_wordId: { userId: user.id, wordId: word.id } },
      select: { state: true }
    });
    return currentMark?.state ?? null;
  });

  revalidatePath("/me");
  revalidatePath("/me/unknown");
  revalidatePath(`/word/${word.slug}`);

  return NextResponse.json({ isBookmarked: markState === WordMarkState.UNKNOWN, markState });
}
