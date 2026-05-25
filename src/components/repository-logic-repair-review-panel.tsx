"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  ExternalLink,
  FileCheck2,
  ListChecks,
  Search,
  X
} from "lucide-react";
import { WordCardPopupButton } from "@/components/word-card-popup-button";
import type { LogicAuditRepairReviewItem } from "@/lib/logic-audit-repair-review";
import { cn } from "@/lib/utils";

type ReviewFilter = "all" | "pending" | "reviewed" | "selected";
type ReviewDirection = "previous" | "next";

const reviewedStorageKey = "mnemonic_logic_audit_repair_reviewed_v1";

export function RepositoryLogicRepairReviewPanel({
  items,
  isAuthenticated,
  defaultUserCardVisibility = "private",
  canEditOfficialCards = false,
  canExportMemoryCardImages = false
}: {
  items: LogicAuditRepairReviewItem[];
  isAuthenticated: boolean;
  defaultUserCardVisibility?: "private" | "public";
  canEditOfficialCards?: boolean;
  canExportMemoryCardImages?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [activeEntryId, setActiveEntryId] = useState(items[0]?.entryId ?? "");
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(() => new Set());
  const [reviewedEntryIds, setReviewedEntryIds] = useState<Set<string>>(() => new Set());
  const [reviewStateLoaded, setReviewStateLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const itemIds = useMemo(() => new Set(items.map((item) => item.entryId)), [items]);
  const itemSignature = useMemo(() => items.map((item) => item.entryId).join("|"), [items]);
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    setSelectedEntryIds(new Set());
    setActiveEntryId((current) => (current && itemIds.has(current) ? current : (items[0]?.entryId ?? "")));
    setReviewStateLoaded(false);
    try {
      const parsed = JSON.parse(window.localStorage.getItem(reviewedStorageKey) || "[]") as unknown;
      const storedIds = Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
      setReviewedEntryIds(new Set(storedIds.filter((entryId) => itemIds.has(entryId))));
    } catch {
      setReviewedEntryIds(new Set());
    } finally {
      setReviewStateLoaded(true);
    }
  }, [itemIds, itemSignature, items]);

  useEffect(() => {
    if (!reviewStateLoaded) return;
    window.localStorage.setItem(reviewedStorageKey, JSON.stringify([...reviewedEntryIds]));
  }, [reviewStateLoaded, reviewedEntryIds]);

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const reviewed = reviewedEntryIds.has(item.entryId);
        const selected = selectedEntryIds.has(item.entryId);
        const matchesFilter =
          filter === "all" ||
          (filter === "pending" && !reviewed) ||
          (filter === "reviewed" && reviewed) ||
          (filter === "selected" && selected);
        if (!matchesFilter) return false;
        if (!normalizedQuery) return true;
        return [
          item.word,
          item.shortMeaningCn,
          item.meaningCn,
          item.changeSummary,
          item.reason,
          item.beforeSplitText ?? "",
          item.afterSplitText ?? ""
        ]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(normalizedQuery));
      }),
    [filter, items, normalizedQuery, reviewedEntryIds, selectedEntryIds]
  );

  useEffect(() => {
    if (!filteredItems.length) {
      setActiveEntryId("");
      return;
    }
    if (!activeEntryId || !filteredItems.some((item) => item.entryId === activeEntryId)) {
      setActiveEntryId(filteredItems[0].entryId);
    }
  }, [activeEntryId, filteredItems]);

  const navigationSlugs = useMemo(() => filteredItems.map((item) => item.slug), [filteredItems]);
  const activeItem =
    filteredItems.find((item) => item.entryId === activeEntryId) ?? filteredItems[0] ?? items[0] ?? null;
  const reviewedCount = items.filter((item) => reviewedEntryIds.has(item.entryId)).length;
  const selectedCount = items.filter((item) => selectedEntryIds.has(item.entryId)).length;
  const pendingCount = Math.max(0, items.length - reviewedCount);
  const filteredEntryIds = filteredItems.map((item) => item.entryId);
  const selectedEntryIdList = items
    .filter((item) => selectedEntryIds.has(item.entryId))
    .map((item) => item.entryId);
  const batchTargetIds = selectedEntryIdList.length ? selectedEntryIdList : filteredEntryIds;

  const toggleSelected = (entryId: string) => {
    setSelectedEntryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  const setReviewed = (entryIds: string[], reviewed: boolean) => {
    setReviewedEntryIds((current) => {
      const next = new Set(current);
      for (const entryId of entryIds) {
        if (reviewed) {
          next.add(entryId);
        } else {
          next.delete(entryId);
        }
      }
      return next;
    });
    setNotice(reviewed ? `已标记 ${entryIds.length} 张` : `已取消 ${entryIds.length} 张`);
  };

  const selectAdjacent = (direction: ReviewDirection) => {
    if (!filteredItems.length) return;
    const currentIndex = activeItem
      ? filteredItems.findIndex((item) => item.entryId === activeItem.entryId)
      : 0;
    const step = direction === "next" ? 1 : -1;
    const nextIndex =
      currentIndex >= 0
        ? (currentIndex + step + filteredItems.length) % filteredItems.length
        : direction === "next"
          ? 0
          : filteredItems.length - 1;
    setActiveEntryId(filteredItems[nextIndex]?.entryId ?? "");
  };

  const copySelectedWords = async () => {
    const selectedWords = items
      .filter((item) => selectedEntryIds.has(item.entryId))
      .map((item) => item.word);
    if (!selectedWords.length) {
      setNotice("还没有选择单词");
      return;
    }

    try {
      await navigator.clipboard.writeText(selectedWords.join("\n"));
      setNotice(`已复制 ${selectedWords.length} 个单词`);
    } catch {
      setNotice("复制失败");
    }
  };

  return (
    <section className="mn-repository-panel-wrap mx-auto max-w-7xl px-5 pt-6 sm:px-8">
      <details
        className="mn-repository-panel group overflow-hidden rounded-[28px] bg-white/95 shadow-[0_18px_55px_rgba(0,0,0,0.08)] ring-1 ring-black/5 dark:bg-card/95 dark:shadow-[0_18px_55px_rgba(0,0,0,0.28)] dark:ring-white/10"
        open={items.length > 0}
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 px-5 py-4 marker:hidden sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-900">
              <FileCheck2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-normal text-foreground">
                123 逻辑修复复查
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {items.length
                  ? `${items.length.toLocaleString("zh-CN")} 张已修改卡片，未看 ${pendingCount.toLocaleString("zh-CN")} 张。`
                  : "暂时没有读取到 Codex 手动修改过的单词卡。"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm font-semibold text-muted-foreground">
            <span>查看结果</span>
            <ChevronRight className="h-4 w-4 transition group-open:rotate-90" />
          </div>
        </summary>

        <div
          className="border-t border-border/70 px-5 py-5 sm:px-6"
          onKeyDown={(event) => {
            if (isEditingTarget(event.target)) return;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              selectAdjacent("previous");
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              selectAdjacent("next");
            }
          }}
        >
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.45fr)]">
            <div className="min-w-0">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <label className="relative block min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索单词、释义、修改摘要"
                    className="h-11 w-full rounded-xl border border-border bg-background px-9 text-sm text-foreground outline-none transition focus:border-[var(--mn-accent)] focus:ring-2 focus:ring-[var(--mn-accent)]/20"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                      aria-label="清空搜索"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      ["all", `全部 ${items.length}`],
                      ["pending", `未看 ${pendingCount}`],
                      ["reviewed", `已看 ${reviewedCount}`],
                      ["selected", `已选 ${selectedCount}`]
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFilter(value)}
                      className={cn(
                        "rounded-lg px-3 py-2 text-sm font-semibold transition",
                        filter === value
                          ? "bg-foreground text-background"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <BatchButton onClick={() => setSelectedEntryIds(new Set(filteredEntryIds))}>
                  <ListChecks className="h-4 w-4" />
                  全选当前
                </BatchButton>
                <BatchButton onClick={() => setSelectedEntryIds(new Set())}>
                  <X className="h-4 w-4" />
                  清空选择
                </BatchButton>
                <BatchButton disabled={!batchTargetIds.length} onClick={() => setReviewed(batchTargetIds, true)}>
                  <CheckCircle2 className="h-4 w-4" />
                  标记已看
                </BatchButton>
                <BatchButton disabled={!batchTargetIds.length} onClick={() => setReviewed(batchTargetIds, false)}>
                  <ClipboardList className="h-4 w-4" />
                  标记未看
                </BatchButton>
                <BatchButton disabled={!selectedCount} onClick={copySelectedWords}>
                  <Copy className="h-4 w-4" />
                  复制已选词
                </BatchButton>
                {notice ? <span className="text-sm font-semibold text-muted-foreground">{notice}</span> : null}
              </div>

              {filteredItems.length ? (
                <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(116px,1fr))] gap-2">
                  {filteredItems.map((item) => (
                    <RepairWordTile
                      key={item.entryId}
                      item={item}
                      isActive={activeItem?.entryId === item.entryId}
                      isSelected={selectedEntryIds.has(item.entryId)}
                      isReviewed={reviewedEntryIds.has(item.entryId)}
                      onSelect={() => setActiveEntryId(item.entryId)}
                      onToggleSelected={() => toggleSelected(item.entryId)}
                    />
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-lg bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground">
                  当前筛选下没有单词卡。
                </p>
              )}
            </div>

            <RepairDetailPane
              item={activeItem}
              navigationSlugs={navigationSlugs}
              isReviewed={activeItem ? reviewedEntryIds.has(activeItem.entryId) : false}
              onSetReviewed={(reviewed) => activeItem && setReviewed([activeItem.entryId], reviewed)}
              onPrevious={() => selectAdjacent("previous")}
              onNext={() => selectAdjacent("next")}
              isAuthenticated={isAuthenticated}
              defaultUserCardVisibility={defaultUserCardVisibility}
              canEditOfficialCards={canEditOfficialCards}
              canExportMemoryCardImages={canExportMemoryCardImages}
            />
          </div>
        </div>
      </details>
    </section>
  );
}

function RepairWordTile({
  item,
  isActive,
  isSelected,
  isReviewed,
  onSelect,
  onToggleSelected
}: {
  item: LogicAuditRepairReviewItem;
  isActive: boolean;
  isSelected: boolean;
  isReviewed: boolean;
  onSelect: () => void;
  onToggleSelected: () => void;
}) {
  return (
    <div
      className={cn(
        "group grid h-14 min-w-0 grid-cols-[1.6rem_minmax(0,1fr)] items-center gap-2 rounded-lg border bg-white px-3 text-base font-semibold tracking-normal text-foreground transition hover:-translate-y-0.5 hover:border-[#1d1d1f] hover:shadow-sm dark:bg-background dark:hover:border-foreground",
        isActive && "border-[#1a73e8] ring-2 ring-[#1a73e8] dark:border-[#7ab7ff] dark:ring-[#7ab7ff]",
        isReviewed
          ? "border-emerald-200 bg-emerald-50/70 text-emerald-950 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-100"
          : "border-border/70"
      )}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onClick={(event) => event.stopPropagation()}
        onChange={onToggleSelected}
        aria-label={`选择 ${item.word}`}
        className="h-4 w-4 rounded border-border accent-[var(--mn-accent)]"
      />
      <button
        type="button"
        onClick={onSelect}
        onFocus={onSelect}
        title={`${item.word}：${item.changeSummary}`}
        aria-label={`查看 ${item.word} 的改动`}
        className="min-w-0 truncate text-left focus:outline-none"
      >
        {item.word}
      </button>
    </div>
  );
}

function RepairDetailPane({
  item,
  navigationSlugs,
  isReviewed,
  onSetReviewed,
  onPrevious,
  onNext,
  isAuthenticated,
  defaultUserCardVisibility,
  canEditOfficialCards,
  canExportMemoryCardImages
}: {
  item: LogicAuditRepairReviewItem | null;
  navigationSlugs: string[];
  isReviewed: boolean;
  onSetReviewed: (reviewed: boolean) => void;
  onPrevious: () => void;
  onNext: () => void;
  isAuthenticated: boolean;
  defaultUserCardVisibility: "private" | "public";
  canEditOfficialCards: boolean;
  canExportMemoryCardImages: boolean;
}) {
  if (!item) {
    return (
      <aside className="rounded-xl border border-border/70 bg-muted/50 p-4 text-sm font-semibold text-muted-foreground">
        选择一个单词后，这里会显示改动。
      </aside>
    );
  }

  return (
    <aside className="sticky top-24 h-fit rounded-xl border border-border/70 bg-muted/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-2xl font-semibold tracking-normal text-foreground">{item.word}</h3>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">{item.shortMeaningCn}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-1 text-xs font-semibold ring-1",
            isReviewed
              ? "bg-emerald-50 text-emerald-900 ring-emerald-100"
              : "bg-amber-50 text-amber-900 ring-amber-100"
          )}
        >
          {isReviewed ? "已看" : "未看"}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onPrevious}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-background text-muted-foreground ring-1 ring-border/70 transition hover:text-foreground"
          aria-label="上一个单词"
          title="上一个单词 (←)"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-background text-muted-foreground ring-1 ring-border/70 transition hover:text-foreground"
          aria-label="下一个单词"
          title="下一个单词 (→)"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onSetReviewed(!isReviewed)}
          className="h-9 rounded-lg bg-background px-3 text-sm font-semibold text-muted-foreground ring-1 ring-border/70 transition hover:text-foreground"
        >
          {isReviewed ? "取消已看" : "标记已看"}
        </button>
        <WordCardPopupButton
          slug={item.slug}
          navigationSlugs={navigationSlugs}
          isAuthenticated={isAuthenticated}
          defaultUserCardVisibility={defaultUserCardVisibility}
          canEditOfficialCards={canEditOfficialCards}
          canExportMemoryCardImages={canExportMemoryCardImages}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-3 text-sm font-semibold text-background transition hover:opacity-90"
          ariaLabel={`打开 ${item.word} 当前单词卡`}
        >
          <ExternalLink className="h-4 w-4" />
          打开卡片
        </WordCardPopupButton>
      </div>

      <div className="mt-4 space-y-3 text-sm leading-6 text-foreground">
        <DetailBlock label="拆分">{formatSplitChange(item.beforeSplitText, item.afterSplitText)}</DetailBlock>
        <DetailBlock label="摘要">{item.changeSummary || "未写入摘要"}</DetailBlock>
        <DetailBlock label="原因">{item.reason || "未写入原因"}</DetailBlock>
        <DetailBlock label="批次">{formatRunTime(item.runCreatedAt)}</DetailBlock>
      </div>
    </aside>
  );
}

function DetailBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-background p-3 ring-1 ring-border/70">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 break-words">{children}</p>
    </div>
  );
}

function BatchButton({
  children,
  disabled = false,
  onClick
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-10 items-center gap-2 rounded-lg bg-muted px-3 text-sm font-semibold text-muted-foreground transition hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function formatSplitChange(before: string | null, after: string | null) {
  const beforeLabel = before?.trim() || "空";
  const afterLabel = after?.trim() || "空";
  if (beforeLabel === afterLabel) return afterLabel;
  return `${beforeLabel} -> ${afterLabel}`;
}

function formatRunTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function isEditingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
