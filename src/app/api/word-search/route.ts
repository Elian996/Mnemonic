import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { compareWordSearchResults } from "@/lib/word-search";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 64) ?? "";
  const limitParam = Number(url.searchParams.get("limit") ?? "0");
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 80) : null;
  const queryTake = limit ? Math.max(limit * 8, 160) : 500;
  if (!q) {
    return NextResponse.json({ words: [] }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }

  const user = await getSessionUser();
  const words = await prisma.word.findMany({
    where: {
      OR: [
        { word: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
        { meaningCn: { contains: q, mode: "insensitive" } },
        { shortMeaningCn: { contains: q, mode: "insensitive" } },
        { meaningEn: { contains: q, mode: "insensitive" } }
      ]
    },
    select: {
      id: true,
      word: true,
      slug: true,
      phoneticUk: true,
      phoneticUs: true,
      partOfSpeech: true,
      meaningCn: true,
      meaningEn: true,
      shortMeaningCn: true,
      bookmarks: {
        where: { userId: user?.id ?? "__anonymous__", mnemonicEntryId: null },
        select: { id: true },
        take: 1
      }
    },
    take: queryTake
  });

  const marks = user
    ? await prisma.wordMark.findMany({
        where: { userId: user.id, wordId: { in: words.map((word) => word.id) } },
        select: { wordId: true, state: true }
      })
    : [];
  const markByWordId = new Map(marks.map((mark) => [mark.wordId, mark.state]));
  const sortedWords = words.sort(compareWordSearchResults(q));
  const visibleWords = limit ? sortedWords.slice(0, limit) : sortedWords;

  return NextResponse.json({
    words: visibleWords.map((word) => ({
      id: word.id,
      word: word.word,
      slug: word.slug,
      phonetic: word.phoneticUs || word.phoneticUk || "",
      partOfSpeech: word.partOfSpeech,
      meaningCn: word.meaningCn,
      shortMeaningCn: word.shortMeaningCn,
      markState: markByWordId.get(word.id) ?? null,
      isBookmarked: word.bookmarks.length > 0 || markByWordId.get(word.id) === "UNKNOWN"
    }))
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
