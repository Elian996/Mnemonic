"use server";

import { ImportDraftStatus, MnemonicSourceType, MnemonicStatus, Prisma, UserRole, WordStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  aiExtensionDraftSource,
  aiExtensionRouteFillPausedReason,
  buildAiExtensionCandidate,
  candidateToDraftPayload,
  normalizeSplitTextForWord,
  readDraftPayload
} from "@/lib/ai-extension-route-fill";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { markdownToPlainText, renderMnemonicMarkdown } from "@/lib/wiki-links/renderer";
import { ensureWordNode, syncEntryWikiLinks } from "@/lib/wiki-links/resolve";

const reviewHref = "/repository?scope=aiExtensionReview#ai-extension-review";
export async function createAiExtensionDraftAction(formData: FormData) {
  const user = await requireRole(UserRole.ADMIN);
  const baseWordId = String(formData.get("baseWordId") ?? "");
  const targetWordId = String(formData.get("targetWordId") ?? "");
  const ruleKey = String(formData.get("ruleKey") ?? "");
  const requestedReturnTo = String(formData.get("returnTo") || reviewHref);
  const returnTo = requestedReturnTo.startsWith("/") ? requestedReturnTo : reviewHref;
  if (!baseWordId || !targetWordId || !ruleKey) throw new Error("缺少 AI 延伸候选参数。");
  if (aiExtensionRouteFillPausedReason) throw new Error(aiExtensionRouteFillPausedReason);

  const candidate = await buildAiExtensionCandidate(baseWordId, targetWordId, ruleKey);
  if (!candidate) throw new Error("候选已失效：目标词可能已有卡，或路线不再匹配。");

  const existingDraft = await findExistingDraft(candidate.targetWordId, candidate.baseWordId, candidate.ruleKey);
  if (existingDraft) {
    redirect(returnTo);
  }

  await prisma.importDraft.create({
    data: {
      source: aiExtensionDraftSource,
      status: ImportDraftStatus.DRAFT,
      word: candidate.targetWord,
      meaningCn: candidate.targetMeaning,
      shortMeaningCn: candidate.targetMeaning,
      splitText: candidate.splitText,
      title: `${candidate.targetWord} AI 延伸记忆卡`,
      contentMarkdown: candidate.contentMarkdown,
      rawText: candidate.explanation,
      agentPayload: candidateToDraftPayload(candidate) satisfies Prisma.InputJsonValue
    }
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: "AI_EXTENSION_ROUTE_FILL_DRAFT_CREATE",
      entityType: "Word",
      entityId: candidate.targetWordId,
      metadataJson: {
        baseWordId: candidate.baseWordId,
        baseWord: candidate.baseWord,
        targetWord: candidate.targetWord,
        ruleKey: candidate.ruleKey,
        confidence: candidate.confidence
      } satisfies Prisma.InputJsonObject
    }
  });

  revalidatePath("/repository");
  redirect(returnTo);
}

export async function approveAiExtensionDraftAction(formData: FormData) {
  const user = await requireRole(UserRole.ADMIN);
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) throw new Error("缺少 AI 延伸草稿 id。");

  await approveAiExtensionDraft(user.id, draftId);

  revalidatePath("/repository");
  redirect(reviewHref);
}

export async function approveAiExtensionDraftInlineAction(draftId: string) {
  const user = await requireRole(UserRole.ADMIN);
  const result = await approveAiExtensionDraft(user.id, draftId);
  revalidatePath("/repository");
  revalidatePath(`/word/${result.targetSlug}`);
  return result;
}

export async function updateAiExtensionDraftInlineAction(input: {
  draftId: string;
  contentMarkdown: string;
}) {
  const user = await requireRole(UserRole.ADMIN);
  const draftId = input.draftId.trim();
  if (!draftId) throw new Error("缺少 AI 延伸草稿 id。");

  const { splitText: rawSplitText, contentMarkdown } = splitEditableMnemonic(input.contentMarkdown);
  if (!rawSplitText.trim() && !contentMarkdown.trim()) {
    throw new Error("记忆卡内容不能为空。");
  }

  const contentHtml = await renderMnemonicMarkdown(contentMarkdown);
  const result = await prisma.$transaction(async (tx) => {
    const draft = await tx.importDraft.findUniqueOrThrow({ where: { id: draftId } });
    if (draft.source !== aiExtensionDraftSource || draft.status !== ImportDraftStatus.DRAFT) {
      throw new Error("这个草稿不在 AI 延伸待审队列中。");
    }
    const payload = readDraftPayload(draft.agentPayload);
    if (!payload) throw new Error("AI 延伸草稿元数据损坏。");
    const splitText = normalizeSplitTextForWord(rawSplitText, payload.targetWord);

    await tx.importDraft.update({
      where: { id: draft.id },
      data: {
        splitText,
        contentMarkdown
      }
    });

    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "AI_EXTENSION_ROUTE_FILL_DRAFT_UPDATE",
        entityType: "ImportDraft",
        entityId: draft.id,
        metadataJson: {
          targetWordId: payload.targetWordId,
          targetWord: payload.targetWord,
          baseWord: payload.baseWord,
          ruleKey: payload.ruleKey
        } satisfies Prisma.InputJsonObject
      }
    });

    return {
      draftId: draft.id,
      splitText,
      contentMarkdown,
      contentHtml
    };
  });

  revalidatePath("/repository");
  return result;
}

export async function undoAiExtensionDraftApprovalInlineAction(draftId: string) {
  const user = await requireRole(UserRole.ADMIN);
  const result = await prisma.$transaction(async (tx) => {
    const draft = await tx.importDraft.findUniqueOrThrow({ where: { id: draftId } });
    if (draft.source !== aiExtensionDraftSource || draft.status !== ImportDraftStatus.SAVED || !draft.savedEntryId) {
      throw new Error("这个草稿没有可撤回的 AI 延伸批准记录。");
    }
    const payload = readDraftPayload(draft.agentPayload);
    if (!payload) throw new Error("AI 延伸草稿元数据损坏。");

    const entry = await tx.mnemonicEntry.findUnique({
      where: { id: draft.savedEntryId },
      include: { targetWord: true }
    });
    if (!entry || entry.editorNote?.includes("ai-extension-review") !== true) {
      throw new Error("找不到可安全撤回的 AI 延伸记忆卡。");
    }

    if (entry.status !== MnemonicStatus.ARCHIVED) {
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
    }

    await tx.importDraft.update({
      where: { id: draft.id },
      data: {
        status: ImportDraftStatus.DRAFT,
        savedWordId: null,
        savedEntryId: null
      }
    });

    const remainingActiveCount = await tx.mnemonicEntry.count({
      where: {
        targetWordId: entry.targetWordId,
        status: { not: MnemonicStatus.ARCHIVED }
      }
    });
    if (!remainingActiveCount) {
      await tx.word.update({
        where: { id: entry.targetWordId },
        data: { status: WordStatus.NEEDS_REVISION }
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "AI_EXTENSION_ROUTE_FILL_APPROVE_UNDO",
        entityType: "ImportDraft",
        entityId: draft.id,
        metadataJson: {
          entryId: entry.id,
          targetWordId: entry.targetWordId,
          targetWord: entry.targetWord.word,
          baseWord: payload.baseWord,
          ruleKey: payload.ruleKey
        } satisfies Prisma.InputJsonObject
      }
    });

    return {
      draftId: draft.id,
      entryId: entry.id,
      targetWordId: entry.targetWordId,
      targetSlug: entry.targetWord.slug,
      targetWord: entry.targetWord.word
    };
  });

  revalidatePath("/repository");
  revalidatePath(`/word/${result.targetSlug}`);
  return result;
}

export async function rejectAiExtensionDraftAction(formData: FormData) {
  const user = await requireRole(UserRole.ADMIN);
  const draftId = String(formData.get("draftId") ?? "");
  if (!draftId) throw new Error("缺少 AI 延伸草稿 id。");

  await prisma.$transaction(async (tx) => {
    const draft = await tx.importDraft.findUniqueOrThrow({ where: { id: draftId } });
    if (draft.source !== aiExtensionDraftSource || draft.status !== ImportDraftStatus.DRAFT) {
      throw new Error("这个草稿不在 AI 延伸待审队列中。");
    }
    const payload = readDraftPayload(draft.agentPayload);
    await tx.importDraft.update({
      where: { id: draft.id },
      data: { status: ImportDraftStatus.DISCARDED }
    });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "AI_EXTENSION_ROUTE_FILL_REJECT",
        entityType: "ImportDraft",
        entityId: draft.id,
        metadataJson: {
          baseWordId: payload?.baseWordId ?? "",
          baseWord: payload?.baseWord ?? "",
          targetWordId: payload?.targetWordId ?? "",
          targetWord: payload?.targetWord ?? ""
        } satisfies Prisma.InputJsonObject
      }
    });
  });

  revalidatePath("/repository");
  redirect(reviewHref);
}

async function findExistingDraft(targetWordId: string, baseWordId: string, ruleKey: string) {
  const drafts = await prisma.importDraft.findMany({
    where: {
      source: aiExtensionDraftSource,
      status: ImportDraftStatus.DRAFT
    },
    select: { id: true, agentPayload: true },
    take: 300
  });
  return drafts.find((draft) => {
    const payload = readDraftPayload(draft.agentPayload);
    return payload?.targetWordId === targetWordId && payload.baseWordId === baseWordId && payload.ruleKey === ruleKey;
  });
}

async function approveAiExtensionDraft(userId: string, draftId: string) {
  return prisma.$transaction(async (tx) => {
    const draft = await tx.importDraft.findUniqueOrThrow({ where: { id: draftId } });
    if (draft.source !== aiExtensionDraftSource || draft.status !== ImportDraftStatus.DRAFT) {
      throw new Error("这个草稿不在 AI 延伸待审队列中。");
    }
    const payload = readDraftPayload(draft.agentPayload);
    if (!payload) throw new Error("AI 延伸草稿元数据损坏。");

    const targetWord = await tx.word.findUniqueOrThrow({ where: { id: payload.targetWordId } });
    const existingActiveCount = await tx.mnemonicEntry.count({
      where: {
        targetWordId: targetWord.id,
        status: { not: MnemonicStatus.ARCHIVED }
      }
    });
    if (existingActiveCount > 0) {
      throw new Error("目标词已经有记忆卡，不能批准 AI 延伸草稿。");
    }

    const splitText = normalizeSplitTextForWord(draft.splitText, targetWord.word);
    const contentHtml = await renderMnemonicMarkdown(draft.contentMarkdown);
    const plainText = markdownToPlainText([splitText ? `划分：${splitText}` : "", draft.contentMarkdown].filter(Boolean).join("\n\n"));
    const entry = await tx.mnemonicEntry.create({
      data: {
        targetWordId: targetWord.id,
        authorId: userId,
        sourceType: MnemonicSourceType.OFFICIAL,
        status: MnemonicStatus.APPROVED,
        title: `${targetWord.word} 记忆卡片`,
        splitText,
        contentMarkdown: draft.contentMarkdown,
        contentHtml,
        plainText,
        editorNote: `Codex route-fill: base=${payload.baseWord}, route_type=${payload.routeType}, confidence ${payload.confidence.toFixed(2)}; ai-extension-review`,
        isOfficialRecommended: true,
        isPublic: true,
        sortOrder: 0,
        editorScore: 8
      }
    });
    await ensureWordNode(targetWord.id, tx);
    await syncEntryWikiLinks(entry.id, userId, tx);
    await tx.word.update({
      where: { id: targetWord.id },
      data: { status: WordStatus.PUBLISHED }
    });
    await tx.importDraft.update({
      where: { id: draft.id },
      data: {
        status: ImportDraftStatus.SAVED,
        splitText,
        savedWordId: targetWord.id,
        savedEntryId: entry.id
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        action: "AI_EXTENSION_ROUTE_FILL_APPROVE",
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: {
          draftId: draft.id,
          baseWordId: payload.baseWordId,
          baseWord: payload.baseWord,
          targetWord: payload.targetWord,
          ruleKey: payload.ruleKey,
          confidence: payload.confidence
        } satisfies Prisma.InputJsonObject
      }
    });

    return {
      draftId: draft.id,
      entryId: entry.id,
      targetWordId: targetWord.id,
      targetSlug: targetWord.slug,
      targetWord: targetWord.word
    };
  });
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
