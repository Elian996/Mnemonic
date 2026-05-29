"use server";

import { ImportDraftStatus, MnemonicSourceType, MnemonicStatus, Prisma, UserRole, WordStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { aiGeneratedWordCardSource, readAiGeneratedWordCardPayload } from "@/lib/ai-generated-word-cards";
import { normalizeSplitTextForWord } from "@/lib/ai-extension-route-fill";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ensureWordNode, syncEntryWikiLinks } from "@/lib/wiki-links/resolve";
import { markdownToPlainText, renderMnemonicMarkdown } from "@/lib/wiki-links/renderer";

export async function approveAiGeneratedWordCardDraftInlineAction(draftId: string) {
  const user = await requireRole(UserRole.ADMIN);
  const result = await approveAiGeneratedWordCardDraft(user.id, draftId);
  revalidatePath("/repository");
  revalidatePath(`/word/${result.targetSlug}`);
  return result;
}

export async function updateAiGeneratedWordCardDraftInlineAction(input: {
  draftId: string;
  contentMarkdown: string;
}) {
  const user = await requireRole(UserRole.ADMIN);
  const draftId = input.draftId.trim();
  if (!draftId) throw new Error("缺少 AI 生成单词卡草稿 id。");

  const { splitText: rawSplitText, contentMarkdown } = splitEditableMnemonic(input.contentMarkdown);
  if (!rawSplitText.trim() && !contentMarkdown.trim()) {
    throw new Error("记忆卡内容不能为空。");
  }

  const contentHtml = await renderMnemonicMarkdown(contentMarkdown);
  const result = await prisma.$transaction(async (tx) => {
    const draft = await tx.importDraft.findUniqueOrThrow({ where: { id: draftId } });
    if (draft.source !== aiGeneratedWordCardSource || draft.status !== ImportDraftStatus.DRAFT) {
      throw new Error("这个草稿不在 AI生成单词卡待审队列中。");
    }
    const payload = readAiGeneratedWordCardPayload(draft.agentPayload);
    if (!payload) throw new Error("AI 生成单词卡草稿元数据损坏。");
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
        action: "AI_GENERATED_WORD_CARD_DRAFT_UPDATE",
        entityType: "ImportDraft",
        entityId: draft.id,
        metadataJson: {
          batchId: payload.batchId,
          targetWordId: payload.targetWordId,
          targetWord: payload.targetWord,
          methodLabel: payload.methodLabel
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

export async function rejectAiGeneratedWordCardDraftInlineAction(draftId: string) {
  const user = await requireRole(UserRole.ADMIN);
  const trimmedDraftId = draftId.trim();
  if (!trimmedDraftId) throw new Error("缺少 AI 生成单词卡草稿 id。");

  const result = await prisma.$transaction(async (tx) => {
    const draft = await tx.importDraft.findUniqueOrThrow({ where: { id: trimmedDraftId } });
    if (draft.source !== aiGeneratedWordCardSource || draft.status !== ImportDraftStatus.DRAFT) {
      throw new Error("这个草稿不在 AI生成单词卡待审队列中。");
    }
    const payload = readAiGeneratedWordCardPayload(draft.agentPayload);
    await tx.importDraft.update({
      where: { id: draft.id },
      data: { status: ImportDraftStatus.DISCARDED }
    });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "AI_GENERATED_WORD_CARD_REJECT",
        entityType: "ImportDraft",
        entityId: draft.id,
        metadataJson: {
          batchId: payload?.batchId ?? "",
          targetWordId: payload?.targetWordId ?? "",
          targetWord: payload?.targetWord ?? draft.word,
          methodLabel: payload?.methodLabel ?? ""
        } satisfies Prisma.InputJsonObject
      }
    });
    return {
      draftId: draft.id,
      targetWord: payload?.targetWord || draft.word
    };
  });

  revalidatePath("/repository");
  return result;
}

export async function undoAiGeneratedWordCardDraftApprovalInlineAction(draftId: string) {
  const user = await requireRole(UserRole.ADMIN);
  const result = await prisma.$transaction(async (tx) => {
    const draft = await tx.importDraft.findUniqueOrThrow({ where: { id: draftId } });
    if (draft.source !== aiGeneratedWordCardSource || draft.status !== ImportDraftStatus.SAVED || !draft.savedEntryId) {
      throw new Error("这个草稿没有可撤回的 AI生成单词卡批准记录。");
    }
    const payload = readAiGeneratedWordCardPayload(draft.agentPayload);
    if (!payload) throw new Error("AI 生成单词卡草稿元数据损坏。");

    const entry = await tx.mnemonicEntry.findUnique({
      where: { id: draft.savedEntryId },
      include: { targetWord: true }
    });
    if (!entry || entry.editorNote?.includes("ai-generated-word-card-review") !== true) {
      throw new Error("找不到可安全撤回的 AI生成单词卡。");
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
        action: "AI_GENERATED_WORD_CARD_APPROVE_UNDO",
        entityType: "ImportDraft",
        entityId: draft.id,
        metadataJson: {
          entryId: entry.id,
          batchId: payload.batchId,
          targetWordId: entry.targetWordId,
          targetWord: entry.targetWord.word,
          methodLabel: payload.methodLabel
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

async function approveAiGeneratedWordCardDraft(userId: string, draftId: string) {
  return prisma.$transaction(async (tx) => {
    const draft = await tx.importDraft.findUniqueOrThrow({ where: { id: draftId } });
    if (draft.source !== aiGeneratedWordCardSource || draft.status !== ImportDraftStatus.DRAFT) {
      throw new Error("这个草稿不在 AI生成单词卡待审队列中。");
    }
    const payload = readAiGeneratedWordCardPayload(draft.agentPayload);
    if (!payload) throw new Error("AI 生成单词卡草稿元数据损坏。");

    const targetWord = await tx.word.findUniqueOrThrow({ where: { id: payload.targetWordId } });
    const existingActiveCount = await tx.mnemonicEntry.count({
      where: {
        targetWordId: targetWord.id,
        status: { not: MnemonicStatus.ARCHIVED }
      }
    });
    if (existingActiveCount > 0) {
      throw new Error("目标词已经有记忆卡，不能批准 AI 生成草稿。");
    }
    if (!draft.contentMarkdown.trim()) {
      throw new Error("这个 AI 生成草稿内容为空，不能审核通过。");
    }

    const splitText = normalizeSplitTextForWord(draft.splitText || "", targetWord.word);
    const contentHtml = await renderMnemonicMarkdown(draft.contentMarkdown);
    const plainText = markdownToPlainText([splitText ? `划分：${splitText}` : "", draft.contentMarkdown].filter(Boolean).join("\n\n"));
    const entry = await tx.mnemonicEntry.create({
      data: {
        targetWordId: targetWord.id,
        authorId: userId,
        sourceType: MnemonicSourceType.OFFICIAL,
        status: MnemonicStatus.APPROVED,
        title: draft.title || `${targetWord.word} 记忆卡片`,
        splitText,
        contentMarkdown: draft.contentMarkdown,
        contentHtml,
        plainText,
        editorNote: `Codex AI-generated word card: batch=${payload.batchId}, method=${payload.methodLabel}, confidence ${payload.confidence.toFixed(2)}; ai-generated-word-card-review`,
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
        action: "AI_GENERATED_WORD_CARD_APPROVE",
        entityType: "MnemonicEntry",
        entityId: entry.id,
        metadataJson: {
          draftId: draft.id,
          batchId: payload.batchId,
          targetWordId: targetWord.id,
          targetWord: targetWord.word,
          methodLabel: payload.methodLabel,
          routeSummary: payload.routeSummary,
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
