import { NextResponse } from "next/server";
import { MnemonicSourceType, MnemonicStatus, Prisma, type User } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { canEditMnemonic } from "@/lib/permissions";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401, headers: noStoreHeaders });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "set-public") {
      await setPublicState(user, body);
    } else if (action === "promote") {
      await promoteUserEntry(user, body);
    } else if (action === "archive") {
      await archiveUserEntries(user, [readEntryId(body)]);
    } else if (action === "bulk-archive") {
      const entryIds = Array.isArray(body.entryIds) ? body.entryIds.filter((item): item is string => typeof item === "string") : [];
      await archiveUserEntries(user, entryIds);
    } else if (action === "default-public") {
      await updateDefaultPublic(user.id, body);
    } else {
      return NextResponse.json({ error: "unknown action" }, { status: 400, headers: noStoreHeaders });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作失败。" },
      { status: 400, headers: noStoreHeaders }
    );
  }

  const [updatedUser, entries] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { defaultPublicMnemonics: true } }),
    getUserMnemonicEntries(user.id)
  ]);

  return NextResponse.json(
    {
      defaultPublicMnemonics: updatedUser.defaultPublicMnemonics,
      entries
    },
    { headers: noStoreHeaders }
  );
}

async function setPublicState(user: Pick<User, "id" | "role">, body: Record<string, unknown>) {
  const entryId = readEntryId(body);
  const intent = body.intent === "private" ? "private" : "public";

  const word = await prisma.$transaction(async (tx) => {
    const entry = await tx.mnemonicEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { targetWord: true }
    });
    assertUserEntryAccess(user, entry, "操作");

    const nextSourceType = intent === "private" ? MnemonicSourceType.USER_PRIVATE : MnemonicSourceType.USER_PUBLIC;
    const nextStatus = intent === "private" ? MnemonicStatus.PRIVATE : MnemonicStatus.PENDING_REVIEW;
    await tx.mnemonicEntry.update({
      where: { id: entry.id },
      data: {
        sourceType: nextSourceType,
        status: nextStatus,
        isPublic: false,
        reviewerId: null,
        reviewedAt: null,
        reviewNote: null
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: intent === "private" ? "MNEMONIC_UNPUBLISH_REQUEST" : "MNEMONIC_PUBLIC_REQUEST",
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: { wordId: entry.targetWordId }
      }
    });

    return entry.targetWord;
  });

  revalidateUserMnemonicPaths(word.slug);
}

async function promoteUserEntry(user: Pick<User, "id" | "role">, body: Record<string, unknown>) {
  const entryId = readEntryId(body);

  const word = await prisma.$transaction(async (tx) => {
    const entry = await tx.mnemonicEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { targetWord: true }
    });
    assertUserEntryAccess(user, entry, "排序");

    await promoteVisibleMnemonicCardForUser(tx, user.id, entry);
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "USER_MNEMONIC_PROMOTE",
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: { wordId: entry.targetWordId, personalOrder: true }
      }
    });

    return entry.targetWord;
  });

  revalidateUserMnemonicPaths(word.slug);
}

async function archiveUserEntries(user: Pick<User, "id" | "role">, entryIds: string[]) {
  const ids = Array.from(new Set(entryIds.filter(Boolean)));
  if (!ids.length) return;

  const affectedSlugs = new Set<string>();
  await prisma.$transaction(async (tx) => {
    const entries = await tx.mnemonicEntry.findMany({
      where: {
        id: { in: ids },
        sourceType: { not: MnemonicSourceType.OFFICIAL },
        status: { not: MnemonicStatus.ARCHIVED }
      },
      include: { targetWord: true }
    });

    for (const entry of entries) {
      assertUserEntryAccess(user, entry, "删除");
    }

    for (const entry of entries) {
      affectedSlugs.add(entry.targetWord.slug);
      await tx.mnemonicEntryVersion.create({
        data: {
          mnemonicEntryId: entry.id,
          contentMarkdown: entry.contentMarkdown,
          splitText: entry.splitText,
          title: entry.title,
          editorId: user.id
        }
      });
      await tx.memoryLink.deleteMany({ where: { sourceMnemonicEntryId: entry.id } });
      await tx.userMnemonicCardOrder.deleteMany({ where: { mnemonicEntryId: entry.id } });
      await tx.mnemonicEntry.update({
        where: { id: entry.id },
        data: {
          status: MnemonicStatus.ARCHIVED,
          isPublic: false,
          reviewerId: null,
          reviewedAt: null
        }
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "USER_MNEMONIC_ARCHIVE",
          entityType: "MnemonicEntry",
          entityId: entry.id,
          metadataJson: { wordId: entry.targetWordId }
        }
      });
    }

    const affectedWordIds = Array.from(new Set(entries.map((entry) => entry.targetWordId)));
    for (const wordId of affectedWordIds) {
      const remaining = await tx.mnemonicEntry.findMany({
        where: {
          targetWordId: wordId,
          authorId: user.id,
          sourceType: { not: MnemonicSourceType.OFFICIAL },
          status: { not: MnemonicStatus.ARCHIVED }
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      });
      for (const [index, item] of remaining.entries()) {
        if (item.sortOrder !== index) {
          await tx.mnemonicEntry.update({ where: { id: item.id }, data: { sortOrder: index } });
        }
      }
    }
  });

  for (const slug of affectedSlugs) revalidateUserMnemonicPaths(slug);
  if (!affectedSlugs.size) revalidateUserMnemonicPaths();
}

async function updateDefaultPublic(userId: string, body: Record<string, unknown>) {
  await prisma.user.update({
    where: { id: userId },
    data: { defaultPublicMnemonics: Boolean(body.enabled) }
  });

  revalidatePath("/me");
  revalidatePath("/me/mnemonics");
}

function assertUserEntryAccess(
  user: Pick<User, "id" | "role">,
  entry: { authorId: string; sourceType: MnemonicSourceType; status: MnemonicStatus },
  verb: string
) {
  if (entry.sourceType === MnemonicSourceType.OFFICIAL) throw new Error(`不能${verb}官方记忆卡。`);
  if (!canEditMnemonic(user, entry)) throw new Error(`只能${verb}自己创建的记忆卡。`);
}

function readEntryId(body: Record<string, unknown>) {
  if (typeof body.entryId !== "string" || !body.entryId) throw new Error("缺少记忆卡 id。");
  return body.entryId;
}

async function getUserMnemonicEntries(userId: string) {
  const entries = await prisma.mnemonicEntry.findMany({
    where: {
      authorId: userId,
      sourceType: { not: MnemonicSourceType.OFFICIAL },
      status: { not: MnemonicStatus.ARCHIVED }
    },
    include: {
      targetWord: true,
      userCardOrders: {
        where: { userId },
        select: { sortOrder: true },
        take: 1
      }
    },
    orderBy: [{ updatedAt: "desc" }]
  });

  return entries.map((entry) => ({
    id: entry.id,
    targetWordId: entry.targetWordId,
    title: entry.title,
    splitText: entry.splitText,
    contentMarkdown: entry.contentMarkdown,
    plainText: entry.plainText,
    status: entry.status,
    sourceType: entry.sourceType,
    reviewNote: entry.reviewNote,
    sortOrder: entry.userCardOrders[0]?.sortOrder ?? entry.sortOrder,
    updatedAt: entry.updatedAt.toISOString(),
    targetWord: {
      word: entry.targetWord.word,
      slug: entry.targetWord.slug,
      shortMeaningCn: entry.targetWord.shortMeaningCn
    }
  }));
}

type MnemonicOrderEntry = {
  id: string;
  targetWordId: string;
  authorId: string;
  sourceType: MnemonicSourceType;
  sortOrder: number;
  createdAt?: Date;
  userCardOrders?: { sortOrder: number }[];
};

async function promoteVisibleMnemonicCardForUser(
  tx: Prisma.TransactionClient,
  userId: string,
  entry: Pick<MnemonicOrderEntry, "id" | "targetWordId" | "authorId" | "sourceType" | "sortOrder">
) {
  const entries = await tx.mnemonicEntry.findMany({
    where: {
      targetWordId: entry.targetWordId,
      status: { not: MnemonicStatus.ARCHIVED },
      OR: [{ sourceType: MnemonicSourceType.OFFICIAL }, { authorId: userId, sourceType: { not: MnemonicSourceType.OFFICIAL } }]
    },
    select: {
      id: true,
      targetWordId: true,
      authorId: true,
      sourceType: true,
      sortOrder: true,
      createdAt: true,
      userCardOrders: {
        where: { userId },
        select: { sortOrder: true },
        take: 1
      }
    },
    orderBy: [{ sourceType: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }]
  });
  const targetEntry = entries.find((item) => item.id === entry.id);
  if (!targetEntry) return;

  const reordered = [targetEntry, ...entries.sort((first, second) => compareMnemonicEntries(first, second, userId)).filter((item) => item.id !== entry.id)];
  for (const [index, item] of reordered.entries()) {
    await tx.userMnemonicCardOrder.upsert({
      where: { userId_mnemonicEntryId: { userId, mnemonicEntryId: item.id } },
      update: { wordId: item.targetWordId, sortOrder: index },
      create: { userId, wordId: item.targetWordId, mnemonicEntryId: item.id, sortOrder: index }
    });
  }
}

function compareMnemonicEntries(first: MnemonicOrderEntry, second: MnemonicOrderEntry, userId: string | null) {
  const firstPersonalOrder = first.userCardOrders?.[0]?.sortOrder ?? null;
  const secondPersonalOrder = second.userCardOrders?.[0]?.sortOrder ?? null;
  if (firstPersonalOrder !== null || secondPersonalOrder !== null) {
    if (firstPersonalOrder === null) return 1;
    if (secondPersonalOrder === null) return -1;
    if (firstPersonalOrder !== secondPersonalOrder) return firstPersonalOrder - secondPersonalOrder;
  }

  const firstGroup = mnemonicDisplayGroup(first, userId);
  const secondGroup = mnemonicDisplayGroup(second, userId);
  if (firstGroup !== secondGroup) return firstGroup - secondGroup;
  if (first.sortOrder !== second.sortOrder) return first.sortOrder - second.sortOrder;
  const firstCreatedAt = first.createdAt?.getTime() ?? 0;
  const secondCreatedAt = second.createdAt?.getTime() ?? 0;
  if (firstCreatedAt !== secondCreatedAt) return firstCreatedAt - secondCreatedAt;
  return first.id.localeCompare(second.id);
}

function mnemonicDisplayGroup(entry: Pick<MnemonicOrderEntry, "authorId" | "sourceType">, userId: string | null) {
  if (userId && entry.authorId === userId && entry.sourceType !== MnemonicSourceType.OFFICIAL) return 0;
  if (entry.sourceType === MnemonicSourceType.OFFICIAL) return 1;
  return 2;
}

function revalidateUserMnemonicPaths(wordSlug?: string) {
  revalidatePath("/me");
  revalidatePath("/me/mnemonics");
  revalidatePath("/me/user-submissions");
  revalidatePath("/admin/reviews");
  revalidatePath("/contributions");
  if (wordSlug) revalidatePath(`/word/${wordSlug}`);
}
