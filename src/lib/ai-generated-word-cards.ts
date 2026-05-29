import { ImportDraftStatus, MnemonicStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { renderMnemonicMarkdown } from "@/lib/wiki-links/renderer";
import { normalizeSplitTextForWord } from "@/lib/ai-extension-route-fill";

export const aiGeneratedWordCardSource = "ai-generated-word-card";

export type AiGeneratedWordCardPayload = {
  type: typeof aiGeneratedWordCardSource;
  batchId: string;
  targetWordId: string;
  targetWord: string;
  targetSlug: string;
  methodLabel: string;
  routeSummary: string;
  confidence: number;
  imagePrompt: string;
};

export async function getAiGeneratedWordCardCount() {
  return prisma.importDraft.count({
    where: {
      source: aiGeneratedWordCardSource,
      status: ImportDraftStatus.DRAFT
    }
  });
}

export async function getAiGeneratedWordCardItems(limit = 80, offset = 0) {
  const drafts = await prisma.importDraft.findMany({
    where: {
      source: aiGeneratedWordCardSource,
      status: ImportDraftStatus.DRAFT
    },
    orderBy: [{ createdAt: "desc" }],
    skip: offset,
    take: limit
  });
  const payloads = drafts
    .map((draft) => ({ draft, payload: readAiGeneratedWordCardPayload(draft.agentPayload) }))
    .filter((item): item is { draft: typeof item.draft; payload: AiGeneratedWordCardPayload } => Boolean(item.payload));

  const targetWordIds = Array.from(new Set(payloads.map((item) => item.payload.targetWordId)));
  const activeCounts = targetWordIds.length
    ? await prisma.mnemonicEntry.groupBy({
        by: ["targetWordId"],
        where: {
          targetWordId: { in: targetWordIds },
          status: { not: MnemonicStatus.ARCHIVED }
        },
        _count: { _all: true }
      })
    : [];
  const activeCountByWordId = new Map(activeCounts.map((count) => [count.targetWordId, count._count._all]));
  const targetWords = targetWordIds.length
    ? await prisma.word.findMany({
        where: { id: { in: targetWordIds } },
        select: {
          id: true,
          word: true,
          slug: true,
          phoneticUk: true,
          phoneticUs: true,
          partOfSpeech: true,
          meaningCn: true,
          shortMeaningCn: true
        }
      })
    : [];
  const targetWordById = new Map(targetWords.map((word) => [word.id, word]));

  return Promise.all(
    payloads.map(async ({ draft, payload }) => {
      const targetWord = targetWordById.get(payload.targetWordId);
      const word = targetWord?.word || draft.word;
      return {
        id: draft.id,
        word,
        slug: targetWord?.slug || payload.targetSlug,
        phonetic: targetWord?.phoneticUs || targetWord?.phoneticUk || "",
        partOfSpeech: targetWord?.partOfSpeech || draft.partOfSpeech || "",
        meaning: targetWord?.shortMeaningCn || draft.shortMeaningCn || draft.meaningCn || "",
        fullMeaning: targetWord?.meaningCn || draft.meaningCn || "",
        splitText: normalizeSplitTextForWord(draft.splitText || "", word),
        contentMarkdown: draft.contentMarkdown,
        contentHtml: await renderMnemonicMarkdown(draft.contentMarkdown),
        imageUrl: draft.originalImageUrl || draft.extractedImageUrls[0] || "",
        createdAt: draft.createdAt,
        payload,
        targetHasActiveCard: (activeCountByWordId.get(payload.targetWordId) ?? 0) > 0
      };
    })
  );
}

export function readAiGeneratedWordCardPayload(value: Prisma.JsonValue | null | undefined): AiGeneratedWordCardPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, Prisma.JsonValue>;
  if (record.type !== aiGeneratedWordCardSource) return null;
  const payload: AiGeneratedWordCardPayload = {
    type: aiGeneratedWordCardSource,
    batchId: readString(record.batchId),
    targetWordId: readString(record.targetWordId),
    targetWord: readString(record.targetWord),
    targetSlug: readString(record.targetSlug),
    methodLabel: readString(record.methodLabel),
    routeSummary: readString(record.routeSummary),
    confidence: readNumber(record.confidence),
    imagePrompt: readString(record.imagePrompt)
  };
  return payload.batchId && payload.targetWordId && payload.targetWord ? payload : null;
}

function readString(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" ? value : "";
}

function readNumber(value: Prisma.JsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
