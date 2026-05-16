"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Brain,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Loader2,
  RotateCcw,
  Search,
  Undo2,
  X
} from "lucide-react";
import { MemoryCardTray, type LevelWordItem } from "@/components/level-word-browser";
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
  codex_p0_review: "Codex 人工复核"
};

const severityLabels: Record<MnemonicLogicIssueSeverity, string> = {
  P0: "必须重做",
  P1: "优先修",
  P2: "需复核",
  P3: "轻微"
};

const severityOrder: MnemonicLogicIssueSeverity[] = ["P0", "P1", "P2", "P3"];
const previewSize = 64;
const repairProgressStoragePrefix = "mnemonic_logic_audit_repair_progress";
type IssueTypeFilter = MnemonicLogicIssueType | "all";
type RepairFilter = "remaining" | "fixed" | "all";
type RepairHistoryItem = {
  id: string;
  word: string;
  wordId: string;
  previousFixed: boolean;
  nextFixed: boolean;
};
type SeverityFilter = MnemonicLogicIssueSeverity | "all";

export function RepositoryLogicAuditPanel({ report }: { report: MnemonicLogicAuditReport | null }) {
  const issues = report?.issues ?? [];
  const issueEntryCount = report?.issueEntries ?? 0;
  const totalEntries = report?.totalEntries ?? 0;
  const auditedEntries = report?.auditedEntries ?? 0;
  const progress = totalEntries ? Math.round((auditedEntries / totalEntries) * 100) : 0;
  const isRunning = report?.status === "running";
  const hasIssues = issues.length > 0;
  const hasFailures = Boolean(report?.failedBatches.length);
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
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [fixedWordIds, setFixedWordIds] = useState<Set<string>>(() => new Set());
  const [repairHistory, setRepairHistory] = useState<RepairHistoryItem[]>([]);
  const fixedWordIdsRef = useRef(new Set<string>());
  const repairHistoryRef = useRef<RepairHistoryItem[]>([]);
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
  const visibleIssues = filteredIssues.slice(0, visibleCount);
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

  useEffect(() => {
    setVisibleCount(previewSize);
  }, [activeType, normalizedQuery, repairFilter, selectedSeverity]);

  useEffect(() => {
    const nextFixedWordIds = new Set([
      ...reportFixedWordIds,
      ...readRepairProgress(repairStorageKey, allProblemWordIds)
    ]);
    fixedWordIdsRef.current = nextFixedWordIds;
    repairHistoryRef.current = [];
    setFixedWordIds(nextFixedWordIds);
    setRepairHistory([]);
  }, [allProblemWordIds, repairStorageKey, reportFixedWordIds]);

  const updateRepairHistory = (updater: (current: RepairHistoryItem[]) => RepairHistoryItem[]) => {
    const nextHistory = updater(repairHistoryRef.current);
    repairHistoryRef.current = nextHistory;
    setRepairHistory(nextHistory);
  };

  const setWordFixed = (wordId: string, fixed: boolean) => {
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
  };

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (openCards.length) return;
      if (event.key.toLowerCase() !== "z" || event.shiftKey || event.altKey) return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (isTextInputTarget(event.target)) return;
      if (!repairHistoryRef.current.length) return;

      event.preventDefault();
      undoLastRepairMark();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openCards.length, repairStorageKey]);

  const openWord = (word: LevelWordItem) => {
    wordCache.current.set(word.slug, word);
    setActiveCardId(word.id);
    setOpenCards((current) => [word, ...current.filter((item) => item.id !== word.id)].slice(0, 5));
  };

  const openWordBySlug = async (slug: string) => {
    const cachedWord = wordCache.current.get(slug);
    if (cachedWord) {
      openWord(cachedWord);
      return true;
    }

    setLoadingSlug(slug);
    try {
      const fetchedWord = await fetchWordCard(slug);
      openWord(fetchedWord);
      return true;
    } catch (error) {
      console.error(error);
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

  return (
    <>
      <section className="mx-auto max-w-7xl px-5 pt-6 sm:px-8">
        <details
          open={Boolean(report && (isRunning || hasIssues || hasFailures))}
          className="group overflow-hidden rounded-[28px] bg-white/95 shadow-[0_18px_55px_rgba(0,0,0,0.08)] ring-1 ring-black/5 dark:bg-card/95 dark:shadow-[0_18px_55px_rgba(0,0,0,0.28)] dark:ring-white/10"
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
                    fixedCount={fixedProblemWords}
                    lastActionWord={repairHistory.at(-1)?.word ?? ""}
                    onClear={clearRepairProgress}
                    onUndo={undoLastRepairMark}
                    progress={repairProgress}
                    remainingCount={remainingProblemWords}
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
                            {visibleIssues.length.toLocaleString("zh-CN")} 条。
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

                      {visibleIssues.length ? (
                        <>
                          <div className="mt-3 grid gap-2 xl:grid-cols-2">
                            {visibleIssues.map((issue) => (
                              <IssueCard
                                key={`${issue.entryId}-${issue.issueType}-${issue.reason}`}
                                issue={issue}
                                isFixed={fixedWordIds.has(issue.wordId)}
                                isLoading={loadingSlug === issue.slug}
                                onOpenWord={() => void openWordBySlug(issue.slug)}
                                onToggleFixed={(fixed) => setWordFixed(issue.wordId, fixed)}
                              />
                            ))}
                          </div>
                          {filteredIssues.length > visibleIssues.length ? (
                            <div className="mt-4 flex justify-center">
                              <button
                                type="button"
                                onClick={() => setVisibleCount((current) => current + previewSize)}
                                className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-white px-4 text-sm font-semibold text-foreground transition hover:bg-muted dark:bg-background"
                              >
                                再显示{" "}
                                {Math.min(
                                  previewSize,
                                  filteredIssues.length - visibleIssues.length
                                ).toLocaleString("zh-CN")}{" "}
                                张
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
          onActivate={setActiveCardId}
          onClose={(wordId) =>
            setOpenCards((current) => current.filter((word) => word.id !== wordId))
          }
          onOpenLinkedWord={openWordBySlug}
          onWordUpdate={updateWord}
          isAuthenticated={true}
        />
      ) : null}
    </>
  );
}

function RepairProgress({
  canUndo,
  fixedCount,
  lastActionWord,
  onClear,
  onUndo,
  progress,
  remainingCount,
  totalCount
}: {
  canUndo: boolean;
  fixedCount: number;
  lastActionWord: string;
  onClear: () => void;
  onUndo: () => void;
  progress: number;
  remainingCount: number;
  totalCount: number;
}) {
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
        <div className="flex shrink-0 items-center gap-2">
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

function IssueCard({
  issue,
  isFixed,
  isLoading,
  onOpenWord,
  onToggleFixed
}: {
  issue: MnemonicLogicAuditIssue;
  isFixed: boolean;
  isLoading: boolean;
  onOpenWord: () => void;
  onToggleFixed: (fixed: boolean) => void;
}) {
  return (
    <article
      className={cn(
        "min-w-0 rounded-lg border bg-white p-3 shadow-sm transition hover:border-[#0071e3]/40 hover:shadow-md dark:bg-background",
        isFixed
          ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-400/30 dark:bg-emerald-500/10"
          : "border-border/70"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenWord}
              disabled={isLoading}
              className="inline-flex min-w-0 items-center gap-2 truncate text-left text-lg font-semibold leading-tight text-foreground transition hover:text-[#06c] disabled:pointer-events-none disabled:opacity-70"
            >
              <span className="truncate">{issue.word}</span>
              {isLoading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : null}
            </button>
            {isFixed ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" />
                已修
              </span>
            ) : null}
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-xs font-semibold",
                severityTone(issue.severity, "soft")
              )}
            >
              {issue.severity} · {severityLabels[issue.severity]}
            </span>
          </div>
          {issue.levelTags.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {issue.levelTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleFixed(!isFixed)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold transition",
              isFixed
                ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:hover:bg-emerald-500/25"
                : "bg-muted text-muted-foreground hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200"
            )}
            aria-pressed={isFixed}
          >
            {isFixed ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <Circle className="h-3.5 w-3.5" />
            )}
            {isFixed ? "已修" : "标记"}
          </button>
          <button
            type="button"
            onClick={onOpenWord}
            disabled={isLoading}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-70"
            aria-label={`打开 ${issue.word}`}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUpRight className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <dl className="mt-3 space-y-2 text-sm leading-5">
        <IssueField label="原因" value={issue.reason} strong />
        <IssueField label="证据" value={issue.evidence} />
        <IssueField label="建议" value={issue.suggestion} />
      </dl>
    </article>
  );
}

function IssueField({
  label,
  value,
  strong = false
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  if (!value) return null;

  return (
    <div className="grid gap-1 sm:grid-cols-[3.25rem_minmax(0,1fr)]">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 text-muted-foreground", strong && "font-medium text-foreground")}>
        {value}
      </dd>
    </div>
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
        "rounded-2xl px-4 py-3 ring-1",
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

function repairProgressStorageKey(report: MnemonicLogicAuditReport | null) {
  return `${repairProgressStoragePrefix}:${report?.createdAt || report?.updatedAt || "empty"}`;
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
