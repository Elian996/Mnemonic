import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { MnemonicSourceType, MnemonicStatus, Prisma, UserRole } from "@prisma/client";
import { CodexP0RepairCards } from "@/components/codex-p0-repair-cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSessionUser } from "@/lib/auth/session";
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
  meaning: string;
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
  const [user, repairedEntries, emptyItems, logicAuditReport] = await Promise.all([
    getSessionUser(),
    prisma.mnemonicEntry.findMany({
      where: entryWhere,
      select: {
        id: true,
        title: true,
        splitText: true,
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
            levelTags: true
          }
        }
      },
      orderBy: [{ targetWord: { word: "asc" } }, { updatedAt: "desc" }]
    }),
    getEmptyRepairItems(q),
    readMnemonicLogicAuditReport()
  ]);
  const approvedWordIds = new Set(logicAuditReport?.fixedWordIds ?? []);
  const approvedCandidateCount = [
    ...new Set([...repairedEntries.map((entry) => entry.targetWord.id), ...emptyItems.map((item) => item.wordId)])
  ].filter((wordId) => approvedWordIds.has(wordId)).length;
  const canEditOfficialCards = hasRole(user, UserRole.EDITOR);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f5f5f7] text-[#1d1d1f]">
      <section className="mx-auto max-w-[1440px] px-5 py-6 sm:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#6e6e73]">codex repair</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-normal sm:text-4xl">P0 来源修复词</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6e6e73]">
              这里单独收拢本次由 Codex 按源文件重做的候选卡。人工审核通过后，才会进入仓库里的已修。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild className="h-9 rounded-md bg-[#1d1d1f] px-4 text-white hover:bg-black">
              <Link href="/repository" className="inline-flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                返回仓库
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-black/5 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <form className="relative min-w-0 flex-1" action="/repository/codex-p0-repair">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b8b91]" />
              <Input
                name="q"
                defaultValue={q}
                className="h-10 rounded-md border-0 bg-[#f5f5f7] pl-10 text-sm shadow-none focus-visible:ring-1"
                placeholder="搜索单词或释义"
              />
            </form>
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#6e6e73]">
              <span className="rounded-md bg-[#f5f5f7] px-2.5 py-1">重做 {repairedEntries.length.toLocaleString("zh-CN")}</span>
              <span className="rounded-md bg-[#f5f5f7] px-2.5 py-1">留空 {emptyItems.length.toLocaleString("zh-CN")}</span>
              <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-emerald-800">
                已通过 {approvedCandidateCount.toLocaleString("zh-CN")}
              </span>
              <span className="hidden truncate text-xs font-medium text-[#8b8b91] lg:inline">
                PDF / DOCX 源文件重查结果
              </span>
            </div>
          </div>
        </div>
      </section>

      <CodexP0RepairCards
        repairedEntries={repairedEntries.map((entry) => {
          const repair = parseCodexP0RepairEditorNote(entry.editorNote);
          return {
            id: entry.id,
            wordId: entry.targetWord.id,
            word: entry.targetWord.word,
            slug: entry.targetWord.slug,
            phonetic: entry.targetWord.phoneticUs || entry.targetWord.phoneticUk || "",
            partOfSpeech: entry.targetWord.partOfSpeech,
            meaning: entry.targetWord.shortMeaningCn || entry.targetWord.meaningCn || "释义待补",
            levelTags: entry.targetWord.levelTags,
            splitText: entry.splitText || "",
            plainText: entry.plainText || entry.title,
            source: repair.source,
            score: repair.score
          };
        })}
        emptyItems={emptyItems}
        query={q}
        approvedWordIds={[...approvedWordIds]}
        isAuthenticated={Boolean(user)}
        defaultUserCardVisibility={user?.defaultPublicMnemonics ? "public" : "private"}
        canEditOfficialCards={canEditOfficialCards}
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
      meaningCn: true,
      shortMeaningCn: true
    },
    orderBy: { word: "asc" }
  });

  return words.map((word) => {
    const metadata = byWordId.get(word.id)?.metadata ?? {};
    return {
      wordId: word.id,
      word: word.word,
      slug: word.slug,
      meaning: word.shortMeaningCn || word.meaningCn || "释义待补",
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
