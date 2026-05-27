import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { MnemonicSourceType, MnemonicStatus, VoteType, WordMarkState } from "@prisma/client";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const validMarkStates = new Set<string>(Object.values(WordMarkState));
const validVoteTypes = new Set<string>([VoteType.LIKE, VoteType.DISLIKE]);
const MAX_ITEMS = 5000;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    marks?: Record<string, unknown>;
    bookmarkedWordIds?: unknown[];
    mnemonicReactions?: Record<string, unknown>;
    mnemonicCardOrders?: Record<string, unknown>;
  };
  const marks = parseMarks(body.marks);
  const bookmarkedWordIds = parseWordIds(body.bookmarkedWordIds);
  const mnemonicReactions = parseMnemonicReactions(body.mnemonicReactions);
  const mnemonicCardOrders = parseMnemonicCardOrders(body.mnemonicCardOrders);

  if (
    marks.length > MAX_ITEMS ||
    bookmarkedWordIds.length > MAX_ITEMS ||
    mnemonicReactions.length > MAX_ITEMS ||
    mnemonicCardOrders.length > MAX_ITEMS
  ) {
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
  const requestedEntryIds = Array.from(
    new Set([
      ...mnemonicReactions.map((item) => item.mnemonicEntryId),
      ...mnemonicCardOrders.flatMap((item) => item.mnemonicEntryIds)
    ])
  );
  const visibleEntries = await prisma.mnemonicEntry.findMany({
    where: {
      id: { in: requestedEntryIds },
      status: { not: MnemonicStatus.ARCHIVED },
      OR: [
        { sourceType: MnemonicSourceType.OFFICIAL },
        {
          sourceType: MnemonicSourceType.USER_PUBLIC,
          isPublic: true,
          status: { in: [MnemonicStatus.APPROVED, MnemonicStatus.FEATURED] }
        }
      ]
    },
    select: { id: true, targetWordId: true }
  });
  const visibleEntryById = new Map(visibleEntries.map((entry) => [entry.id, entry]));
  const validMnemonicReactions = mnemonicReactions.filter((item) => {
    const entry = visibleEntryById.get(item.mnemonicEntryId);
    return entry && entry.targetWordId === item.wordId;
  });
  const validMnemonicCardOrders = mnemonicCardOrders
    .map((item) => ({
      wordId: item.wordId,
      mnemonicEntryIds: item.mnemonicEntryIds.filter((entryId) => visibleEntryById.get(entryId)?.targetWordId === item.wordId)
    }))
    .filter((item) => item.mnemonicEntryIds.length);

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

    const affectedMnemonicEntryIds = new Set<string>();
    for (const item of validMnemonicReactions) {
      await tx.vote.deleteMany({
        where: {
          userId: user.id,
          mnemonicEntryId: item.mnemonicEntryId,
          type: { in: [VoteType.LIKE, VoteType.DISLIKE] }
        }
      });
      await tx.vote.create({
        data: {
          userId: user.id,
          mnemonicEntryId: item.mnemonicEntryId,
          type: item.reaction
        }
      });
      if (item.reaction === VoteType.LIKE) {
        await tx.bookmark.upsert({
          where: {
            userId_wordId_mnemonicEntryId: {
              userId: user.id,
              wordId: item.wordId,
              mnemonicEntryId: item.mnemonicEntryId
            }
          },
          update: {},
          create: {
            userId: user.id,
            wordId: item.wordId,
            mnemonicEntryId: item.mnemonicEntryId
          }
        });
      } else {
        await tx.bookmark.deleteMany({
          where: { userId: user.id, wordId: item.wordId, mnemonicEntryId: item.mnemonicEntryId }
        });
      }
      affectedMnemonicEntryIds.add(item.mnemonicEntryId);
    }

    for (const item of validMnemonicCardOrders) {
      await tx.userMnemonicCardOrder.deleteMany({
        where: { userId: user.id, wordId: item.wordId }
      });
      for (const [sortOrder, mnemonicEntryId] of item.mnemonicEntryIds.entries()) {
        await tx.userMnemonicCardOrder.create({
          data: {
            userId: user.id,
            wordId: item.wordId,
            mnemonicEntryId,
            sortOrder
          }
        });
      }
    }

    for (const mnemonicEntryId of affectedMnemonicEntryIds) {
      const [likeCount, dislikeCount, bookmarkCount] = await Promise.all([
        tx.vote.count({ where: { mnemonicEntryId, type: VoteType.LIKE } }),
        tx.vote.count({ where: { mnemonicEntryId, type: VoteType.DISLIKE } }),
        tx.bookmark.count({ where: { mnemonicEntryId } })
      ]);
      await tx.mnemonicEntry.update({
        where: { id: mnemonicEntryId },
        data: { likeCount, dislikeCount, bookmarkCount }
      });
    }
  });

  revalidatePath("/me");

  return NextResponse.json({
    ok: true,
    markCount: validMarks.length,
    bookmarkCount: validBookmarkedWordIds.length,
    mnemonicReactionCount: validMnemonicReactions.length,
    mnemonicCardOrderCount: validMnemonicCardOrders.length
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

function parseMnemonicReactions(value: Record<string, unknown> | undefined) {
  if (!value || typeof value !== "object") return [];

  return Object.entries(value)
    .flatMap(([mnemonicEntryId, raw]) => {
      if (!mnemonicEntryId || !raw || typeof raw !== "object") return [];
      const { wordId, reaction } = raw as { wordId?: unknown; reaction?: unknown };
      if (
        typeof wordId === "string" &&
        wordId &&
        typeof reaction === "string" &&
        validVoteTypes.has(reaction)
      ) {
        return [{ mnemonicEntryId, wordId, reaction: reaction as VoteType }];
      }
      return [];
    })
    .slice(0, MAX_ITEMS);
}

function parseMnemonicCardOrders(value: Record<string, unknown> | undefined) {
  if (!value || typeof value !== "object") return [];

  return Object.entries(value)
    .flatMap(([wordId, rawIds]) => {
      if (!wordId || !Array.isArray(rawIds)) return [];
      const mnemonicEntryIds = Array.from(
        new Set(rawIds.filter((item): item is string => typeof item === "string" && item.length > 0))
      );
      return mnemonicEntryIds.length ? [{ wordId, mnemonicEntryIds }] : [];
    })
    .slice(0, MAX_ITEMS);
}
