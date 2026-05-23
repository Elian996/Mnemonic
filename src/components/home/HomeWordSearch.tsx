"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { MiniWordGraph } from "@/components/home/MiniWordGraph";
import type { LevelWordItem } from "@/components/level-word-browser";

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

const defaultPreview = {
  word: "memory",
  meaning: "记忆",
  pronunciation: "/ˈmeməri/",
  definition: "the power of the mind by which information is encoded, stored, and retrieved."
};

export function HomeWordSearch({ categories }: { categories: HomeCategory[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HomeSearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [message, setMessage] = useState("");
  const [isResultsOpen, setIsResultsOpen] = useState(false);
  const [selectedWord, setSelectedWord] = useState<LevelWordItem | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const wordCacheRef = useRef(new Map<string, LevelWordItem>());

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

  const openWordCardBySlug = async (slug: string) => {
    const cachedWord = wordCacheRef.current.get(slug);
    if (cachedWord) {
      setSelectedWord(cachedWord);
      setIsResultsOpen(false);
      return;
    }

    setLoadingSlug(slug);
    setMessage("");
    try {
      const response = await fetch(`/api/word-card/${encodeURIComponent(slug)}?fresh=${Date.now()}`, {
        cache: "no-store"
      });
      if (!response.ok) throw new Error("无法打开单词卡");
      const card = (await response.json()) as LevelWordItem;
      wordCacheRef.current.set(card.slug, card);
      setSelectedWord(card);
      setIsResultsOpen(false);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "无法打开单词卡");
      setIsResultsOpen(true);
    } finally {
      setLoadingSlug((current) => (current === slug ? null : current));
    }
  };

  const openWordCard = async (word: HomeSearchResult) => {
    await openWordCardBySlug(word.slug);
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
    void openWordCardBySlug(slug);
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

      <section className="mn-preview-card" aria-label={selectedWord ? `${selectedWord.word} 单词卡` : "memory 示例词卡"}>
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
              onClick={() => void openWordCardBySlug("memory")}
              disabled={loadingSlug === "memory"}
            >
              {loadingSlug === "memory" ? "打开中" : "查看详情"} <span aria-hidden="true">→</span>
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
