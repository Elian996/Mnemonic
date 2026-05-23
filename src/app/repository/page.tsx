import Link from "next/link";
import { ChevronDown, Eye, EyeOff, Grid2X2, Inbox, List, Plus, Search, Volume2, Wrench } from "lucide-react";
import { LevelTag, MnemonicSourceType, MnemonicStatus, Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { hasRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RepositoryBulkDeleteList } from "@/components/repository-bulk-delete-list";
import { RepositoryDeleteButton } from "@/components/repository-delete-button";
import { RepositoryContaminationPanel } from "@/components/repository-contamination-panel";
import { RepositoryLogicAuditPanel } from "@/components/repository-logic-audit-panel";
import { RepositoryWorkloadPanel, type RepositoryWorkloadRecord } from "@/components/repository-workload-panel";
import { WordCardPopupButton } from "@/components/word-card-popup-button";
import {
  RepositoryMissingMnemonicPanel,
  missingMnemonicHref,
  type MissingMnemonicCategory
} from "@/components/repository-missing-mnemonic-panel";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { PublicTopBar } from "@/components/public-top-bar";
import { vocabCategories } from "@/lib/vocab-categories";
import { getMnemonicContaminationAudit } from "@/lib/mnemonic-contamination-audit";
import { readMnemonicLogicAuditReport } from "@/lib/mnemonic-logic-audit-report";
import { repairProgressWorkloadAuditAction } from "@/lib/repository-workload";
import { bulkDeleteWordsFromRepositoryAction } from "@/lib/services/word-service";
import {
  codexP0ManualRestoreAction,
  codexP0RepairHref,
  codexP0RepairMarker,
  metadataHasCodexP0RepairMarker
} from "@/lib/codex-p0-repair";

type RepositorySearchParams = {
  q?: string;
  sort?: string;
  view?: string;
  reveal?: string;
  scope?: string;
  letter?: string;
  level?: string;
  page?: string;
  deleted?: string;
};

const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
const pageSize = 120;
const missingMnemonicPreviewSize = 24;
const workloadStartUtc = new Date(Date.UTC(2026, 4, 17, 16, 0, 0));
const halfDayMs = 12 * 60 * 60 * 1000;
const shanghaiOffsetMs = 8 * 60 * 60 * 1000;
const workloadAuditActions = [
  "MNEMONIC_QUICK_CREATE",
  "MNEMONIC_QUICK_UPDATE",
  "MNEMONIC_QUICK_DELETE",
  "MNEMONIC_QUICK_RESTORE",
  "USER_MNEMONIC_QUICK_CREATE",
  "USER_MNEMONIC_QUICK_UPDATE",
  "USER_MNEMONIC_QUICK_DELETE",
  "USER_MNEMONIC_QUICK_RESTORE",
  "WORD_MEANING_QUICK_UPDATE",
  "WORD_CREATE",
  "WORD_UPDATE",
  "MNEMONIC_SAVE",
  "MNEMONIC_ARCHIVE",
  repairProgressWorkloadAuditAction
];

const categoryLinks = vocabCategories;

const sortLabels: Record<string, string> = {
  recent: "最近添加",
  oldest: "最早添加",
  az: "按字母 A-Z",
  za: "按字母 Z-A"
};

const scopeLabels: Record<string, string> = {
  all: "当前(全部)",
  withMnemonic: "已有记忆方法",
  empty: "待补全"
};

export default async function RepositoryPage({
  searchParams
}: {
  searchParams: Promise<RepositorySearchParams>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const sort = sortLabels[params.sort ?? ""] ? String(params.sort) : "az";
  const view = params.view === "list" ? "list" : "grid";
  const reveal = params.reveal === "1";
  const scope = scopeLabels[params.scope ?? ""] ? String(params.scope) : "all";
  const letter = params.letter && alphabet.includes(params.letter.toLowerCase()) ? params.letter.toLowerCase() : "";
  const level = categoryLinks.some((category) => category.tag === params.level) ? (params.level as LevelTag) : "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const deletedCount = Math.max(0, Number.parseInt(params.deleted ?? "0", 10) || 0);
  const activeCategory = categoryLinks.find((category) => category.tag === level);
  const user = await getSessionUser();
  const canUseImports = hasRole(user, UserRole.ADMIN);
  const canEditOfficialCards = hasRole(user, UserRole.EDITOR);
  const canExportMemoryCardImages = hasRole(user, UserRole.ADMIN);

  const baseWhere = (levelFilter: LevelTag | ""): Prisma.WordWhereInput => ({
    AND: [
      q
        ? {
            OR: [
              { word: { contains: q, mode: "insensitive" as const } },
              { meaningCn: { contains: q, mode: "insensitive" as const } },
              { shortMeaningCn: { contains: q, mode: "insensitive" as const } }
            ]
          }
        : {},
      letter && !q ? { word: { startsWith: letter } } : {},
      levelFilter ? { levelTags: { has: levelFilter } } : {},
      scope === "withMnemonic" ? { mnemonicEntries: { some: { status: { not: "ARCHIVED" as const } } } } : {},
      scope === "empty" ? { mnemonicEntries: { none: { status: { not: "ARCHIVED" as const } } } } : {}
    ]
  });
  const where = baseWhere(level);

  const orderBy =
    sort === "oldest"
      ? { createdAt: "asc" as const }
      : sort === "az"
        ? { word: "asc" as const }
        : sort === "za"
          ? { word: "desc" as const }
          : { createdAt: "desc" as const };

  const [totalCount, categoryCounts, importDraftCount, codexP0RepairCount, codexP0EmptyLogs, codexP0ManualRestoreLogs, contaminationGroups, missingMnemonicGroups, logicAuditReport, workloadRecords] = await Promise.all([
    prisma.word.count({ where }),
    Promise.all(
      categoryLinks.map(async (category) => [
        category.tag,
        await prisma.word.count({ where: baseWhere(category.tag) })
      ] as const)
    ),
    canUseImports ? prisma.importDraft.count({ where: { status: "DRAFT" } }) : Promise.resolve(0),
    prisma.mnemonicEntry.count({
      where: {
        sourceType: MnemonicSourceType.OFFICIAL,
        status: { not: MnemonicStatus.ARCHIVED },
        editorNote: { contains: codexP0RepairMarker }
      }
    }),
    prisma.auditLog.findMany({
      where: { action: "CODEX_P0_SOURCE_EMPTY" },
      select: { entityId: true, metadataJson: true }
    }),
    prisma.auditLog.findMany({
      where: { action: codexP0ManualRestoreAction },
      select: { entityId: true, metadataJson: true }
    }),
    getMnemonicContaminationAudit(),
    getMissingMnemonicGroups(),
    readMnemonicLogicAuditReport(),
    getRepositoryWorkloadRecords(user?.id ?? null)
  ]);
  const codexP0ManuallyRestoredWordIds = new Set(codexP0ManualRestoreLogs.map((log) => log.entityId));
  const codexP0EmptyCount = new Set(
    codexP0EmptyLogs
      .filter((log) => metadataHasCodexP0RepairMarker(log.metadataJson))
      .filter((log) => !codexP0ManuallyRestoredWordIds.has(log.entityId))
      .map((log) => log.entityId)
  ).size;
  const countByCategory = Object.fromEntries(categoryCounts) as Partial<Record<LevelTag, number>>;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(page, totalPages);
  const words = await prisma.word.findMany({
    where,
    include: {
      _count: {
        select: { mnemonicEntries: { where: { status: { not: "ARCHIVED" } } } }
      },
      mnemonicEntries: {
        where: { status: { not: "ARCHIVED" } },
        orderBy: [{ sourceType: "asc" }, { updatedAt: "desc" }],
        take: 1
      }
    },
    orderBy,
    skip: (currentPage - 1) * pageSize,
    take: pageSize
  });

  const hrefFor = (overrides: Partial<RepositorySearchParams>) => {
    const next = { q, sort, view, reveal: reveal ? "1" : "", scope, letter, level, page: String(currentPage), ...overrides };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (value && !(key === "page" && value === "1")) query.set(key, value);
    }
    return `/repository${query.size ? `?${query.toString()}` : ""}`;
  };
  const listReturnTo = `${hrefFor({ page: String(currentPage) })}#word-list`;

  return (
    <main className="mn-repository-page">
      <PublicTopBar
        user={user}
        breadcrumbs={[
          { label: "首页", href: "/" },
          { label: "我的", href: "/me" },
          { label: "单词仓库" }
        ]}
        actionsSlot={
          <>
            {canUseImports ? (
              <Link href="/imports" className="mn-repository-top-action">
                <Inbox className="h-4 w-4" />
                <span>草稿</span>
                {importDraftCount ? <span className="mn-repository-top-count">{importDraftCount}</span> : null}
              </Link>
            ) : null}
            <Link href={codexP0RepairHref} className="mn-repository-top-action">
              <Wrench className="h-4 w-4" />
              <span>修复</span>
              {codexP0RepairCount || codexP0EmptyCount ? (
                <span className="mn-repository-top-count">
                  {codexP0RepairCount}
                  {codexP0EmptyCount ? `+${codexP0EmptyCount}` : ""}
                </span>
              ) : null}
            </Link>
            <Link href="/#new-word" className="mn-repository-top-action is-primary" aria-label="新建单词">
              <Plus className="h-4 w-4" />
              <span>新建</span>
            </Link>
          </>
        }
      />

      <section className="mn-repository-container">
        <header className="mn-repository-hero">
          <div className="mn-repository-hero-copy">
            <p className="mn-repository-eyebrow">repository</p>
            <h1 className="mn-repository-title">单词仓库</h1>
            <p className="mn-repository-description">
              {activeCategory ? `${activeCategory.label} ` : "全部词库 "}
              {letter && !q ? ` / ${letter.toUpperCase()} 开头` : ""}
              {q ? ` / 搜索「${q}」` : ""}
            </p>
            {activeCategory ? <p className="mn-repository-category-note">{activeCategory.description}</p> : null}
          </div>
          <div className="mn-repository-hero-meta" aria-label="仓库分页">
            <span>{totalCount.toLocaleString("zh-CN")} 词</span>
            <span>第 {currentPage} / {totalPages} 页</span>
          </div>
        </header>

        {deletedCount ? (
          <div className="mn-repository-notice">
            已删除 {deletedCount} 个单词。其他卡片数据保持不变。
          </div>
        ) : null}

        <form className="mn-repository-toolbar" action="/repository">
          <div className="mn-repository-search-field">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              name="q"
              defaultValue={q}
              className="mn-repository-search-input"
              placeholder="搜索单词或释义..."
            />
          </div>
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="reveal" value={reveal ? "1" : ""} />
          <input type="hidden" name="level" value={level} />
          <div className="mn-repository-control-row">
            <AutoSubmitSelect name="sort" defaultValue={sort} className="mn-repository-select">
              {Object.entries(sortLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </AutoSubmitSelect>
            <AutoSubmitSelect name="scope" defaultValue={scope} className="mn-repository-select">
              {Object.entries(scopeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </AutoSubmitSelect>
            <input type="hidden" name="letter" value={letter} />
            <Button asChild variant={view === "grid" ? "default" : "ghost"} size="icon" className={cn("mn-repository-icon-button", view === "grid" && "is-active")}>
              <Link href={hrefFor({ view: "grid", page: "1" })} aria-label="网格视图">
                <Grid2X2 className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant={view === "list" ? "default" : "ghost"} size="icon" className={cn("mn-repository-icon-button", view === "list" && "is-active")}>
              <Link href={hrefFor({ view: "list", page: "1" })} aria-label="列表视图">
                <List className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant={reveal ? "default" : "ghost"} size="icon" className={cn("mn-repository-icon-button", reveal && "is-active")}>
              <Link href={hrefFor({ reveal: reveal ? "" : "1", page: "1" })} aria-label={reveal ? "隐藏释义与记忆方法" : "显示释义与记忆方法"}>
                {reveal ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Link>
            </Button>
          </div>
        </form>

        <details className="mn-repository-filter-drawer" open={Boolean(level || letter)}>
          <summary>
            <span>筛选范围</span>
            <span className="mn-repository-filter-state">
              {activeCategory?.label ?? "全部词库"}
              {letter ? ` / ${letter.toUpperCase()}` : ""}
            </span>
            <ChevronDown className="h-4 w-4" />
          </summary>
          <div className="mn-repository-filter-content">
            <nav className="mn-repository-category-nav" aria-label="类别入口">
              <Link
                href={hrefFor({ level: "", letter: "", page: "1" })}
                className={cn("mn-repository-filter-link", !level && "is-active")}
              >
                全部词库
                <span>{totalCount.toLocaleString("zh-CN")}</span>
              </Link>
              {categoryLinks.map((category) => (
                <Link
                  key={category.tag}
                  href={hrefFor({ level: category.tag, letter: "", page: "1" })}
                  title={category.description}
                  className={cn("mn-repository-filter-link", level === category.tag && "is-active")}
                >
                  {category.label}
                  <span>{(countByCategory[category.tag] ?? 0).toLocaleString("zh-CN")}</span>
                </Link>
              ))}
            </nav>
            <nav className="mn-repository-letter-nav" aria-label="字母索引">
            <Link
              href={hrefFor({ q: "", letter: "", page: "1" })}
              className={cn(
                "mn-repository-letter-link",
                !letter && "is-active"
              )}
            >
              全部
            </Link>
              {alphabet.map((item) => (
                <Link
                  key={item}
                  href={hrefFor({ q: "", letter: item, page: "1" })}
                  className={cn("mn-repository-letter-link uppercase", letter === item && "is-active")}
                >
                  {item}
                </Link>
              ))}
            </nav>
          </div>
        </details>
      </section>

      <RepositoryWorkloadPanel records={workloadRecords} />
      <RepositoryLogicAuditPanel report={logicAuditReport} />
      <RepositoryContaminationPanel groups={contaminationGroups} />
      <RepositoryMissingMnemonicPanel
        groups={missingMnemonicGroups}
        isAuthenticated={Boolean(user)}
        defaultUserCardVisibility={user?.defaultPublicMnemonics ? "public" : "private"}
        canEditOfficialCards={canEditOfficialCards}
        canExportMemoryCardImages={canExportMemoryCardImages}
      />

      <section id="word-list" className="mn-repository-word-section">
        {words.length === 0 ? (
          <div className="mn-repository-empty-state">
            没有找到卡片。可以换个关键词，或回到工作台新建单词。
          </div>
        ) : view === "grid" ? (
          <div className="mn-repository-word-grid">
            {words.map((word) => (
              <article key={word.id} className="mn-repository-word-card">
                <div className="mn-repository-word-card-head">
                  <WordCardPopupButton
                    slug={word.slug}
                    isAuthenticated={Boolean(user)}
                    defaultUserCardVisibility={user?.defaultPublicMnemonics ? "public" : "private"}
                    canEditOfficialCards={canEditOfficialCards}
                    canExportMemoryCardImages={canExportMemoryCardImages}
                    ariaLabel={`打开 ${word.word} 单词卡弹窗`}
                    className="word-card-title min-w-0 hover:text-[var(--mn-accent)]"
                  >
                    <span className="block truncate">{word.word}</span>
                  </WordCardPopupButton>
                  <div className="mn-repository-word-actions">
                    {word.audioUsUrl || word.audioUkUrl ? (
                      <a
                        href={word.audioUsUrl || word.audioUkUrl || "#"}
                        className="mn-repository-row-icon"
                        aria-label={`播放 ${word.word}`}
                      >
                        <Volume2 className="h-4 w-4" />
                      </a>
                    ) : null}
                    <RepositoryDeleteButton id={word.id} word={word.word} />
                  </div>
                </div>
                <WordCardPopupButton
                  slug={word.slug}
                  isAuthenticated={Boolean(user)}
                  defaultUserCardVisibility={user?.defaultPublicMnemonics ? "public" : "private"}
                  canEditOfficialCards={canEditOfficialCards}
                  canExportMemoryCardImages={canExportMemoryCardImages}
                  ariaLabel={`打开 ${word.word} 单词卡弹窗`}
                  className="mn-repository-word-preview"
                >
                  {reveal ? (
                    <span>
                      <span className="line-clamp-2">{word.shortMeaningCn || word.meaningCn || "未填写释义"}</span>
                      <span className="mt-2 line-clamp-2 text-xs text-[var(--mn-text-faint)]">{word.mnemonicEntries[0]?.splitText || word.mnemonicEntries[0]?.plainText || "还没有记忆方法"}</span>
                    </span>
                  ) : (
                    <span className="mn-repository-hidden-line">已隐藏释义</span>
                  )}
                </WordCardPopupButton>
                <div className="mn-repository-word-card-foot">
                  <span>{word._count.mnemonicEntries} 张卡</span>
                  <Badge className="mn-repository-status-badge">{word._count.mnemonicEntries ? "正文词" : "待补全"}</Badge>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <RepositoryBulkDeleteList
            words={words.map((word) => ({
              id: word.id,
              word: word.word,
              slug: word.slug,
              phonetic: word.phoneticUs || word.phoneticUk || "",
              meaning: reveal ? word.shortMeaningCn || word.meaningCn || "未填写释义" : "释义与带你背已隐藏",
              statusLabel: word._count.mnemonicEntries ? "正文" : "待补全"
            }))}
            returnTo={listReturnTo}
            bulkDeleteAction={bulkDeleteWordsFromRepositoryAction}
            isAuthenticated={Boolean(user)}
            defaultUserCardVisibility={user?.defaultPublicMnemonics ? "public" : "private"}
            canEditOfficialCards={canEditOfficialCards}
            canExportMemoryCardImages={canExportMemoryCardImages}
          />
        )}
        {totalPages > 1 ? (
          <div className="mn-repository-pagination">
            <Button asChild variant="outline" className="mn-repository-page-button" aria-disabled={currentPage <= 1}>
              <Link href={currentPage <= 1 ? hrefFor({ page: "1" }) : hrefFor({ page: String(currentPage - 1) })}>上一页</Link>
            </Button>
            <span>
              第 {currentPage} / {totalPages} 页
            </span>
            <Button asChild variant="outline" className="mn-repository-page-button" aria-disabled={currentPage >= totalPages}>
              <Link href={currentPage >= totalPages ? hrefFor({ page: String(totalPages) }) : hrefFor({ page: String(currentPage + 1) })}>下一页</Link>
            </Button>
          </div>
        ) : null}
      </section>
    </main>
  );
}

async function getMissingMnemonicGroups(): Promise<MissingMnemonicCategory[]> {
  return Promise.all(
    categoryLinks.map(async (category) => {
      const missingWhere = missingMnemonicWhere(category.tag);
      const [totalCount, missingCount, words] = await Promise.all([
        prisma.word.count({ where: { levelTags: { has: category.tag } } }),
        prisma.word.count({ where: missingWhere }),
        prisma.word.findMany({
          where: missingWhere,
          select: {
            id: true,
            word: true,
            slug: true,
            meaningCn: true,
            shortMeaningCn: true
          },
          orderBy: { word: "asc" },
          take: missingMnemonicPreviewSize
        })
      ]);

      return {
        tag: category.tag,
        label: category.label,
        description: category.description,
        totalCount,
        missingCount,
        href: missingMnemonicHref(category.tag),
        words: words.map((word) => ({
          id: word.id,
          word: word.word,
          slug: word.slug,
          meaning: word.shortMeaningCn || word.meaningCn || "释义待补"
        }))
      };
    })
  );
}

function missingMnemonicWhere(tag: LevelTag): Prisma.WordWhereInput {
  return {
    levelTags: { has: tag },
    mnemonicEntries: { none: { status: { not: "ARCHIVED" as const } } }
  };
}

async function getRepositoryWorkloadRecords(actorId: string | null): Promise<RepositoryWorkloadRecord[]> {
  if (!actorId) return [];

  const now = new Date();
  const endUtc = nextWorkloadBoundary(now);
  const logs = await prisma.auditLog.findMany({
    where: {
      actorId,
      action: { in: workloadAuditActions },
      createdAt: { gte: workloadStartUtc, lt: endUtc }
    },
    select: {
      action: true,
      entityType: true,
      entityId: true,
      metadataJson: true,
      createdAt: true
    },
    orderBy: { createdAt: "asc" }
  });

  const entryIdsNeedingLookup = new Set<string>();
  for (const log of logs) {
    if (log.entityType === "MnemonicEntry" && !metadataWordIds(log.metadataJson).length) {
      entryIdsNeedingLookup.add(log.entityId);
    }
  }

  const entryWordIds = entryIdsNeedingLookup.size
    ? new Map(
        (
          await prisma.mnemonicEntry.findMany({
            where: { id: { in: [...entryIdsNeedingLookup] } },
            select: { id: true, targetWordId: true }
          })
        ).map((entry) => [entry.id, entry.targetWordId])
      )
    : new Map<string, string>();

  const resolvedLogs = logs.flatMap((log) =>
    logWordIds(log, entryWordIds).map((wordId) => ({
      ...log,
      wordId
    }))
  );

  const wordIds = [...new Set(resolvedLogs.map((log) => log.wordId))];
  const wordNames = wordIds.length
    ? new Map(
        (
          await prisma.word.findMany({
            where: { id: { in: wordIds } },
            select: { id: true, word: true }
          })
        ).map((word) => [word.id, word.word])
      )
    : new Map<string, string>();

  const buckets = buildWorkloadBuckets(endUtc);
  for (const log of resolvedLogs) {
    const bucketIndex = Math.floor((log.createdAt.getTime() - workloadStartUtc.getTime()) / halfDayMs);
    const bucket = buckets[bucketIndex];
    if (!bucket) continue;

    const isRepairProgressEvent = log.action === repairProgressWorkloadAuditAction;
    bucket.eventCount += 1;
    if (isRepairProgressEvent) {
      bucket.repairEventCount += 1;
    } else if (log.action.includes("MNEMONIC")) {
      bucket.cardEventCount += 1;
    } else if (log.action.startsWith("WORD_")) {
      bucket.meaningEventCount += 1;
    }
    bucket.firstEditedAt ??= log.createdAt;
    bucket.lastEditedAt = log.createdAt;

    if (!bucket.wordIds.has(log.wordId)) {
      bucket.wordIds.add(log.wordId);
      bucket.sampleWords.push(wordNames.get(log.wordId) ?? "unknown");
    }
  }

  return buckets.map((bucket) => ({
    id: bucket.id,
    label: bucket.label,
    rangeLabel: bucket.rangeLabel,
    wordCount: bucket.wordIds.size,
    eventCount: bucket.eventCount,
    cardEventCount: bucket.cardEventCount,
    meaningEventCount: bucket.meaningEventCount,
    repairEventCount: bucket.repairEventCount,
    sampleWords: bucket.sampleWords,
    firstEditLabel: bucket.firstEditedAt ? formatShanghaiTime(bucket.firstEditedAt) : null,
    lastEditLabel: bucket.lastEditedAt ? formatShanghaiTime(bucket.lastEditedAt) : null,
    isStart: bucket.startsAt.getTime() === workloadStartUtc.getTime(),
    isCurrent: now >= bucket.startsAt && now < bucket.endsAt
  }));
}

type WorkloadBucket = {
  id: string;
  label: string;
  rangeLabel: string;
  startsAt: Date;
  endsAt: Date;
  wordIds: Set<string>;
  sampleWords: string[];
  eventCount: number;
  cardEventCount: number;
  meaningEventCount: number;
  repairEventCount: number;
  firstEditedAt: Date | null;
  lastEditedAt: Date | null;
};

function buildWorkloadBuckets(endUtc: Date): WorkloadBucket[] {
  const bucketCount = Math.max(1, Math.ceil((endUtc.getTime() - workloadStartUtc.getTime()) / halfDayMs));
  return Array.from({ length: bucketCount }, (_, index) => {
    const startsAt = new Date(workloadStartUtc.getTime() + index * halfDayMs);
    const endsAt = new Date(startsAt.getTime() + halfDayMs);
    const localParts = shanghaiParts(startsAt);
    const isMorning = localParts.hour < 12;
    const rangeLabel = isMorning ? "00:00-12:00" : "12:00-24:00";
    const monthDay = `${String(localParts.month).padStart(2, "0")}/${String(localParts.day).padStart(2, "0")}`;

    return {
      id: startsAt.toISOString(),
      label: `${localParts.year}/${monthDay} ${isMorning ? "上午" : "下午"}`,
      rangeLabel,
      startsAt,
      endsAt,
      wordIds: new Set<string>(),
      sampleWords: [],
      eventCount: 0,
      cardEventCount: 0,
      meaningEventCount: 0,
      repairEventCount: 0,
      firstEditedAt: null,
      lastEditedAt: null
    };
  });
}

function nextWorkloadBoundary(now: Date) {
  if (now < workloadStartUtc) return new Date(workloadStartUtc.getTime() + halfDayMs);
  const elapsed = now.getTime() - workloadStartUtc.getTime();
  return new Date(workloadStartUtc.getTime() + (Math.floor(elapsed / halfDayMs) + 1) * halfDayMs);
}

function logWordIds(
  log: { entityType: string; entityId: string; metadataJson: Prisma.JsonValue | null },
  entryWordIds: Map<string, string>
) {
  if (log.entityType === "Word") return [log.entityId];
  const wordIds = metadataWordIds(log.metadataJson);
  if (wordIds.length) return wordIds;
  if (log.entityType === "MnemonicEntry") {
    const wordId = entryWordIds.get(log.entityId);
    return wordId ? [wordId] : [];
  }
  return [];
}

function metadataWordIds(metadata: Prisma.JsonValue | null) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const value = metadata as Record<string, unknown>;
  const wordIds = new Set<string>();
  if (typeof value.wordId === "string" && value.wordId) {
    wordIds.add(value.wordId);
  }
  for (const key of ["wordIds", "changedWordIds", "appliedWordIds"]) {
    const rawIds = value[key];
    if (!Array.isArray(rawIds)) continue;
    for (const wordId of rawIds) {
      if (typeof wordId === "string" && wordId) wordIds.add(wordId);
    }
  }
  return [...wordIds];
}

function formatShanghaiTime(date: Date) {
  const parts = shanghaiParts(date);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function shanghaiParts(date: Date) {
  const local = new Date(date.getTime() + shanghaiOffsetMs);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes()
  };
}
