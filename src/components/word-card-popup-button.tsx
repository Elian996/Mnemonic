"use client";

import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { MemoryCardTray, type LevelWordItem } from "@/components/level-word-browser";
import { applyGuestProgressToWord } from "@/lib/guest-progress";
import { cn } from "@/lib/utils";

export function WordCardPopupButton({
  slug,
  children,
  className,
  ariaLabel,
  disabled = false,
  isAuthenticated,
  defaultUserCardVisibility = "private",
  canEditOfficialCards = false,
  canExportMemoryCardImages = false
}: {
  slug: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  isAuthenticated: boolean;
  defaultUserCardVisibility?: "private" | "public";
  canEditOfficialCards?: boolean;
  canExportMemoryCardImages?: boolean;
}) {
  const [openCards, setOpenCards] = useState<LevelWordItem[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const wordCache = useRef(new Map<string, LevelWordItem>());

  const openWord = (word: LevelWordItem) => {
    const nextWord = isAuthenticated ? word : applyGuestProgressToWord(word);
    wordCache.current.set(nextWord.slug, nextWord);
    setActiveCardId(nextWord.id);
    setErrorMessage("");
    setOpenCards((current) =>
      [nextWord, ...current.filter((item) => item.id !== nextWord.id)].slice(0, 5)
    );
  };

  const openWordBySlug = async (nextSlug: string) => {
    const cachedWord = wordCache.current.get(nextSlug);
    if (cachedWord) {
      openWord(cachedWord);
      return true;
    }

    setIsLoading(true);
    setErrorMessage("");
    try {
      const fetchedWord = await fetchWordCard(nextSlug);
      openWord(fetchedWord);
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "单词卡加载失败。");
      return false;
    } finally {
      setIsLoading(false);
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
      <button
        type="button"
        onClick={() => void openWordBySlug(slug)}
        disabled={disabled || isLoading}
        aria-label={ariaLabel}
        className={cn("appearance-none text-left disabled:pointer-events-none disabled:opacity-70", className)}
      >
        {children}
      </button>
      {errorMessage ? <span className="sr-only">{errorMessage}</span> : null}

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
          canExportMemoryCardImages={canExportMemoryCardImages}
        />
      ) : null}
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
