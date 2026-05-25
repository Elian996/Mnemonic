"use client";

import type { ReactNode } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { MemoryCardTray, type LevelWordItem } from "@/components/level-word-browser";
import { applyGuestProgressToWord } from "@/lib/guest-progress";
import { cn } from "@/lib/utils";

type WordNavigationDirection = "previous" | "next";

export function WordCardPopupButton({
  slug,
  children,
  className,
  ariaLabel,
  disabled = false,
  isAuthenticated,
  defaultUserCardVisibility = "private",
  canEditOfficialCards = false,
  canExportMemoryCardImages = false,
  navigationSlugs,
  stopClickPropagation = false
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
  navigationSlugs?: string[];
  stopClickPropagation?: boolean;
}) {
  const [openCards, setOpenCards] = useState<LevelWordItem[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const wordCache = useRef(new Map<string, LevelWordItem>());
  const navigationSlugList = useMemo(() => {
    if (!navigationSlugs?.length) return [];
    const seen = new Set<string>();
    return navigationSlugs.filter((value) => {
      const nextSlug = value.trim();
      if (!nextSlug || seen.has(nextSlug)) return false;
      seen.add(nextSlug);
      return true;
    });
  }, [navigationSlugs]);

  const openWord = (word: LevelWordItem) => {
    const nextWord = isAuthenticated ? word : applyGuestProgressToWord(word);
    wordCache.current.set(nextWord.slug, nextWord);
    setActiveCardId(nextWord.id);
    setErrorMessage("");
    setOpenCards((current) =>
      [nextWord, ...current.filter((item) => item.id !== nextWord.id)].slice(0, 5)
    );
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
    setErrorMessage("");
    setOpenCards((current) =>
      [
        nextWord,
        ...current.filter((item) => item.id !== currentWordId && item.id !== nextWord.id)
      ].slice(0, 5)
    );
  };

  const refreshWordBySlug = async (nextSlug: string, showError = true, activate = true) => {
    try {
      const fetchedWord = await fetchWordCard(nextSlug);
      if (activate) {
        openWord(fetchedWord);
      } else {
        updateWord(fetchedWord);
      }
      return true;
    } catch (error) {
      if (showError) setErrorMessage(error instanceof Error ? error.message : "单词卡加载失败。");
      return false;
    }
  };

  const openWordBySlug = async (nextSlug: string) => {
    const cachedWord = wordCache.current.get(nextSlug);
    if (cachedWord) {
      openWord(cachedWord);
      void refreshWordBySlug(nextSlug, false, false);
      return true;
    }

    setIsLoading(true);
    setErrorMessage("");
    try {
      return await refreshWordBySlug(nextSlug);
    } finally {
      setIsLoading(false);
    }
  };

  const navigateWord = async (word: LevelWordItem, direction: WordNavigationDirection) => {
    if (navigationSlugList.length <= 1) return false;

    const currentIndex = navigationSlugList.findIndex((item) => item === word.slug);
    const fallbackIndex = navigationSlugList.findIndex((item) => item === slug);
    const baseIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
    const step = direction === "next" ? 1 : -1;
    const nextIndex =
      baseIndex >= 0
        ? (baseIndex + step + navigationSlugList.length) % navigationSlugList.length
        : direction === "next"
          ? 0
          : navigationSlugList.length - 1;
    const nextSlug = navigationSlugList[nextIndex];
    if (!nextSlug || nextSlug === word.slug) return false;

    const cachedWord = wordCache.current.get(nextSlug);
    if (cachedWord) {
      replaceActiveWord(word.id, cachedWord);
      void refreshWordBySlug(nextSlug, false, false);
      return true;
    }

    setIsLoading(true);
    setErrorMessage("");
    try {
      const fetchedWord = await fetchWordCard(nextSlug);
      replaceActiveWord(word.id, fetchedWord);
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "单词卡加载失败。");
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!stopClickPropagation) return;
    event.stopPropagation();
  };

  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (stopClickPropagation) {
      event.preventDefault();
      event.stopPropagation();
    }
    void openWordBySlug(slug);
  };

  return (
    <>
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onClick={handleClick}
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
