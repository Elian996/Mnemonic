import { MnemonicSourceType, MnemonicStatus, Prisma, UserRole } from "@prisma/client";
import { CodexP0RepairCards } from "@/components/codex-p0-repair-cards";
import { requireRole } from "@/lib/auth/session";
import {
  codexP0ManualRestoreAction,
  codexP0RepairMarker,
  parseCodexP0RepairEditorNote
} from "@/lib/codex-p0-repair";
import { prisma } from "@/lib/db";
import { readMnemonicLogicAuditReport } from "@/lib/mnemonic-logic-audit-report";
import { hasRole } from "@/lib/permissions";

type CodexP0RepairSearchParams = {
  q?: string;
};

type EmptyRepairItem = {
  wordId: string;
  word: string;
  slug: string;
  phonetic: string;
  partOfSpeech: string;
  meaning: string;
  fullMeaning: string;
  levelTags: string[];
  exampleSentence: string;
  exampleTranslation: string;
  reason: string;
  source: string;
  score: string;
};

export default async function CodexP0RepairPage({
  searchParams
}: {
  searchParams: Promise<CodexP0RepairSearchParams>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const user = await requireRole(UserRole.REVIEWER);
  const entryWhere: Prisma.MnemonicEntryWhereInput = {
    sourceType: MnemonicSourceType.OFFICIAL,
    status: { not: MnemonicStatus.ARCHIVED },
    editorNote: { contains: codexP0RepairMarker },
    ...(q
      ? {
          targetWord: {
            is: {
              OR: [
                { word: { contains: q, mode: "insensitive" } },
                { meaningCn: { contains: q, mode: "insensitive" } },
                { shortMeaningCn: { contains: q, mode: "insensitive" } }
              ]
            }
          }
        }
      : {})
  };
  const [repairedEntries, emptyItems, logicAuditReport] = await Promise.all([
    prisma.mnemonicEntry.findMany({
      where: entryWhere,
      select: {
        id: true,
        title: true,
        splitText: true,
        contentMarkdown: true,
        plainText: true,
        editorNote: true,
        updatedAt: true,
        targetWord: {
          select: {
            id: true,
            word: true,
            slug: true,
            phoneticUk: true,
            phoneticUs: true,
            partOfSpeech: true,
            meaningCn: true,
            shortMeaningCn: true,
            exampleSentence: true,
            exampleTranslation: true,
            levelTags: true
          }
        }
      },
      orderBy: [{ targetWord: { word: "asc" } }, { updatedAt: "desc" }]
    }),
    getEmptyRepairItems(q),
    readMnemonicLogicAuditReport()
  ]);
  const issueByWordId = new Map(
    (logicAuditReport?.issues ?? [])
      .filter((issue) => !issue.issueType.startsWith("keyword_"))
      .map((issue) => [issue.wordId, issue])
  );
  const approvedWordIds = new Set(logicAuditReport?.fixedWordIds ?? []);
  const approvedCandidateCount = [
    ...new Set([...repairedEntries.map((entry) => entry.targetWord.id), ...emptyItems.map((item) => item.wordId)])
  ].filter((wordId) => approvedWordIds.has(wordId)).length;
  const canEditOfficialCards = hasRole(user, UserRole.EDITOR);
  const canExportMemoryCardImages = hasRole(user, UserRole.ADMIN);

  return (
    <main className="min-h-screen bg-[#f7f7f8] text-[#111113]">
      <CodexP0RepairCards
        repairedEntries={repairedEntries.map((entry) => {
          const repair = parseCodexP0RepairEditorNote(entry.editorNote);
          const issue = issueByWordId.get(entry.targetWord.id);
          return {
            id: entry.id,
            wordId: entry.targetWord.id,
            word: entry.targetWord.word,
            slug: entry.targetWord.slug,
            phonetic: entry.targetWord.phoneticUs || entry.targetWord.phoneticUk || "",
            partOfSpeech: entry.targetWord.partOfSpeech,
            meaning: entry.targetWord.shortMeaningCn || entry.targetWord.meaningCn || "释义待补",
            fullMeaning: entry.targetWord.meaningCn || entry.targetWord.shortMeaningCn || "释义待补",
            levelTags: entry.targetWord.levelTags,
            splitText: entry.splitText || "",
            contentMarkdown: entry.contentMarkdown || "",
            plainText: entry.plainText || entry.title,
            exampleSentence: entry.targetWord.exampleSentence || "",
            exampleTranslation: entry.targetWord.exampleTranslation || "",
            source: repair.source,
            score: repair.score,
            issueType: issue?.issueType ?? "codex_p0_review",
            issueSeverity: issue?.severity ?? "P0",
            issueReason: issue?.reason ?? "Codex 按来源重做后需要人工复核。",
            issueEvidence: issue?.evidence ?? "",
            issueSuggestion: issue?.suggestion ?? "确认这张 AI 修复卡是否可以进入已修。"
          };
        })}
        emptyItems={emptyItems}
        query={q}
        approvedWordIds={[...approvedWordIds]}
        initialReviewStates={logicAuditReport?.codexP0ReviewStates ?? {}}
        isAuthenticated={Boolean(user)}
        defaultUserCardVisibility={user?.defaultPublicMnemonics ? "public" : "private"}
        canEditOfficialCards={canEditOfficialCards}
        canExportMemoryCardImages={canExportMemoryCardImages}
        summary={{
          repairedCount: repairedEntries.length,
          emptyCount: emptyItems.length,
          approvedCount: approvedCandidateCount
        }}
      />
    </main>
  );
}

async function getEmptyRepairItems(query: string): Promise<EmptyRepairItem[]> {
  const [emptyLogs, manualRestoreLogs] = await Promise.all([
    prisma.auditLog.findMany({
      where: { action: "CODEX_P0_SOURCE_EMPTY" },
      select: {
        entityId: true,
        metadataJson: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.auditLog.findMany({
      where: { action: codexP0ManualRestoreAction },
      select: { entityId: true }
    })
  ]);
  const manuallyRestoredWordIds = new Set(manualRestoreLogs.map((log) => log.entityId));
  const byWordId = new Map<
    string,
    {
      wordId: string;
      metadata: EmptyRepairMetadata;
    }
  >();

  for (const log of emptyLogs) {
    const metadata = readEmptyRepairMetadata(log.metadataJson);
    if (metadata.marker !== codexP0RepairMarker || byWordId.has(log.entityId)) continue;
    if (manuallyRestoredWordIds.has(log.entityId)) continue;
    byWordId.set(log.entityId, {
      wordId: log.entityId,
      metadata
    });
  }

  const wordIds = [...byWordId.keys()];
  if (!wordIds.length) return [];

  const words = await prisma.word.findMany({
    where: {
      id: { in: wordIds },
      ...(query
        ? {
            OR: [
              { word: { contains: query, mode: "insensitive" } },
              { meaningCn: { contains: query, mode: "insensitive" } },
              { shortMeaningCn: { contains: query, mode: "insensitive" } }
            ]
          }
        : {})
    },
    select: {
      id: true,
      word: true,
      slug: true,
      phoneticUk: true,
      phoneticUs: true,
      partOfSpeech: true,
      meaningCn: true,
      shortMeaningCn: true,
      exampleSentence: true,
      exampleTranslation: true,
      levelTags: true
    },
    orderBy: { word: "asc" }
  });

  return words.map((word) => {
    const metadata = byWordId.get(word.id)?.metadata ?? {};
    return {
      wordId: word.id,
      word: word.word,
      slug: word.slug,
      phonetic: word.phoneticUs || word.phoneticUk || "",
      partOfSpeech: word.partOfSpeech,
      meaning: word.shortMeaningCn || word.meaningCn || "释义待补",
      fullMeaning: word.meaningCn || word.shortMeaningCn || "释义待补",
      levelTags: word.levelTags,
      exampleSentence: word.exampleSentence || "",
      exampleTranslation: word.exampleTranslation || "",
      reason: metadata.reason ?? "",
      source: metadata.bestCandidate?.source ?? "",
      score: metadata.bestCandidate?.score ? String(metadata.bestCandidate.score) : ""
    };
  });
}

type EmptyRepairMetadata = {
  marker?: string;
  reason?: string;
  bestCandidate?: {
    source?: string;
    score?: number;
  } | null;
};

function readEmptyRepairMetadata(value: Prisma.JsonValue | null): EmptyRepairMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, Prisma.JsonValue>;
  const bestCandidate = record.bestCandidate;

  return {
    marker: typeof record.marker === "string" ? record.marker : undefined,
    reason: typeof record.reason === "string" ? record.reason : undefined,
    bestCandidate:
      bestCandidate && typeof bestCandidate === "object" && !Array.isArray(bestCandidate)
        ? {
            source: typeof (bestCandidate as Record<string, Prisma.JsonValue>).source === "string" ? ((bestCandidate as Record<string, Prisma.JsonValue>).source as string) : undefined,
            score: typeof (bestCandidate as Record<string, Prisma.JsonValue>).score === "number" ? ((bestCandidate as Record<string, Prisma.JsonValue>).score as number) : undefined
          }
        : null
  };
}
