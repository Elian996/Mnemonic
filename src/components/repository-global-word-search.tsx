"use client";

import { Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LOGIN_REQUIRED_INTERACTION_MESSAGE,
  LoginRequiredPrompt
} from "@/components/login-required-prompt";
import { MemoryCardTray, type LevelWordItem } from "@/components/level-word-browser";
import { applyGuestProgressToWord } from "@/lib/guest-progress";
import { cn } from "@/lib/utils";

type RepositorySearchStatus = "idle" | "loading" | "done" | "error";
type WordNavigationDirection = "previous" | "next";

type RepositoryWordSearchResult = Pick<
  LevelWordItem,
  | "id"
  | "word"
  | "slug"
  | "phonetic"
  | "partOfSpeech"
  | "meaningCn"
  | "shortMeaningCn"
  | "markState"
  | "isBookmarked"
>;

type WordSearchResponse = {
  words?: RepositoryWordSearchResult[];
  error?: string;
};

export function RepositoryGlobalWordSearch({
  initialQuery = "",
  isAuthenticated,
  defaultUserCardVisibility = "private",
  canEditOfficialCards = false,
  canExportMemoryCardImages = false
}: {
  initialQuery?: string;
  isAuthenticated: boolean;
  defaultUserCardVisibility?: "private" | "public";
  canEditOfficialCards?: boolean;
  canExportMemoryCardImages?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState<RepositorySearchStatus>("idle");
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<RepositoryWordSearchResult[]>([]);
  const [isResultsOpen, setIsResultsOpen] = useState(Boolean(initialQuery.trim()));
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [openCards, setOpenCards] = useState<LevelWordItem[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [loginPromptMessage, setLoginPromptMessage] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const wordCache = useRef(new Map<string, LevelWordItem>());
  const trimmedQuery = query.trim();
  const showLoginPrompt = (promptMessage = LOGIN_REQUIRED_INTERACTION_MESSAGE) => {
    setLoginPromptMessage(promptMessage);
  };

  const navigationSlugList = useMemo(() => {
    const seen = new Set<string>();
    return results
      .map((word) => word.slug.trim())
      .filter((slug) => {
        if (!slug || seen.has(slug)) return false;
        seen.add(slug);
        return true;
      });
  }, [results]);

  useEffect(() => {
    if (!trimmedQuery) {
      setStatus("idle");
      setResults([]);
      setMessage("");
      setIsResultsOpen(false);
      return;
    }

    const controller = new AbortController();
    const searchTimer = window.setTimeout(async () => {
      setStatus("loading");
      setMessage("");
      setIsResultsOpen(true);

      try {
        const response = await fetch(
          `/api/word-search?q=${encodeURIComponent(trimmedQuery)}&limit=16`,
          { cache: "no-store", signal: controller.signal }
        );
        const result = (await response.json().catch(() => ({}))) as WordSearchResponse;
        if (!response.ok) throw new Error(result.error || "搜索失败。");

        const nextResults = (result.words ?? []).map((word) =>
          isAuthenticated ? word : applyGuestProgressToWord(word)
        );
        setResults(nextResults);
        setStatus("done");
        setMessage(nextResults.length ? "" : "没有找到匹配单词。");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("error");
        setResults([]);
        setMessage(error instanceof Error ? error.message : "搜索失败。");
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(searchTimer);
    };
  }, [isAuthenticated, trimmedQuery]);

  useEffect(() => {
    if (!isResultsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && wrapperRef.current?.contains(target)) return;
      setIsResultsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsResultsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isResultsOpen]);

  useEffect(() => {
    const closeForMemoryCard = () => {
      if (!document.documentElement.classList.contains("mn-memory-card-open")) return;
      setIsResultsOpen(false);
      const searchInput = searchInputRef.current;
      if (searchInput && document.activeElement === searchInput) searchInput.blur();
    };

    closeForMemoryCard();
    const observer = new MutationObserver(closeForMemoryCard);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const openWord = (word: LevelWordItem) => {
    const nextWord = isAuthenticated ? word : applyGuestProgressToWord(word);
    wordCache.current.set(nextWord.slug, nextWord);
    setMessage("");
    setActiveCardId(nextWord.id);
    setOpenCards((current) =>
      [nextWord, ...current.filter((item) => item.id !== nextWord.id)].slice(0, 5)
    );
    setIsResultsOpen(false);
  };

  const updateWord = (updatedWord: LevelWordItem) => {
    const nextWord = isAuthenticated ? updatedWord : applyGuestProgressToWord(updatedWord);
    wordCache.current.set(nextWord.slug, nextWord);
    setOpenCards((current) =>
      current.map((word) => (word.id === nextWord.id ? { ...word, ...nextWord } : word))
    );
  };

  const replaceActiveWord = (currentWordId: string, word: LevelWordItem) => {
    const nextWord = isAuthenticated ? word : applyGuestProgressToWord(word);
    wordCache.current.set(nextWord.slug, nextWord);
    setActiveCardId(nextWord.id);
    setMessage("");
    setOpenCards((current) =>
      [
        nextWord,
        ...current.filter((item) => item.id !== currentWordId && item.id !== nextWord.id)
      ].slice(0, 5)
    );
    setIsResultsOpen(false);
  };

  const refreshWordBySlug = async (slug: string, activate = true) => {
    const fetchedWord = await fetchWordCard(slug);
    if (activate) {
      openWord(fetchedWord);
    } else {
      updateWord(fetchedWord);
    }
    return true;
  };

  const openWordBySlug = async (slug: string) => {
    const cachedWord = wordCache.current.get(slug);
    if (cachedWord) {
      openWord(cachedWord);
      void refreshWordBySlug(slug, false).catch(() => undefined);
      return true;
    }

    setLoadingSlug(slug);
    setMessage("");
    try {
      return await refreshWordBySlug(slug);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "单词卡加载失败。");
      setIsResultsOpen(true);
      return false;
    } finally {
      setLoadingSlug((current) => (current === slug ? null : current));
    }
  };

  const navigateWord = async (word: LevelWordItem, direction: WordNavigationDirection) => {
    if (navigationSlugList.length <= 1) return false;

    const currentIndex = navigationSlugList.findIndex((item) => item === word.slug);
    const step = direction === "next" ? 1 : -1;
    const nextIndex =
      currentIndex >= 0
        ? (currentIndex + step + navigationSlugList.length) % navigationSlugList.length
        : direction === "next"
          ? 0
          : navigationSlugList.length - 1;
    const nextSlug = navigationSlugList[nextIndex];
    if (!nextSlug || nextSlug === word.slug) return false;

    const cachedWord = wordCache.current.get(nextSlug);
    if (cachedWord) {
      replaceActiveWord(word.id, cachedWord);
      void refreshWordBySlug(nextSlug, false).catch(() => undefined);
      return true;
    }

    setLoadingSlug(nextSlug);
    try {
      const fetchedWord = await fetchWordCard(nextSlug);
      replaceActiveWord(word.id, fetchedWord);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "单词卡加载失败。");
      return false;
    } finally {
      setLoadingSlug((current) => (current === nextSlug ? null : current));
    }
  };

  const openFirstResult = () => {
    const firstResult = results[0];
    if (!firstResult || loadingSlug) return;
    void openWordBySlug(firstResult.slug);
  };

  const clearSearch = () => {
    setQuery("");
    setResults([]);
    setMessage("");
    setStatus("idle");
    setIsResultsOpen(false);
  };

  const metaLabel =
    status === "loading"
      ? "搜索中"
      : results.length
        ? `找到 ${results.length.toLocaleString("zh-CN")} 个`
        : message;

  return (
    <>
      <div ref={wrapperRef} className="mn-repository-search-field mn-repository-global-search">
        <span className="mn-repository-global-search-icon" aria-hidden="true">
          {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </span>
        <label className="sr-only" htmlFor="repository-global-word-search">
          搜索全部单词
        </label>
        <input
          ref={searchInputRef}
          id="repository-global-word-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            if (trimmedQuery) setIsResultsOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            openFirstResult();
          }}
          className="mn-repository-search-input"
          placeholder="搜索全部单词或释义..."
          autoComplete="off"
        />
        {query ? (
          <button
            type="button"
            className="mn-repository-global-search-clear"
            onClick={clearSearch}
            aria-label="清空搜索"
            title="清空"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}

        {isResultsOpen && trimmedQuery ? (
          <div className="mn-repository-global-search-popover" role="listbox" aria-label="全局单词搜索结果">
            <div className="mn-repository-global-search-meta">
              <span>{metaLabel || "输入后搜索"}</span>
            </div>
            {results.length ? (
              <div className="mn-repository-global-search-results">
                {results.map((word) => {
                  const isOpening = loadingSlug === word.slug;
                  return (
                    <button
                      key={word.id}
                      type="button"
                      role="option"
                      aria-selected="false"
                      disabled={Boolean(loadingSlug)}
                      onClick={() => void openWordBySlug(word.slug)}
                      className={cn(
                        "mn-repository-global-search-result",
                        isOpening && "is-opening"
                      )}
                    >
                      <span className="mn-repository-global-search-result-main">
                        <span className="mn-repository-global-search-word">{word.word}</span>
                        {word.phonetic ? (
                          <span className="mn-repository-global-search-phonetic">{word.phonetic}</span>
                        ) : null}
                        {word.markState ? (
                          <span className="mn-repository-global-search-mark">
                            {markLabel(word.markState)}
                          </span>
                        ) : null}
                        {isOpening ? (
                          <Loader2 className="mn-repository-global-search-loading h-3.5 w-3.5 animate-spin" />
                        ) : null}
                      </span>
                      <span className="mn-repository-global-search-meaning">
                        {word.shortMeaningCn || word.meaningCn || "释义待补"}
                      </span>
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
          onClose={(wordId) =>
            setOpenCards((current) => current.filter((word) => word.id !== wordId))
          }
          onOpenLinkedWord={openWordBySlug}
          onWordUpdate={updateWord}
          onNavigateWord={
            navigationSlugList.length > 1
              ? (word, direction) => {
                  void navigateWord(word, direction);
                }
              : undefined
          }
          isAuthenticated={isAuthenticated}
          defaultUserCardVisibility={defaultUserCardVisibility}
          canEditOfficialCards={canEditOfficialCards}
          canExportMemoryCardImages={canExportMemoryCardImages}
          onRequireLogin={showLoginPrompt}
        />
      ) : null}
      <LoginRequiredPrompt
        message={loginPromptMessage}
        onClose={() => setLoginPromptMessage("")}
      />
    </>
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

function markLabel(markState: LevelWordItem["markState"]) {
  if (markState === "KNOWN") return "熟";
  if (markState === "FUZZY") return "模糊";
  if (markState === "UNKNOWN") return "生词";
  return "";
}
