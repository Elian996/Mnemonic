"use client";

import { Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MemoryCardTray, type LevelWordItem } from "@/components/level-word-browser";
import { applyGuestProgressToWord } from "@/lib/guest-progress";
import { cn } from "@/lib/utils";

type WordSearchResponse = {
  words?: WordSearchResult[];
  error?: string;
};

type WordSearchResult = Pick<
  LevelWordItem,
  "id" | "word" | "slug" | "phonetic" | "partOfSpeech" | "meaningCn" | "shortMeaningCn" | "markState" | "isBookmarked"
>;

const searchIconClassName = "h-4 w-4";

export function WordMemorySearch({
  isAuthenticated,
  canEditOfficialCards = false,
  canExportMemoryCardImages = false
}: {
  isAuthenticated: boolean;
  canEditOfficialCards?: boolean;
  canExportMemoryCardImages?: boolean;
}) {
  const [q, setQ] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<WordSearchResult[]>([]);
  const [isResultsOpen, setIsResultsOpen] = useState(false);
  const [openCards, setOpenCards] = useState<LevelWordItem[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const linkedWordCache = useRef(new Map<string, LevelWordItem>());

  useEffect(() => {
    if (!isExpanded) return;
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [isExpanded]);

  useEffect(() => {
    if (!isExpanded && !isResultsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && wrapperRef.current?.contains(target)) return;
      setIsResultsOpen(false);
      setIsExpanded(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsResultsOpen(false);
      setIsExpanded(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isExpanded, isResultsOpen]);

  const openWord = (word: LevelWordItem) => {
    const nextWord = isAuthenticated ? word : applyGuestProgressToWord(word);
    linkedWordCache.current.set(nextWord.slug, nextWord);
    setMessage("");
    setActiveCardId(nextWord.id);
    setOpenCards((current) => [nextWord, ...current.filter((item) => item.id !== nextWord.id)].slice(0, 5));
  };

  const updateWord = (updatedWord: LevelWordItem) => {
    const nextWord = isAuthenticated ? updatedWord : applyGuestProgressToWord(updatedWord);
    linkedWordCache.current.set(nextWord.slug, nextWord);
    setOpenCards((current) => current.map((word) => (word.id === nextWord.id ? { ...word, ...nextWord } : word)));
  };

  const refreshWordBySlug = async (slug: string, activate = true) => {
    const response = await fetch(`/api/word-card/${encodeURIComponent(slug)}?fresh=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return false;
    const fetchedWord = (await response.json()) as LevelWordItem;
    if (activate) {
      openWord(fetchedWord);
    } else {
      updateWord(fetchedWord);
    }
    setIsResultsOpen(false);
    return true;
  };

  const searchWord = async () => {
    const query = q.trim();
    if (!query || isLoading) return;

    setIsLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/word-search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      const result = (await response.json().catch(() => ({}))) as WordSearchResponse;
      if (!response.ok) throw new Error(result.error || "搜索失败。");

      const words = (result.words ?? []).map((word) => (isAuthenticated ? word : applyGuestProgressToWord(word)));
      setResults(words);
      setIsResultsOpen(true);
      if (!words.length) setMessage("没有找到匹配单词。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "搜索失败。");
      setResults([]);
      setIsResultsOpen(true);
    } finally {
      setIsLoading(false);
    }
  };

  const openWordBySlug = async (slug: string) => {
    const cachedWord = linkedWordCache.current.get(slug);
    if (cachedWord) {
      openWord(cachedWord);
      void refreshWordBySlug(slug, false);
      return true;
    }

    setLoadingSlug(slug);
    try {
      return await refreshWordBySlug(slug);
    } finally {
      setLoadingSlug((current) => (current === slug ? null : current));
    }
  };

  const openLinkedWord = async (slug: string) => openWordBySlug(slug);

  const closeSearch = () => {
    setIsResultsOpen(false);
    setIsExpanded(false);
  };

  return (
    <>
      <div ref={wrapperRef} className="relative z-[70] h-9 w-9 shrink-0">
        <div
          className={cn(
            "absolute right-0 top-0 h-9 overflow-visible rounded-md border border-[#d8dde6] bg-white text-[#171a1f] transition-[width,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:border-border dark:bg-card dark:text-foreground",
            isExpanded
              ? "w-[min(320px,calc(100vw-2rem))] shadow-[0_12px_34px_rgba(23,26,31,0.16)]"
              : "w-9 hover:border-[#171a1f] dark:hover:border-foreground"
          )}
        >
          <label className="sr-only" htmlFor="level-word-toolbar-search">
            搜索全部单词
          </label>
          <input
            ref={inputRef}
            id="level-word-toolbar-search"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setMessage("");
              if (!event.target.value.trim()) {
                setResults([]);
                setIsResultsOpen(false);
              }
            }}
            onFocus={() => {
              if (results.length || message) setIsResultsOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void searchWord();
              }
            }}
            placeholder="输入英文或中文释义"
            className={cn(
              "h-full w-full bg-transparent pl-3 pr-10 text-sm font-medium text-[#171a1f] outline-none placeholder:text-[#8b93a1] dark:text-foreground dark:placeholder:text-muted-foreground",
              isExpanded ? "opacity-100" : "pointer-events-none opacity-0"
            )}
          />
          <button
            type="button"
            onClick={() => {
              if (!isExpanded) {
                setIsExpanded(true);
                return;
              }
              void searchWord();
            }}
            disabled={isLoading}
            title={isExpanded ? "搜索" : "打开搜索"}
            aria-label={isExpanded ? "搜索全部单词" : "打开搜索"}
            className="absolute right-0 top-0 flex h-9 w-9 appearance-none items-center justify-center rounded-md text-[#171a1f] transition hover:bg-[#f2eee7] disabled:pointer-events-none disabled:opacity-60 dark:text-foreground dark:hover:bg-muted"
          >
            {isLoading ? <Loader2 className={cn(searchIconClassName, "animate-spin")} /> : <Search className={searchIconClassName} />}
          </button>
          {isExpanded ? (
            <button
              type="button"
              onClick={closeSearch}
              title="收起搜索"
              aria-label="收起搜索"
              className="absolute -left-10 top-0 flex h-9 w-9 appearance-none items-center justify-center rounded-md border border-[#d8dde6] bg-white text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {isResultsOpen && (results.length || message) ? (
          <div className="absolute right-0 top-11 z-[90] w-[min(520px,calc(100vw-2rem))] overflow-hidden rounded-md border border-[#d8dde6] bg-white text-[#171a1f] shadow-[0_18px_46px_rgba(23,26,31,0.18)] dark:border-border dark:bg-card dark:text-foreground">
            <div className="flex items-center justify-between gap-3 border-b border-[#eef2f6] px-3 py-2 text-xs font-semibold text-[#69717f] dark:border-border dark:text-muted-foreground">
              <span>{results.length ? `找到 ${results.length.toLocaleString("zh-CN")} 个，点击打开单词卡` : message}</span>
              <button
                type="button"
                onClick={() => {
                  setResults([]);
                  setMessage("");
                  setIsResultsOpen(false);
                }}
                aria-label="清空搜索结果"
                title="清空"
                className="flex h-7 w-7 appearance-none items-center justify-center rounded text-[#69717f] transition hover:bg-[#eef2f6] hover:text-[#171a1f] dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {results.length ? (
              <div className="max-h-[min(520px,calc(100vh-12rem))] overflow-auto p-2">
                {results.map((word) => {
                  const isOpening = loadingSlug === word.slug;
                  return (
                    <button
                      key={word.id}
                      type="button"
                      onClick={() => void openWordBySlug(word.slug)}
                      disabled={Boolean(loadingSlug)}
                      className={cn(
                        "block w-full rounded-md px-3 py-2 text-left transition disabled:pointer-events-none disabled:opacity-70",
                        isOpening ? "bg-[#f7f8fb] dark:bg-muted" : "hover:bg-[#f7f8fb] dark:hover:bg-muted"
                      )}
                    >
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate text-sm font-semibold text-[#171a1f] dark:text-foreground">{word.word}</span>
                        <span className="shrink-0 text-xs text-[#69717f] dark:text-muted-foreground">{word.phonetic}</span>
                        {word.markState ? (
                          <span className="shrink-0 rounded border border-[#d8dde6] px-1.5 py-0.5 text-[11px] font-semibold text-[#69717f] dark:border-border dark:text-muted-foreground">
                            {markLabel(word.markState)}
                          </span>
                        ) : null}
                        {isOpening ? <Loader2 className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-[#69717f]" /> : null}
                      </span>
                      <span className="mt-1 block truncate text-xs text-[#69717f] dark:text-muted-foreground">{word.shortMeaningCn || word.meaningCn || "释义待补"}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {openCards.length ? (
        <MemoryCardTray
          words={openCards}
          activeCardId={activeCardId}
          onActivate={setActiveCardId}
          onClose={(wordId) => setOpenCards((current) => current.filter((word) => word.id !== wordId))}
          onOpenLinkedWord={openLinkedWord}
          onWordUpdate={updateWord}
          isAuthenticated={isAuthenticated}
          canEditOfficialCards={canEditOfficialCards}
          canExportMemoryCardImages={canExportMemoryCardImages}
        />
      ) : null}
    </>
  );
}

function markLabel(markState: LevelWordItem["markState"]) {
  if (markState === "KNOWN") return "熟";
  if (markState === "FUZZY") return "不熟";
  if (markState === "UNKNOWN") return "陌生";
  return "";
}
