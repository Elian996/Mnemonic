import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, Grid2X2, Inbox, List, Plus, Search, Volume2, Wrench } from "lucide-react";
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
import { WordCardPopupButton } from "@/components/word-card-popup-button";
import {
  RepositoryMissingMnemonicPanel,
  missingMnemonicHref,
  type MissingMnemonicCategory
} from "@/components/repository-missing-mnemonic-panel";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { vocabCategories } from "@/lib/vocab-categories";
import { getMnemonicContaminationAudit } from "@/lib/mnemonic-contamination-audit";
import { readMnemonicLogicAuditReport } from "@/lib/mnemonic-logic-audit-report";
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

  const [totalCount, categoryCounts, importDraftCount, codexP0RepairCount, codexP0EmptyLogs, codexP0ManualRestoreLogs, contaminationGroups, missingMnemonicGroups, logicAuditReport] = await Promise.all([
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
    readMnemonicLogicAuditReport()
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
    <main className="min-h-[calc(100vh-4rem)] bg-[#f5f5f7] text-[#1d1d1f]">
      <section className="mx-auto max-w-7xl px-5 pb-8 pt-10 sm:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-[#6e6e73]">mnemonic</p>
            <h1 className="mt-2 text-5xl font-semibold tracking-normal sm:text-6xl">单词仓库</h1>
            <p className="mt-3 text-lg text-[#6e6e73]">
              {activeCategory ? `${activeCategory.label} ` : ""}
              {letter && !q ? `${letter.toUpperCase()} 开头 ` : ""}
              共 {totalCount} 词，当前第 {currentPage} / {totalPages} 页。
            </p>
            {activeCategory ? <p className="mt-2 text-sm text-[#6e6e73]">{activeCategory.description}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canUseImports ? (
              <Button asChild variant="outline" className="rounded-full border-white bg-white px-5 text-[#1d1d1f] shadow-sm hover:bg-[#f5f5f7]">
                <Link href="/imports" className="inline-flex items-center gap-2">
                  <Inbox className="h-4 w-4" />
                  <span>草稿箱</span>
                  {importDraftCount ? <span className="text-[#6e6e73]">· {importDraftCount}</span> : null}
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" className="rounded-full border-white bg-white px-5 text-[#1d1d1f] shadow-sm hover:bg-[#f5f5f7]">
              <Link href={codexP0RepairHref} className="inline-flex items-center gap-2">
                <Wrench className="h-4 w-4" />
                <span>Codex 修复</span>
                {codexP0RepairCount || codexP0EmptyCount ? (
                  <span className="text-[#6e6e73]">
                    · {codexP0RepairCount}
                    {codexP0EmptyCount ? ` + ${codexP0EmptyCount}留空` : ""}
                  </span>
                ) : null}
              </Link>
            </Button>
            <Button asChild className="rounded-full bg-[#0071e3] px-5 hover:bg-[#0077ed]">
              <Link href="/#new-word" className="inline-flex items-center gap-2">
                <Plus className="h-4 w-4" />
                新建单词
              </Link>
            </Button>
            <Button asChild variant="ghost" className="rounded-full px-5 text-[#06c] hover:bg-white">
              <Link href="/" className="inline-flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                返回工作台
              </Link>
            </Button>
          </div>
        </div>
        {deletedCount ? (
          <div className="mt-6 rounded-2xl bg-white px-4 py-3 text-sm text-emerald-700 shadow-sm">
            已删除 {deletedCount} 个单词。其他卡片数据保持不变。
          </div>
        ) : null}
      </section>

      <section className="mx-auto max-w-7xl px-5 sm:px-8">
        <form className="rounded-[28px] bg-white/90 p-4 shadow-[0_18px_55px_rgba(0,0,0,0.08)] ring-1 ring-black/5 backdrop-blur" action="/repository">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              defaultValue={q}
              className="h-12 rounded-2xl border-0 bg-[#f5f5f7] pl-10 text-base shadow-none focus-visible:ring-1"
              placeholder="搜索单词或释义..."
            />
          </div>
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="reveal" value={reveal ? "1" : ""} />
          <input type="hidden" name="level" value={level} />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <AutoSubmitSelect name="sort" defaultValue={sort} className="h-11 rounded-full border-0 bg-[#f5f5f7] px-5 text-sm text-[#1d1d1f] outline-none ring-1 ring-black/5">
              {Object.entries(sortLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </AutoSubmitSelect>
            <AutoSubmitSelect name="scope" defaultValue={scope} className="h-11 rounded-full border-0 bg-[#f5f5f7] px-5 text-sm text-[#1d1d1f] outline-none ring-1 ring-black/5">
              {Object.entries(scopeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </AutoSubmitSelect>
            <input type="hidden" name="letter" value={letter} />
            <Button asChild variant={view === "grid" ? "default" : "ghost"} size="icon" className={cn("h-11 w-11 rounded-full", view === "grid" ? "bg-[#1d1d1f]" : "bg-[#f5f5f7]")}>
              <Link href={hrefFor({ view: "grid", page: "1" })} aria-label="网格视图">
                <Grid2X2 className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant={view === "list" ? "default" : "ghost"} size="icon" className={cn("h-11 w-11 rounded-full", view === "list" ? "bg-[#1d1d1f]" : "bg-[#f5f5f7]")}>
              <Link href={hrefFor({ view: "list", page: "1" })} aria-label="列表视图">
                <List className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant={reveal ? "default" : "ghost"} size="icon" className={cn("h-11 w-11 rounded-full", reveal ? "bg-[#1d1d1f]" : "bg-[#f5f5f7]")}>
              <Link href={hrefFor({ reveal: reveal ? "" : "1", page: "1" })} aria-label={reveal ? "隐藏释义与记忆方法" : "显示释义与记忆方法"}>
                {reveal ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Link>
            </Button>
          </div>
        </form>
        <nav className="mt-5 flex flex-wrap gap-3" aria-label="类别入口">
          <Link
            href={hrefFor({ level: "", letter: "", page: "1" })}
            className={cn(
              "text-sm font-semibold transition",
              !level ? "text-[#1d1d1f]" : "text-[#06c] hover:text-[#004c99]"
            )}
          >
            全部词库
          </Link>
          {categoryLinks.map((category) => (
            <Link
              key={category.tag}
              href={hrefFor({ level: category.tag, letter: "", page: "1" })}
              title={category.description}
              className={cn(
                "text-sm font-semibold transition",
                level === category.tag ? "text-[#1d1d1f]" : "text-[#06c] hover:text-[#004c99]"
              )}
            >
              {category.label} · {countByCategory[category.tag] ?? 0}
            </Link>
          ))}
        </nav>
        <nav className="mt-4 flex gap-2 overflow-x-auto pb-2" aria-label="字母索引">
          <Link
            href={hrefFor({ q: "", letter: "", page: "1" })}
            className={cn(
              "flex h-9 min-w-14 items-center justify-center border-b-2 px-1 text-sm font-semibold transition",
              !letter ? "border-[#1d1d1f] text-[#1d1d1f]" : "border-transparent text-[#6e6e73] hover:text-[#1d1d1f]"
            )}
          >
            全部
          </Link>
          {alphabet.map((item) => (
            <Link
              key={item}
              href={hrefFor({ q: "", letter: item, page: "1" })}
              className={cn(
                "flex h-9 min-w-7 items-center justify-center border-b-2 text-sm font-semibold uppercase transition",
                letter === item ? "border-[#1d1d1f] text-[#1d1d1f]" : "border-transparent text-[#6e6e73] hover:text-[#1d1d1f]"
              )}
            >
              {item}
            </Link>
          ))}
        </nav>
      </section>

      <RepositoryLogicAuditPanel report={logicAuditReport} />
      <RepositoryContaminationPanel groups={contaminationGroups} />
      <RepositoryMissingMnemonicPanel
        groups={missingMnemonicGroups}
        isAuthenticated={Boolean(user)}
        defaultUserCardVisibility={user?.defaultPublicMnemonics ? "public" : "private"}
        canEditOfficialCards={canEditOfficialCards}
      />

      <section id="word-list" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-8 sm:px-8">
        {words.length === 0 ? (
          <div className="rounded-[28px] bg-white p-12 text-center text-muted-foreground shadow-sm">
            没有找到卡片。可以换个关键词，或回到工作台新建单词。
          </div>
        ) : view === "grid" ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {words.map((word) => (
              <article key={word.id} className="rounded-[28px] bg-white p-5 shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-xl">
                <div className="flex items-start justify-between gap-2">
                  <WordCardPopupButton
                    slug={word.slug}
                    isAuthenticated={Boolean(user)}
                    defaultUserCardVisibility={user?.defaultPublicMnemonics ? "public" : "private"}
                    canEditOfficialCards={canEditOfficialCards}
                    ariaLabel={`打开 ${word.word} 单词卡弹窗`}
                    className="min-w-0 text-3xl font-semibold leading-tight hover:text-[#06c]"
                  >
                    <span className="block truncate">{word.word}</span>
                  </WordCardPopupButton>
                  <div className="flex shrink-0 items-center gap-1">
                    {word.audioUsUrl || word.audioUkUrl ? (
                      <a
                        href={word.audioUsUrl || word.audioUkUrl || "#"}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
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
                  ariaLabel={`打开 ${word.word} 单词卡弹窗`}
                  className="mt-4 block w-full"
                >
                  <div className="flex min-h-36 items-center justify-center rounded-3xl bg-[#f5f5f7] p-5 text-center text-sm font-medium text-muted-foreground">
                    {reveal ? (
                      <div className="space-y-2 text-left">
                        <p className="line-clamp-3">{word.shortMeaningCn || word.meaningCn}</p>
                        <p className="line-clamp-3 text-xs">{word.mnemonicEntries[0]?.splitText || word.mnemonicEntries[0]?.plainText || "还没有记忆方法"}</p>
                      </div>
                    ) : (
                      "释义与带你背已隐藏"
                    )}
                  </div>
                </WordCardPopupButton>
                <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-3 text-sm text-muted-foreground">
                  <span>{word._count.mnemonicEntries} 张卡</span>
                  <Badge>{word._count.mnemonicEntries ? "正文词" : "待补全"}</Badge>
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
          />
        )}
        {totalPages > 1 ? (
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button asChild variant="outline" className="rounded-full px-5" aria-disabled={currentPage <= 1}>
              <Link href={currentPage <= 1 ? hrefFor({ page: "1" }) : hrefFor({ page: String(currentPage - 1) })}>上一页</Link>
            </Button>
            <span className="text-sm text-muted-foreground">
              第 {currentPage} / {totalPages} 页
            </span>
            <Button asChild variant="outline" className="rounded-full px-5" aria-disabled={currentPage >= totalPages}>
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
