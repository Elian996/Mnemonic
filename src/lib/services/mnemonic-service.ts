"use server";

import {
  MnemonicSourceType,
  MnemonicStatus,
  Prisma,
  ReviewRating,
  UserRole,
  WordStatus
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { canEditMnemonic, canReviewSubmissions, canViewMnemonic } from "@/lib/permissions";
import { sortPublicMnemonics } from "@/lib/ranking";
import { ratingRemembered, scheduleReview } from "@/lib/review/scheduler";
import { getCurrentUser, requireRole, requireUser } from "@/lib/auth/session";
import { markdownToPlainText, renderMnemonicMarkdown } from "@/lib/wiki-links/renderer";
import { ensureWordNode, syncEntryWikiLinks } from "@/lib/wiki-links/resolve";

export async function saveOfficialMnemonicAction(formData: FormData) {
  const user = await requireRole(UserRole.EDITOR);
  const wordId = String(formData.get("targetWordId") ?? "");
  const title = String(formData.get("title") ?? "");
  const splitText = String(formData.get("splitText") ?? "");
  const contentMarkdown = normalizeMnemonicContent(String(formData.get("contentMarkdown") ?? ""));
  const status = String(formData.get("status") ?? "DRAFT") as MnemonicStatus;
  const entryId = String(formData.get("id") ?? "");
  const editorScore = Number(formData.get("editorScore") ?? 0);
  const isOfficialRecommended = formData.get("isOfficialRecommended") === "on";
  const returnTo = String(formData.get("returnTo") || "admin");

  await upsertMnemonicEntry({
    entryId: entryId || undefined,
    actorId: user.id,
    authorId: user.id,
    wordId,
    title,
    splitText,
    contentMarkdown,
    sourceType: MnemonicSourceType.OFFICIAL,
    status,
    isPublic: status === MnemonicStatus.APPROVED || status === MnemonicStatus.FEATURED,
    isOfficialRecommended,
    editorScore
  });

  await prisma.word.update({
    where: { id: wordId },
    data: { status: status === MnemonicStatus.ARCHIVED ? WordStatus.NEEDS_REVISION : WordStatus.PUBLISHED }
  });

  const word = await prisma.word.findUniqueOrThrow({ where: { id: wordId } });
  revalidatePath(`/word/${word.slug}`);
  revalidatePath(`/admin/words/${wordId}`);
  revalidatePath("/");
  if (returnTo === "word") redirect(`/word/${word.slug}?saved=mnemonic`);
  redirect(`/admin/words/${wordId}?saved=1`);
}

export async function reorderOfficialMnemonicAction(formData: FormData) {
  const user = await requireRole(UserRole.EDITOR);
  const entryId = String(formData.get("entryId") ?? "");
  const direction = String(formData.get("direction") ?? "");
  const returnTo = String(formData.get("returnTo") || "word");
  if (!entryId || !["up", "down"].includes(direction)) throw new Error("排序参数不完整");

  const word = await prisma.$transaction(async (tx) => {
    const entry = await tx.mnemonicEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { targetWord: true }
    });
    if (entry.sourceType !== MnemonicSourceType.OFFICIAL) throw new Error("只能调整官方记忆卡排序");

    const entries = await tx.mnemonicEntry.findMany({
      where: {
        targetWordId: entry.targetWordId,
        sourceType: MnemonicSourceType.OFFICIAL,
        status: { not: MnemonicStatus.ARCHIVED }
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
    const currentIndex = entries.findIndex((item) => item.id === entry.id);
    const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= entries.length) return entry.targetWord;

    const reordered = [...entries];
    const [current] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, current);
    for (const [index, item] of reordered.entries()) {
      await tx.mnemonicEntry.update({
        where: { id: item.id },
        data: { sortOrder: index }
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "MNEMONIC_REORDER",
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: { direction, wordId: entry.targetWordId }
      }
    });
    return entry.targetWord;
  });

  revalidatePath(`/word/${word.slug}`);
  if (returnTo === "word") redirect(`/word/${word.slug}?saved=reordered`);
  redirect(`/admin/words/${word.id}?saved=reordered`);
}

export async function archiveOfficialMnemonicAction(formData: FormData) {
  const user = await requireRole(UserRole.EDITOR);
  const entryId = String(formData.get("entryId") ?? "");
  const returnTo = String(formData.get("returnTo") || "word");
  if (!entryId) throw new Error("缺少记忆卡 id");

  const word = await prisma.$transaction(async (tx) => {
    const entry = await tx.mnemonicEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { targetWord: true }
    });
    if (entry.sourceType !== MnemonicSourceType.OFFICIAL) throw new Error("只能删除官方记忆卡");

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
      data: {
        status: MnemonicStatus.ARCHIVED,
        isPublic: false,
        isOfficialRecommended: false
      }
    });

    const remaining = await tx.mnemonicEntry.findMany({
      where: {
        targetWordId: entry.targetWordId,
        sourceType: MnemonicSourceType.OFFICIAL,
        status: { not: MnemonicStatus.ARCHIVED }
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
    for (const [index, item] of remaining.entries()) {
      if (item.sortOrder !== index) {
        await tx.mnemonicEntry.update({ where: { id: item.id }, data: { sortOrder: index } });
      }
    }
    if (!remaining.length) {
      await tx.word.update({
        where: { id: entry.targetWordId },
        data: { status: WordStatus.NEEDS_REVISION }
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "MNEMONIC_ARCHIVE",
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: { wordId: entry.targetWordId, word: entry.targetWord.word }
      }
    });
    return entry.targetWord;
  });

  revalidatePath(`/word/${word.slug}`);
  revalidatePath("/repository");
  if (returnTo === "word") redirect(`/word/${word.slug}?deleted=mnemonic`);
  redirect(`/admin/words/${word.id}?deleted=mnemonic`);
}

export async function saveUserMnemonicAction(formData: FormData) {
  const user = await requireUser();
  const wordId = String(formData.get("targetWordId") ?? "");
  const mode = String(formData.get("mode") ?? "private");
  const entryId = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "");
  const splitText = String(formData.get("splitText") ?? "");
  const contentMarkdown = normalizeMnemonicContent(String(formData.get("contentMarkdown") ?? ""));
  const returnTo = String(formData.get("returnTo") || "word");
  const sourceType = mode === "public" ? MnemonicSourceType.USER_PUBLIC : MnemonicSourceType.USER_PRIVATE;
  const status = mode === "public" ? MnemonicStatus.PENDING_REVIEW : MnemonicStatus.PRIVATE;

  const entry = await upsertMnemonicEntry({
    entryId: entryId || undefined,
    actorId: user.id,
    authorId: user.id,
    wordId,
    title,
    splitText,
    contentMarkdown,
    sourceType,
    status,
    isPublic: false,
    isOfficialRecommended: false,
    editorScore: 0
  });

  const word = await prisma.word.findUniqueOrThrow({ where: { id: wordId } });
  revalidateUserMnemonicPaths(word.slug);
  revalidatePath(`/word/${word.slug}`);
  if (returnTo === "mine") redirect(`/me/mnemonics?saved=${entry.status === MnemonicStatus.PENDING_REVIEW ? "review" : "private"}`);
  redirect(`/word/${word.slug}?saved=1`);
}

export async function updateDefaultPublicMnemonicsAction(formData: FormData) {
  const user = await requireUser();
  const enabled = formData.get("defaultPublicMnemonics") === "on";

  await prisma.user.update({
    where: { id: user.id },
    data: { defaultPublicMnemonics: enabled }
  });

  revalidatePath("/me");
  revalidatePath("/me/mnemonics");
  redirect(`/me/mnemonics?defaultPublic=${enabled ? "on" : "off"}`);
}

export async function setUserMnemonicPublicAction(formData: FormData) {
  const user = await requireUser();
  const entryId = String(formData.get("entryId") ?? "");
  const intent = String(formData.get("intent") ?? "public");
  const returnTo = String(formData.get("returnTo") || "mine");
  if (!entryId) throw new Error("缺少记忆卡 id");

  const word = await prisma.$transaction(async (tx) => {
    const entry = await tx.mnemonicEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { targetWord: true }
    });
    if (!canEditMnemonic(user, entry)) throw new Error("没有权限操作此记忆卡");
    if (entry.sourceType === MnemonicSourceType.OFFICIAL) throw new Error("不能用个人公开开关操作官方记忆卡");

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
        reviewNote: null,
        sortOrder:
          entry.sourceType === nextSourceType
            ? entry.sortOrder
            : await nextMnemonicSortOrder(tx, entry.targetWordId, nextSourceType)
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

  revalidatePath(`/word/${word.slug}`);
  revalidateUserMnemonicPaths(word.slug);
  if (returnTo === "word") redirect(`/word/${word.slug}?public=${intent === "private" ? "off" : "pending"}`);
  redirect(`/me/mnemonics?public=${intent === "private" ? "off" : "pending"}`);
}

export async function promoteUserMnemonicAction(formData: FormData) {
  const user = await requireUser();
  const entryId = String(formData.get("entryId") ?? "");
  if (!entryId) throw new Error("缺少记忆卡 id");

  const word = await prisma.$transaction(async (tx) => {
    const entry = await tx.mnemonicEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { targetWord: true }
    });
    if (!canEditMnemonic(user, entry)) throw new Error("没有权限排序此记忆卡");
    if (entry.sourceType === MnemonicSourceType.OFFICIAL) throw new Error("不能用个人排序操作官方记忆卡");

    const entries = await tx.mnemonicEntry.findMany({
      where: {
        targetWordId: entry.targetWordId,
        authorId: entry.authorId,
        sourceType: { not: MnemonicSourceType.OFFICIAL },
        status: { not: MnemonicStatus.ARCHIVED }
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
    const reordered = [entry, ...entries.filter((item) => item.id !== entry.id)];
    for (const [index, item] of reordered.entries()) {
      await tx.mnemonicEntry.update({ where: { id: item.id }, data: { sortOrder: index } });
    }
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "USER_MNEMONIC_PROMOTE",
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: { wordId: entry.targetWordId }
      }
    });
    return entry.targetWord;
  });

  revalidatePath(`/word/${word.slug}`);
  revalidateUserMnemonicPaths(word.slug);
  redirect("/me/mnemonics?promoted=1");
}

export async function archiveUserMnemonicAction(formData: FormData) {
  const user = await requireUser();
  const entryId = String(formData.get("entryId") ?? "");
  if (!entryId) throw new Error("缺少记忆卡 id");

  const wordSlugs = await archiveUserMnemonicEntries(user, [entryId]);
  for (const slug of wordSlugs) revalidatePath(`/word/${slug}`);
  revalidateUserMnemonicPaths(wordSlugs[0]);
  redirect("/me/mnemonics?deleted=1");
}

export async function bulkArchiveUserMnemonicsAction(formData: FormData) {
  const user = await requireUser();
  const entryIds = formData
    .getAll("entryIds")
    .map((value) => String(value))
    .filter(Boolean);
  if (!entryIds.length) redirect("/me/mnemonics?deleted=0");

  const wordSlugs = await archiveUserMnemonicEntries(user, entryIds);
  for (const slug of wordSlugs) revalidatePath(`/word/${slug}`);
  revalidateUserMnemonicPaths(wordSlugs[0]);
  redirect(`/me/mnemonics?deleted=${entryIds.length}`);
}

export async function reviewSubmissionAction(formData: FormData) {
  const user = await requireUser();
  if (!canReviewSubmissions(user)) redirect("/");
  const entryId = String(formData.get("entryId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reviewNote = String(formData.get("reviewNote") ?? "");
  const editorScore = Number(formData.get("editorScore") ?? 0);
  const returnTo = String(formData.get("returnTo") || "admin-reviews");
  if (!["approve", "feature", "reject"].includes(decision)) throw new Error("未知的审核操作。");
  const status =
    decision === "approve"
      ? MnemonicStatus.APPROVED
      : decision === "feature"
        ? MnemonicStatus.FEATURED
        : MnemonicStatus.REJECTED;

  const entry = await prisma.$transaction(async (tx) => {
    const pendingEntry = await tx.mnemonicEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { targetWord: true, author: true }
    });
    if (
      pendingEntry.sourceType !== MnemonicSourceType.USER_PUBLIC ||
      pendingEntry.status !== MnemonicStatus.PENDING_REVIEW
    ) {
      throw new Error("只能审核待审核的用户公开记忆卡。");
    }

    const reviewedEntry = await tx.mnemonicEntry.update({
      where: { id: entryId },
      data: {
        status,
        isPublic: status === MnemonicStatus.APPROVED || status === MnemonicStatus.FEATURED,
        reviewNote,
        editorScore,
        reviewerId: user.id,
        reviewedAt: new Date()
      },
      include: { targetWord: true, author: true }
    });

    if (status === MnemonicStatus.APPROVED || status === MnemonicStatus.FEATURED) {
      await tx.user.update({
        where: { id: reviewedEntry.authorId },
        data: {
          contributionScore: { increment: 10 + editorScore },
          wordCardContributionCount: { increment: 1 }
        }
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: `REVIEW_${decision.toUpperCase()}`,
        entityType: "MnemonicEntry",
        entityId: entryId,
        metadataJson: { reviewNote, editorScore }
      }
    });

    return reviewedEntry;
  });

  const reviewResult =
    status === MnemonicStatus.FEATURED
      ? "审核通过并精选"
      : status === MnemonicStatus.APPROVED
        ? "审核通过"
        : "审核失败";
  await prisma.notification.create({
    data: {
      userId: entry.authorId,
      title: `你的记忆卡${reviewResult}`,
      body: [
        `单词「${entry.targetWord.word}」的「${entry.title}」${reviewResult}。`,
        reviewNote ? `审核意见：${reviewNote}` : ""
      ].filter(Boolean).join("\n"),
      href: `/word/${entry.targetWord.slug}`
    }
  });

  revalidatePath(`/word/${entry.targetWord.slug}`);
  revalidatePath("/admin/reviews");
  revalidatePath("/me/user-submissions");
  revalidatePath("/contributions");
  revalidatePath("/me");
  revalidatePath("/me/inbox");
  if (returnTo === "user-submissions") redirect("/me/user-submissions?saved=1");
  redirect("/admin/reviews?saved=1");
}

export async function likeMnemonicAction(formData: FormData) {
  const user = await requireUser();
  const entryId = String(formData.get("entryId") ?? "");
  const entry = await prisma.mnemonicEntry.findUniqueOrThrow({ where: { id: entryId }, include: { targetWord: true } });
  if (!canViewMnemonic(user, entry)) throw new Error("没有权限操作这张记忆卡。");

  const existing = await prisma.vote.findUnique({
    where: { userId_mnemonicEntryId_type: { userId: user.id, mnemonicEntryId: entryId, type: "LIKE" } }
  });
  if (!existing) {
    await prisma.vote.create({ data: { userId: user.id, mnemonicEntryId: entryId, type: "LIKE" } });
    await prisma.mnemonicEntry.update({ where: { id: entryId }, data: { likeCount: { increment: 1 } } });
  }
  revalidatePath(`/word/${entry.targetWord.slug}`);
}

export async function bookmarkWordAction(formData: FormData) {
  const user = await requireUser();
  const wordId = String(formData.get("wordId") ?? "");
  const entryId = String(formData.get("entryId") || "") || null;
  const word = await prisma.word.findUniqueOrThrow({ where: { id: wordId } });
  if (entryId) {
    const entry = await prisma.mnemonicEntry.findUniqueOrThrow({ where: { id: entryId }, include: { targetWord: true } });
    if (entry.targetWordId !== wordId) throw new Error("记忆卡与单词不匹配。");
    if (!canViewMnemonic(user, entry)) throw new Error("没有权限收藏这张记忆卡。");
  }

  const existing = await prisma.bookmark.findFirst({ where: { userId: user.id, wordId, mnemonicEntryId: entryId } });
  if (!existing) {
    await prisma.bookmark.create({ data: { userId: user.id, wordId, mnemonicEntryId: entryId } });
  }
  if (entryId) {
    await prisma.mnemonicEntry.update({ where: { id: entryId }, data: { bookmarkCount: { increment: 1 } } });
  }
  revalidatePath(`/word/${word.slug}`);
}

export async function reportMnemonicAction(formData: FormData) {
  const user = await requireUser();
  const entryId = String(formData.get("entryId") ?? "");
  const reason = String(formData.get("reason") ?? "内容问题");
  const detail = String(formData.get("detail") ?? "");
  const entry = await prisma.mnemonicEntry.findUniqueOrThrow({ where: { id: entryId } });
  if (!canViewMnemonic(user, entry)) throw new Error("没有权限举报这张记忆卡。");

  await prisma.report.create({
    data: { reporterId: user.id, mnemonicEntryId: entryId, reason, detail }
  });
  await prisma.mnemonicEntry.update({ where: { id: entryId }, data: { reportCount: { increment: 1 } } });
  revalidatePath("/admin/reports");
}

export async function moderateReportAction(formData: FormData) {
  const user = await requireRole(UserRole.REVIEWER);
  const reportId = String(formData.get("reportId") ?? "");
  const decision = String(formData.get("decision") ?? "resolve");
  const report = await prisma.report.update({
    where: { id: reportId },
    data: {
      status: decision === "reject" ? "REJECTED" : "RESOLVED",
      handledById: user.id
    },
    include: { mnemonicEntry: { include: { targetWord: true } } }
  });
  if (decision === "hide") {
    await prisma.mnemonicEntry.update({
      where: { id: report.mnemonicEntryId },
      data: { status: MnemonicStatus.ARCHIVED, isPublic: false }
    });
  }
  revalidatePath("/admin/reports");
  revalidatePath(`/word/${report.mnemonicEntry.targetWord.slug}`);
}

export async function addReviewCardAction(formData: FormData) {
  const user = await requireUser();
  const wordId = String(formData.get("wordId") ?? "");
  const entryId = String(formData.get("entryId") || "") || null;
  await prisma.word.findUniqueOrThrow({ where: { id: wordId }, select: { id: true } });
  if (entryId) {
    const entry = await prisma.mnemonicEntry.findUniqueOrThrow({ where: { id: entryId } });
    if (entry.targetWordId !== wordId) throw new Error("记忆卡与单词不匹配。");
    if (!canViewMnemonic(user, entry)) throw new Error("没有权限复习这张记忆卡。");
  }

  const existing = await prisma.reviewCard.findFirst({ where: { userId: user.id, wordId, mnemonicEntryId: entryId } });
  if (existing) {
    await prisma.reviewCard.update({ where: { id: existing.id }, data: { state: "NEW", dueAt: new Date() } });
  } else {
    await prisma.reviewCard.create({ data: { userId: user.id, wordId, mnemonicEntryId: entryId } });
  }
  revalidatePath("/review");
}

export async function completeReviewAction(formData: FormData) {
  const user = await requireUser();
  const cardId = String(formData.get("cardId") ?? "");
  const rating = String(formData.get("rating") ?? "GOOD") as ReviewRating;
  if (!Object.values(ReviewRating).includes(rating)) throw new Error("未知的复习评分。");

  const card = await prisma.reviewCard.findUniqueOrThrow({ where: { id: cardId } });
  if (card.userId !== user.id) throw new Error("没有权限更新这张复习卡。");
  const next = scheduleReview(card, rating);
  const remembered = ratingRemembered(rating);

  await prisma.$transaction(async (tx) => {
    await tx.reviewCard.update({ where: { id: cardId }, data: next });
    await tx.reviewLog.create({
      data: {
        userId: user.id,
        wordId: card.wordId,
        mnemonicEntryId: card.mnemonicEntryId,
        rating,
        remembered
      }
    });
    if (card.mnemonicEntryId) {
      const logs = await tx.reviewLog.findMany({
        where: { mnemonicEntryId: card.mnemonicEntryId },
        select: { remembered: true }
      });
      const rememberedCount = logs.filter((log) => log.remembered).length;
      const total = logs.length;
      await tx.mnemonicEntry.update({
        where: { id: card.mnemonicEntryId },
        data: { effectivenessScore: total ? rememberedCount / total : 0 }
      });
    }
  });

  revalidatePath("/review");
}

async function archiveUserMnemonicEntries(
  user: { id: string; role: UserRole },
  entryIds: string[]
) {
  const affectedSlugs = new Set<string>();
  await prisma.$transaction(async (tx) => {
    const entries = await tx.mnemonicEntry.findMany({
      where: {
        id: { in: entryIds },
        sourceType: { not: MnemonicSourceType.OFFICIAL },
        status: { not: MnemonicStatus.ARCHIVED }
      },
      include: { targetWord: true }
    });

    for (const entry of entries) {
      if (!canEditMnemonic(user, entry)) throw new Error("没有权限删除此记忆卡");
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
  return Array.from(affectedSlugs);
}

export async function getWordPageData(slug: string) {
  const user = await getCurrentUser();
  const word = await prisma.word.findUnique({
    where: { slug },
    include: {
      mnemonicEntries: {
        include: { author: true, links: { include: { targetNode: true } } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      }
    }
  });
  if (!word) return null;

  const officialEntries = word.mnemonicEntries.filter(
    (entry) => entry.sourceType === MnemonicSourceType.OFFICIAL && entry.status !== MnemonicStatus.ARCHIVED
  );
  const publicEntries = sortPublicMnemonics(
    word.mnemonicEntries.filter(
      (entry) =>
        entry.sourceType === MnemonicSourceType.USER_PUBLIC &&
        entry.isPublic &&
        (entry.status === MnemonicStatus.APPROVED || entry.status === MnemonicStatus.FEATURED)
    )
  );
  const privateEntries = user
    ? word.mnemonicEntries.filter(
        (entry) =>
          entry.sourceType === MnemonicSourceType.USER_PRIVATE &&
          entry.authorId === user.id &&
          entry.status !== MnemonicStatus.ARCHIVED
      )
    : [];
  const userEntries = user
    ? word.mnemonicEntries.filter(
        (entry) =>
          entry.authorId === user.id &&
          entry.sourceType !== MnemonicSourceType.OFFICIAL &&
          entry.status !== MnemonicStatus.ARCHIVED
      )
    : [];
  const node = await prisma.memoryNode.findUnique({ where: { type_slug: { type: "WORD", slug } } });
  const backlinks = node
    ? await prisma.memoryLink.findMany({
        where: { targetNodeId: node.id },
        include: { sourceNode: true, sourceMnemonicEntry: { include: { targetWord: true } } },
        orderBy: { createdAt: "desc" }
      })
    : [];
  const directLinks = node
    ? await prisma.memoryLink.findMany({
        where: { sourceNodeId: node.id, sourceMnemonicEntryId: null },
        include: { targetNode: true },
        orderBy: { createdAt: "desc" }
      })
    : [];
  const chains = node
    ? await prisma.memoryChain.findMany({
        where: { status: "PUBLISHED", items: { some: { nodeId: node.id } } },
        include: { items: { include: { node: true }, orderBy: { orderIndex: "asc" } } },
        take: 5
      })
    : [];

  return { user, word, officialEntries, publicEntries, privateEntries, userEntries, backlinks, directLinks, chains };
}

async function upsertMnemonicEntry(input: {
  entryId?: string;
  actorId: string;
  authorId: string;
  wordId: string;
  title: string;
  splitText: string;
  contentMarkdown: string;
  sourceType: MnemonicSourceType;
  status: MnemonicStatus;
  isPublic: boolean;
  isOfficialRecommended: boolean;
  editorScore: number;
}) {
  const contentHtml = await renderMnemonicMarkdown(input.contentMarkdown);
  const plainText = markdownToPlainText(input.contentMarkdown);

  return prisma.$transaction(async (tx) => {
    if (input.entryId) {
      const existing = await tx.mnemonicEntry.findUniqueOrThrow({ where: { id: input.entryId } });
      const actor = await tx.user.findUniqueOrThrow({ where: { id: input.actorId } });
      if (!canEditMnemonic(actor, existing)) throw new Error("没有权限编辑此内容");
      const sortOrder =
        existing.targetWordId === input.wordId && existing.sourceType === input.sourceType
          ? existing.sortOrder
          : await nextMnemonicSortOrder(tx, input.wordId, input.sourceType);
      await tx.mnemonicEntryVersion.create({
        data: {
          mnemonicEntryId: existing.id,
          contentMarkdown: existing.contentMarkdown,
          splitText: existing.splitText,
          title: existing.title,
          editorId: input.actorId
        }
      });
      const entry = await tx.mnemonicEntry.update({
        where: { id: input.entryId },
        data: {
          targetWordId: input.wordId,
          sourceType: input.sourceType,
          title: input.title,
          splitText: input.splitText,
          contentMarkdown: input.contentMarkdown,
          contentHtml,
          plainText,
          status: input.status,
          isPublic: input.isPublic,
          isOfficialRecommended: input.isOfficialRecommended,
          sortOrder,
          editorScore: input.editorScore
        }
      });
      await ensureWordNode(input.wordId, tx);
      await syncEntryWikiLinks(entry.id, input.actorId, tx);
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "MNEMONIC_UPDATE",
          entityType: "MnemonicEntry",
          entityId: entry.id,
          metadataJson: {
            wordId: input.wordId,
            previous: { sourceType: existing.sourceType, status: existing.status },
            next: { sourceType: input.sourceType, status: input.status }
          }
        }
      });
      return entry;
    }

    const entry = await tx.mnemonicEntry.create({
      data: {
        targetWordId: input.wordId,
        authorId: input.authorId,
        sourceType: input.sourceType,
        status: input.status,
        title: input.title,
        splitText: input.splitText,
        contentMarkdown: input.contentMarkdown,
        contentHtml,
        plainText,
        isPublic: input.isPublic,
        isOfficialRecommended: input.isOfficialRecommended,
        sortOrder: await nextMnemonicSortOrder(tx, input.wordId, input.sourceType),
        editorScore: input.editorScore
      }
    });
    await ensureWordNode(input.wordId, tx);
    await syncEntryWikiLinks(entry.id, input.actorId, tx);
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "MNEMONIC_SAVE",
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: { sourceType: input.sourceType, status: input.status }
      }
    });
    return entry;
  });
}

async function nextMnemonicSortOrder(
  tx: Prisma.TransactionClient,
  wordId: string,
  sourceType: MnemonicSourceType
) {
  const latest = await tx.mnemonicEntry.findFirst({
    where: { targetWordId: wordId, sourceType, status: { not: MnemonicStatus.ARCHIVED } },
    orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
    select: { sortOrder: true }
  });
  return (latest?.sortOrder ?? -1) + 1;
}

function normalizeMnemonicContent(markdown: string) {
  const marker = markdown.search(/\n*相关单词[:：]/u);
  if (marker === -1) return markdown.trim();
  const body = markdown.slice(0, marker).trimEnd();
  const relatedText = markdown.slice(marker);
  const words = Array.from(
    new Set(
      Array.from(relatedText.matchAll(/\[\[word:([^|\]\s]+)(?:\|[^\]]+)?\]\]/giu))
        .map((match) => String(match[1] ?? "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
  const relatedBlock = words.length ? ["相关单词：", ...words.map((word) => `[[word:${word}]]`)].join("\n") : "";
  return [body, relatedBlock].filter(Boolean).join("\n\n").trim();
}

function revalidateUserMnemonicPaths(wordSlug?: string) {
  revalidatePath("/me");
  revalidatePath("/me/mnemonics");
  revalidatePath("/me/user-submissions");
  revalidatePath("/admin/reviews");
  revalidatePath("/contributions");
  if (wordSlug) revalidatePath(`/word/${wordSlug}`);
}
