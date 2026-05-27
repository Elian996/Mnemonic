import { NextResponse } from "next/server";
import { MnemonicSourceType, MnemonicStatus, Prisma, UserRole, VoteType, WordStatus, type User } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { canEditMnemonic, canViewMnemonic, hasRole } from "@/lib/permissions";
import { markdownToPlainText, renderMnemonicMarkdown } from "@/lib/wiki-links/renderer";
import { ensureWordNode, syncEntryWikiLinks } from "@/lib/wiki-links/resolve";
import { vocabCategories } from "@/lib/vocab-categories";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  const word = await findWordCardRecord(decodeURIComponent(slug), user?.id ?? null);

  if (!word) {
    return NextResponse.json({ error: "word not found" }, { status: 404 });
  }

  return NextResponse.json(await toWordCardPayload(word, user), { headers: noStoreHeaders });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "create") {
    return createMnemonicCard(slug, body);
  }

  if (action === "update") {
    return updateMnemonicCard(slug, body);
  }

  if (action === "update-meaning") {
    return updateWordMeaning(slug, body);
  }

  if (action === "promote") {
    return promoteMnemonicCard(slug, body);
  }

  if (action === "react") {
    return reactToMnemonicCard(slug, body);
  }

  if (action === "delete") {
    return deleteMnemonicCard(slug, body);
  }

  if (action === "restore") {
    return restoreMnemonicCard(slug, body);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

async function createMnemonicCard(slug: string, body: Record<string, unknown>) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("请先登录后再创建自己的记忆卡。");
  const word = await prisma.word.findUnique({
    where: { slug },
    select: { id: true, word: true, slug: true, levelTags: true }
  });
  if (!word) return NextResponse.json({ error: "word not found" }, { status: 404 });

  const editableMarkdown = typeof body.contentMarkdown === "string" ? body.contentMarkdown : "";
  const { splitText, contentMarkdown } = splitEditableMnemonic(editableMarkdown);
  if (!splitText.trim() && !contentMarkdown.trim()) {
    return NextResponse.json({ error: "记忆卡内容不能为空" }, { status: 400 });
  }

  const contentHtml = await renderMnemonicMarkdown(contentMarkdown);
  const plainText = markdownToPlainText([splitText ? `划分：${splitText}` : "", contentMarkdown].filter(Boolean).join("\n\n"));
  const createsOfficialCard = hasRole(user, UserRole.EDITOR);
  const requestedVisibility = readVisibility(body);
  const wantsPublicUserCard = requestedVisibility ? requestedVisibility === "public" : user.defaultPublicMnemonics;
  const sourceType = createsOfficialCard
    ? MnemonicSourceType.OFFICIAL
    : wantsPublicUserCard
      ? MnemonicSourceType.USER_PUBLIC
      : MnemonicSourceType.USER_PRIVATE;
  const status = createsOfficialCard
    ? MnemonicStatus.APPROVED
    : wantsPublicUserCard
      ? MnemonicStatus.PENDING_REVIEW
      : MnemonicStatus.PRIVATE;
  let activeEntryId = "";

  await prisma.$transaction(async (tx) => {
    const entry = await tx.mnemonicEntry.create({
      data: {
        targetWordId: word.id,
        authorId: user.id,
        sourceType,
        status,
        title: `${word.word} 记忆卡片`,
        splitText,
        contentMarkdown,
        contentHtml,
        plainText,
        isPublic: createsOfficialCard,
        isOfficialRecommended: createsOfficialCard,
        sortOrder: createsOfficialCard ? await nextOfficialSortOrder(tx, word.id) : await nextUserSortOrder(tx, word.id, user.id),
        editorScore: createsOfficialCard ? 8 : 0
      }
    });
    activeEntryId = entry.id;
    await ensureWordNode(word.id, tx);
    await syncEntryWikiLinks(entry.id, user.id, tx);
    if (createsOfficialCard) {
      await tx.word.update({
        where: { id: word.id },
        data: { status: WordStatus.PUBLISHED }
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: createsOfficialCard ? "MNEMONIC_QUICK_CREATE" : "USER_MNEMONIC_QUICK_CREATE",
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: { wordId: word.id, sourceType, status }
      }
    });
  });

  revalidateWordSurfaces(word);
  if (!createsOfficialCard) revalidateUserMnemonicPaths(word.slug);
  const updatedWord = await findWordCardRecord(word.slug, user.id);
  return NextResponse.json({ word: updatedWord ? await toWordCardPayload(updatedWord, user) : null, activeEntryId }, { headers: noStoreHeaders });
}

async function updateMnemonicCard(slug: string, body: Record<string, unknown>) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse();
  const entryId = typeof body.entryId === "string" ? body.entryId : "";
  if (!entryId) return NextResponse.json({ error: "missing entry id" }, { status: 400 });

  const entry = await prisma.mnemonicEntry.findUnique({
    where: { id: entryId },
    include: { targetWord: true }
  });
  if (!entry || entry.targetWord.slug !== slug) {
    return NextResponse.json({ error: "mnemonic card not found" }, { status: 404 });
  }
  if (entry.status === MnemonicStatus.ARCHIVED) {
    return NextResponse.json({ error: "不能编辑已删除的记忆卡" }, { status: 400 });
  }
  if (entry.sourceType === MnemonicSourceType.OFFICIAL && !hasRole(user, UserRole.EDITOR)) {
    return forbiddenResponse("官方已有记忆卡只能由编辑员修改。你可以新建自己的记忆卡。");
  }
  if (entry.sourceType !== MnemonicSourceType.OFFICIAL && !canEditMnemonic(user, entry)) {
    return forbiddenResponse("只能编辑自己创建的记忆卡。");
  }

  const editableMarkdown = typeof body.contentMarkdown === "string" ? body.contentMarkdown : "";
  const { splitText, contentMarkdown } = splitEditableMnemonic(editableMarkdown);
  if (!splitText.trim() && !contentMarkdown.trim()) {
    return NextResponse.json({ error: "记忆卡内容不能为空" }, { status: 400 });
  }

  const contentHtml = await renderMnemonicMarkdown(contentMarkdown);
  const plainText = markdownToPlainText([splitText ? `划分：${splitText}` : "", contentMarkdown].filter(Boolean).join("\n\n"));
  const requestedVisibility = readVisibility(body);

  await prisma.$transaction(async (tx) => {
    await tx.mnemonicEntryVersion.create({
      data: {
        mnemonicEntryId: entry.id,
        contentMarkdown: entry.contentMarkdown,
        splitText: entry.splitText,
        title: entry.title,
        editorId: user.id
      }
    });
    const isOfficialCard = entry.sourceType === MnemonicSourceType.OFFICIAL;
    const wantsPublicUserCard = requestedVisibility ? requestedVisibility === "public" : entry.sourceType === MnemonicSourceType.USER_PUBLIC;
    await tx.mnemonicEntry.update({
      where: { id: entry.id },
      data: isOfficialCard
        ? {
            splitText,
            contentMarkdown,
            contentHtml,
            plainText,
            status: MnemonicStatus.APPROVED,
            isPublic: true,
            isOfficialRecommended: true
          }
        : {
            splitText,
            contentMarkdown,
            contentHtml,
            plainText,
            sourceType: wantsPublicUserCard ? MnemonicSourceType.USER_PUBLIC : MnemonicSourceType.USER_PRIVATE,
            status: wantsPublicUserCard ? MnemonicStatus.PENDING_REVIEW : MnemonicStatus.PRIVATE,
            isPublic: false,
            isOfficialRecommended: false,
            reviewerId: null,
            reviewedAt: null,
            reviewNote: null
          }
    });
    await syncEntryWikiLinks(entry.id, user.id, tx);
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: isOfficialCard ? "MNEMONIC_QUICK_UPDATE" : "USER_MNEMONIC_QUICK_UPDATE",
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: { wordId: entry.targetWordId, sourceType: entry.sourceType }
      }
    });
  });

  revalidateWordSurfaces(entry.targetWord);
  if (entry.sourceType !== MnemonicSourceType.OFFICIAL || !hasRole(user, UserRole.EDITOR)) {
    revalidateUserMnemonicPaths(entry.targetWord.slug);
  }
  const updatedWord = await findWordCardRecord(entry.targetWord.slug, user.id);
  return NextResponse.json({ word: updatedWord ? await toWordCardPayload(updatedWord, user) : null, activeEntryId: entry.id }, { headers: noStoreHeaders });
}

async function updateWordMeaning(slug: string, body: Record<string, unknown>) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("请先登录后再修改中文释义。");
  if (!hasRole(user, UserRole.EDITOR)) return forbiddenResponse("只有编辑员可以修改中文释义。");

  const meaningCn = typeof body.meaningCn === "string" ? body.meaningCn.trim() : "";
  if (!meaningCn) return NextResponse.json({ error: "中文释义不能为空。" }, { status: 400 });

  const word = await prisma.word.findUnique({ where: { slug } });
  if (!word) return NextResponse.json({ error: "word not found" }, { status: 404 });

  const shortMeaningCn =
    typeof body.shortMeaningCn === "string" && body.shortMeaningCn.trim()
      ? body.shortMeaningCn.trim()
      : shortMeaningFrom(meaningCn);

  const updatedWordRecord = await prisma.$transaction(async (tx) => {
    const updated = await tx.word.update({
      where: { id: word.id },
      data: { meaningCn, shortMeaningCn }
    });
    await ensureWordNode(updated.id, tx);
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "WORD_MEANING_QUICK_UPDATE",
        entityType: "Word",
        entityId: updated.id,
        metadataJson: {
          previous: {
            meaningCn: word.meaningCn,
            shortMeaningCn: word.shortMeaningCn
          },
          next: {
            meaningCn,
            shortMeaningCn
          }
        }
      }
    });
    return updated;
  });

  revalidateWordSurfaces(updatedWordRecord);
  const updatedWord = await findWordCardRecord(updatedWordRecord.slug, user.id);
  return NextResponse.json(
    {
      word: updatedWord ? await toWordCardPayload(updatedWord, user) : null,
      activeEntryId: updatedWord?.mnemonicEntries[0]?.id ?? ""
    },
    { headers: noStoreHeaders }
  );
}

async function promoteMnemonicCard(slug: string, body: Record<string, unknown>) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse();
  const entryId = typeof body.entryId === "string" ? body.entryId : "";
  if (!entryId) return NextResponse.json({ error: "missing entry id" }, { status: 400 });

  const entry = await prisma.mnemonicEntry.findUnique({
    where: { id: entryId },
    include: { targetWord: true }
  });
  if (!entry || entry.targetWord.slug !== slug) {
    return NextResponse.json({ error: "mnemonic card not found" }, { status: 404 });
  }
  if (entry.status === MnemonicStatus.ARCHIVED) {
    return NextResponse.json({ error: "不能前置已删除的记忆卡" }, { status: 400 });
  }
  if (!canViewMnemonic(user, entry)) {
    return forbiddenResponse("没有权限前置这张记忆卡。");
  }

  await prisma.$transaction(async (tx) => {
    const isOfficialCard = entry.sourceType === MnemonicSourceType.OFFICIAL;
    const promotesPublicOfficialOrder = isOfficialCard && hasRole(user, UserRole.EDITOR);
    if (promotesPublicOfficialOrder) {
      const entries = await tx.mnemonicEntry.findMany({
        where: {
          targetWordId: entry.targetWordId,
          sourceType: MnemonicSourceType.OFFICIAL,
          status: { not: MnemonicStatus.ARCHIVED }
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      });
      const reordered = [entry, ...entries.filter((item) => item.id !== entry.id)];
      for (const [index, item] of reordered.entries()) {
        await tx.mnemonicEntry.update({
          where: { id: item.id },
          data: { sortOrder: index }
        });
      }
    } else {
      await promoteVisibleMnemonicCardForUser(tx, user.id, entry);
    }
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: promotesPublicOfficialOrder ? "MNEMONIC_PROMOTE" : "USER_MNEMONIC_PROMOTE",
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: { wordId: entry.targetWordId, sourceType: entry.sourceType, personalOrder: !promotesPublicOfficialOrder }
      }
    });
  });

  revalidateWordSurfaces(entry.targetWord);
  if (entry.sourceType !== MnemonicSourceType.OFFICIAL) revalidateUserMnemonicPaths(entry.targetWord.slug);
  const updatedWord = await findWordCardRecord(entry.targetWord.slug, user.id);
  return NextResponse.json({ word: updatedWord ? await toWordCardPayload(updatedWord, user) : null, activeEntryId: entry.id }, { headers: noStoreHeaders });
}

async function reactToMnemonicCard(slug: string, body: Record<string, unknown>) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("请先登录后再点赞或点踩。");
  const entryId = typeof body.entryId === "string" ? body.entryId : "";
  const reaction = body.reaction === "LIKE" || body.reaction === "DISLIKE" ? body.reaction : "";
  if (!entryId || !reaction) return NextResponse.json({ error: "reaction payload invalid" }, { status: 400 });

  const entry = await prisma.mnemonicEntry.findUnique({
    where: { id: entryId },
    include: { targetWord: true }
  });
  if (!entry || entry.targetWord.slug !== slug) {
    return NextResponse.json({ error: "mnemonic card not found" }, { status: 404 });
  }
  if (!canViewMnemonic(user, entry) || !isPubliclyReactableEntry(entry)) {
    return forbiddenResponse("只能评价已公开的记忆卡。");
  }

  await prisma.$transaction(async (tx) => {
    const existingVotes = await tx.vote.findMany({
      where: {
        userId: user.id,
        mnemonicEntryId: entry.id,
        type: { in: [VoteType.LIKE, VoteType.DISLIKE] }
      },
      select: { type: true }
    });
    const hadSameVote = existingVotes.some((vote) => vote.type === reaction);

    await tx.vote.deleteMany({
      where: {
        userId: user.id,
        mnemonicEntryId: entry.id,
        type: { in: [VoteType.LIKE, VoteType.DISLIKE] }
      }
    });

    if (!hadSameVote) {
      await tx.vote.create({
        data: {
          userId: user.id,
          mnemonicEntryId: entry.id,
          type: reaction
        }
      });
    }

    if (!hadSameVote && reaction === VoteType.LIKE) {
      await tx.bookmark.upsert({
        where: {
          userId_wordId_mnemonicEntryId: {
            userId: user.id,
            wordId: entry.targetWordId,
            mnemonicEntryId: entry.id
          }
        },
        update: {},
        create: { userId: user.id, wordId: entry.targetWordId, mnemonicEntryId: entry.id }
      });
    } else {
      await tx.bookmark.deleteMany({
        where: { userId: user.id, wordId: entry.targetWordId, mnemonicEntryId: entry.id }
      });
    }

    const [likeCount, dislikeCount, bookmarkCount] = await Promise.all([
      tx.vote.count({ where: { mnemonicEntryId: entry.id, type: VoteType.LIKE } }),
      tx.vote.count({ where: { mnemonicEntryId: entry.id, type: VoteType.DISLIKE } }),
      tx.bookmark.count({ where: { mnemonicEntryId: entry.id } })
    ]);

    await tx.mnemonicEntry.update({
      where: { id: entry.id },
      data: { likeCount, dislikeCount, bookmarkCount }
    });

    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: hadSameVote ? "MNEMONIC_REACTION_CLEAR" : `MNEMONIC_REACTION_${reaction}`,
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: { wordId: entry.targetWordId, reaction }
      }
    });
  });

  revalidateWordSurfaces(entry.targetWord);
  const updatedWord = await findWordCardRecord(entry.targetWord.slug, user.id);
  return NextResponse.json({ word: updatedWord ? await toWordCardPayload(updatedWord, user) : null, activeEntryId: entry.id }, { headers: noStoreHeaders });
}

type MnemonicOrderEntry = {
  id: string;
  targetWordId?: string;
  authorId: string;
  sourceType: MnemonicSourceType;
  sortOrder: number;
  likeCount?: number;
  dislikeCount?: number;
  createdAt?: Date;
  userCardOrders?: { sortOrder: number }[];
};

async function promoteVisibleMnemonicCardForUser(
  tx: Prisma.TransactionClient,
  userId: string,
  entry: Pick<MnemonicOrderEntry, "id" | "targetWordId" | "authorId" | "sourceType" | "sortOrder"> & { targetWordId: string }
) {
  const entries = await tx.mnemonicEntry.findMany({
    where: {
      targetWordId: entry.targetWordId,
      status: { not: MnemonicStatus.ARCHIVED },
      OR: [
        { sourceType: MnemonicSourceType.OFFICIAL },
        { authorId: userId, sourceType: { not: MnemonicSourceType.OFFICIAL } },
        {
          sourceType: MnemonicSourceType.USER_PUBLIC,
          isPublic: true,
          status: { in: [MnemonicStatus.APPROVED, MnemonicStatus.FEATURED] }
        }
      ]
    },
    select: {
      id: true,
      targetWordId: true,
      authorId: true,
      sourceType: true,
      sortOrder: true,
      likeCount: true,
      dislikeCount: true,
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

  const reordered = [targetEntry, ...entries.sort(compareMnemonicEntries).filter((item) => item.id !== entry.id)];
  for (const [index, item] of reordered.entries()) {
    await tx.userMnemonicCardOrder.upsert({
      where: { userId_mnemonicEntryId: { userId, mnemonicEntryId: item.id } },
      update: { wordId: item.targetWordId, sortOrder: index },
      create: { userId, wordId: item.targetWordId, mnemonicEntryId: item.id, sortOrder: index }
    });
  }
}

async function deleteMnemonicCard(slug: string, body: Record<string, unknown>) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse();
  const entryId = typeof body.entryId === "string" ? body.entryId : "";
  if (!entryId) return NextResponse.json({ error: "missing entry id" }, { status: 400 });

  const targetEntry = await prisma.mnemonicEntry.findUnique({
    where: { id: entryId },
    include: { targetWord: true }
  });
  if (!targetEntry || targetEntry.targetWord.slug !== slug) {
    return NextResponse.json({ error: "mnemonic card not found" }, { status: 404 });
  }
  if (targetEntry.sourceType === MnemonicSourceType.OFFICIAL && !hasRole(user, UserRole.EDITOR)) {
    return forbiddenResponse("官方已有记忆卡只能由编辑员删除。你可以新建自己的记忆卡。");
  }
  if (targetEntry.sourceType !== MnemonicSourceType.OFFICIAL && !canEditMnemonic(user, targetEntry)) {
    return forbiddenResponse("只能删除自己创建的记忆卡。");
  }

  const word = await prisma.$transaction(async (tx) => {
    const entry = await tx.mnemonicEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { targetWord: true }
    });
    const isOfficialCard = entry.sourceType === MnemonicSourceType.OFFICIAL;

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
    await tx.mnemonicEntry.update({
      where: { id: entry.id },
      data: isOfficialCard
        ? {
            status: MnemonicStatus.ARCHIVED,
            isPublic: false,
            isOfficialRecommended: false
          }
        : {
            status: MnemonicStatus.ARCHIVED,
            isPublic: false,
            isOfficialRecommended: false,
            reviewerId: null,
            reviewedAt: null
          }
    });

    const remaining = await tx.mnemonicEntry.findMany({
      where: isOfficialCard
        ? {
            targetWordId: entry.targetWordId,
            sourceType: MnemonicSourceType.OFFICIAL,
            status: { not: MnemonicStatus.ARCHIVED }
          }
        : {
            targetWordId: entry.targetWordId,
            authorId: entry.authorId,
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
    if (isOfficialCard && !remaining.length) {
      await tx.word.update({
        where: { id: entry.targetWordId },
        data: { status: WordStatus.NEEDS_REVISION }
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: isOfficialCard ? "MNEMONIC_QUICK_DELETE" : "USER_MNEMONIC_QUICK_DELETE",
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: { wordId: entry.targetWordId, word: entry.targetWord.word, sourceType: entry.sourceType }
      }
    });
    return entry.targetWord;
  });

  revalidateWordSurfaces(word);
  if (targetEntry.sourceType !== MnemonicSourceType.OFFICIAL) revalidateUserMnemonicPaths(word.slug);
  const updatedWord = await findWordCardRecord(word.slug, user.id);
  const activeEntryId = updatedWord?.mnemonicEntries[0]?.id ?? "";
  return NextResponse.json({ word: updatedWord ? await toWordCardPayload(updatedWord, user) : null, activeEntryId }, { headers: noStoreHeaders });
}

async function restoreMnemonicCard(slug: string, body: Record<string, unknown>) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse();
  const entryId = typeof body.entryId === "string" ? body.entryId : "";
  const requestedIndex = Number(body.sortOrder);
  const restoreIndex = Number.isFinite(requestedIndex) ? Math.max(0, Math.trunc(requestedIndex)) : 0;
  if (!entryId) return NextResponse.json({ error: "missing entry id" }, { status: 400 });

  const targetEntry = await prisma.mnemonicEntry.findUnique({
    where: { id: entryId },
    include: { targetWord: true }
  });
  if (!targetEntry || targetEntry.targetWord.slug !== slug) {
    return NextResponse.json({ error: "mnemonic card not found" }, { status: 404 });
  }
  if (targetEntry.sourceType === MnemonicSourceType.OFFICIAL && !hasRole(user, UserRole.EDITOR)) {
    return forbiddenResponse("官方已有记忆卡只能由编辑员恢复。");
  }
  if (targetEntry.sourceType !== MnemonicSourceType.OFFICIAL && !canEditMnemonic(user, targetEntry)) {
    return forbiddenResponse("只能恢复自己创建的记忆卡。");
  }

  const word = await prisma.$transaction(async (tx) => {
    const entry = await tx.mnemonicEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { targetWord: true }
    });
    const isOfficialCard = entry.sourceType === MnemonicSourceType.OFFICIAL;
    const remaining = await tx.mnemonicEntry.findMany({
      where: isOfficialCard
        ? {
            targetWordId: entry.targetWordId,
            sourceType: MnemonicSourceType.OFFICIAL,
            status: { not: MnemonicStatus.ARCHIVED }
          }
        : {
            targetWordId: entry.targetWordId,
            authorId: entry.authorId,
            sourceType: { not: MnemonicSourceType.OFFICIAL },
            status: { not: MnemonicStatus.ARCHIVED }
          },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
    const ordered = remaining.filter((item) => item.id !== entry.id);
    ordered.splice(Math.min(restoreIndex, ordered.length), 0, entry);

    await tx.mnemonicEntry.update({
      where: { id: entry.id },
      data: isOfficialCard
        ? {
            status: MnemonicStatus.APPROVED,
            isPublic: true,
            isOfficialRecommended: true
          }
        : {
            status: entry.sourceType === MnemonicSourceType.USER_PUBLIC ? MnemonicStatus.PENDING_REVIEW : MnemonicStatus.PRIVATE,
            isPublic: false,
            isOfficialRecommended: false,
            reviewerId: null,
            reviewedAt: null,
            reviewNote: null
          }
    });
    for (const [index, item] of ordered.entries()) {
      await tx.mnemonicEntry.update({
        where: { id: item.id },
        data: { sortOrder: index }
      });
    }
    await ensureWordNode(entry.targetWordId, tx);
    await syncEntryWikiLinks(entry.id, user.id, tx);
    if (isOfficialCard) {
      await tx.word.update({
        where: { id: entry.targetWordId },
        data: { status: WordStatus.PUBLISHED }
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: isOfficialCard ? "MNEMONIC_QUICK_RESTORE" : "USER_MNEMONIC_QUICK_RESTORE",
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: { wordId: entry.targetWordId, word: entry.targetWord.word, restoreIndex, sourceType: entry.sourceType }
      }
    });
    return entry.targetWord;
  });

  revalidateWordSurfaces(word);
  if (targetEntry.sourceType !== MnemonicSourceType.OFFICIAL) revalidateUserMnemonicPaths(word.slug);
  const updatedWord = await findWordCardRecord(word.slug, user.id);
  return NextResponse.json({ word: updatedWord ? await toWordCardPayload(updatedWord, user) : null, activeEntryId: entryId }, { headers: noStoreHeaders });
}

async function findWordCardRecord(slug: string, userId: string | null) {
  const mnemonicEntryWhere: Prisma.MnemonicEntryWhereInput = userId
    ? {
        status: { not: MnemonicStatus.ARCHIVED },
        OR: [
          { sourceType: MnemonicSourceType.OFFICIAL },
          { authorId: userId, sourceType: { not: MnemonicSourceType.OFFICIAL } },
          {
            sourceType: MnemonicSourceType.USER_PUBLIC,
            isPublic: true,
            status: { in: [MnemonicStatus.APPROVED, MnemonicStatus.FEATURED] }
          }
        ]
      }
    : {
        status: { not: MnemonicStatus.ARCHIVED },
        OR: [
          { sourceType: MnemonicSourceType.OFFICIAL },
          {
            sourceType: MnemonicSourceType.USER_PUBLIC,
            isPublic: true,
            status: { in: [MnemonicStatus.APPROVED, MnemonicStatus.FEATURED] }
          }
        ]
      };

  return prisma.word.findUnique({
    where: { slug },
    select: {
      id: true,
      word: true,
      slug: true,
      phoneticUk: true,
      phoneticUs: true,
      audioUkUrl: true,
      audioUsUrl: true,
      partOfSpeech: true,
      meaningCn: true,
      shortMeaningCn: true,
      exampleSentence: true,
      exampleTranslation: true,
      bookmarks: {
        where: { userId: userId ?? "__anonymous__", mnemonicEntryId: null },
        select: { id: true },
        take: 1
      },
      wordMarks: {
        where: { userId: userId ?? "__anonymous__" },
        select: { state: true },
        take: 1
      },
      mnemonicEntries: {
        where: mnemonicEntryWhere,
        select: {
          id: true,
          authorId: true,
          sourceType: true,
          status: true,
          isPublic: true,
          sortOrder: true,
          likeCount: true,
          dislikeCount: true,
          bookmarkCount: true,
          votes: {
            where: { userId: userId ?? "__anonymous__", type: { in: [VoteType.LIKE, VoteType.DISLIKE] } },
            select: { type: true },
            take: 1
          },
          bookmarks: {
            where: { userId: userId ?? "__anonymous__" },
            select: { id: true },
            take: 1
          },
          userCardOrders: {
            where: { userId: userId ?? "__anonymous__" },
            select: { sortOrder: true },
            take: 1
          },
          title: true,
          splitText: true,
          contentMarkdown: true,
          contentHtml: true,
          plainText: true,
          updatedAt: true
        },
        orderBy: [{ sourceType: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }]
      }
    }
  });
}

function unauthorizedResponse(message = "请先登录后再操作记忆卡。") {
  return NextResponse.json({ error: message }, { status: 401 });
}

function forbiddenResponse(message: string) {
  return NextResponse.json({ error: message }, { status: 403 });
}

type WordCardRecord = NonNullable<Awaited<ReturnType<typeof findWordCardRecord>>>;

async function toWordCardPayload(word: WordCardRecord, user: Pick<User, "id" | "role"> | null) {
  const markState = word.wordMarks[0]?.state ?? null;
  const orderedEntries = [...word.mnemonicEntries].sort(compareMnemonicEntries);
  const mnemonics = await Promise.all(
    orderedEntries.map(async (entry) => ({
      id: entry.id,
      title: entry.title,
      splitText: entry.splitText || "",
      contentMarkdown: entry.contentMarkdown,
      contentHtml: await renderMnemonicMarkdown(entry.contentMarkdown),
      plainText: entry.plainText,
      sourceType: entry.sourceType,
      status: entry.status,
      likeCount: entry.likeCount,
      dislikeCount: entry.dislikeCount,
      userVoteType: entry.votes[0]?.type ?? null,
      isSaved: entry.bookmarks.length > 0,
      updatedAt: entry.updatedAt.toISOString(),
      canEdit: canEditMnemonic(user, entry)
    }))
  );

  return {
    id: word.id,
    word: word.word,
    slug: word.slug,
    phonetic: word.phoneticUs || word.phoneticUk || "",
    audioUkUrl: word.audioUkUrl || "",
    audioUsUrl: word.audioUsUrl || "",
    partOfSpeech: word.partOfSpeech,
    meaningCn: word.meaningCn,
    shortMeaningCn: word.shortMeaningCn,
    exampleSentence: word.exampleSentence || "",
    exampleTranslation: word.exampleTranslation || "",
    markState,
    isBookmarked: word.bookmarks.length > 0 || markState === "UNKNOWN",
    canEditOfficialCards: hasRole(user, UserRole.EDITOR),
    canExportMemoryCardImages: hasRole(user, UserRole.ADMIN),
    mnemonic: mnemonics[0] ?? null,
    mnemonics
  };
}

function revalidateWordSurfaces(word: { slug: string; levelTags?: string[] }) {
  revalidatePath(`/word/${word.slug}`);
  revalidatePath("/repository");
  revalidatePath("/words");
  for (const category of vocabCategories) {
    if (word.levelTags?.includes(category.tag)) {
      revalidatePath(`/levels/${category.slug}`);
    }
  }
}

function revalidateUserMnemonicPaths(wordSlug?: string) {
  revalidatePath("/me");
  revalidatePath("/me/mnemonics");
  revalidatePath("/me/user-submissions");
  revalidatePath("/admin/reviews");
  revalidatePath("/contributions");
  if (wordSlug) revalidatePath(`/word/${wordSlug}`);
}

async function nextOfficialSortOrder(tx: Prisma.TransactionClient, wordId: string) {
  const latest = await tx.mnemonicEntry.findFirst({
    where: {
      targetWordId: wordId,
      sourceType: MnemonicSourceType.OFFICIAL,
      status: { not: MnemonicStatus.ARCHIVED }
    },
    orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
    select: { sortOrder: true }
  });
  return (latest?.sortOrder ?? -1) + 1;
}

async function nextUserSortOrder(tx: Prisma.TransactionClient, wordId: string, authorId: string) {
  const latest = await tx.mnemonicEntry.findFirst({
    where: {
      targetWordId: wordId,
      authorId,
      sourceType: { not: MnemonicSourceType.OFFICIAL },
      status: { not: MnemonicStatus.ARCHIVED }
    },
    orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
    select: { sortOrder: true }
  });
  return (latest?.sortOrder ?? -1) + 1;
}

function compareMnemonicEntries(first: MnemonicOrderEntry, second: MnemonicOrderEntry) {
  const firstPersonalOrder = first.userCardOrders?.[0]?.sortOrder ?? null;
  const secondPersonalOrder = second.userCardOrders?.[0]?.sortOrder ?? null;
  if (firstPersonalOrder !== null || secondPersonalOrder !== null) {
    if (firstPersonalOrder === null) return 1;
    if (secondPersonalOrder === null) return -1;
    if (firstPersonalOrder !== secondPersonalOrder) return firstPersonalOrder - secondPersonalOrder;
  }

  const firstFeedbackScore = mnemonicFeedbackScore(first);
  const secondFeedbackScore = mnemonicFeedbackScore(second);
  if (firstFeedbackScore !== secondFeedbackScore) return secondFeedbackScore - firstFeedbackScore;
  if (first.sortOrder !== second.sortOrder) return first.sortOrder - second.sortOrder;
  const firstCreatedAt = first.createdAt?.getTime() ?? 0;
  const secondCreatedAt = second.createdAt?.getTime() ?? 0;
  if (firstCreatedAt !== secondCreatedAt) return firstCreatedAt - secondCreatedAt;
  return first.id.localeCompare(second.id);
}

function mnemonicFeedbackScore(entry: Pick<MnemonicOrderEntry, "likeCount" | "dislikeCount">) {
  return (entry.likeCount ?? 0) - (entry.dislikeCount ?? 0);
}

function isPubliclyReactableEntry(entry: {
  sourceType: MnemonicSourceType;
  status: MnemonicStatus;
  isPublic: boolean;
}) {
  if (entry.status === MnemonicStatus.ARCHIVED) return false;
  if (entry.sourceType === MnemonicSourceType.OFFICIAL) return true;
  return (
    entry.sourceType === MnemonicSourceType.USER_PUBLIC &&
    entry.isPublic &&
    (entry.status === MnemonicStatus.APPROVED || entry.status === MnemonicStatus.FEATURED)
  );
}

function readVisibility(body: Record<string, unknown>) {
  return body.visibility === "public" || body.visibility === "private" ? body.visibility : null;
}

function splitEditableMnemonic(markdown: string) {
  let splitText = "";
  const contentLines: string[] = [];
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const splitMatch = line.match(/^\s*划分\s*[:：]\s*(.*?)\s*$/u);
    if (splitMatch && !splitText) {
      splitText = splitMatch[1]?.trim() ?? "";
      continue;
    }
    if (splitMatch) continue;
    contentLines.push(line);
  }

  return {
    splitText,
    contentMarkdown: contentLines.join("\n").trim()
  };
}

function shortMeaningFrom(meaningCn: string) {
  return meaningCn.split(/[；;，,\n]/)[0]?.trim() || meaningCn.trim() || "未填写";
}
