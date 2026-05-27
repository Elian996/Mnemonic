"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { MiniWordGraph } from "@/components/home/MiniWordGraph";
import { MemoryCardTray, type LevelWordItem } from "@/components/level-word-browser";
import {
  LOGIN_REQUIRED_INTERACTION_MESSAGE,
  LoginRequiredPrompt
} from "@/components/login-required-prompt";
import { applyGuestProgressToWord, saveGuestWordMarkState } from "@/lib/guest-progress";

type HomeCategory = {
  tag: string;
  href: string;
  shortLabel: string;
};

type HomeSearchResult = Pick<
  LevelWordItem,
  "id" | "word" | "slug" | "phonetic" | "partOfSpeech" | "meaningCn" | "shortMeaningCn" | "markState" | "isBookmarked"
>;

type WordSearchResponse = {
  words?: HomeSearchResult[];
  error?: string;
};

type SearchStatus = "idle" | "loading" | "ready" | "error";
type WordMarkState = NonNullable<LevelWordItem["markState"]>;

const defaultPreview = {
  word: "legitimacy",
  meaning: "n. 合法性；正当性；正统性",
  pronunciation: "/lɪˈdʒɪtɪməsi/ · n.",
  definition:
    "legitimate 是已记住的形容词，表示合法的、正当的；去掉 -ate，保留 legitim，加 -acy 名词后缀，得到 legitimacy。"
};

export function HomeWordSearch({
  categories,
  isAuthenticated
}: {
  categories: HomeCategory[];
  isAuthenticated: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HomeSearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [message, setMessage] = useState("");
  const [isResultsOpen, setIsResultsOpen] = useState(false);
  const [selectedWord, setSelectedWord] = useState<LevelWordItem | null>(null);
  const [openCards, setOpenCards] = useState<LevelWordItem[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [loginPromptMessage, setLoginPromptMessage] = useState("");
  const searchRef = useRef<HTMLDivElement>(null);
  const wordCacheRef = useRef(new Map<string, LevelWordItem>());
  const showLoginPrompt = (message = LOGIN_REQUIRED_INTERACTION_MESSAGE) => {
    setLoginPromptMessage(message);
  };

  useEffect(() => {
    for (const category of categories) {
      router.prefetch(category.href);
    }
  }, [categories, router]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setResults([]);
      setStatus("idle");
      setMessage("");
      setIsResultsOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      setMessage("");
      setIsResultsOpen(true);
      try {
        const response = await fetch(`/api/word-search?q=${encodeURIComponent(trimmedQuery)}&limit=64`, {
          cache: "no-store",
          signal: controller.signal
        });
        const data = (await response.json().catch(() => ({}))) as WordSearchResponse;
        if (!response.ok) throw new Error(data.error || "搜索失败");

        const words = data.words ?? [];
        setResults(words);
        setStatus("ready");
        setMessage(words.length ? "" : "没有找到匹配单词");
      } catch (error) {
        if (controller.signal.aborted) return;
        setResults([]);
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "搜索失败");
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!isResultsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && searchRef.current?.contains(target)) return;
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
    const closeForUsageManual = () => {
      setIsResultsOpen(false);
      if (searchRef.current?.contains(document.activeElement)) {
        (document.activeElement as HTMLElement).blur();
      }
    };

    window.addEventListener("mnemonic:usage-manual-open", closeForUsageManual);
    return () => window.removeEventListener("mnemonic:usage-manual-open", closeForUsageManual);
  }, []);

  const activateWordCard = (wordId: string | null) => {
    setActiveCardId(wordId);
  };

  const openWordTray = (word: LevelWordItem) => {
    setSelectedWord(word);
    setActiveCardId(word.id);
    setOpenCards((current) => [word, ...current.filter((item) => item.id !== word.id)].slice(0, 5));
  };

  const openWordCardBySlug = async (slug: string, openTray = true) => {
    const cachedWord = wordCacheRef.current.get(slug);
    if (cachedWord) {
      setSelectedWord(cachedWord);
      if (openTray) openWordTray(cachedWord);
      setIsResultsOpen(false);
      void refreshWordCardBySlug(slug);
      return;
    }

    setLoadingSlug(slug);
    setMessage("");
    try {
      const word = await refreshWordCardBySlug(slug, true);
      if (word && openTray) openWordTray(word);
      setIsResultsOpen(false);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "无法打开单词卡");
      setIsResultsOpen(true);
    } finally {
      setLoadingSlug((current) => (current === slug ? null : current));
    }
  };

  const refreshWordCardBySlug = async (slug: string, raiseError = false) => {
    try {
      const response = await fetch(`/api/word-card/${encodeURIComponent(slug)}?fresh=${Date.now()}`, {
        cache: "no-store"
      });
      if (!response.ok) throw new Error("无法打开单词卡");
      const fetchedCard = (await response.json()) as LevelWordItem;
      const card = isAuthenticated ? fetchedCard : applyGuestProgressToWord(fetchedCard);
      wordCacheRef.current.set(card.slug, card);
      setSelectedWord(card);
      setOpenCards((current) => current.map((word) => (word.id === card.id ? card : word)));
      return card;
    } catch (error) {
      if (raiseError) throw error;
      return null;
    }
  };

  const openWordCard = async (word: HomeSearchResult) => {
    await openWordCardBySlug(word.slug);
  };

  const updateWord = (updatedWord: LevelWordItem) => {
    wordCacheRef.current.set(updatedWord.slug, updatedWord);
    setSelectedWord((current) => (current?.id === updatedWord.id ? updatedWord : current));
    setOpenCards((current) => current.map((word) => (word.id === updatedWord.id ? updatedWord : word)));
  };

  const markWord = async (word: LevelWordItem, state: WordMarkState | null) => {
    const nextWord = {
      ...word,
      isBookmarked: state === "UNKNOWN",
      markState: state
    };
    updateWord(nextWord);

    if (!isAuthenticated) {
      saveGuestWordMarkState(word.id, state);
      showLoginPrompt();
      return;
    }

    const response = await fetch("/api/word-marks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wordId: word.id, state })
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      isBookmarked?: boolean;
      markState?: WordMarkState | null;
    };
    if (!response.ok) {
      updateWord(word);
      throw new Error(result.error || "标记失败。");
    }

    updateWord({
      ...nextWord,
      isBookmarked: Boolean(result.isBookmarked),
      markState: result.markState ?? null
    });
  };

  const openLinkedWordFromTray = async (slug: string) => {
    await openWordCardBySlug(slug);
    return true;
  };

  const openLinkedWordCard = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const anchor =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a.wiki-link-word[href]")
        : null;
    if (!anchor) return;
    const slug = wordSlugFromHref(anchor.getAttribute("href"));
    if (!slug) return;

    event.preventDefault();
    event.stopPropagation();
    void openWordCardBySlug(slug, false);
  };

  const preview = selectedWord
    ? {
        word: selectedWord.word,
        meaning: selectedWord.shortMeaningCn || selectedWord.meaningCn || "释义待补",
        pronunciation: [selectedWord.phonetic, selectedWord.partOfSpeech].filter(Boolean).join(" · "),
        definition:
          compactText(selectedWord.exampleSentence, 180) ||
          compactText(selectedWord.mnemonic?.plainText, 180) ||
          compactText(selectedWord.meaningCn, 180) ||
          "暂无更多内容"
      }
    : defaultPreview;
  const activeMnemonic = selectedWord?.mnemonic ?? selectedWord?.mnemonics?.[0] ?? null;

  return (
    <>
      <div ref={searchRef} className="mn-home-search-wrap">
        <form
          className="mn-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            if (results[0]) void openWordCard(results[0]);
          }}
        >
          <span className="mn-search-icon" aria-hidden="true">
            {status === "loading" ? <Loader2 className="mn-search-loading" /> : <Search />}
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => {
              if (query.trim()) setIsResultsOpen(true);
            }}
            type="search"
            placeholder="Search a word"
            aria-label="Search a word"
            autoComplete="off"
          />
        </form>

        {isResultsOpen && query.trim() ? (
          <div className="mn-search-popover" role="listbox" aria-label="搜索结果">
            <div className="mn-search-popover-meta">
              {status === "loading"
                ? "搜索中"
                : results.length
                  ? `找到 ${results.length.toLocaleString("zh-CN")} 个单词`
                  : message}
            </div>
            {results.length ? (
              <div className="mn-search-result-list">
                {results.map((word) => {
                  const isOpening = loadingSlug === word.slug;
                  return (
                    <button
                      key={word.id}
                      type="button"
                      className="mn-search-result"
                      disabled={Boolean(loadingSlug)}
                      onClick={() => void openWordCard(word)}
                      role="option"
                      aria-selected={selectedWord?.id === word.id}
                    >
                      <span className="mn-search-result-main">
                        <span className="mn-search-result-word">{word.word}</span>
                        {word.phonetic ? <span className="mn-search-result-phonetic">{word.phonetic}</span> : null}
                        {isOpening ? <Loader2 className="mn-search-result-loading" aria-hidden="true" /> : null}
                      </span>
                      <span className="mn-search-result-meaning">
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

      <div className="mn-category-row" aria-label="词库分类">
        {categories.map((category) => (
          <Link
            key={category.tag}
            href={category.href}
            prefetch
            className="mn-category-button"
            onPointerEnter={() => router.prefetch(category.href)}
            onFocus={() => router.prefetch(category.href)}
          >
            {category.shortLabel}
          </Link>
        ))}
      </div>

      <section className="mn-preview-card" aria-label={selectedWord ? `${selectedWord.word} 单词卡` : "legitimacy 示例词卡"}>
        <div className="mn-preview-word">
          <h2 className="mn-preview-word-title">{preview.word}</h2>
          <p className="mn-preview-meaning">{preview.meaning}</p>
          {preview.pronunciation ? <p className="mn-preview-pronunciation">{preview.pronunciation}</p> : null}
          <p className="mn-preview-definition">{preview.definition}</p>
          {selectedWord ? (
            <button type="button" className="mn-preview-button" onClick={() => setSelectedWord(null)}>
              返回示例
            </button>
          ) : (
            <button
              type="button"
              className="mn-preview-button"
              onClick={() => void openWordCardBySlug("legitimacy")}
              disabled={loadingSlug === "legitimacy"}
            >
              {loadingSlug === "legitimacy" ? "打开中" : "查看详情"} <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
        <div className="mn-preview-graph">
          {selectedWord ? (
            <div className="mn-home-word-card-panel">
              <p className="mn-home-word-card-label">单词卡</p>
              {activeMnemonic?.splitText ? <p className="mn-home-word-card-split">{activeMnemonic.splitText}</p> : null}
              {activeMnemonic?.contentHtml ? (
                <div
                  className="mn-home-word-card-content reading"
                  onClick={openLinkedWordCard}
                  dangerouslySetInnerHTML={{ __html: activeMnemonic.contentHtml }}
                />
              ) : (
                <p className="mn-home-word-card-copy">
                  {compactText(selectedWord.exampleTranslation || selectedWord.exampleSentence, 280) ||
                    "这个单词还没有记忆卡。"}
                </p>
              )}
              {selectedWord.exampleSentence ? (
                <div className="mn-home-word-card-example">
                  <p>{selectedWord.exampleSentence}</p>
                  {selectedWord.exampleTranslation ? <p>{selectedWord.exampleTranslation}</p> : null}
                </div>
              ) : null}
            </div>
          ) : (
            <MiniWordGraph />
          )}
        </div>
      </section>

      {openCards.length ? (
        <MemoryCardTray
          words={openCards}
          activeCardId={activeCardId}
          onActivate={activateWordCard}
          onClose={(wordId) =>
            setOpenCards((current) => current.filter((word) => word.id !== wordId))
          }
          onOpenLinkedWord={openLinkedWordFromTray}
          onWordUpdate={updateWord}
          onCollectionMark={markWord}
          isAuthenticated={isAuthenticated}
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

function compactText(value: string | null | undefined, limit: number, splitText?: string | null) {
  let text = (value ?? "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/\[\[(?:word|root|prefix|suffix):([^\]|]+)(?:\|([^\]]+))?]]/g, (_match, fallback, label) => label || fallback)
    .replace(/\s+/g, " ")
    .trim();
  if (splitText) {
    text = text.replace(new RegExp(`^划分[:：]\\s*${escapeRegExp(splitText)}\\s*`, "i"), "").trim();
  }
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit).trim()}...` : text;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordSlugFromHref(href: string | null) {
  if (!href) return "";
  try {
    const url = new URL(href, window.location.origin);
    if (!url.pathname.startsWith("/word/")) return "";
    return decodeURIComponent(url.pathname.replace(/^\/word\//, "").split("/")[0] ?? "").trim();
  } catch {
    return "";
  }
}
