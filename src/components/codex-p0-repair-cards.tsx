"use client";

import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Flag,
  Keyboard,
  LayoutList,
  Loader2,
  Search,
  SkipForward,
  X
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LogoMark } from "@/components/logo";
import { MemoryCardTray, type LevelWordItem } from "@/components/level-word-browser";
import { applyGuestProgressToWord } from "@/lib/guest-progress";
import type { CodexP0ReviewDraft, CodexP0ReviewState, CodexP0ReviewStatus } from "@/lib/codex-p0-repair";
import { cn } from "@/lib/utils";

export type CodexP0RepairCardItem = {
  id: string;
  wordId: string;
  word: string;
  slug: string;
  phonetic: string;
  partOfSpeech: string;
  meaning: string;
  fullMeaning: string;
  levelTags: string[];
  splitText: string;
  contentMarkdown: string;
  plainText: string;
  exampleSentence: string;
  exampleTranslation: string;
  source: string;
  score: string;
  issueType: string;
  issueSeverity: string;
  issueReason: string;
  issueEvidence: string;
  issueSuggestion: string;
};

export type CodexP0EmptyRepairItem = {
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

type ErrorCategory = "OCR乱码" | "错别字" | "异常换行" | "内容缺失" | "AI乱改" | "需要人工判断";
type ReviewStatus = "unfixed" | "approved" | CodexP0ReviewStatus;
type ReviewMode = "focus" | "list";
type StatusFilter = "all" | ReviewStatus;

type ReviewCandidate = {
  kind: "repaired" | "empty";
  id: string;
  wordId: string;
  word: string;
  slug: string;
  phonetic: string;
  partOfSpeech: string;
  meaning: string;
  fullMeaning: string;
  levelTags: string[];
  splitText: string;
  contentMarkdown: string;
  plainText: string;
  exampleSentence: string;
  exampleTranslation: string;
  source: string;
  score: string;
  errorCategory: ErrorCategory;
  priority: string;
  issueReason: string;
  issueEvidence: string;
  issueSuggestion: string;
};

const errorCategories: Array<"all" | ErrorCategory> = [
  "all",
  "OCR乱码",
  "错别字",
  "异常换行",
  "内容缺失",
  "AI乱改",
  "需要人工判断"
];

const statusOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "unfixed", label: "未修" },
  { value: "approved", label: "已通过" },
  { value: "edited", label: "已编辑" },
  { value: "skipped", label: "已跳过" },
  { value: "severe", label: "严重错误" }
];

const statusLabels: Record<ReviewStatus, string> = {
  unfixed: "未修",
  approved: "已通过",
  edited: "已编辑",
  skipped: "已跳过",
  severe: "严重错误"
};

export function CodexP0RepairCards({
  repairedEntries,
  emptyItems,
  query,
  approvedWordIds,
  initialReviewStates,
  isAuthenticated,
  defaultUserCardVisibility = "private",
  canEditOfficialCards = false,
  canExportMemoryCardImages = false,
  summary
}: {
  repairedEntries: CodexP0RepairCardItem[];
  emptyItems: CodexP0EmptyRepairItem[];
  query: string;
  approvedWordIds: string[];
  initialReviewStates: Record<string, CodexP0ReviewState>;
  isAuthenticated: boolean;
  defaultUserCardVisibility?: "private" | "public";
  canEditOfficialCards?: boolean;
  canExportMemoryCardImages?: boolean;
  summary: {
    repairedCount: number;
    emptyCount: number;
    approvedCount: number;
  };
}) {
  const [mode, setMode] = useState<ReviewMode>("focus");
  const [searchText, setSearchText] = useState(query);
  const [categoryFilter, setCategoryFilter] = useState<"all" | ErrorCategory>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(() => new Set(approvedWordIds));
  const [reviewStates, setReviewStates] = useState<Record<string, CodexP0ReviewState>>(initialReviewStates);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CodexP0ReviewDraft>({});
  const [message, setMessage] = useState("");
  const [loadingAction, setLoadingAction] = useState<ReviewStatus | null>(null);
  const [openCards, setOpenCards] = useState<LevelWordItem[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const wordCache = useRef(new Map<string, LevelWordItem>());

  const candidates = useMemo(
    () => buildCandidates(repairedEntries, emptyItems),
    [emptyItems, repairedEntries]
  );

  const statusForWord = useCallback(
    (wordId: string): ReviewStatus => {
      if (approvedIds.has(wordId)) return "approved";
      return reviewStates[wordId]?.status ?? "unfixed";
    },
    [approvedIds, reviewStates]
  );

  const filteredCandidates = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return candidates.filter((candidate) => {
      const status = statusForWord(candidate.wordId);
      const matchesSearch =
        !q ||
        candidate.word.toLowerCase().includes(q) ||
        candidate.fullMeaning.toLowerCase().includes(q) ||
        candidate.meaning.toLowerCase().includes(q);
      const matchesCategory = categoryFilter === "all" || candidate.errorCategory === categoryFilter;
      const matchesStatus = statusFilter === "all" || status === statusFilter;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [candidates, categoryFilter, searchText, statusFilter, statusForWord]);

  const current = filteredCandidates[activeIndex] ?? null;
  const currentStatus = current ? statusForWord(current.wordId) : "unfixed";
  const processedCount = candidates.filter((candidate) => statusForWord(candidate.wordId) !== "unfixed").length;
  const totalCount = candidates.length;
  const currentPosition = filteredCandidates.length ? activeIndex + 1 : 0;
  const actionDisabled = !current || Boolean(loadingAction) || !canEditOfficialCards;

  useEffect(() => {
    setApprovedIds(new Set(approvedWordIds));
  }, [approvedWordIds]);

  useEffect(() => {
    setReviewStates(initialReviewStates);
  }, [initialReviewStates]);

  useEffect(() => {
    if (activeIndex >= filteredCandidates.length) {
      setActiveIndex(Math.max(0, filteredCandidates.length - 1));
    }
  }, [activeIndex, filteredCandidates.length]);

  useEffect(() => {
    if (!current) {
      setEditing(false);
      setDraft({});
      return;
    }
    setEditing(false);
    setDraft(buildDraft(current, reviewStates[current.wordId]));
  }, [current?.wordId, reviewStates]);

  const goPrevious = useCallback(() => {
    setActiveIndex((index) => Math.max(0, index - 1));
    setMessage("");
  }, []);

  const goNext = useCallback(() => {
    setActiveIndex((index) => Math.min(Math.max(0, filteredCandidates.length - 1), index + 1));
    setMessage("");
  }, [filteredCandidates.length]);

  const openWord = useCallback(
    (word: LevelWordItem) => {
      const nextWord = isAuthenticated ? word : applyGuestProgressToWord(word);
      wordCache.current.set(nextWord.slug, nextWord);
      setActiveCardId(nextWord.id);
      setOpenCards((cards) => [nextWord, ...cards.filter((item) => item.id !== nextWord.id)].slice(0, 5));
    },
    [isAuthenticated]
  );

  const openWordBySlug = useCallback(
    async (slug: string) => {
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
        setLoadingSlug((currentSlug) => (currentSlug === slug ? null : currentSlug));
      }
    },
    [openWord]
  );

  const updateWord = (updatedWord: LevelWordItem) => {
    wordCache.current.set(updatedWord.slug, updatedWord);
    setOpenCards((cards) => cards.map((word) => (word.id === updatedWord.id ? { ...word, ...updatedWord } : word)));
  };

  const saveApproval = useCallback(
    async (candidate: ReviewCandidate, approved: boolean) => {
      if (!canEditOfficialCards) {
        setMessage("需要编辑权限才能保存审核状态。");
        return false;
      }
      setLoadingAction(approved ? "approved" : "unfixed");
      setMessage("");
      try {
        const response = await fetch("/api/codex-p0-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordIds: [candidate.wordId], approved })
        });
        const result = (await response.json().catch(() => ({}))) as ReviewApiResult;
        if (!response.ok) throw new Error(result.error || "审核状态保存失败。");

        setApprovedIds(new Set(result.fixedWordIds ?? []));
        setReviewStates(result.codexP0ReviewStates ?? {});
        setMessage(approved ? `已通过 ${candidate.word}。` : `已撤回 ${candidate.word}。`);
        return true;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "审核状态保存失败。");
        return false;
      } finally {
        setLoadingAction(null);
      }
    },
    [canEditOfficialCards]
  );

  const savePendingState = useCallback(
    async (candidate: ReviewCandidate, status: CodexP0ReviewStatus, nextDraft?: CodexP0ReviewDraft) => {
      if (!canEditOfficialCards) {
        setMessage("需要编辑权限才能保存审核状态。");
        return false;
      }
      setLoadingAction(status);
      setMessage("");
      try {
        const response = await fetch("/api/codex-p0-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wordIds: [candidate.wordId],
            status,
            draft: nextDraft,
            note: status === "severe" ? "标记为严重错误，需要重新检查来源。" : undefined
          })
        });
        const result = (await response.json().catch(() => ({}))) as ReviewApiResult;
        if (!response.ok) throw new Error(result.error || "审核状态保存失败。");

        setApprovedIds(new Set(result.fixedWordIds ?? []));
        setReviewStates(result.codexP0ReviewStates ?? {});
        setMessage(`${candidate.word} 已标记为${statusLabels[status]}，未改正式卡片。`);
        return true;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "审核状态保存失败。");
        return false;
      } finally {
        setLoadingAction(null);
      }
    },
    [canEditOfficialCards]
  );

  const approveCurrent = useCallback(async () => {
    if (!current) return;
    const ok = await saveApproval(current, true);
    if (ok) goNext();
  }, [current, goNext, saveApproval]);

  const skipCurrent = useCallback(async () => {
    if (!current) return;
    const ok = await savePendingState(current, "skipped");
    if (ok) goNext();
  }, [current, goNext, savePendingState]);

  const severeCurrent = useCallback(async () => {
    if (!current) return;
    const ok = await savePendingState(current, "severe");
    if (ok) goNext();
  }, [current, goNext, savePendingState]);

  const confirmEdited = useCallback(async () => {
    if (!current) return;
    const ok = await savePendingState(current, "edited", draft);
    if (ok) {
      setEditing(false);
      goNext();
    }
  }, [current, draft, goNext, savePendingState]);

  const startEditing = useCallback(() => {
    if (!current) return;
    if (!canEditOfficialCards) {
      setMessage("需要编辑权限才能保存审核草稿。");
      return;
    }
    setDraft(buildDraft(current, reviewStates[current.wordId]));
    setEditing(true);
    setMessage("");
  }, [canEditOfficialCards, current, reviewStates]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
        return;
      }
      if (!current || mode !== "focus") return;
      const key = event.key.toLowerCase();
      if (key === "a") {
        event.preventDefault();
        void approveCurrent();
      } else if (key === "e") {
        event.preventDefault();
        startEditing();
      } else if (key === "s") {
        event.preventDefault();
        void skipCurrent();
      } else if (key === "f") {
        event.preventDefault();
        void severeCurrent();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [approveCurrent, current, goNext, goPrevious, mode, severeCurrent, skipCurrent, startEditing]);

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-black/5 bg-white/95 backdrop-blur">
        <div className="mx-auto grid max-w-[1500px] gap-3 px-4 py-3 lg:grid-cols-[240px_auto_minmax(0,1fr)] lg:items-center lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <LogoMark className="h-8 w-8 shrink-0" />
            <a href="/repository" className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-[#111113] hover:text-[#0057d8]">
              <ArrowLeft className="h-4 w-4 shrink-0" />
              <span className="truncate">返回单词仓库</span>
            </a>
          </div>

          <div className="justify-self-start text-sm font-semibold text-[#111113] lg:justify-self-center">
            {currentPosition.toLocaleString("zh-CN")} / {filteredCandidates.length.toLocaleString("zh-CN")}
            <span className="ml-2 font-normal text-[#6b6b72]">
              已处理 {processedCount.toLocaleString("zh-CN")} / {totalCount.toLocaleString("zh-CN")}
            </span>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
            <label className="relative min-w-[180px] flex-1 lg:max-w-[260px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c8c93]" />
              <Input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                className="h-9 rounded-xl border-black/10 bg-[#f7f7f8] pl-9 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-[#0066ff]"
                placeholder="搜索"
              />
            </label>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value as "all" | ErrorCategory)}
              className="h-9 rounded-xl border border-black/10 bg-white px-3 text-sm text-[#111113] outline-none focus:ring-1 focus:ring-[#0066ff]"
              aria-label="筛选错误类型"
            >
              {errorCategories.map((category) => (
                <option key={category} value={category}>
                  {category === "all" ? "筛选" : category}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="h-9 rounded-xl border border-black/10 bg-white px-3 text-sm text-[#111113] outline-none focus:ring-1 focus:ring-[#0066ff]"
              aria-label="筛选状态"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMode((value) => (value === "focus" ? "list" : "focus"))}
              className="h-9 rounded-xl px-3 text-[#111113] hover:bg-[#f0f0f2]"
            >
              <LayoutList className="h-4 w-4" />
              {mode === "focus" ? "问题列表" : "审核流"}
            </Button>
            <Button asChild variant="ghost" className="h-9 rounded-xl px-3 text-[#6b6b72] hover:bg-[#f0f0f2]">
              <a href="/repository">
                <X className="h-4 w-4" />
                退出审核
              </a>
            </Button>
          </div>
        </div>
      </div>

      <section className="mx-auto max-w-[1500px] px-4 pb-36 pt-5 lg:px-6">
        {message ? (
          <p className="mb-4 rounded-2xl border border-black/5 bg-white px-4 py-3 text-sm text-[#111113]">
            {message}
          </p>
        ) : null}

        {mode === "list" ? (
          <ReviewList
            candidates={filteredCandidates}
            statusForWord={statusForWord}
            onEnter={(index) => {
              setActiveIndex(index);
              setMode("focus");
              setMessage("");
            }}
          />
        ) : current ? (
          <div className="grid min-h-[calc(100vh-190px)] gap-4 lg:grid-cols-2">
            <CurrentContentPanel
              candidate={current}
              status={currentStatus}
              isLoadingCard={loadingSlug === current.slug}
              onOpenCard={() => void openWordBySlug(current.slug)}
            />
            <SuggestionPanel
              candidate={current}
              status={currentStatus}
              editing={editing}
              draft={draft}
              onDraftChange={setDraft}
              onStartEditing={startEditing}
              editDisabled={actionDisabled}
              onCancelEditing={() => {
                setEditing(false);
                setDraft(buildDraft(current, reviewStates[current.wordId]));
              }}
              onConfirmEdited={() => void confirmEdited()}
              loadingAction={loadingAction}
            />
          </div>
        ) : (
          <div className="grid min-h-[55vh] place-items-center rounded-2xl border border-black/5 bg-white text-center text-sm text-[#6b6b72]">
            当前筛选下没有待审核卡片。
          </div>
        )}
      </section>

      {mode === "focus" ? (
        <ReviewActionBar
          current={current}
          activeIndex={activeIndex}
          total={filteredCandidates.length}
          disabled={actionDisabled}
          loadingAction={loadingAction}
          onPrevious={goPrevious}
          onNext={goNext}
          onApprove={() => void approveCurrent()}
          onEdit={startEditing}
          onSkip={() => void skipCurrent()}
          onSevere={() => void severeCurrent()}
        />
      ) : null}

      <ShortcutHint />

      <div className="pointer-events-none fixed bottom-3 left-4 hidden text-xs text-[#8c8c93] md:block">
        重做 {summary.repairedCount.toLocaleString("zh-CN")} · 留空 {summary.emptyCount.toLocaleString("zh-CN")} · 已通过 {summary.approvedCount.toLocaleString("zh-CN")}
      </div>

      {openCards.length ? (
        <MemoryCardTray
          words={openCards}
          activeCardId={activeCardId}
          onActivate={setActiveCardId}
          onClose={(wordId) => setOpenCards((cards) => cards.filter((word) => word.id !== wordId))}
          onOpenLinkedWord={openWordBySlug}
          onWordUpdate={updateWord}
          isAuthenticated={isAuthenticated}
          defaultUserCardVisibility={defaultUserCardVisibility}
          canEditOfficialCards={canEditOfficialCards}
          canExportMemoryCardImages={canExportMemoryCardImages}
        />
      ) : null}
    </>
  );
}

function CurrentContentPanel({
  candidate,
  status,
  isLoadingCard,
  onOpenCard
}: {
  candidate: ReviewCandidate;
  status: ReviewStatus;
  isLoadingCard: boolean;
  onOpenCard: () => void;
}) {
  return (
    <article className="min-h-0 rounded-2xl border border-black/5 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-[#8c8c93]">当前网站内容</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <h1 className="text-4xl font-semibold tracking-normal text-[#111113]">{candidate.word}</h1>
            <span className="pb-1 text-sm text-[#6b6b72]">
              {[candidate.phonetic, candidate.partOfSpeech].filter(Boolean).join(" · ")}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusBadge status={status} />
          <Button
            type="button"
            variant="ghost"
            onClick={onOpenCard}
            disabled={isLoadingCard}
            className="h-8 rounded-xl px-2 text-xs text-[#6b6b72] hover:bg-[#f0f0f2]"
          >
            {isLoadingCard ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            打开卡片
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-5">
        <ContentBlock title="中文释义">
          <p className="text-base leading-7 text-[#111113]">{candidate.fullMeaning || candidate.meaning}</p>
        </ContentBlock>

        <ContentBlock title="记忆卡片">
          {candidate.splitText ? (
            <p className="mb-3 rounded-xl bg-[#f7f7f8] px-3 py-2 text-sm font-semibold text-[#111113]">
              {candidate.splitText}
            </p>
          ) : null}
          {candidate.contentMarkdown || candidate.plainText ? (
            <p className="whitespace-pre-wrap text-[15px] leading-7 text-[#1f1f23]">
              {candidate.contentMarkdown || candidate.plainText}
            </p>
          ) : (
            <p className="rounded-xl bg-[#fff5f5] px-3 py-3 text-sm text-[#9b1c1c]">当前没有保留正式卡正文。</p>
          )}
        </ContentBlock>

        <ContentBlock title="例句">
          {candidate.exampleSentence ? (
            <div className="grid gap-2 text-[15px] leading-7">
              <p className="text-[#111113]">{candidate.exampleSentence}</p>
              {candidate.exampleTranslation ? <p className="text-[#6b6b72]">{candidate.exampleTranslation}</p> : null}
            </div>
          ) : (
            <p className="text-sm text-[#8c8c93]">暂无例句。</p>
          )}
        </ContentBlock>
      </div>
    </article>
  );
}

function SuggestionPanel({
  candidate,
  status,
  editing,
  draft,
  onDraftChange,
  onStartEditing,
  editDisabled,
  onCancelEditing,
  onConfirmEdited,
  loadingAction
}: {
  candidate: ReviewCandidate;
  status: ReviewStatus;
  editing: boolean;
  draft: CodexP0ReviewDraft;
  onDraftChange: (draft: CodexP0ReviewDraft) => void;
  onStartEditing: () => void;
  editDisabled: boolean;
  onCancelEditing: () => void;
  onConfirmEdited: () => void;
  loadingAction: ReviewStatus | null;
}) {
  if (editing) {
    return (
      <article className="min-h-0 rounded-2xl border border-[#0057d8]/15 bg-white p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-[#0057d8]">可编辑 pending</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-normal text-[#111113]">编辑后通过</h2>
            <p className="mt-1 text-sm leading-6 text-[#6b6b72]">这里只保存审核草稿，不直接覆盖正式卡片。</p>
          </div>
          <StatusBadge status={status} />
        </div>

        <div className="mt-6 grid gap-4">
          <label className="grid gap-2">
            <span className="text-xs font-medium text-[#6b6b72]">标题</span>
            <Input
              value={draft.title ?? ""}
              onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
              className="rounded-xl border-black/10 bg-[#f7f7f8] shadow-none focus-visible:ring-1 focus-visible:ring-[#0066ff]"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-xs font-medium text-[#6b6b72]">划分</span>
            <Input
              value={draft.splitText ?? ""}
              onChange={(event) => onDraftChange({ ...draft, splitText: event.target.value })}
              className="rounded-xl border-black/10 bg-[#f7f7f8] shadow-none focus-visible:ring-1 focus-visible:ring-[#0066ff]"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-xs font-medium text-[#6b6b72]">记忆卡片</span>
            <Textarea
              value={draft.contentMarkdown ?? ""}
              onChange={(event) => onDraftChange({ ...draft, contentMarkdown: event.target.value })}
              className="min-h-[300px] rounded-xl border-black/10 bg-[#f7f7f8] leading-6 shadow-none focus:ring-1 focus:ring-[#0066ff]"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-xs font-medium text-[#6b6b72]">例句</span>
            <Textarea
              value={draft.exampleSentence ?? ""}
              onChange={(event) => onDraftChange({ ...draft, exampleSentence: event.target.value })}
              className="min-h-20 rounded-xl border-black/10 bg-[#f7f7f8] leading-6 shadow-none focus:ring-1 focus:ring-[#0066ff]"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-xs font-medium text-[#6b6b72]">例句翻译</span>
            <Textarea
              value={draft.exampleTranslation ?? ""}
              onChange={(event) => onDraftChange({ ...draft, exampleTranslation: event.target.value })}
              className="min-h-20 rounded-xl border-black/10 bg-[#f7f7f8] leading-6 shadow-none focus:ring-1 focus:ring-[#0066ff]"
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancelEditing} className="rounded-xl px-4">
            取消
          </Button>
          <Button
            type="button"
            onClick={onConfirmEdited}
            disabled={Boolean(loadingAction)}
            className="rounded-xl bg-[#0057d8] px-5 text-white hover:bg-[#004bb8]"
          >
            {loadingAction === "edited" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            保存 pending
          </Button>
        </div>
      </article>
    );
  }

  return (
    <article className="min-h-0 rounded-2xl border border-black/5 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-[#8c8c93]">AI 修复建议</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ErrorBadge category={candidate.errorCategory} />
            <Badge className="border-transparent bg-[#f7f7f8] text-[#6b6b72]">{candidate.priority}</Badge>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={onStartEditing}
          disabled={editDisabled}
          className="h-9 rounded-xl px-3 text-[#111113] hover:bg-[#f0f0f2]"
        >
          <Edit3 className="h-4 w-4" />
          编辑
        </Button>
      </div>

      <div className="mt-6 grid gap-5">
        <ContentBlock title="问题说明">
          <p className="text-[15px] leading-7 text-[#111113]">{candidate.issueReason}</p>
          {candidate.issueEvidence ? (
            <p className="mt-3 rounded-xl bg-[#fff5f5] px-3 py-3 text-sm leading-6 text-[#8f1f1f]">
              {candidate.issueEvidence}
            </p>
          ) : null}
        </ContentBlock>

        <ContentBlock title="建议修改后的内容">
          <p className="whitespace-pre-wrap text-[15px] leading-7 text-[#1f1f23]">
            {buildSuggestionText(candidate)}
          </p>
          {candidate.source || candidate.score ? (
            <p className="mt-3 text-xs leading-5 text-[#8c8c93]">
              {[candidate.source ? `来源：${candidate.source}` : "", candidate.score ? `匹配分：${candidate.score}` : ""].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </ContentBlock>

        <ContentBlock title="差异高亮">
          <DiffPreview fromText={candidate.issueEvidence || candidate.issueReason} toText={buildSuggestionText(candidate)} />
        </ContentBlock>
      </div>
    </article>
  );
}

function ReviewActionBar({
  current,
  activeIndex,
  total,
  disabled,
  loadingAction,
  onPrevious,
  onNext,
  onApprove,
  onEdit,
  onSkip,
  onSevere
}: {
  current: ReviewCandidate | null;
  activeIndex: number;
  total: number;
  disabled: boolean;
  loadingAction: ReviewStatus | null;
  onPrevious: () => void;
  onNext: () => void;
  onApprove: () => void;
  onEdit: () => void;
  onSkip: () => void;
  onSevere: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-black/5 bg-white/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center justify-between gap-2 lg:justify-start">
          <Button
            type="button"
            variant="ghost"
            onClick={onPrevious}
            disabled={activeIndex <= 0}
            className="h-11 rounded-xl px-3 hover:bg-[#f0f0f2]"
          >
            <ChevronLeft className="h-5 w-5" />
            上一张
          </Button>
          <span className="text-sm text-[#6b6b72]">
            {current ? current.word : "无卡片"} · {total ? activeIndex + 1 : 0}/{total}
          </span>
          <Button
            type="button"
            variant="ghost"
            onClick={onNext}
            disabled={activeIndex >= total - 1}
            className="h-11 rounded-xl px-3 hover:bg-[#f0f0f2]"
          >
            下一张
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:flex lg:justify-end">
          <Button
            type="button"
            onClick={onApprove}
            disabled={disabled}
            className="h-12 rounded-xl bg-[#0057d8] px-5 text-base font-semibold text-white hover:bg-[#004bb8]"
          >
            {loadingAction === "approved" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
            通过
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onEdit}
            disabled={disabled}
            className="h-12 rounded-xl border-black/10 px-5 text-base font-semibold"
          >
            <Edit3 className="h-5 w-5" />
            编辑后通过
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onSkip}
            disabled={disabled}
            className="h-12 rounded-xl border-black/10 px-5 text-base font-semibold"
          >
            {loadingAction === "skipped" ? <Loader2 className="h-5 w-5 animate-spin" /> : <SkipForward className="h-5 w-5" />}
            跳过
          </Button>
          <Button
            type="button"
            onClick={onSevere}
            disabled={disabled}
            className="h-12 rounded-xl bg-[#fff5f5] px-5 text-base font-semibold text-[#9b1c1c] hover:bg-[#ffe8e8]"
          >
            {loadingAction === "severe" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Flag className="h-5 w-5" />}
            标记严重错误
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReviewList({
  candidates,
  statusForWord,
  onEnter
}: {
  candidates: ReviewCandidate[];
  statusForWord: (wordId: string) => ReviewStatus;
  onEnter: (index: number) => void;
}) {
  if (!candidates.length) {
    return (
      <div className="grid min-h-[50vh] place-items-center rounded-2xl border border-black/5 bg-white text-sm text-[#6b6b72]">
        当前筛选下没有问题卡。
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-black/5 bg-white">
      <div className="hidden grid-cols-[minmax(150px,1.3fr)_160px_120px_120px_120px] gap-3 border-b border-black/5 px-4 py-3 text-xs font-medium text-[#8c8c93] md:grid">
        <span>单词</span>
        <span>错误类型</span>
        <span>优先级</span>
        <span>状态</span>
        <span className="text-right">操作</span>
      </div>
      {candidates.map((candidate, index) => {
        const status = statusForWord(candidate.wordId);
        return (
          <div
            key={candidate.id}
            className="grid gap-2 border-b border-black/5 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(150px,1.3fr)_160px_120px_120px_120px] md:items-center"
          >
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-[#111113]">{candidate.word}</p>
              <p className="truncate text-xs text-[#8c8c93]">{candidate.meaning}</p>
            </div>
            <ErrorBadge category={candidate.errorCategory} />
            <span className="text-sm font-medium text-[#6b6b72]">{candidate.priority}</span>
            <StatusBadge status={status} />
            <div className="md:text-right">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onEnter(index)}
                className="h-9 rounded-xl px-3 text-[#0057d8] hover:bg-[#f0f5ff]"
              >
                进入审核
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ContentBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[#8c8c93]">{title}</h3>
      {children}
    </section>
  );
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  return (
    <Badge
      className={cn(
        "w-fit border-transparent px-2.5 py-1",
        status === "approved" && "bg-[#f0fff6] text-[#146b3a]",
        status === "edited" && "bg-[#f0f5ff] text-[#0057d8]",
        status === "skipped" && "bg-[#f7f7f8] text-[#6b6b72]",
        status === "severe" && "bg-[#fff5f5] text-[#9b1c1c]",
        status === "unfixed" && "bg-[#f7f7f8] text-[#111113]"
      )}
    >
      {statusLabels[status]}
    </Badge>
  );
}

function ErrorBadge({ category }: { category: ErrorCategory }) {
  return (
    <Badge
      className={cn(
        "w-fit border-transparent px-2.5 py-1",
        category === "内容缺失" || category === "OCR乱码" || category === "AI乱改"
          ? "bg-[#fff5f5] text-[#9b1c1c]"
          : "bg-[#f0f5ff] text-[#0057d8]"
      )}
    >
      {category}
    </Badge>
  );
}

function ShortcutHint() {
  return (
    <div className="fixed bottom-28 right-4 z-10 hidden rounded-2xl border border-black/5 bg-white/90 px-3 py-3 text-xs text-[#6b6b72] backdrop-blur lg:block">
      <div className="mb-2 flex items-center gap-2 font-medium text-[#111113]">
        <Keyboard className="h-4 w-4" />
        快捷键
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <ShortcutKey>A</ShortcutKey><span>通过</span>
        <ShortcutKey>E</ShortcutKey><span>编辑</span>
        <ShortcutKey>S</ShortcutKey><span>跳过</span>
        <ShortcutKey>F</ShortcutKey><span>严重错误</span>
        <ShortcutKey>← / →</ShortcutKey><span>上一张 / 下一张</span>
      </div>
    </div>
  );
}

function ShortcutKey({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md bg-[#f0f0f2] px-1.5 py-0.5 font-mono text-[11px] text-[#111113]">{children}</kbd>;
}

function DiffPreview({ fromText, toText }: { fromText: string; toText: string }) {
  const removed = splitDiffLines(fromText);
  const added = splitDiffLines(toText);

  return (
    <div className="grid overflow-hidden rounded-xl border border-black/5 text-sm leading-6">
      {removed.slice(0, 6).map((line, index) => (
        <p key={`removed-${index}`} className="border-b border-white/60 bg-[#fff5f5] px-3 py-1.5 text-[#9b1c1c]">
          - {line}
        </p>
      ))}
      {added.slice(0, 10).map((line, index) => (
        <p key={`added-${index}`} className="border-b border-white/60 bg-[#f0fff6] px-3 py-1.5 text-[#146b3a] last:border-b-0">
          + {line}
        </p>
      ))}
    </div>
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

function buildCandidates(repairedEntries: CodexP0RepairCardItem[], emptyItems: CodexP0EmptyRepairItem[]): ReviewCandidate[] {
  const repairedCandidates = repairedEntries.map((entry) => ({
    kind: "repaired" as const,
    id: entry.id,
    wordId: entry.wordId,
    word: entry.word,
    slug: entry.slug,
    phonetic: entry.phonetic,
    partOfSpeech: entry.partOfSpeech,
    meaning: entry.meaning,
    fullMeaning: entry.fullMeaning,
    levelTags: entry.levelTags,
    splitText: entry.splitText,
    contentMarkdown: entry.contentMarkdown,
    plainText: entry.plainText,
    exampleSentence: entry.exampleSentence,
    exampleTranslation: entry.exampleTranslation,
    source: entry.source,
    score: entry.score,
    errorCategory: classifyIssue(entry.issueType, `${entry.issueReason}\n${entry.issueEvidence}\n${entry.issueSuggestion}`),
    priority: entry.issueSeverity || "P0",
    issueReason: entry.issueReason,
    issueEvidence: entry.issueEvidence,
    issueSuggestion: entry.issueSuggestion
  }));

  const emptyCandidates = emptyItems.map((item) => ({
    kind: "empty" as const,
    id: `empty:${item.wordId}`,
    wordId: item.wordId,
    word: item.word,
    slug: item.slug,
    phonetic: item.phonetic,
    partOfSpeech: item.partOfSpeech,
    meaning: item.meaning,
    fullMeaning: item.fullMeaning,
    levelTags: item.levelTags,
    splitText: "",
    contentMarkdown: "",
    plainText: "",
    exampleSentence: item.exampleSentence,
    exampleTranslation: item.exampleTranslation,
    source: item.source,
    score: item.score,
    errorCategory: "内容缺失" as ErrorCategory,
    priority: "P0",
    issueReason: emptyReasonLabel(item.reason),
    issueEvidence: item.source ? `最接近来源：${item.source}` : "源文件中没有可靠卡片内容。",
    issueSuggestion: "保持留空，等待人工补到可靠来源后再写正式卡。"
  }));

  return [...repairedCandidates, ...emptyCandidates];
}

function buildDraft(candidate: ReviewCandidate, state?: CodexP0ReviewState): CodexP0ReviewDraft {
  return {
    title: state?.draft?.title ?? `${candidate.word} 记忆卡片`,
    splitText: state?.draft?.splitText ?? candidate.splitText,
    contentMarkdown: state?.draft?.contentMarkdown ?? candidate.contentMarkdown,
    exampleSentence: state?.draft?.exampleSentence ?? candidate.exampleSentence,
    exampleTranslation: state?.draft?.exampleTranslation ?? candidate.exampleTranslation
  };
}

function buildSuggestionText(candidate: ReviewCandidate) {
  const lines = [
    candidate.splitText ? `划分：${candidate.splitText}` : "",
    candidate.contentMarkdown || candidate.plainText || candidate.issueSuggestion,
    candidate.exampleSentence ? `例句：${candidate.exampleSentence}` : "",
    candidate.exampleTranslation ? `翻译：${candidate.exampleTranslation}` : ""
  ];
  return lines.filter(Boolean).join("\n\n");
}

function classifyIssue(issueType: string, text: string): ErrorCategory {
  const value = `${issueType}\n${text}`.toLowerCase();
  if (value.includes("ocr") || value.includes("乱码") || value.includes("garbled")) return "OCR乱码";
  if (value.includes("typo") || value.includes("错别字") || value.includes("拼写")) return "错别字";
  if (value.includes("line") || value.includes("换行") || value.includes("break")) return "异常换行";
  if (value.includes("missing") || value.includes("empty") || value.includes("缺失") || value.includes("incomplete")) return "内容缺失";
  if (value.includes("ai") || value.includes("codex") || value.includes("乱改")) return "AI乱改";
  return "需要人工判断";
}

function emptyReasonLabel(reason: string) {
  if (reason === "source_word_error") return "源文件词项错误，需要人工判断。";
  if (reason === "missing_source") return "源文件未找到，建议保持留空。";
  return "按规则留空，等待人工确认。";
}

function splitDiffLines(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function isTypingTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));
}

type ReviewApiResult = {
  error?: string;
  fixedWordIds?: string[];
  codexP0ReviewStates?: Record<string, CodexP0ReviewState>;
};
