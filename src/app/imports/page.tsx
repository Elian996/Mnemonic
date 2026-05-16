import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserWithRole } from "@/lib/auth/session";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  clearImportDraftListAction,
  bulkSaveImportDraftsAction,
  saveFilteredImportDraftsAction,
  undoImportDraftSaveAction
} from "@/lib/services/import-draft-service";
import { ImportDraftListActions } from "@/components/import-draft-list-actions";
import { InteriorContainer, InteriorHero, InteriorPage } from "@/components/interior-shell";

const LIST_PAGE_SIZE = 100;

type ImportsSearchParams = {
  batch?: string;
  bulkFailed?: string;
  bulkSaved?: string;
  bulkSkipped?: string;
  cleared?: string;
  existing?: string;
  filter?: string;
  images?: string;
  noSavable?: string;
  page?: string;
  undone?: string;
};

export default async function ImportsPage({
  searchParams
}: {
  searchParams: Promise<ImportsSearchParams>;
}) {
  const admin = await getUserWithRole(UserRole.ADMIN);
  if (!admin) notFound();

  const params = await searchParams;
  const batchIds = parseBatchIds(params.batch);
  const filter = params.filter === "unsaved" || params.filter === "saved" ? params.filter : "all";
  const existingFilter = params.existing === "with" || params.existing === "without" ? params.existing : "all";
  const imageFilter =
    params.images === "none" || params.images === "one" || params.images === "multiple" ? params.images : "all";
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const baseWhere = batchIds.length
    ? { id: { in: batchIds }, status: { not: "DISCARDED" as const } }
    : { status: { not: "DISCARDED" as const } };
  const statusWhere = filter === "unsaved" ? { status: "DRAFT" as const } : filter === "saved" ? { status: "SAVED" as const } : {};
  const visibleLimit = batchIds.length ? 500 : 5000;
  const [candidateDrafts, unsavedCount, savedCount] = await Promise.all([
    batchIds.length
      ? prisma.importDraft.findMany({
          where: { id: { in: batchIds }, status: { not: "DISCARDED" }, ...statusWhere },
          orderBy: { createdAt: "asc" }
        })
      : prisma.importDraft.findMany({
          where: { ...baseWhere, ...statusWhere },
          orderBy: { createdAt: "desc" },
          take: visibleLimit
        }),
    prisma.importDraft.count({ where: { ...baseWhere, status: "DRAFT" } }),
    prisma.importDraft.count({ where: { ...baseWhere, status: "SAVED" } })
  ]);
  const existingCardCounts = await readExistingCardCounts(candidateDrafts.map((draft) => draft.word));
  const batchDrafts = batchIds.length ? candidateDrafts : [];
  const matchingDrafts = candidateDrafts.filter((draft) => {
    const existingCardCount = getExistingCardCount(existingCardCounts, draft.word);
    if (existingFilter === "with" && existingCardCount === 0) return false;
    if (existingFilter === "without" && existingCardCount > 0) return false;
    const imageCount = draft.extractedImageUrls.length;
    if (imageFilter === "none" && imageCount !== 0) return false;
    if (imageFilter === "one" && imageCount !== 1) return false;
    if (imageFilter === "multiple" && imageCount < 2) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(matchingDrafts.length / LIST_PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const pageStartIndex = matchingDrafts.length ? (currentPage - 1) * LIST_PAGE_SIZE : 0;
  const drafts = matchingDrafts.slice(pageStartIndex, pageStartIndex + LIST_PAGE_SIZE);
  const pageEndIndex = pageStartIndex + drafts.length;
  const facetCounts = {
    existingWith: candidateDrafts.filter((draft) => getExistingCardCount(existingCardCounts, draft.word) > 0).length,
    existingWithout: candidateDrafts.filter((draft) => getExistingCardCount(existingCardCounts, draft.word) === 0).length,
    imageNone: candidateDrafts.filter((draft) => draft.extractedImageUrls.length === 0).length,
    imageOne: candidateDrafts.filter((draft) => draft.extractedImageUrls.length === 1).length,
    imageMultiple: candidateDrafts.filter((draft) => draft.extractedImageUrls.length > 1).length
  };
  const batchIdSet = new Set(batchDrafts.map((draft) => draft.id));
  const savedBatchDrafts = batchDrafts.filter((draft) => draft.status === "SAVED" && draft.savedEntryId);
  const savedVisibleDrafts = drafts.filter((draft) => draft.status === "SAVED" && draft.savedEntryId);
  const selectableCount = drafts.filter((draft) => draft.status === "DRAFT").length;
  const initiallySelectedDraftIds = batchDrafts.filter((draft) => draft.status === "DRAFT").map((draft) => draft.id);
  const canSaveFilteredDrafts = filter !== "saved" && existingFilter === "without" && matchingDrafts.some((draft) => draft.status === "DRAFT");
  const selectionStorageKey = [
    batchIds.length ? `batch:${batchIds.join(",")}` : "recent",
    `status:${filter}`,
    `existing:${existingFilter}`,
    `images:${imageFilter}`,
    `page:${currentPage}`
  ].join("|");
  const importsHrefFor = (overrides: Partial<ImportsSearchParams> = {}) => {
    const next = {
      batch: batchIds.length ? batchIds.join(",") : "",
      filter: filter === "all" ? "" : filter,
      existing: existingFilter === "all" ? "" : existingFilter,
      images: imageFilter === "all" ? "" : imageFilter,
      page: String(currentPage),
      ...overrides
    };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (!value || (key === "page" && value === "1")) continue;
      query.set(key, value);
    }
    return `/imports${query.size ? `?${query.toString()}` : ""}`;
  };

  return (
    <InteriorPage>
      <InteriorContainer wide>
        <InteriorHero
          eyebrow="imports"
          title="导入草稿"
          description="外部 AI Agent、Markdown 批量导入和网页图片上传都会先生成草稿。确认保存后才会写入正式卡片。"
          meta={`未保存 ${unsavedCount.toLocaleString("zh-CN")} / 已保存 ${savedCount.toLocaleString("zh-CN")}`}
          actions={
          <Button asChild>
            <Link href="/imports/new">导入草稿</Link>
          </Button>
          }
        />
        <p className="mt-4 max-w-3xl text-sm text-muted-foreground">
          外部 Agent 接口：<code className="rounded bg-muted px-1">POST /api/import/drafts</code>
        </p>

      {batchDrafts.length ? (
        <section className="mt-6 rounded-xl border border-primary/20 bg-accent p-5 text-accent-foreground shadow-sm">
          <h2 className="text-lg font-semibold">本次批量识别结果</h2>
          <p className="mt-1 text-sm opacity-80">
            共 {batchDrafts.length} 个草稿。可以逐个点开确认保存；返回这里时列表不会丢。
          </p>
          {params.bulkSaved ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-card px-3 py-2 text-sm font-medium">
              <span className="text-emerald-600 dark:text-emerald-300">已批量保存 {params.bulkSaved} 个草稿。</span>
              {savedBatchDrafts.length ? (
                <form action={undoImportDraftSaveAction}>
                  <input type="hidden" name="batch" value={batchIds.join(",")} />
                  <input type="hidden" name="filter" value={filter} />
                  <input type="hidden" name="existing" value={existingFilter} />
                  <input type="hidden" name="images" value={imageFilter} />
                  {savedBatchDrafts.map((draft) => (
                    <input key={draft.id} type="hidden" name="draftId" value={draft.id} />
                  ))}
                  <Button type="submit" variant="destructive" size="sm">
                    一键撤销本批次保存
                  </Button>
                </form>
              ) : null}
            </div>
          ) : null}
          {params.cleared ? (
            <p className="mt-2 rounded-lg bg-card px-3 py-2 text-sm font-medium text-emerald-600 dark:text-emerald-300">
              已从草稿列表清除 {params.cleared} 条。
            </p>
          ) : null}
          {params.bulkSkipped ? (
            <p className="mt-2 rounded-lg bg-card px-3 py-2 text-sm font-medium text-muted-foreground">
              已跳过 {params.bulkSkipped} 条重复词或已不适合保存的草稿。
            </p>
          ) : null}
          {params.bulkFailed ? (
            <p className="mt-2 rounded-lg bg-card px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-300">
              有 {params.bulkFailed} 条草稿保存失败，剩余草稿仍可继续处理。
            </p>
          ) : null}
          {params.undone ? (
            <p className="mt-2 rounded-lg bg-card px-3 py-2 text-sm font-medium text-emerald-600 dark:text-emerald-300">
              已撤销 {params.undone} 条保存，草稿已恢复为未保存。
            </p>
          ) : null}
          {params.noSavable ? (
            <p className="mt-2 rounded-lg bg-card px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-300">
              这批草稿里没有可保存的未保存项，可能已经保存过了。
            </p>
          ) : null}
          {!params.bulkSaved && savedBatchDrafts.length ? (
            <form action={undoImportDraftSaveAction} className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-card px-3 py-2 text-sm">
              <input type="hidden" name="batch" value={batchIds.join(",")} />
              <input type="hidden" name="filter" value={filter} />
              <input type="hidden" name="existing" value={existingFilter} />
              <input type="hidden" name="images" value={imageFilter} />
              {savedBatchDrafts.map((draft) => (
                <input key={draft.id} type="hidden" name="draftId" value={draft.id} />
              ))}
              <span className="text-muted-foreground">这批里有 {savedBatchDrafts.length} 条已保存记录。</span>
              <Button type="submit" variant="destructive" size="sm">
                一键撤销本批次保存
              </Button>
            </form>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {batchDrafts.map((draft) => (
              <Button key={draft.id} asChild variant="outline" className="bg-card">
                <Link href={`/imports/${draft.id}?batch=${encodeURIComponent(batchIds.join(","))}`}>
                  {draft.word} · 已有 {getExistingCardCount(existingCardCounts, draft.word)} 张
                </Link>
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      <form action={bulkSaveImportDraftsAction} className="mt-6 rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
        <input type="hidden" name="batch" value={batchIds.join(",")} />
        <input type="hidden" name="filter" value={filter} />
        <input type="hidden" name="existing" value={existingFilter} />
        <input type="hidden" name="images" value={imageFilter} />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">草稿列表</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              当前筛选共有 {matchingDrafts.length} 条；每页显示 {LIST_PAGE_SIZE} 条，避免一次塞满太多复选框。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ImportDraftListActions
              selectableCount={selectableCount}
              storageKey={selectionStorageKey}
              initialSelectedIds={initiallySelectedDraftIds}
            />
            <Button type="submit" disabled={!selectableCount}>保存选中草稿</Button>
            {canSaveFilteredDrafts ? (
              <Button type="submit" form="save-filtered-import-drafts">
                保存全部无已有卡
              </Button>
            ) : null}
            {savedVisibleDrafts.length ? (
              <Button type="submit" form="undo-saved-imports" variant="destructive">
                一键撤销已保存
              </Button>
            ) : null}
            <Button type="submit" form="clear-import-draft-list" variant="outline" disabled={!matchingDrafts.length}>
              清除列表
            </Button>
          </div>
        </div>
        {params.bulkSaved ? (
          <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            已保存 {params.bulkSaved} 个草稿。
          </p>
        ) : null}
        {params.bulkSkipped ? (
          <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-sm font-medium text-muted-foreground">
            已跳过 {params.bulkSkipped} 条重复词或已不适合保存的草稿。
          </p>
        ) : null}
        {params.bulkFailed ? (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            有 {params.bulkFailed} 条草稿保存失败，剩余草稿仍可继续处理。
          </p>
        ) : null}
        {params.cleared ? (
          <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            已从草稿列表清除 {params.cleared} 条。
          </p>
        ) : null}
        {params.undone ? (
          <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            已撤销 {params.undone} 条保存，草稿已恢复为未保存。
          </p>
        ) : null}
        {params.noSavable ? (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            当前筛选里没有可保存的未保存项，可能已经保存过了。
          </p>
        ) : null}
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          {[
            ["all", "全部"],
            ["unsaved", `未保存 ${unsavedCount}`],
            ["saved", `已保存 ${savedCount}`]
          ].map(([value, label]) => {
            return (
              <Link
                key={value}
                href={importsHrefFor({ filter: value === "all" ? "" : value, page: "1" })}
                className={cn(
                  "rounded-full border px-4 py-2 transition hover:bg-muted",
                  filter === value ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </Link>
            );
          })}
        </div>
        <div className="mb-4 grid gap-3 text-sm md:grid-cols-2">
          <div className="flex flex-wrap items-center gap-2">
            {[
              ["all", `全部已有状态 ${candidateDrafts.length}`],
              ["with", `有已有卡 ${facetCounts.existingWith}`],
              ["without", `无已有卡 ${facetCounts.existingWithout}`]
            ].map(([value, label]) => {
              return (
                <Link
                  key={value}
                  href={importsHrefFor({ existing: value === "all" ? "" : value, page: "1" })}
                  className={cn(
                    "rounded-full border px-4 py-2 transition hover:bg-muted",
                    existingFilter === value
                      ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            {[
              ["all", `全部图片 ${candidateDrafts.length}`],
              ["none", `无图 ${facetCounts.imageNone}`],
              ["one", `1 张图 ${facetCounts.imageOne}`],
              ["multiple", `2 张及以上 ${facetCounts.imageMultiple}`]
            ].map(([value, label]) => {
              return (
                <Link
                  key={value}
                  href={importsHrefFor({ images: value === "all" ? "" : value, page: "1" })}
                  className={cn(
                    "rounded-full border px-4 py-2 transition hover:bg-muted",
                    imageFilter === value
                      ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          当前匹配 {matchingDrafts.length} 条；正在显示第 {currentPage} / {totalPages} 页
          {drafts.length ? `，第 ${pageStartIndex + 1}-${pageEndIndex} 条` : ""}。“清除列表”和“保存全部无已有卡”都会按当前筛选在服务端处理全部匹配草稿。
        </p>
        {totalPages > 1 ? (
          <PaginationNav
            currentPage={currentPage}
            totalPages={totalPages}
            hrefFor={(page) => importsHrefFor({ page: String(page) })}
          />
        ) : null}
        <section className="divide-y divide-border">
        {drafts.map((draft) => (
          <div
            key={draft.id}
            className={cn(
              "flex items-start justify-between gap-4 py-4",
              batchIdSet.has(draft.id) ? "rounded-lg border border-primary/20 bg-accent/70 px-3 text-accent-foreground" : ""
            )}
          >
            <div className="flex min-w-0 items-start gap-3">
              {draft.status === "DRAFT" ? (
                <input
                  type="checkbox"
                  name="draftId"
                  value={draft.id}
                  defaultChecked={batchIdSet.has(draft.id)}
                  data-import-draft-checkbox="true"
                  className="mt-2 h-5 w-5 rounded border"
                />
              ) : (
                <div className="mt-2 h-5 w-5" aria-hidden />
              )}
              <div className="min-w-0">
              <Link
                href={`/imports/${draft.id}${batchIds.length ? `?batch=${encodeURIComponent(batchIds.join(","))}` : ""}`}
                className="text-xl font-semibold hover:text-primary hover:underline"
              >
                {draft.word}
              </Link>
              <div className="mt-1 text-sm text-muted-foreground">{draft.shortMeaningCn || draft.meaningCn}</div>
              <div className="mt-2 flex gap-2">
                <Badge>{draft.source}</Badge>
                <Badge>{draft.extractedImageUrls.length} 张图</Badge>
                <Badge>{getExistingCardCount(existingCardCounts, draft.word)} 张已有记忆卡</Badge>
              </div>
              </div>
            </div>
            <StatusBadge value={draft.status} />
          </div>
        ))}
        {drafts.length === 0 ? <p className="py-10 text-center text-muted-foreground">暂无草稿。</p> : null}
        </section>
        {totalPages > 1 ? (
          <PaginationNav
            currentPage={currentPage}
            totalPages={totalPages}
            hrefFor={(page) => importsHrefFor({ page: String(page) })}
            className="mt-5"
          />
        ) : null}
      </form>
      <form id="clear-import-draft-list" action={clearImportDraftListAction}>
        <input type="hidden" name="batch" value={batchIds.join(",")} />
        <input type="hidden" name="filter" value={filter} />
        <input type="hidden" name="existing" value={existingFilter} />
        <input type="hidden" name="images" value={imageFilter} />
      </form>
      <form id="save-filtered-import-drafts" action={saveFilteredImportDraftsAction}>
        <input type="hidden" name="batch" value={batchIds.join(",")} />
        <input type="hidden" name="filter" value={filter} />
        <input type="hidden" name="existing" value={existingFilter} />
        <input type="hidden" name="images" value={imageFilter} />
      </form>
      <form id="undo-saved-imports" action={undoImportDraftSaveAction}>
        <input type="hidden" name="batch" value={batchIds.join(",")} />
        <input type="hidden" name="filter" value={filter} />
        <input type="hidden" name="existing" value={existingFilter} />
        <input type="hidden" name="images" value={imageFilter} />
        {savedVisibleDrafts.map((draft) => (
          <input key={draft.id} type="hidden" name="draftId" value={draft.id} />
        ))}
      </form>
      </InteriorContainer>
    </InteriorPage>
  );
}

function PaginationNav({
  currentPage,
  totalPages,
  hrefFor,
  className
}: {
  currentPage: number;
  totalPages: number;
  hrefFor: (page: number) => string;
  className?: string;
}) {
  const pageItems = paginationItems(currentPage, totalPages);
  const linkClass = "inline-flex h-9 min-w-9 items-center justify-center rounded-full border px-3 text-sm font-medium transition";
  const inactiveClass = "border-border text-muted-foreground hover:bg-muted hover:text-foreground";
  const disabledClass = "border-border text-muted-foreground/45";

  return (
    <nav className={cn("mb-4 flex flex-wrap items-center gap-2 text-sm", className)} aria-label="草稿分页">
      {currentPage > 1 ? (
        <Link href={hrefFor(currentPage - 1)} className={cn(linkClass, inactiveClass)}>
          上一页
        </Link>
      ) : (
        <span className={cn(linkClass, disabledClass)}>上一页</span>
      )}
      {pageItems.map((item) =>
        typeof item === "number" ? (
          <Link
            key={item}
            href={hrefFor(item)}
            aria-current={item === currentPage ? "page" : undefined}
            className={cn(
              linkClass,
              item === currentPage ? "border-primary bg-primary text-primary-foreground" : inactiveClass
            )}
          >
            {item}
          </Link>
        ) : (
          <span key={item} className="px-1 text-muted-foreground">
            ...
          </span>
        )
      )}
      {currentPage < totalPages ? (
        <Link href={hrefFor(currentPage + 1)} className={cn(linkClass, inactiveClass)}>
          下一页
        </Link>
      ) : (
        <span className={cn(linkClass, disabledClass)}>下一页</span>
      )}
    </nav>
  );
}

function paginationItems(currentPage: number, totalPages: number) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  const items: Array<number | "start-ellipsis" | "end-ellipsis"> = [];
  let previous = 0;
  Array.from(pages)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((first, second) => first - second)
    .forEach((page) => {
      if (previous && page - previous > 1) {
        items.push(previous === 1 ? "start-ellipsis" : "end-ellipsis");
      }
      items.push(page);
      previous = page;
    });
  return items;
}

function parseBatchIds(value: string | undefined) {
  return Array.from(
    new Set(
      String(value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => /^[a-z0-9]+$/i.test(item))
    )
  ).slice(0, 120);
}

async function readExistingCardCounts(words: string[]) {
  const uniqueWords = Array.from(new Set(words.map((word) => word.trim().toLowerCase()).filter(Boolean)));
  if (!uniqueWords.length) return new Map<string, number>();
  const counts = new Map<string, number>();
  for (let index = 0; index < uniqueWords.length; index += 1000) {
    const chunk = uniqueWords.slice(index, index + 1000);
    const rows = await prisma.$queryRaw<Array<{ word: string; count: bigint }>>(
      Prisma.sql`
        SELECT lower(w.word) AS word, count(me.id)::bigint AS count
        FROM "Word" w
        LEFT JOIN "MnemonicEntry" me
          ON me."targetWordId" = w.id
          AND me."sourceType" = 'OFFICIAL'
          AND me.status <> 'ARCHIVED'
        WHERE lower(w.word) IN (${Prisma.join(chunk)})
        GROUP BY lower(w.word)
      `
    );
    rows.forEach((row) => counts.set(row.word, Number(row.count)));
  }
  return counts;
}

function getExistingCardCount(counts: Map<string, number>, word: string) {
  return counts.get(word.trim().toLowerCase()) ?? 0;
}
