"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  RotateCcw,
  Save,
  Search,
  Undo2,
  X
} from "lucide-react";
import { MemoryCardTray, type LevelWordItem } from "@/components/level-word-browser";
import { dispatchRepositoryWorkloadRefresh } from "@/lib/repository-workload";
import type {
  MnemonicLogicAuditIssue,
  MnemonicLogicAuditReport,
  MnemonicLogicIssueSeverity,
  MnemonicLogicIssueType
} from "@/lib/mnemonic-logic-audit-report";
import { cn } from "@/lib/utils";

const issueTypeLabels: Record<MnemonicLogicIssueType, string> = {
  wrong_target: "讲错目标词",
  mixed_card: "多卡串线",
  split_logic: "拆分逻辑错误",
  meaning_mismatch: "释义逻辑不符",
  example_mismatch: "例句逻辑错误",
  related_word_mismatch: "相关词不当",
  ocr_garbled: "OCR 影响理解",
  contradiction: "前后矛盾",
  incomplete: "内容不完整",
  codex_p0_review: "Codex 人工复核",
  keyword_tree: "关键词：树",
  keyword_sample_meaning: "关键词：样义",
  keyword_breakthrough: "关键词：单词突围"
};

const severityOrder: MnemonicLogicIssueSeverity[] = ["P0", "P1", "P2", "P3"];
const previewSize = 64;
const autoSaveDelayMs = 3000;
const repairProgressStoragePrefix = "mnemonic_logic_audit_repair_progress";
type IssueTypeFilter = MnemonicLogicIssueType | "all";
type RepairFilter = "remaining" | "fixed" | "all";
type RepairSaveState = "saved" | "dirty" | "saving" | "error";
type RepairHistoryItem = {
  id: string;
  word: string;
  wordId: string;
  previousFixed: boolean;
  nextFixed: boolean;
};
type SeverityFilter = MnemonicLogicIssueSeverity | "all";
type IssueNavigationDirection = "previous" | "next";

export function RepositoryLogicAuditPanel({ report }: { report: MnemonicLogicAuditReport | null }) {
  const issues = report?.issues ?? [];
  const issueEntryCount = report?.issueEntries ?? 0;
  const totalEntries = report?.totalEntries ?? 0;
  const auditedEntries = report?.auditedEntries ?? 0;
  const progress = totalEntries ? Math.round((auditedEntries / totalEntries) * 100) : 0;
  const isRunning = report?.status === "running";
  const hasIssues = issues.length > 0;
  const issueGroups = useMemo(() => groupIssues(issues), [issues]);
  const defaultIssueType = issueGroups[0]?.type ?? "all";
  const repairStorageKey = repairProgressStorageKey(report);
  const allProblemWordIds = useMemo(() => new Set(issues.map((issue) => issue.wordId)), [issues]);
  const reportFixedWordIds = useMemo(
    () => new Set((report?.fixedWordIds ?? []).filter((wordId) => allProblemWordIds.has(wordId))),
    [allProblemWordIds, report?.fixedWordIds]
  );
  const wordLabelById = useMemo(
    () => new Map(issues.map((issue) => [issue.wordId, issue.word] as const)),
    [issues]
  );
  const [selectedType, setSelectedType] = useState<IssueTypeFilter>(defaultIssueType);
  const [selectedSeverity, setSelectedSeverity] = useState<SeverityFilter>("all");
  const [repairFilter, setRepairFilter] = useState<RepairFilter>("remaining");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(previewSize);
  const [openCards, setOpenCards] = useState<LevelWordItem[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [selectedWordId, setSelectedWordId] = useState<string | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [fixedWordIds, setFixedWordIds] = useState<Set<string>>(() => new Set());
  const [repairHistory, setRepairHistory] = useState<RepairHistoryItem[]>([]);
  const [repairSaveState, setRepairSaveState] = useState<RepairSaveState>("saved");
  const [repairSaveMessage, setRepairSaveMessage] = useState("已保存");
  const fixedWordIdsRef = useRef(new Set<string>());
  const repairHistoryRef = useRef<RepairHistoryItem[]>([]);
  const lastSavedRepairSignatureRef = useRef("");
  const repairSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repairSaveRequestRef = useRef(0);
  const allowSelectedWordFocusRef = useRef(false);
  const selectedWordIdRef = useRef<string | null>(null);
  const wordCache = useRef(new Map<string, LevelWordItem>());
  const activeType =
    selectedType === "all" || issueGroups.some((group) => group.type === selectedType)
      ? selectedType
      : defaultIssueType;
  const activeIssues =
    activeType === "all"
      ? issues
      : (issueGroups.find((group) => group.type === activeType)?.issues ?? []);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredIssues = useMemo(
    () =>
      activeIssues.filter((issue) => {
        const matchesSeverity = selectedSeverity === "all" || issue.severity === selectedSeverity;
        const isFixed = fixedWordIds.has(issue.wordId);
        const matchesRepair =
          repairFilter === "all" || (repairFilter === "fixed" ? isFixed : !isFixed);
        if (!matchesSeverity) return false;
        if (!matchesRepair) return false;
        if (!normalizedQuery) return true;
        return [issue.word, issue.reason, issue.evidence, issue.suggestion]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(normalizedQuery));
      }),
    [activeIssues, fixedWordIds, normalizedQuery, repairFilter, selectedSeverity]
  );
  const filteredWordIssues = useMemo(() => uniqueIssuesByWord(filteredIssues), [filteredIssues]);
  const visibleWordIssues = filteredWordIssues.slice(0, visibleCount);
  const issueByWordId = useMemo(
    () => new Map(filteredWordIssues.map((issue) => [issue.wordId, issue] as const)),
    [filteredWordIssues]
  );
  const repairScopedActiveIssues = useMemo(
    () =>
      activeIssues.filter((issue) => {
        const isFixed = fixedWordIds.has(issue.wordId);
        return repairFilter === "all" || (repairFilter === "fixed" ? isFixed : !isFixed);
      }),
    [activeIssues, fixedWordIds, repairFilter]
  );
  const activeSeverityCounts = countBySeverity(repairScopedActiveIssues);
  const totalProblemWords = allProblemWordIds.size;
  const fixedProblemWords = countFixedWords(allProblemWordIds, fixedWordIds);
  const remainingProblemWords = Math.max(0, totalProblemWords - fixedProblemWords);
  const repairProgress = totalProblemWords
    ? Math.round((fixedProblemWords / totalProblemWords) * 100)
    : 100;
  const activeTotalWords = countUniqueWords(activeIssues);
  const activeFixedWords = countUniqueWords(
    activeIssues.filter((issue) => fixedWordIds.has(issue.wordId))
  );
  const activeRemainingWords = Math.max(0, activeTotalWords - activeFixedWords);
  const filteredWordCount = countUniqueWords(filteredIssues);
  const hasUnsavedRepairProgress =
    repairProgressSignature(fixedWordIds) !== lastSavedRepairSignatureRef.current;

  useEffect(() => {
    setVisibleCount(previewSize);
  }, [activeType, normalizedQuery, repairFilter, selectedSeverity]);

  useEffect(() => {
    selectedWordIdRef.current = selectedWordId;
  }, [selectedWordId]);

  useEffect(() => {
    if (!filteredWordIssues.length) {
      setSelectedWordId(null);
      return;
    }
    if (!selectedWordId || !filteredWordIssues.some((issue) => issue.wordId === selectedWordId)) {
      setSelectedWordId(filteredWordIssues[0].wordId);
    }
  }, [filteredWordIssues, selectedWordId]);

  useEffect(() => {
    if (!selectedWordId) return;
    if (!allowSelectedWordFocusRef.current) return;

    const frameId = window.requestAnimationFrame(() => {
      focusRepositoryIssueWord(selectedWordId);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeCardId, selectedWordId, visibleCount]);

  useEffect(() => {
    const nextFixedWordIds = new Set([
      ...reportFixedWordIds,
      ...readRepairProgress(repairStorageKey, allProblemWordIds)
    ]);
    const savedSignature = repairProgressSignature(reportFixedWordIds);
    const nextSignature = repairProgressSignature(nextFixedWordIds);

    lastSavedRepairSignatureRef.current = savedSignature;
    fixedWordIdsRef.current = nextFixedWordIds;
    repairHistoryRef.current = [];
    setFixedWordIds(nextFixedWordIds);
    setRepairHistory([]);
    setRepairSaveState(nextSignature === savedSignature ? "saved" : "dirty");
    setRepairSaveMessage(
      nextSignature === savedSignature ? "已保存" : "检测到本地未保存标记，3 秒后自动保存"
    );
  }, [allProblemWordIds, repairStorageKey, reportFixedWordIds]);

  const persistRepairProgress = useCallback(
    async (mode: "manual" | "auto" = "manual") => {
      if (!report || !allProblemWordIds.size) return;

      if (repairSaveTimerRef.current) {
        clearTimeout(repairSaveTimerRef.current);
        repairSaveTimerRef.current = null;
      }

      const requestedFixedWordIds = [...fixedWordIdsRef.current].filter((wordId) =>
        allProblemWordIds.has(wordId)
      );
      const requestedSignature = repairProgressSignature(new Set(requestedFixedWordIds));
      const requestId = repairSaveRequestRef.current + 1;
      repairSaveRequestRef.current = requestId;

      setRepairSaveState("saving");
      setRepairSaveMessage(mode === "auto" ? "自动保存中..." : "保存中...");

      try {
        const result = await saveRepairProgressSnapshot(requestedFixedWordIds, [
          ...allProblemWordIds
        ]);
        if (requestId !== repairSaveRequestRef.current) return;

        const persistedFixedWordIds = new Set(
          (result.fixedWordIds ?? requestedFixedWordIds).filter((wordId) =>
            allProblemWordIds.has(wordId)
          )
        );
        const persistedSignature = repairProgressSignature(persistedFixedWordIds);
        lastSavedRepairSignatureRef.current = persistedSignature;

        if (repairProgressSignature(fixedWordIdsRef.current) === requestedSignature) {
          fixedWordIdsRef.current = persistedFixedWordIds;
          setFixedWordIds(persistedFixedWordIds);
          writeRepairProgress(repairStorageKey, persistedFixedWordIds);
        } else {
          writeRepairProgress(repairStorageKey, fixedWordIdsRef.current);
        }

        if (repairProgressSignature(fixedWordIdsRef.current) === persistedSignature) {
          setRepairSaveState("saved");
          setRepairSaveMessage(`已保存 ${formatClockTime()}`);
        } else {
          setRepairSaveState("dirty");
          setRepairSaveMessage("有新的未保存标记，3 秒后自动保存");
        }
        if (result.changedWordIds?.length) {
          dispatchRepositoryWorkloadRefresh({
            changedWordIds: result.changedWordIds,
            source: "repair-progress"
          });
        }
      } catch (error) {
        console.error(error);
        if (requestId !== repairSaveRequestRef.current) return;
        setRepairSaveState("error");
        setRepairSaveMessage("保存失败，已先保存在本地");
      }
    },
    [allProblemWordIds, repairStorageKey, report]
  );

  useEffect(() => {
    if (!report || !allProblemWordIds.size) return;

    const currentSignature = repairProgressSignature(fixedWordIds);
    if (currentSignature === lastSavedRepairSignatureRef.current) {
      if (repairSaveTimerRef.current) {
        clearTimeout(repairSaveTimerRef.current);
        repairSaveTimerRef.current = null;
      }
      setRepairSaveState((current) => (current === "saving" ? current : "saved"));
      return;
    }

    setRepairSaveState((current) => (current === "saving" ? current : "dirty"));
    setRepairSaveMessage("有未保存标记，3 秒后自动保存");
    if (repairSaveTimerRef.current) clearTimeout(repairSaveTimerRef.current);
    repairSaveTimerRef.current = setTimeout(() => {
      void persistRepairProgress("auto");
    }, autoSaveDelayMs);

    return () => {
      if (repairSaveTimerRef.current) {
        clearTimeout(repairSaveTimerRef.current);
        repairSaveTimerRef.current = null;
      }
    };
  }, [allProblemWordIds.size, fixedWordIds, persistRepairProgress, report]);

  const updateRepairHistory = (updater: (current: RepairHistoryItem[]) => RepairHistoryItem[]) => {
    const nextHistory = updater(repairHistoryRef.current);
    repairHistoryRef.current = nextHistory;
    setRepairHistory(nextHistory);
  };

  const setWordFixed = useCallback((wordId: string, fixed: boolean) => {
    const previousFixed = fixedWordIdsRef.current.has(wordId);
    if (previousFixed === fixed) return;

    const nextFixedWordIds = new Set(fixedWordIdsRef.current);
    if (fixed) {
      nextFixedWordIds.add(wordId);
    } else {
      nextFixedWordIds.delete(wordId);
    }

    fixedWordIdsRef.current = nextFixedWordIds;
    setFixedWordIds(nextFixedWordIds);
    writeRepairProgress(repairStorageKey, nextFixedWordIds);
    updateRepairHistory((current) =>
      [
        ...current,
        {
          id: `${Date.now()}-${wordId}-${fixed ? "fixed" : "unfixed"}`,
          nextFixed: fixed,
          previousFixed,
          word: wordLabelById.get(wordId) ?? "这个单词",
          wordId
        }
      ].slice(-80)
    );
  }, [repairStorageKey, wordLabelById]);

  const toggleWordFixed = useCallback(
    (wordId: string) => {
      setWordFixed(wordId, !fixedWordIdsRef.current.has(wordId));
    },
    [setWordFixed]
  );

  const ensureIssueVisible = useCallback(
    (wordId: string) => {
      const nextIndex = filteredWordIssues.findIndex((issue) => issue.wordId === wordId);
      if (nextIndex < 0 || nextIndex < visibleCount) return;
      setVisibleCount(Math.ceil((nextIndex + 1) / previewSize) * previewSize);
    },
    [filteredWordIssues, visibleCount]
  );

  const undoLastRepairMark = () => {
    const latest = repairHistoryRef.current.at(-1);
    if (!latest) return;

    const nextFixedWordIds = new Set(fixedWordIdsRef.current);
    if (latest.previousFixed) {
      nextFixedWordIds.add(latest.wordId);
    } else {
      nextFixedWordIds.delete(latest.wordId);
    }

    fixedWordIdsRef.current = nextFixedWordIds;
    setFixedWordIds(nextFixedWordIds);
    writeRepairProgress(repairStorageKey, nextFixedWordIds);
    updateRepairHistory((current) =>
      current.at(-1)?.id === latest.id
        ? current.slice(0, -1)
        : current.filter((item) => item.id !== latest.id)
    );
  };

  const clearRepairProgress = () => {
    if (!fixedProblemWords) return;
    if (!window.confirm("清空当前审计报告里的所有已修标记？")) return;
    fixedWordIdsRef.current = new Set();
    repairHistoryRef.current = [];
    setFixedWordIds(new Set());
    setRepairHistory([]);
    writeRepairProgress(repairStorageKey, new Set());
    setRepairFilter("remaining");
  };

  const openWord = useCallback((word: LevelWordItem) => {
    wordCache.current.set(word.slug, word);
    setActiveCardId(word.id);
    if (issueByWordId.has(word.id)) setSelectedWordId(word.id);
    setOpenCards((current) => [word, ...current.filter((item) => item.id !== word.id)].slice(0, 5));
  }, [issueByWordId]);

  const loadWordBySlug = useCallback(async (slug: string) => {
    const cachedWord = wordCache.current.get(slug);
    if (cachedWord) return cachedWord;

    setLoadingSlug(slug);
    try {
      const fetchedWord = await fetchWordCard(slug);
      wordCache.current.set(fetchedWord.slug, fetchedWord);
      return fetchedWord;
    } catch (error) {
      console.error(error);
      return null;
    } finally {
      setLoadingSlug((current) => (current === slug ? null : current));
    }
  }, []);

  const openWordBySlug = useCallback(
    async (slug: string) => {
      const word = await loadWordBySlug(slug);
      if (!word) return false;
      openWord(word);
      return true;
    },
    [loadWordBySlug, openWord]
  );

  const openIssueWord = useCallback(
    async (issue: MnemonicLogicAuditIssue) => {
      allowSelectedWordFocusRef.current = true;
      setSelectedWordId(issue.wordId);
      ensureIssueVisible(issue.wordId);
      const word = await loadWordBySlug(issue.slug);
      if (!word) return false;
      openWord(word);
      return true;
    },
    [ensureIssueVisible, loadWordBySlug, openWord]
  );

  const activateWordCard = useCallback(
    (wordId: string | null) => {
      setActiveCardId(wordId);
      if (wordId && issueByWordId.has(wordId)) {
        allowSelectedWordFocusRef.current = true;
        setSelectedWordId(wordId);
        ensureIssueVisible(wordId);
      }
    },
    [ensureIssueVisible, issueByWordId]
  );

  const closeWord = useCallback(
    (wordId: string) => {
      allowSelectedWordFocusRef.current = true;
      setSelectedWordId(wordId);
      ensureIssueVisible(wordId);
      setOpenCards((current) => current.filter((word) => word.id !== wordId));
      window.requestAnimationFrame(() => focusRepositoryIssueWord(wordId));
    },
    [ensureIssueVisible]
  );

  const replaceActiveIssueCard = useCallback(
    async (currentWordId: string, nextIssue: MnemonicLogicAuditIssue | null) => {
      if (!nextIssue) {
        closeWord(currentWordId);
        setActiveCardId(null);
        return;
      }

      allowSelectedWordFocusRef.current = true;
      setSelectedWordId(nextIssue.wordId);
      ensureIssueVisible(nextIssue.wordId);
      const nextWord = await loadWordBySlug(nextIssue.slug);
      if (!nextWord) return;

      setActiveCardId(nextWord.id);
      setOpenCards((current) =>
        [
          nextWord,
          ...current.filter((item) => item.id !== currentWordId && item.id !== nextWord.id)
        ].slice(0, 5)
      );
    },
    [closeWord, ensureIssueVisible, loadWordBySlug]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const targetWordId =
        activeCardId && issueByWordId.has(activeCardId)
          ? activeCardId
          : selectedWordIdRef.current;
      const targetIssue = targetWordId ? issueByWordId.get(targetWordId) : null;

      if (event.key === " " || event.code === "Space") {
        if (isTextInputTarget(event.target) || !targetWordId || !targetIssue) return;
        event.preventDefault();
        if (openCards.some((word) => word.id === targetWordId)) {
          const nextActiveCardId =
            activeCardId === targetWordId
              ? (openCards.find((word) => word.id !== targetWordId)?.id ?? null)
              : activeCardId;
          closeWord(targetWordId);
          setActiveCardId(nextActiveCardId);
          return;
        }
        void openIssueWord(targetIssue);
        return;
      }

      if (
        (event.key.toLowerCase() === "v" || event.code === "KeyV") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        if (isTextInputTarget(event.target) || !targetWordId) return;
        event.preventDefault();
        if (
          activeCardId === targetWordId &&
          targetIssue &&
          openCards.some((word) => word.id === targetWordId)
        ) {
          setWordFixed(targetWordId, true);
          const nextIssue = adjacentIssue(filteredWordIssues, targetIssue, "next");
          void replaceActiveIssueCard(targetWordId, nextIssue);
          return;
        }
        toggleWordFixed(targetWordId);
        return;
      }

      if (openCards.length) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (isTextInputTarget(event.target)) return;
        const currentWordId = selectedWordIdRef.current ?? visibleWordIssues[0]?.wordId;
        const currentIssue = currentWordId ? issueByWordId.get(currentWordId) : null;
        const nextIssue = adjacentIssue(
          visibleWordIssues,
          currentIssue ?? visibleWordIssues[0] ?? null,
          event.key === "ArrowLeft" ? "previous" : "next"
        );
        if (!nextIssue) return;
        event.preventDefault();
        allowSelectedWordFocusRef.current = true;
        setSelectedWordId(nextIssue.wordId);
        return;
      }
      if (event.key.toLowerCase() !== "z" || event.shiftKey || event.altKey) return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (isTextInputTarget(event.target)) return;
      if (!repairHistoryRef.current.length) return;

      event.preventDefault();
      undoLastRepairMark();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    activeCardId,
    closeWord,
    filteredWordIssues,
    issueByWordId,
    openCards,
    openIssueWord,
    replaceActiveIssueCard,
    repairStorageKey,
    setWordFixed,
    toggleWordFixed,
    visibleWordIssues
  ]);

  const updateWord = (updatedWord: LevelWordItem) => {
    wordCache.current.set(updatedWord.slug, updatedWord);
    setOpenCards((current) =>
      current.map((word) => (word.id === updatedWord.id ? { ...word, ...updatedWord } : word))
    );
    dispatchRepositoryWorkloadRefresh({ changedWordIds: [updatedWord.id], source: "word-card" });
  };

  return (
    <>
      <section className="mn-repository-panel-wrap mx-auto max-w-7xl px-5 pt-6 sm:px-8">
        <details
          className="mn-repository-panel group overflow-hidden rounded-[28px] bg-white/95 shadow-[0_18px_55px_rgba(0,0,0,0.08)] ring-1 ring-black/5 dark:bg-card/95 dark:shadow-[0_18px_55px_rgba(0,0,0,0.28)] dark:ring-white/10"
        >
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 px-5 py-4 marker:hidden sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
                  !report
                    ? "bg-muted text-muted-foreground"
                    : hasIssues
                      ? "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200"
                      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200"
                )}
              >
                {isRunning ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : hasIssues ? (
                  <AlertTriangle className="h-5 w-5" />
                ) : (
                  <ClipboardCheck className="h-5 w-5" />
                )}
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-normal text-foreground">
                  逻辑审计汇总
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {report
                    ? `${isRunning ? "正在阅读" : report.status === "failed" ? "审计中断" : "已阅读"} ${auditedEntries.toLocaleString("zh-CN")} / ${totalEntries.toLocaleString("zh-CN")} 张分类记忆卡，发现 ${issueEntryCount.toLocaleString("zh-CN")} 张有逻辑问题。`
                    : "还没有生成全量阅读审计报告。"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-sm font-semibold text-muted-foreground">
              <span>{report ? `${progress}%` : "待生成"}</span>
              <ChevronRight className="h-4 w-4 transition group-open:rotate-90" />
            </div>
          </summary>

          <div className="border-t border-border/70 px-5 py-5 sm:px-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric
                label="阅读进度"
                value={report ? `${progress}%` : "0%"}
                tone={report && progress === 100 ? "clean" : "neutral"}
              />
              <Metric
                label="问题卡"
                value={issueEntryCount.toLocaleString("zh-CN")}
                tone={issueEntryCount ? "danger" : "clean"}
              />
              <Metric
                label="失败批次"
                value={(report?.failedBatches.length ?? 0).toLocaleString("zh-CN")}
                tone={report?.failedBatches.length ? "warning" : "clean"}
              />
            </div>

            {report ? (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 dark:bg-white/10">
                    <Brain className="h-3.5 w-3.5" />
                    {report.model}
                  </span>
                  <span>更新：{formatDateTime(report.updatedAt)}</span>
                </div>
                {issues.length ? (
                  <RepairProgress
                    canUndo={repairHistory.length > 0}
                    canSave={hasUnsavedRepairProgress || repairSaveState === "error"}
                    fixedCount={fixedProblemWords}
                    lastActionWord={repairHistory.at(-1)?.word ?? ""}
                    onClear={clearRepairProgress}
                    onSave={() => void persistRepairProgress("manual")}
                    onUndo={undoLastRepairMark}
                    progress={repairProgress}
                    remainingCount={remainingProblemWords}
                    saveMessage={repairSaveMessage}
                    saveState={repairSaveState}
                    totalCount={totalProblemWords}
                  />
                ) : null}
                {issues.length ? (
                  <div className="mt-5 grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                    <aside className="space-y-2">
                      <IssueTypeButton
                        active={activeType === "all"}
                        count={totalProblemWords}
                        label="全部问题卡"
                        priorityCount={countPriorityWords(issues, fixedWordIds)}
                        onClick={() => setSelectedType("all")}
                      />
                      {issueGroups.map((group) => {
                        return (
                          <IssueTypeButton
                            key={group.type}
                            active={activeType === group.type}
                            count={countUniqueWords(group.issues)}
                            label={issueTypeLabels[group.type]}
                            priorityCount={countPriorityWords(group.issues, fixedWordIds)}
                            onClick={() => setSelectedType(group.type)}
                          />
                        );
                      })}
                    </aside>

                    <div className="min-w-0 rounded-lg border border-border/70 bg-[#fbfbfd] p-3 dark:bg-white/5">
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div className="min-w-0">
                          <h3 className="text-base font-semibold text-foreground">
                            {activeType === "all" ? "全部问题卡" : issueTypeLabels[activeType]}
                          </h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {filteredWordCount.toLocaleString("zh-CN")} 个单词 /{" "}
                            {filteredIssues.length.toLocaleString("zh-CN")} 条问题，当前显示{" "}
                            {visibleWordIssues.length.toLocaleString("zh-CN")} 个。
                          </p>
                        </div>
                        <div className="flex flex-col gap-2 sm:items-end">
                          <div className="flex flex-wrap gap-2">
                            <RepairFilterButton
                              active={repairFilter === "remaining"}
                              count={activeRemainingWords}
                              label="未修"
                              onClick={() => setRepairFilter("remaining")}
                            />
                            <RepairFilterButton
                              active={repairFilter === "fixed"}
                              count={activeFixedWords}
                              label="已修"
                              onClick={() => setRepairFilter("fixed")}
                            />
                            <RepairFilterButton
                              active={repairFilter === "all"}
                              count={activeTotalWords}
                              label="全部"
                              onClick={() => setRepairFilter("all")}
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <SeverityButton
                              active={selectedSeverity === "all"}
                              count={repairScopedActiveIssues.length}
                              label="全部"
                              onClick={() => setSelectedSeverity("all")}
                            />
                            {severityOrder.map((severity) => (
                              <SeverityButton
                                key={severity}
                                active={selectedSeverity === severity}
                                count={activeSeverityCounts[severity]}
                                label={severity}
                                tone={severity}
                                onClick={() => setSelectedSeverity(severity)}
                              />
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="relative mt-3">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          className="h-11 w-full rounded-lg border border-border/70 bg-white pl-9 pr-10 text-sm font-medium text-foreground outline-none transition placeholder:text-muted-foreground focus:border-[#0071e3] dark:bg-background"
                          placeholder="搜索单词、原因、证据或建议"
                          type="search"
                        />
                        {query ? (
                          <button
                            type="button"
                            onClick={() => setQuery("")}
                            className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                            aria-label="清空搜索"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>

                      {visibleWordIssues.length ? (
                        <>
                          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(116px,1fr))] gap-2">
                            {visibleWordIssues.map((issue) => (
                              <IssueWordTile
                                key={issue.wordId}
                                issue={issue}
                                isFixed={fixedWordIds.has(issue.wordId)}
                                isSelected={selectedWordId === issue.wordId}
                                isLoading={loadingSlug === issue.slug}
                                onOpenWord={() => void openIssueWord(issue)}
                                onSelect={() => {
                                  allowSelectedWordFocusRef.current = true;
                                  selectedWordIdRef.current = issue.wordId;
                                  setSelectedWordId(issue.wordId);
                                }}
                                onToggleFixed={() => toggleWordFixed(issue.wordId)}
                              />
                            ))}
                          </div>
                          {filteredWordIssues.length > visibleWordIssues.length ? (
                            <div className="mt-4 flex justify-center">
                              <button
                                type="button"
                                onClick={() => setVisibleCount((current) => current + previewSize)}
                                className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-white px-4 text-sm font-semibold text-foreground transition hover:bg-muted dark:bg-background"
                              >
                                再显示{" "}
                                {Math.min(
                                  previewSize,
                                  filteredWordIssues.length - visibleWordIssues.length
                                ).toLocaleString("zh-CN")}{" "}
                                个
                              </button>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <p className="mt-3 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-muted-foreground ring-1 ring-border/70 dark:bg-background">
                          当前筛选下没有问题卡。
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-5 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
                    已审计范围内暂时没有发现逻辑问题。
                  </p>
                )}
              </>
            ) : (
              <p className="mt-4 rounded-lg bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground">
                运行 npm run mnemonic:audit-logic 后，这里会自动显示最新汇总。
              </p>
            )}
          </div>
        </details>
      </section>

      {openCards.length ? (
        <MemoryCardTray
          words={openCards}
          activeCardId={activeCardId}
          onActivate={activateWordCard}
          onClose={closeWord}
          onOpenLinkedWord={openWordBySlug}
          onWordUpdate={updateWord}
          onNavigateWord={(word, direction) => {
            const nextIssue = adjacentIssue(
              filteredWordIssues,
              issueByWordId.get(word.id) ?? null,
              direction
            );
            void replaceActiveIssueCard(word.id, nextIssue);
          }}
          isAuthenticated={true}
        />
      ) : null}
    </>
  );
}

function RepairProgress({
  canUndo,
  canSave,
  fixedCount,
  lastActionWord,
  onClear,
  onSave,
  onUndo,
  progress,
  remainingCount,
  saveMessage,
  saveState,
  totalCount
}: {
  canUndo: boolean;
  canSave: boolean;
  fixedCount: number;
  lastActionWord: string;
  onClear: () => void;
  onSave: () => void;
  onUndo: () => void;
  progress: number;
  remainingCount: number;
  saveMessage: string;
  saveState: RepairSaveState;
  totalCount: number;
}) {
  const isSaving = saveState === "saving";

  return (
    <div className="mt-4 rounded-lg border border-border/70 bg-[#fbfbfd] px-4 py-3 dark:bg-white/5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-semibold text-foreground">修复进度</span>
            <span className="text-sm text-muted-foreground">
              已修 {fixedCount.toLocaleString("zh-CN")} / {totalCount.toLocaleString("zh-CN")}{" "}
              个问题单词
            </span>
            <span className="text-sm font-semibold text-rose-700 dark:text-rose-200">
              剩 {remainingCount.toLocaleString("zh-CN")} 个
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-semibold",
              saveState === "error"
                ? "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200"
                : saveState === "dirty"
                  ? "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
                  : saveState === "saving"
                    ? "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200"
                    : "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200"
            )}
          >
            {saveMessage}
          </span>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave || isSaving}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-semibold text-foreground transition hover:bg-muted disabled:pointer-events-none disabled:opacity-45 dark:bg-background"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            保存
          </button>
          <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            {progress}%
          </span>
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title={
              lastActionWord ? `撤销上一次标记：${lastActionWord} (⌘Z)` : "撤销上一次标记 (⌘Z)"
            }
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-45 dark:bg-background"
          >
            <Undo2 className="h-3.5 w-3.5" />
            撤销
            <span className="text-[11px] opacity-70">⌘Z</span>
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={!fixedCount}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-45 dark:bg-background"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            清空标记
          </button>
        </div>
      </div>
    </div>
  );
}

function IssueTypeButton({
  active,
  count,
  label,
  priorityCount,
  onClick
}: {
  active: boolean;
  count: number;
  label: string;
  priorityCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition",
        active
          ? "border-[#1d1d1f] bg-[#1d1d1f] text-white shadow-sm dark:border-white dark:bg-white dark:text-background"
          : "border-border bg-white text-foreground hover:border-[#1d1d1f]/40 hover:bg-muted/40 dark:bg-background dark:hover:border-white/40"
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{label}</span>
        <span
          className={cn(
            "mt-0.5 block text-xs",
            active ? "text-white/70 dark:text-background/70" : "text-muted-foreground"
          )}
        >
          {priorityCount.toLocaleString("zh-CN")} 个优先未修
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 rounded-md px-2 py-1 text-xs font-semibold",
          active ? "bg-white/15 dark:bg-background/10" : "bg-muted text-muted-foreground"
        )}
      >
        {count.toLocaleString("zh-CN")}
      </span>
    </button>
  );
}

function RepairFilterButton({
  active,
  count,
  label,
  onClick
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition",
        active
          ? "border-[#1d1d1f] bg-[#1d1d1f] text-white dark:border-white dark:bg-white dark:text-background"
          : "border-border bg-white text-muted-foreground hover:border-[#1d1d1f]/40 hover:text-foreground dark:bg-background dark:hover:border-white/40"
      )}
    >
      <span>{label}</span>
      <span className={cn("text-xs", active ? "opacity-80" : "opacity-70")}>
        {count.toLocaleString("zh-CN")}
      </span>
    </button>
  );
}

function SeverityButton({
  active,
  count,
  label,
  tone,
  onClick
}: {
  active: boolean;
  count: number;
  label: string;
  tone?: MnemonicLogicIssueSeverity;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition",
        active
          ? severityTone(tone, "active")
          : "border-border bg-white text-muted-foreground hover:border-[#1d1d1f]/40 hover:text-foreground dark:bg-background dark:hover:border-white/40"
      )}
    >
      <span>{label}</span>
      <span className={cn("text-xs", active ? "opacity-80" : "opacity-70")}>
        {count.toLocaleString("zh-CN")}
      </span>
    </button>
  );
}

function IssueWordTile({
  issue,
  isFixed,
  isSelected,
  isLoading,
  onOpenWord,
  onSelect,
  onToggleFixed
}: {
  issue: MnemonicLogicAuditIssue;
  isFixed: boolean;
  isSelected: boolean;
  isLoading: boolean;
  onOpenWord: () => void;
  onSelect: () => void;
  onToggleFixed: () => void;
}) {
  return (
    <button
      type="button"
      data-repository-issue-word-id={issue.wordId}
      onClick={onOpenWord}
      onFocus={onSelect}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (event.key === "Enter") {
          event.preventDefault();
          onOpenWord();
          return;
        }
        if (event.key === " " || event.code === "Space") {
          event.preventDefault();
          event.stopPropagation();
          onOpenWord();
          return;
        }
        if (event.key.toLowerCase() === "v" || event.code === "KeyV") {
          event.preventDefault();
          event.stopPropagation();
          onToggleFixed();
        }
      }}
      title={issue.word}
      aria-pressed={isFixed}
      aria-label={`${issue.word}，${isFixed ? "已标记" : "未标记"}，点击或空格打开单词卡，V 标记`}
      className={cn(
        "group flex h-14 min-w-0 items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left text-base font-semibold tracking-normal text-foreground transition hover:-translate-y-0.5 hover:border-[#1d1d1f] hover:shadow-sm focus:outline-none focus-visible:border-[#1a73e8] focus-visible:ring-2 focus-visible:ring-[#1a73e8] dark:bg-background dark:hover:border-foreground",
        isSelected && "border-[#1a73e8] ring-2 ring-[#1a73e8] dark:border-[#7ab7ff] dark:ring-[#7ab7ff]",
        isFixed
          ? "border-emerald-200 bg-emerald-50/70 text-emerald-950 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-100"
          : "border-border/70"
      )}
    >
      <span className="min-w-0 truncate">{issue.word}</span>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isFixed ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-200" />
        ) : null}
      </span>
    </button>
  );
}

function Metric({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "clean" | "danger" | "warning" | "neutral";
}) {
  return (
    <div
      className={cn(
        "mn-repository-metric rounded-2xl px-4 py-3 ring-1",
        tone === "clean" &&
          "bg-emerald-50 text-emerald-900 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-100 dark:ring-emerald-400/20",
        tone === "danger" &&
          "bg-rose-50 text-rose-900 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-100 dark:ring-rose-400/20",
        tone === "warning" &&
          "bg-amber-50 text-amber-900 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-400/20",
        tone === "neutral" &&
          "bg-muted text-foreground ring-border/70 dark:bg-white/10 dark:ring-white/10"
      )}
    >
      <div className="text-2xl font-semibold tracking-normal">{value}</div>
      <div className="mt-1 text-xs font-semibold">{label}</div>
    </div>
  );
}

function groupIssues(issues: MnemonicLogicAuditIssue[]) {
  const byType = new Map<MnemonicLogicIssueType, MnemonicLogicAuditIssue[]>();
  for (const issue of issues) {
    const items = byType.get(issue.issueType) ?? [];
    items.push(issue);
    byType.set(issue.issueType, items);
  }
  return [...byType.entries()]
    .map(([type, groupIssues]) => ({
      type,
      issues: groupIssues.sort(compareIssue)
    }))
    .sort((left, right) => right.issues.length - left.issues.length);
}

function countBySeverity(issues: MnemonicLogicAuditIssue[]) {
  return issues.reduce(
    (counts, issue) => {
      counts[issue.severity] += 1;
      return counts;
    },
    { P0: 0, P1: 0, P2: 0, P3: 0 } satisfies Record<MnemonicLogicIssueSeverity, number>
  );
}

function countUniqueWords(issues: MnemonicLogicAuditIssue[]) {
  return new Set(issues.map((issue) => issue.wordId)).size;
}

function uniqueIssuesByWord(issues: MnemonicLogicAuditIssue[]) {
  const byWordId = new Map<string, MnemonicLogicAuditIssue>();
  for (const issue of issues) {
    const existing = byWordId.get(issue.wordId);
    if (!existing || compareIssue(issue, existing) < 0) {
      byWordId.set(issue.wordId, issue);
    }
  }
  return [...byWordId.values()].sort(compareIssue);
}

function adjacentIssue(
  issues: MnemonicLogicAuditIssue[],
  issue: Pick<MnemonicLogicAuditIssue, "wordId" | "slug"> | null,
  direction: IssueNavigationDirection
) {
  if (!issues.length) return null;
  if (!issue) return direction === "next" ? issues[0] : issues[issues.length - 1];
  const currentIndex = issues.findIndex(
    (item) => item.wordId === issue.wordId || item.slug === issue.slug
  );
  if (currentIndex < 0) return direction === "next" ? issues[0] : issues[issues.length - 1];
  if (issues.length === 1) return null;

  const step = direction === "next" ? 1 : -1;
  const nextIndex = (currentIndex + step + issues.length) % issues.length;
  return issues[nextIndex] ?? null;
}

function focusRepositoryIssueWord(wordId: string) {
  const wordElement = Array.from(
    document.querySelectorAll<HTMLElement>("[data-repository-issue-word-id]")
  ).find((element) => element.dataset.repositoryIssueWordId === wordId);
  if (!wordElement) return;

  wordElement.focus({ preventScroll: true });
  wordElement.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: "auto"
  });
}

function countFixedWords(wordIds: Set<string>, fixedWordIds: Set<string>) {
  let count = 0;
  for (const wordId of wordIds) {
    if (fixedWordIds.has(wordId)) count += 1;
  }
  return count;
}

function countPriorityWords(issues: MnemonicLogicAuditIssue[], fixedWordIds: Set<string>) {
  const wordIds = new Set<string>();
  for (const issue of issues) {
    if ((issue.severity === "P0" || issue.severity === "P1") && !fixedWordIds.has(issue.wordId)) {
      wordIds.add(issue.wordId);
    }
  }
  return wordIds.size;
}

function compareIssue(left: MnemonicLogicAuditIssue, right: MnemonicLogicAuditIssue) {
  const severityRank: Record<MnemonicLogicIssueSeverity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return (
    severityRank[left.severity] - severityRank[right.severity] ||
    left.word.localeCompare(right.word)
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatClockTime(date = new Date()) {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: "2-digit"
  });
}

function repairProgressStorageKey(report: MnemonicLogicAuditReport | null) {
  return `${repairProgressStoragePrefix}:${report?.createdAt || report?.updatedAt || "empty"}`;
}

function repairProgressSignature(wordIds: Set<string>) {
  return [...wordIds].sort().join("\n");
}

function readRepairProgress(storageKey: string, validWordIds: Set<string>) {
  if (typeof window === "undefined") return new Set<string>();

  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]") as unknown;
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(
      parsed.filter(
        (wordId): wordId is string => typeof wordId === "string" && validWordIds.has(wordId)
      )
    );
  } catch {
    return new Set<string>();
  }
}

function writeRepairProgress(storageKey: string, fixedWordIds: Set<string>) {
  if (typeof window === "undefined") return;

  if (!fixedWordIds.size) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify([...fixedWordIds]));
}

function isTextInputTarget(target: EventTarget | null) {
  return (
    (target instanceof HTMLInputElement &&
      !["button", "checkbox", "radio", "range"].includes(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
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

async function saveRepairProgressSnapshot(fixedWordIds: string[], scopedWordIds: string[]) {
  const response = await fetch("/api/mnemonic-logic-audit/repair-progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fixedWordIds, scopedWordIds })
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    changedWordIds?: string[];
    fixedWordIds?: string[];
  };

  if (!response.ok) {
    throw new Error(result.error || "审计标记保存失败。");
  }

  return result;
}

function severityTone(severity: MnemonicLogicIssueSeverity | undefined, mode: "active" | "soft") {
  if (mode === "active") {
    if (severity === "P0") return "border-rose-700 bg-rose-700 text-white";
    if (severity === "P1") return "border-orange-600 bg-orange-600 text-white";
    if (severity === "P2") return "border-amber-500 bg-amber-500 text-white";
    if (severity === "P3") return "border-sky-600 bg-sky-600 text-white";
    return "border-[#1d1d1f] bg-[#1d1d1f] text-white dark:border-white dark:bg-white dark:text-background";
  }

  if (severity === "P0") return "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200";
  if (severity === "P1")
    return "bg-orange-50 text-orange-800 dark:bg-orange-500/10 dark:text-orange-200";
  if (severity === "P2")
    return "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200";
  return "bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:text-sky-200";
}
