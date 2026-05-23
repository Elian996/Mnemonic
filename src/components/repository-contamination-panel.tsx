"use client";

import { AlertTriangle, Bug, ChevronDown, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { MemoryCardTray, type LevelWordItem } from "@/components/level-word-browser";
import type { ContaminationAuditGroup, ContaminationAuditWord } from "@/lib/mnemonic-contamination-audit";
import { cn } from "@/lib/utils";

export function RepositoryContaminationPanel({ groups }: { groups: ContaminationAuditGroup[] }) {
  const [openCards, setOpenCards] = useState<LevelWordItem[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const wordCache = useRef(new Map<string, LevelWordItem>());
  const total = groups.reduce((sum, group) => sum + group.words.length, 0);
  const definiteCount = groups
    .filter((group) => group.id !== "duplicate-section" && group.id !== "odd-separator")
    .reduce((sum, group) => sum + group.words.length, 0);
  const reviewCount = Math.max(0, total - definiteCount);

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
    } finally {
      setLoadingSlug((current) => (current === slug ? null : current));
    }
  };

  const updateWord = (updatedWord: LevelWordItem) => {
    wordCache.current.set(updatedWord.slug, updatedWord);
    setOpenCards((current) => current.map((word) => (word.id === updatedWord.id ? { ...word, ...updatedWord } : word)));
  };

  return (
    <section className="mn-repository-panel-wrap mx-auto max-w-7xl px-5 pt-6 sm:px-8">
      <details
        className="mn-repository-panel group overflow-hidden rounded-[28px] bg-white/95 shadow-[0_18px_55px_rgba(0,0,0,0.08)] ring-1 ring-black/5"
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 px-5 py-4 marker:hidden sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", total ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800")}>
              {total ? <Bug className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-normal text-[#1d1d1f]">记忆卡体检</h2>
              <p className="mt-1 text-sm text-[#6e6e73]">
                {total ? `发现 ${total} 个待看点：${definiteCount} 个优先处理，${reviewCount} 个待确认。` : "目前没有发现污染。"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm font-semibold text-[#6e6e73]">
            <span>{total ? "展开查看" : "查看明细"}</span>
            <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
          </div>
        </summary>

        <div className="border-t border-black/5 px-5 py-5 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="检测维度" value={`${groups.length} 类`} tone="clean" />
            <Metric label="优先处理" value={definiteCount} tone={definiteCount ? "danger" : "clean"} />
            <Metric label="待确认" value={reviewCount} tone={reviewCount ? "warning" : "clean"} />
          </div>

          <div className="mt-5 space-y-4">
            {groups.map((group) => (
              <IssueGroup
                key={group.id}
                group={group}
                loadingSlug={loadingSlug}
                onOpenWord={(word) => void openWordBySlug(word.slug)}
              />
            ))}
          </div>
        </div>
      </details>

      {openCards.length ? (
        <MemoryCardTray
          words={openCards}
          activeCardId={activeCardId}
          onActivate={setActiveCardId}
          onClose={(wordId) => setOpenCards((current) => current.filter((word) => word.id !== wordId))}
          onOpenLinkedWord={openWordBySlug}
          onWordUpdate={updateWord}
          isAuthenticated={true}
        />
      ) : null}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone: "clean" | "danger" | "warning" }) {
  return (
    <div
      className={cn(
        "mn-repository-metric",
        "rounded-2xl px-4 py-3 ring-1",
        tone === "clean" && "bg-emerald-50 text-emerald-900 ring-emerald-100",
        tone === "danger" && "bg-rose-50 text-rose-900 ring-rose-100",
        tone === "warning" && "bg-amber-50 text-amber-900 ring-amber-100"
      )}
    >
      <div className="text-2xl font-semibold tracking-normal">{value}</div>
      <div className="mt-1 text-xs font-semibold">{label}</div>
    </div>
  );
}

function IssueGroup({
  group,
  loadingSlug,
  onOpenWord
}: {
  group: ContaminationAuditGroup;
  loadingSlug: string | null;
  onOpenWord: (word: ContaminationAuditWord) => void;
}) {
  const Icon = group.tone === "danger" ? AlertTriangle : group.tone === "warning" ? Bug : Sparkles;
  const visibleWords = useMemo(() => group.words.slice(0, 160), [group.words]);

  return (
    <section className="mn-repository-issue-group border-t border-black/5 pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[#1d1d1f]">
            <Icon className={cn("h-4 w-4", group.tone === "danger" && "text-rose-600", group.tone === "warning" && "text-amber-600", group.tone === "info" && "text-sky-600")} />
            {group.title}
            <span className="text-[#6e6e73]">({group.words.length})</span>
          </h3>
          <p className="mt-1 text-sm leading-6 text-[#6e6e73]">{group.description}</p>
        </div>
      </div>

      {group.words.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {visibleWords.map((word) => {
            const isLoading = loadingSlug === word.slug;
            return (
              <button
                key={`${group.id}-${word.id}`}
                type="button"
                onClick={() => onOpenWord(word)}
                disabled={isLoading}
                title={[word.meaning, ...word.details].join("\n")}
                className={cn(
                  "mn-repository-word-chip inline-flex h-9 max-w-full items-center gap-2 rounded-full border px-3 text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-70",
                  group.tone === "danger" && "border-rose-200 bg-rose-50 text-rose-900 hover:border-rose-400",
                  group.tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-400",
                  group.tone === "info" && "border-sky-200 bg-sky-50 text-sky-900 hover:border-sky-400"
                )}
              >
                <span className="truncate">{word.word}</span>
                {isLoading ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
              </button>
            );
          })}
          {group.words.length > visibleWords.length ? (
            <span className="inline-flex h-9 items-center rounded-full bg-[#f5f5f7] px-3 text-sm font-semibold text-[#6e6e73]">
              还有 {group.words.length - visibleWords.length} 个
            </span>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">这一类已经干净。</p>
      )}
    </section>
  );
}

async function fetchWordCard(slug: string) {
  const response = await fetch(`/api/word-card/${encodeURIComponent(slug)}?fresh=${Date.now()}`, {
    cache: "no-store"
  });
  const result = (await response.json().catch(() => ({}))) as Partial<LevelWordItem> & { error?: string };

  if (!response.ok) {
    throw new Error(result.error || "单词卡加载失败。");
  }
  if (!result.id || !result.slug || !result.word || !Array.isArray(result.mnemonics)) {
    throw new Error("单词卡返回数据不完整。");
  }

  return result as LevelWordItem;
}
