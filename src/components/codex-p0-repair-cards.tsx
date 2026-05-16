"use client";

import { CheckCircle2, CheckSquare, CircleSlash2, Loader2, Maximize2, RotateCcw, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { MemoryCardTray, type LevelWordItem } from "@/components/level-word-browser";
import { applyGuestProgressToWord } from "@/lib/guest-progress";
import { toggleRangeSelection } from "@/lib/range-selection";
import { cn } from "@/lib/utils";

export type CodexP0RepairCardItem = {
  id: string;
  wordId: string;
  word: string;
  slug: string;
  phonetic: string;
  partOfSpeech: string;
  meaning: string;
  levelTags: string[];
  splitText: string;
  plainText: string;
  source: string;
  score: string;
};

export type CodexP0EmptyRepairItem = {
  wordId: string;
  word: string;
  slug: string;
  meaning: string;
  reason: string;
  source: string;
  score: string;
};

export function CodexP0RepairCards({
  repairedEntries,
  emptyItems,
  query,
  approvedWordIds,
  isAuthenticated,
  defaultUserCardVisibility = "private",
  canEditOfficialCards = false
}: {
  repairedEntries: CodexP0RepairCardItem[];
  emptyItems: CodexP0EmptyRepairItem[];
  query: string;
  approvedWordIds: string[];
  isAuthenticated: boolean;
  defaultUserCardVisibility?: "private" | "public";
  canEditOfficialCards?: boolean;
}) {
  const [openCards, setOpenCards] = useState<LevelWordItem[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [approvedIds, setApprovedIds] = useState<Set<string>>(() => new Set(approvedWordIds));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const wordCache = useRef(new Map<string, LevelWordItem>());
  const rangeAnchorWordId = useRef<string | null>(null);
  const candidateWordIds = useMemo(
    () => Array.from(new Set([...repairedEntries.map((entry) => entry.wordId), ...emptyItems.map((item) => item.wordId)])),
    [emptyItems, repairedEntries]
  );
  const reviewDisabled = reviewLoading || !canEditOfficialCards;
  const approvedCount = candidateWordIds.filter((wordId) => approvedIds.has(wordId)).length;
  const pendingCount = Math.max(0, candidateWordIds.length - approvedCount);
  const selectedCandidateIds = candidateWordIds.filter((wordId) => selectedIds.has(wordId));
  const selectedApprovedCount = selectedCandidateIds.filter((wordId) => approvedIds.has(wordId)).length;
  const selectedPendingCount = Math.max(0, selectedCandidateIds.length - selectedApprovedCount);

  useEffect(() => {
    setApprovedIds(new Set(approvedWordIds));
  }, [approvedWordIds]);

  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((wordId) => candidateWordIds.includes(wordId))));
    if (rangeAnchorWordId.current && !candidateWordIds.includes(rangeAnchorWordId.current)) {
      rangeAnchorWordId.current = null;
    }
  }, [candidateWordIds]);

  const openWord = (word: LevelWordItem) => {
    const nextWord = isAuthenticated ? word : applyGuestProgressToWord(word);
    wordCache.current.set(nextWord.slug, nextWord);
    setMessage("");
    setActiveCardId(nextWord.id);
    setOpenCards((current) =>
      [nextWord, ...current.filter((item) => item.id !== nextWord.id)].slice(0, 5)
    );
  };

  const openWordBySlug = async (slug: string) => {
    const cachedWord = wordCache.current.get(slug);
    if (cachedWord) {
      openWord(cachedWord);
      return true;
    }

    setLoadingSlug(slug);
    setMessage("");
    try {
      const fetchedWord = await fetchWordCard(slug);
      openWord(fetchedWord);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "单词卡加载失败。");
      return false;
    } finally {
      setLoadingSlug((current) => (current === slug ? null : current));
    }
  };

  const updateWord = (updatedWord: LevelWordItem) => {
    wordCache.current.set(updatedWord.slug, updatedWord);
    setOpenCards((current) =>
      current.map((word) => (word.id === updatedWord.id ? { ...word, ...updatedWord } : word))
    );
  };

  const toggleSelected = (wordId: string, event?: ReactMouseEvent<HTMLButtonElement>) => {
    const anchorWordId = event?.shiftKey ? rangeAnchorWordId.current : null;
    if (event?.shiftKey) {
      event.preventDefault();
    }

    setSelectedIds((current) => {
      return toggleRangeSelection({
        selectedIds: current,
        orderedIds: candidateWordIds,
        targetId: wordId,
        anchorId: anchorWordId
      });
    });
    rangeAnchorWordId.current = wordId;
  };

  const reviewWords = async (wordIds: string[], approved: boolean) => {
    if (!canEditOfficialCards) {
      setMessage("需要编辑权限才能审核通过。");
      return;
    }
    const uniqueWordIds = Array.from(new Set(wordIds)).filter(Boolean);
    if (!uniqueWordIds.length) return;

    setReviewLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/codex-p0-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordIds: uniqueWordIds, approved })
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        fixedWordIds?: string[];
        wordIds?: string[];
        changedWordIds?: string[];
      };
      if (!response.ok) throw new Error(result.error || "审核状态保存失败。");

      setApprovedIds(new Set(result.fixedWordIds ?? []));
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const wordId of result.wordIds ?? uniqueWordIds) next.delete(wordId);
        return next;
      });
      const changedCount = result.changedWordIds?.length ?? uniqueWordIds.length;
      setMessage(
        approved
          ? `已通过 ${changedCount.toLocaleString("zh-CN")} 个词，会进入仓库已修。`
          : `已撤回 ${changedCount.toLocaleString("zh-CN")} 个词的通过状态。`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "审核状态保存失败。");
    } finally {
      setReviewLoading(false);
    }
  };

  return (
    <>
      <section className="mx-auto max-w-[1440px] px-5 py-3 sm:px-8">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-normal">候选修复</h2>
            <p className="mt-0.5 text-sm text-[#6e6e73]">
              人工通过后才进入仓库已修。当前 {pendingCount.toLocaleString("zh-CN")} 个待审核，{approvedCount.toLocaleString("zh-CN")} 个已通过。
            </p>
          </div>
          {query ? <p className="text-sm text-[#6e6e73]">当前搜索：{query}</p> : null}
        </div>
        <ReviewBatchToolbar
          disabled={reviewDisabled || Boolean(loadingSlug) || !candidateWordIds.length}
          pendingCount={pendingCount}
          approvedCount={approvedCount}
          selectedCount={selectedCandidateIds.length}
          selectedPendingCount={selectedPendingCount}
          selectedApprovedCount={selectedApprovedCount}
          totalCount={candidateWordIds.length}
          onSelectAll={() => setSelectedIds(new Set(candidateWordIds))}
          onClearSelection={() => setSelectedIds(new Set())}
          onApproveSelected={() => void reviewWords(selectedCandidateIds, true)}
          onRevokeSelected={() => void reviewWords(selectedCandidateIds, false)}
        />
        {message ? (
          <p className="mb-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-[#1d1d1f] shadow-sm ring-1 ring-black/5 dark:bg-card dark:text-foreground">
            {message}
          </p>
        ) : null}
        {repairedEntries.length ? (
          <div className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-card">
            {repairedEntries.map((entry) => {
              const isLoading = loadingSlug === entry.slug;
              const isApproved = approvedIds.has(entry.wordId);
              const isSelected = selectedIds.has(entry.wordId);

              return (
                <article
                  key={entry.id}
                  className={cn(
                    "group grid gap-2 border-b border-black/5 px-3 py-2.5 text-left transition last:border-b-0 hover:bg-[#f7f9fc] dark:border-white/10 dark:hover:bg-muted/40 lg:grid-cols-[32px_180px_220px_minmax(0,1fr)_150px_120px] lg:items-start",
                    activeCardId === entry.wordId && "bg-blue-50/70 dark:bg-blue-500/10",
                    isApproved && "border-l-2 border-l-emerald-300 dark:border-l-emerald-500/70"
                  )}
                >
                  <span className="flex items-start lg:justify-center">
                    <button
                      type="button"
                      onClick={(event) => toggleSelected(entry.wordId, event)}
                      disabled={reviewDisabled}
                      className={cn(
                        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition",
                        isSelected
                          ? "bg-[#0071e3] text-white"
                          : "bg-[#f5f5f7] text-[#6e6e73] hover:text-[#1d1d1f] dark:bg-muted dark:hover:text-foreground"
                      )}
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? "取消选择" : "选择"} ${entry.word}`}
                      title="Shift 单击可范围选择"
                    >
                      {isSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </button>
                  </span>
                  <span className="min-w-0">
                    <button
                      type="button"
                      onClick={() => void openWordBySlug(entry.slug)}
                      disabled={Boolean(loadingSlug)}
                      className="min-w-0 text-left disabled:pointer-events-none disabled:opacity-70"
                    >
                      <span className="block truncate text-lg font-semibold leading-6 text-[#06c] group-hover:text-[#004c99] dark:text-[#7ab7ff]">
                        {entry.word}
                      </span>
                      <span className="block truncate text-xs text-[#6e6e73]">
                        {[entry.phonetic, entry.partOfSpeech].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                    <span className="mt-1 flex max-h-6 flex-wrap gap-1 overflow-hidden">
                      {entry.levelTags.slice(0, 3).map((tag) => (
                        <Badge key={tag} className="h-5 border-transparent bg-[#f5f5f7] px-1.5 text-[11px] text-[#6e6e73] dark:bg-muted">
                          {tag}
                        </Badge>
                      ))}
                      {entry.levelTags.length > 3 ? (
                        <Badge className="h-5 border-transparent bg-[#f5f5f7] px-1.5 text-[11px] text-[#6e6e73] dark:bg-muted">
                          +{entry.levelTags.length - 3}
                        </Badge>
                      ) : null}
                    </span>
                  </span>
                  <span className="min-w-0 text-sm leading-5 text-[#6e6e73]">
                    <span className="block text-xs font-semibold text-[#8b8b91]">释义</span>
                    <span className="block max-h-10 overflow-hidden">{entry.meaning}</span>
                  </span>
                  <span className="min-w-0 text-sm leading-5">
                    <span className="block text-xs font-semibold text-[#8b8b91]">修复内容</span>
                    {entry.splitText ? (
                      <span className="block max-h-5 overflow-hidden font-semibold text-[#1d1d1f] dark:text-foreground">
                        {entry.splitText}
                      </span>
                    ) : null}
                    <span className="block max-h-10 overflow-hidden text-[#6e6e73]">
                      {entry.plainText}
                    </span>
                  </span>
                  <span className="min-w-0 text-xs leading-5 text-[#6e6e73]">
                    <span className="block font-semibold text-[#8b8b91]">来源</span>
                    <span className="block max-h-10 overflow-hidden break-words">{entry.source || "未记录"}</span>
                    {entry.score ? <span className="block">匹配分：{entry.score}</span> : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                    <Badge
                      className={cn(
                        "h-6 border-transparent px-2 text-xs",
                        isApproved
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200"
                          : "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"
                      )}
                    >
                      {isApproved ? "已通过" : "待审"}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => void openWordBySlug(entry.slug)}
                      disabled={Boolean(loadingSlug)}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#6e6e73] transition hover:bg-[#f5f5f7] hover:text-[#1d1d1f] disabled:pointer-events-none disabled:opacity-70 dark:hover:bg-muted dark:hover:text-foreground"
                      aria-label={`打开 ${entry.word} 单词卡弹窗`}
                    >
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Maximize2 className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void reviewWords([entry.wordId], !isApproved)}
                      disabled={reviewDisabled}
                      className={cn(
                        "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-semibold transition disabled:pointer-events-none disabled:opacity-60",
                        isApproved
                          ? "bg-muted text-muted-foreground hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
                          : "bg-emerald-600 text-white hover:bg-emerald-700"
                      )}
                    >
                      {isApproved ? <RotateCcw className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      {isApproved ? "撤回" : "通过"}
                    </button>
                  </span>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[28px] bg-white p-12 text-center text-[#6e6e73] shadow-sm dark:bg-card">
            没有找到符合条件的修复卡。
          </div>
        )}
      </section>

      <section className="mx-auto max-w-[1440px] px-5 pb-10 sm:px-8">
        <div className="mb-2 flex items-center gap-2">
          <CircleSlash2 className="h-5 w-5 text-[#6e6e73]" />
          <h2 className="text-xl font-semibold tracking-normal">按规则留空</h2>
        </div>
        {emptyItems.length ? (
          <div className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-card">
            {emptyItems.map((item) => {
              const isLoading = loadingSlug === item.slug;
              const isApproved = approvedIds.has(item.wordId);
              const isSelected = selectedIds.has(item.wordId);

              return (
                <article
                  key={item.wordId}
                  className={cn(
                    "group grid gap-2 border-b border-black/5 px-3 py-2.5 text-left transition last:border-b-0 hover:bg-[#f7f9fc] dark:border-white/10 dark:hover:bg-muted/40 lg:grid-cols-[32px_180px_260px_minmax(0,1fr)_120px] lg:items-start",
                    isApproved && "border-l-2 border-l-emerald-300 dark:border-l-emerald-500/70"
                  )}
                >
                  <span className="flex items-start lg:justify-center">
                    <button
                      type="button"
                      onClick={(event) => toggleSelected(item.wordId, event)}
                      disabled={reviewDisabled}
                      className={cn(
                        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition",
                        isSelected
                          ? "bg-[#0071e3] text-white"
                          : "bg-[#f5f5f7] text-[#6e6e73] hover:text-[#1d1d1f] dark:bg-muted dark:hover:text-foreground"
                      )}
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? "取消选择" : "选择"} ${item.word}`}
                      title="Shift 单击可范围选择"
                    >
                      {isSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </button>
                  </span>
                  <span className="min-w-0">
                    <button
                      type="button"
                      onClick={() => void openWordBySlug(item.slug)}
                      disabled={Boolean(loadingSlug)}
                      className="min-w-0 text-left disabled:pointer-events-none disabled:opacity-70"
                    >
                      <span className="block truncate text-lg font-semibold leading-6 text-[#06c] group-hover:text-[#004c99] dark:text-[#7ab7ff]">
                        {item.word}
                      </span>
                    </button>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <Badge
                        className={cn(
                          "h-5 border-transparent px-1.5 text-[11px]",
                          isApproved
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200"
                            : "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"
                        )}
                      >
                        {isApproved ? "人工通过" : "待审核"}
                      </Badge>
                      <Badge className="h-5 border-transparent bg-rose-50 px-1.5 text-[11px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
                        {emptyReasonLabel(item.reason)}
                      </Badge>
                    </span>
                  </span>
                  <span className="min-w-0 text-sm leading-5 text-[#6e6e73]">
                    <span className="block text-xs font-semibold text-[#8b8b91]">释义</span>
                    <span className="block max-h-10 overflow-hidden">{item.meaning}</span>
                  </span>
                  <span className="min-w-0 text-sm leading-5 text-[#6e6e73]">
                    <span className="block text-xs font-semibold text-[#8b8b91]">留空说明</span>
                    <span className="block">当前没有保留正式卡正文。</span>
                    {item.source ? <span className="block max-h-10 overflow-hidden">最接近来源：{item.source}</span> : null}
                    {item.score ? <span className="block">匹配分：{item.score}</span> : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                    <button
                      type="button"
                      onClick={() => void openWordBySlug(item.slug)}
                      disabled={Boolean(loadingSlug)}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#6e6e73] transition hover:bg-[#f5f5f7] hover:text-[#1d1d1f] disabled:pointer-events-none disabled:opacity-70 dark:hover:bg-muted dark:hover:text-foreground"
                      aria-label={`打开 ${item.word} 单词卡弹窗`}
                    >
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Maximize2 className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void reviewWords([item.wordId], !isApproved)}
                      disabled={reviewDisabled}
                      className={cn(
                        "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-semibold transition disabled:pointer-events-none disabled:opacity-60",
                        isApproved
                          ? "bg-muted text-muted-foreground hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
                          : "bg-emerald-600 text-white hover:bg-emerald-700"
                      )}
                    >
                      {isApproved ? <RotateCcw className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      {isApproved ? "撤回" : "通过"}
                    </button>
                  </span>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[28px] bg-white p-8 text-sm text-[#6e6e73] shadow-sm dark:bg-card">
            {query ? "当前搜索下没有留空词。" : "这次修复没有留空词。"}
          </div>
        )}
      </section>

      {openCards.length ? (
        <MemoryCardTray
          words={openCards}
          activeCardId={activeCardId}
          onActivate={setActiveCardId}
          onClose={(wordId) =>
            setOpenCards((current) => current.filter((word) => word.id !== wordId))
          }
          onOpenLinkedWord={openWordBySlug}
          onWordUpdate={updateWord}
          isAuthenticated={isAuthenticated}
          defaultUserCardVisibility={defaultUserCardVisibility}
          canEditOfficialCards={canEditOfficialCards}
        />
      ) : null}
    </>
  );
}

function ReviewBatchToolbar({
  disabled,
  pendingCount,
  approvedCount,
  selectedCount,
  selectedPendingCount,
  selectedApprovedCount,
  totalCount,
  onSelectAll,
  onClearSelection,
  onApproveSelected,
  onRevokeSelected
}: {
  disabled: boolean;
  pendingCount: number;
  approvedCount: number;
  selectedCount: number;
  selectedPendingCount: number;
  selectedApprovedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onApproveSelected: () => void;
  onRevokeSelected: () => void;
}) {
  const hasSelection = selectedCount > 0;
  const hasItems = totalCount > 0;

  return (
    <div className="mb-2 rounded-lg border border-black/10 bg-white px-3 py-2 shadow-sm dark:border-white/10 dark:bg-card">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#6e6e73]">
          <span className="rounded-md bg-[#f5f5f7] px-2 py-1 dark:bg-muted">
            总计 {totalCount.toLocaleString("zh-CN")}
          </span>
          <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            待审核 {pendingCount.toLocaleString("zh-CN")}
          </span>
          <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
            已通过 {approvedCount.toLocaleString("zh-CN")}
          </span>
          {hasSelection ? (
            <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200">
              已选 {selectedCount.toLocaleString("zh-CN")}，待审 {selectedPendingCount.toLocaleString("zh-CN")}，已过 {selectedApprovedCount.toLocaleString("zh-CN")}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <BatchButton disabled={disabled || !hasItems} onClick={onSelectAll}>
            全选当前
          </BatchButton>
          <BatchButton disabled={disabled || !hasSelection} onClick={onClearSelection}>
            清空选择
          </BatchButton>
          <BatchButton disabled={disabled || !hasSelection} onClick={onApproveSelected} tone="approve">
            通过选中
          </BatchButton>
          <BatchButton disabled={disabled || !hasSelection} onClick={onRevokeSelected}>
            撤回选中
          </BatchButton>
        </div>
      </div>
    </div>
  );
}

function BatchButton({
  children,
  disabled,
  tone,
  onClick
}: {
  children: ReactNode;
  disabled: boolean;
  tone?: "approve";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-md px-2.5 text-xs font-semibold transition disabled:pointer-events-none disabled:opacity-50",
        tone === "approve"
          ? "bg-emerald-600 text-white hover:bg-emerald-700"
          : "bg-[#f5f5f7] text-[#6e6e73] hover:bg-[#ececf0] hover:text-[#1d1d1f] dark:bg-muted dark:hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

async function fetchWordCard(slug: string) {
  const response = await fetch(`/api/word-card/${encodeURIComponent(slug)}?fresh=${Date.now()}`, {
    cache: "no-store"
  });
  const result = (await response.json().catch(() => ({}))) as Partial<LevelWordItem> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(result.error || "单词卡加载失败。");
  }
  if (!result.id || !result.slug || !result.word || !Array.isArray(result.mnemonics)) {
    throw new Error("单词卡返回数据不完整。");
  }

  return result as LevelWordItem;
}

function emptyReasonLabel(reason: string) {
  if (reason === "source_word_error") return "源文件词项错误";
  if (reason === "missing_source") return "源文件未找到";
  return "留空";
}
