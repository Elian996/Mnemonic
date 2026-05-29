"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Circle,
  Eye,
  EyeOff,
  Grid2X2,
  List,
  Loader2,
  Pencil,
  RotateCcw,
  Trash2,
  X
} from "lucide-react";
import { MemoryCardTray, type LevelWordItem } from "@/components/level-word-browser";
import { cn } from "@/lib/utils";
import {
  WORD_MARK_SAVE_REQUEST_EVENT,
  WORD_MARK_SAVE_STATE_EVENT,
  type WordMarkSaveStateDetail,
  type WordMarkSaveStatus
} from "@/lib/word-mark-save-events";

type ProfileListKind = "known" | "fuzzy" | "unknown";
type SortMode = "random" | "newest" | "oldest" | "az" | "za";
type ViewMode = "grid" | "list";
type WordMarkState = NonNullable<LevelWordItem["markState"]>;
type WordNavigationDirection = "previous" | "next";
type MarkHistoryItem = {
  word: ProfileWordListItem;
  previousState: WordMarkState | null;
  previousWords: ProfileWordListItem[];
};
type MnemonicCardDeleteUndoState = {
  wordId: string;
  canUndo: boolean;
  restore: () => void | Promise<void>;
};

export type ProfileWordListItem = {
  id: string;
  slug: string;
  word: string;
  phoneticUk: string | null;
  phoneticUs: string | null;
  shortMeaningCn: string;
  meaningCn: string;
  joinedAt: string;
};

export function ProfileWordList({
  words: initialWords,
  emptyText,
  kind
}: {
  words: ProfileWordListItem[];
  emptyText: string;
  kind: ProfileListKind;
}) {
  const router = useRouter();
  const currentMarkState = profileKindToMarkState[kind];
  const [words, setWords] = useState(initialWords);
  const [wordStates, setWordStates] = useState<Map<string, WordMarkState | null>>(
    () => new Map(initialWords.map((word) => [word.id, currentMarkState]))
  );
  const [openCards, setOpenCards] = useState<LevelWordItem[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [selectedWordId, setSelectedWordId] = useState<string | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("random");
  const [randomSeed, setRandomSeed] = useState(() => createRandomSeed());
  const [view, setView] = useState<ViewMode>("grid");
  const [showMeaning, setShowMeaning] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [markingWordId, setMarkingWordId] = useState<string | null>(null);
  const [deletingWordId, setDeletingWordId] = useState<string | null>(null);
  const [markHistory, setMarkHistory] = useState<MarkHistoryItem[]>([]);
  const [pendingSaveCount, setPendingSaveCount] = useState(0);
  const [saveStatus, setSaveStatus] = useState<WordMarkSaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const linkedWordCache = useRef(new Map<string, LevelWordItem>());
  const mnemonicCardDeleteUndoRef = useRef(new Map<string, () => void | Promise<void>>());
  const markHistoryRef = useRef<MarkHistoryItem[]>([]);
  const committedWordStatesRef = useRef(new Map<string, WordMarkState>());
  const pendingMarkChangesRef = useRef(new Map<string, WordMarkState | null>());
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const [mnemonicCardDeleteUndoIds, setMnemonicCardDeleteUndoIds] = useState<string[]>([]);

  useEffect(() => {
    setWords(initialWords);
    setWordStates(new Map(initialWords.map((word) => [word.id, currentMarkState])));
    setOpenCards([]);
    setActiveCardId(null);
    setLoadingSlug(null);
    setMarkingWordId(null);
    setDeletingWordId(null);
    setPendingSaveCount(0);
    setSaveStatus("idle");
    setSaveMessage("");
    linkedWordCache.current.clear();
    mnemonicCardDeleteUndoRef.current.clear();
    markHistoryRef.current = [];
    committedWordStatesRef.current = new Map(
      initialWords.map((word) => [word.id, currentMarkState])
    );
    pendingMarkChangesRef.current = new Map();
    setMarkHistory([]);
    setMnemonicCardDeleteUndoIds([]);
  }, [currentMarkState, initialWords, kind]);

  const sortedWords = useMemo(
    () => sortProfileWords(words, sortMode, randomSeed),
    [randomSeed, sortMode, words]
  );
  const visibleMarkStateForWord = (wordId: string) =>
    wordStates.has(wordId) ? (wordStates.get(wordId) ?? null) : currentMarkState;

  const activateWordCard = useCallback((wordId: string | null) => {
    setActiveCardId(wordId);
    if (wordId) setSelectedWordId(wordId);
  }, []);

  const openWord = useCallback((word: LevelWordItem) => {
    linkedWordCache.current.set(word.slug, word);
    activateWordCard(word.id);
    setOpenCards((current) => [word, ...current.filter((item) => item.id !== word.id)].slice(0, 5));
  }, [activateWordCard]);

  const openWordBySlug = async (slug: string) => {
    const cachedWord = linkedWordCache.current.get(slug);
    if (cachedWord) {
      openWord(cachedWord);
      return true;
    }

    const profileWord = words.find((word) => word.slug === slug);
    if (profileWord) {
      openWord(profileWordToLevelWord(profileWord, visibleMarkStateForWord(profileWord.id)));
    }

    setLoadingSlug(slug);
    try {
      const fetchedWord = await fetchWordCard(slug);
      linkedWordCache.current.set(fetchedWord.slug, fetchedWord);
      setOpenCards((current) => {
        const hasOpenWord = current.some(
          (word) => word.id === fetchedWord.id || word.slug === fetchedWord.slug
        );
        if (!hasOpenWord && !profileWord) {
          return [fetchedWord, ...current.filter((word) => word.id !== fetchedWord.id)].slice(0, 5);
        }

        return current.map((word) =>
          word.id === fetchedWord.id || word.slug === fetchedWord.slug ? fetchedWord : word
        );
      });
      return true;
    } finally {
      setLoadingSlug((current) => (current === slug ? null : current));
    }
  };

  const replaceActiveWordCard = useCallback(
    async (currentWordId: string, nextWord: ProfileWordListItem | null) => {
      if (!nextWord) {
        setOpenCards((current) => current.filter((word) => word.id !== currentWordId));
        setActiveCardId((current) => (current === currentWordId ? null : current));
        return;
      }

      const cachedWord = linkedWordCache.current.get(nextWord.slug);
      if (cachedWord) {
        openWord(cachedWord);
        setOpenCards((current) =>
          [
            cachedWord,
            ...current.filter((word) => word.id !== currentWordId && word.id !== cachedWord.id)
          ].slice(0, 5)
        );
        return;
      }

      const placeholderWord = profileWordToLevelWord(
        nextWord,
        visibleMarkStateForWord(nextWord.id)
      );
      linkedWordCache.current.set(placeholderWord.slug, placeholderWord);
      activateWordCard(placeholderWord.id);
      setOpenCards((current) =>
        [
          placeholderWord,
          ...current.filter((word) => word.id !== currentWordId && word.id !== placeholderWord.id)
        ].slice(0, 5)
      );
      setLoadingSlug(nextWord.slug);
      try {
        const fetchedWord = await fetchWordCard(nextWord.slug);
        linkedWordCache.current.set(fetchedWord.slug, fetchedWord);
        setOpenCards((current) =>
          current.map((word) =>
            word.id === placeholderWord.id || word.slug === fetchedWord.slug ? fetchedWord : word
          )
        );
      } finally {
        setLoadingSlug((current) => (current === nextWord.slug ? null : current));
      }
    },
    [activateWordCard, currentMarkState, openWord]
  );

  const updateWord = (updatedWord: LevelWordItem) => {
    const nextMarkState = updatedWord.markState ?? null;
    linkedWordCache.current.set(updatedWord.slug, updatedWord);
    setWordStates((current) => {
      const next = new Map(current);
      next.set(updatedWord.id, nextMarkState);
      return next;
    });
    setWords((current) =>
      current.map((word) =>
        word.id === updatedWord.id
          ? {
              ...word,
              word: updatedWord.word,
              slug: updatedWord.slug,
              shortMeaningCn: updatedWord.shortMeaningCn,
              meaningCn: updatedWord.meaningCn
            }
          : word
      )
    );
    setOpenCards((current) =>
      current.map((word) => (word.id === updatedWord.id ? { ...word, ...updatedWord } : word))
    );
  };

  const applyProfileMark = async (word: ProfileWordListItem, state: WordMarkState | null) => {
    if (deletingWordId) return;

    const previousWords = words;
    const previousState = visibleMarkStateForWord(word.id);
    const history = [
      ...markHistoryRef.current,
      { word, previousState, previousWords }
    ];
    markHistoryRef.current = history;
    setMarkHistory(history);
    updateCachedWordMark(word.id, state);
    updatePendingMarkChange(word.id, state);
  };

  const undoLastMark = useCallback(() => {
    if (markingWordId || deletingWordId) return;
    const last = markHistoryRef.current.at(-1);
    if (!last) return;

    markHistoryRef.current = markHistoryRef.current.slice(0, -1);
    setMarkHistory(markHistoryRef.current);
    updateCachedWordMark(last.word.id, last.previousState);
    updatePendingMarkChange(last.word.id, last.previousState);
    setWords(last.previousWords);
  }, [deletingWordId, markingWordId]);
  const updateMnemonicCardDeleteUndo = useCallback((state: MnemonicCardDeleteUndoState) => {
    if (state.canUndo) {
      mnemonicCardDeleteUndoRef.current.set(state.wordId, state.restore);
    } else {
      mnemonicCardDeleteUndoRef.current.delete(state.wordId);
    }

    setMnemonicCardDeleteUndoIds((current) => {
      const hasWord = current.includes(state.wordId);
      if (state.canUndo) return hasWord ? current : [...current, state.wordId];
      if (!hasWord) return current;
      return current.filter((wordId) => wordId !== state.wordId);
    });
  }, []);
  const undoLastAction = useCallback(() => {
    if (markingWordId || deletingWordId) return;
    const activeCardRestore = activeCardId
      ? mnemonicCardDeleteUndoRef.current.get(activeCardId)
      : null;
    const fallbackCardRestore = mnemonicCardDeleteUndoIds.length
      ? mnemonicCardDeleteUndoRef.current.get(mnemonicCardDeleteUndoIds.at(-1) ?? "")
      : null;
    const restoreDeletedMnemonicCard = activeCardRestore ?? fallbackCardRestore;
    if (restoreDeletedMnemonicCard) {
      void restoreDeletedMnemonicCard();
      return;
    }

    undoLastMark();
  }, [activeCardId, deletingWordId, markingWordId, mnemonicCardDeleteUndoIds, undoLastMark]);
  const canUndoLastAction = markHistory.length > 0 || mnemonicCardDeleteUndoIds.length > 0;

  const updateCachedWordMark = (wordId: string, state: WordMarkState | null) => {
    setWordStates((current) => {
      const next = new Map(current);
      next.set(wordId, state);
      return next;
    });
    setOpenCards((current) =>
      current.map((word) =>
        word.id === wordId
          ? {
              ...word,
              isBookmarked: state === "UNKNOWN",
              markState: state
            }
          : word
      )
    );
    for (const [slug, cachedWord] of linkedWordCache.current) {
      if (cachedWord.id === wordId) {
        linkedWordCache.current.set(slug, {
          ...cachedWord,
          isBookmarked: state === "UNKNOWN",
          markState: state
        });
      }
    }
  };

  function updatePendingMarkChange(wordId: string, state: WordMarkState | null) {
    const committedState = committedWordStatesRef.current.get(wordId) ?? null;
    if (state === committedState) {
      pendingMarkChangesRef.current.delete(wordId);
    } else {
      pendingMarkChangesRef.current.set(wordId, state);
    }

    const nextCount = pendingMarkChangesRef.current.size;
    setPendingSaveCount(nextCount);
    setSaveStatus(nextCount ? "dirty" : "idle");
    setSaveMessage(nextCount ? `${nextCount} 个单词标记未保存。` : "");
  }

  const applySavedMarkChanges = useCallback((changes: Array<[string, WordMarkState | null]>) => {
    for (const [wordId, state] of changes) {
      if (state) {
        committedWordStatesRef.current.set(wordId, state);
      } else {
        committedWordStatesRef.current.delete(wordId);
      }

      if (
        pendingMarkChangesRef.current.has(wordId) &&
        pendingMarkChangesRef.current.get(wordId) === state
      ) {
        pendingMarkChangesRef.current.delete(wordId);
      }
    }

    const nextCount = pendingMarkChangesRef.current.size;
    setPendingSaveCount(nextCount);
    setSaveStatus(nextCount ? "dirty" : "saved");
    setSaveMessage(nextCount ? `${nextCount} 个单词标记未保存。` : "单词标记已保存。");
  }, []);

  const savePendingMarks = useCallback(async () => {
    if (saveInFlightRef.current) return saveInFlightRef.current;

    const changes = Array.from(pendingMarkChangesRef.current.entries());
    if (!changes.length) {
      setSaveStatus("idle");
      setSaveMessage("");
      return true;
    }

    const savePromise = (async () => {
      setSaveStatus("saving");
      setSaveMessage(`正在保存 ${changes.length} 个单词标记...`);
      try {
        await saveProfileWordStates(changes);
      } catch (error) {
        setSaveStatus("error");
        setSaveMessage(error instanceof Error ? error.message : "保存失败，请重试。");
        return false;
      }

      applySavedMarkChanges(changes);
      return true;
    })();

    saveInFlightRef.current = savePromise;
    try {
      return await savePromise;
    } finally {
      if (saveInFlightRef.current === savePromise) {
        saveInFlightRef.current = null;
      }
    }
  }, [applySavedMarkChanges]);

  const flushPendingMarksInBackground = useCallback(() => {
    const changes = Array.from(pendingMarkChangesRef.current.entries());
    if (!changes.length) return;

    void saveProfileWordStates(changes, { keepalive: true })
      .then(() => applySavedMarkChanges(changes))
      .catch(() => {
        // The explicit save button and beforeunload warning remain the visible recovery path.
      });
  }, [applySavedMarkChanges]);

  const deleteWord = async (word: ProfileWordListItem) => {
    if (deletingWordId || markingWordId) return;

    await applyProfileMark(word, null);
    setWords((current) => current.filter((item) => item.id !== word.id));
    setOpenCards((current) => current.filter((item) => item.id !== word.id));
    linkedWordCache.current.delete(word.slug);
  };

  const openLinkedWord = async (slug: string) => {
    const currentWord = words.find((word) => word.slug === slug);
    if (currentWord) return openWordBySlug(currentWord.slug);

    const cachedWord = linkedWordCache.current.get(slug);
    if (cachedWord) {
      openWord(cachedWord);
      return true;
    }

    const fetchedWord = await fetchWordCard(slug);
    linkedWordCache.current.set(fetchedWord.slug, fetchedWord);
    openWord(fetchedWord);
    return true;
  };

  useEffect(() => {
    const handleSaveRequest = () => {
      void savePendingMarks();
    };

    window.addEventListener(WORD_MARK_SAVE_REQUEST_EVENT, handleSaveRequest);
    return () => window.removeEventListener(WORD_MARK_SAVE_REQUEST_EVENT, handleSaveRequest);
  }, [savePendingMarks]);

  useEffect(() => {
    if (!pendingSaveCount) return;

    const intervalId = window.setInterval(() => {
      void savePendingMarks();
    }, 5_000);

    return () => window.clearInterval(intervalId);
  }, [pendingSaveCount, savePendingMarks]);

  useEffect(() => {
    const detail: WordMarkSaveStateDetail = {
      pendingCount: pendingSaveCount,
      status: saveStatus,
      message: saveMessage
    };
    window.dispatchEvent(new CustomEvent(WORD_MARK_SAVE_STATE_EVENT, { detail }));
  }, [pendingSaveCount, saveMessage, saveStatus]);

  useEffect(() => {
    if (!pendingSaveCount) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      flushPendingMarksInBackground();
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [flushPendingMarksInBackground, pendingSaveCount]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingMarksInBackground();
      }
    };
    const handlePageHide = () => {
      flushPendingMarksInBackground();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [flushPendingMarksInBackground]);

  useEffect(() => {
    const handleDocumentClick = (event: globalThis.MouseEvent) => {
      if (
        !pendingMarkChangesRef.current.size ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target || anchor.download) return;
      if (anchor.matches(".wiki-link-word")) return;

      const nextUrl = new URL(anchor.href, window.location.href);
      if (nextUrl.origin !== window.location.origin) return;
      if (nextUrl.href === window.location.href) return;

      event.preventDefault();
      void (async () => {
        const saved = await savePendingMarks();
        if (!saved) return;
        router.push(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
      })();
    };

    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [router, savePendingMarks]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isUndoShortcut(event)) return;
      if (!markHistoryRef.current.length && !mnemonicCardDeleteUndoRef.current.size) return;
      if (isTextInputTarget(event.target)) return;

      event.preventDefault();
      undoLastAction();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [undoLastAction]);

  useEffect(() => {
    if (!selectedWordId) return;

    const frameId = window.requestAnimationFrame(() => {
      focusProfileWordItem(selectedWordId);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeCardId, selectedWordId, sortMode, view, words]);

  return (
    <>
      <section className="mn-profile-word-list mt-8">
        <div className="mn-profile-word-toolbar flex flex-wrap items-center justify-between gap-3 border-y border-[#d8dde6] py-3 dark:border-border">
          <div className="mn-profile-word-count text-sm font-medium text-[#69717f] dark:text-muted-foreground">
            {words.length.toLocaleString("zh-CN")} 个单词
          </div>
          <div className="mn-profile-word-actions flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={undoLastAction}
              disabled={!canUndoLastAction || Boolean(markingWordId) || Boolean(deletingWordId)}
              title="撤销上一步，含记忆卡删除 (⌘Z / Ctrl+Z / Shift+R)"
              aria-label="撤销上一步，快捷键 Command Z、Control Z 或 Shift R"
              className="mn-profile-icon-button flex h-10 w-10 appearance-none items-center justify-center rounded-md border border-[#d8dde6] bg-white text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] disabled:pointer-events-none disabled:opacity-35 dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <div className="mn-profile-sort-control grid grid-cols-5 overflow-hidden rounded-md border border-[#d8dde6] bg-white dark:border-border dark:bg-card">
              {sortOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setSortMode(option.value);
                    if (option.value === "random") setRandomSeed(createRandomSeed());
                  }}
                  aria-pressed={sortMode === option.value}
                  className={cn(
                    "flex h-10 appearance-none items-center justify-center border-l border-[#d8dde6] px-3 text-sm font-semibold transition first:border-l-0 dark:border-border",
                    sortMode === option.value
                      ? "bg-[#171a1f] text-white dark:bg-foreground dark:text-background"
                      : "text-[#69717f] hover:bg-[#eef2f6] hover:text-[#171a1f] dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="mn-profile-view-control grid grid-cols-2 overflow-hidden rounded-md border border-[#d8dde6] bg-white dark:border-border dark:bg-card">
              <button
                type="button"
                onClick={() => setView("grid")}
                title="格子展示"
                aria-label="格子展示"
                className={cn(
                  "flex h-10 w-11 appearance-none items-center justify-center transition",
                  view === "grid"
                    ? "bg-[#171a1f] text-white dark:bg-foreground dark:text-background"
                    : "text-[#69717f] hover:bg-[#eef2f6] dark:text-muted-foreground dark:hover:bg-muted"
                )}
              >
                <Grid2X2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                title="列表展示"
                aria-label="列表展示"
                className={cn(
                  "flex h-10 w-11 appearance-none items-center justify-center border-l border-[#d8dde6] transition dark:border-border",
                  view === "list"
                    ? "bg-[#171a1f] text-white dark:bg-foreground dark:text-background"
                    : "text-[#69717f] hover:bg-[#eef2f6] dark:text-muted-foreground dark:hover:bg-muted"
                )}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowMeaning((value) => !value)}
              className="mn-profile-toggle-button inline-flex h-10 appearance-none items-center gap-2 rounded-md border border-[#d8dde6] bg-white px-3 text-sm font-semibold text-[#171a1f] transition hover:border-[#171a1f] dark:border-border dark:bg-card dark:text-foreground dark:hover:border-foreground"
            >
              {showMeaning ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {showMeaning ? "隐藏释义" : "显示释义"}
            </button>
            <button
              type="button"
              onClick={() => setIsEditing((value) => !value)}
              aria-pressed={isEditing}
              className={cn(
                "mn-profile-edit-button inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition",
                isEditing
                  ? "border-[#171a1f] bg-[#171a1f] text-white dark:border-foreground dark:bg-foreground dark:text-background"
                  : "border-[#d8dde6] bg-white text-[#171a1f] hover:border-[#171a1f] dark:border-border dark:bg-card dark:text-foreground dark:hover:border-foreground"
              )}
            >
              {isEditing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
              {isEditing ? "完成" : "编辑"}
            </button>
          </div>
        </div>

        {sortedWords.length === 0 ? (
          <div className="mn-profile-empty mt-8 rounded-lg border border-dashed border-[#cbd3df] bg-white p-10 text-center text-sm font-medium text-[#69717f] dark:border-border dark:bg-card dark:text-muted-foreground">
            {emptyText}
          </div>
        ) : view === "grid" ? (
          <div className="mn-level-word-grid mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sortedWords.map((word) => (
              <ProfileWordCard
                key={word.id}
                word={word}
                markState={visibleMarkStateForWord(word.id)}
                showMeaning={showMeaning}
                isEditing={isEditing}
                isLoading={loadingSlug === word.slug}
                isBusy={markingWordId === word.id}
                isDeleting={deletingWordId === word.id}
                isSelected={selectedWordId === word.id}
                onOpen={() => void openWordBySlug(word.slug)}
                onMark={applyProfileMark}
                onDelete={deleteWord}
              />
            ))}
          </div>
        ) : (
          <div className="mn-level-word-list mt-5 overflow-hidden rounded-lg border border-[#d8dde6] bg-white dark:border-border dark:bg-card">
            {sortedWords.map((word) => (
              <ProfileWordRow
                key={word.id}
                word={word}
                markState={visibleMarkStateForWord(word.id)}
                showMeaning={showMeaning}
                isEditing={isEditing}
                isLoading={loadingSlug === word.slug}
                isBusy={markingWordId === word.id}
                isDeleting={deletingWordId === word.id}
                isSelected={selectedWordId === word.id}
                onOpen={() => void openWordBySlug(word.slug)}
                onMark={applyProfileMark}
                onDelete={deleteWord}
              />
            ))}
          </div>
        )}
      </section>

      {openCards.length ? (
        <MemoryCardTray
          words={openCards}
          activeCardId={activeCardId}
          onActivate={activateWordCard}
          onClose={(wordId) =>
            setOpenCards((current) => current.filter((word) => word.id !== wordId))
          }
          onOpenLinkedWord={openLinkedWord}
          onWordUpdate={updateWord}
          onCollectionMark={async (word, state) => {
            const profileWord = findProfileWord(words, word) ?? levelWordToProfileWord(word);
            await applyProfileMark(profileWord, state);
          }}
          onNavigateWord={(word, direction) => {
            const nextWord = adjacentProfileWord(sortedWords, word, direction);
            void replaceActiveWordCard(word.id, nextWord).catch(() => undefined);
          }}
          onKeyboardMark={(word, state) => {
            const profileWord = findProfileWord(words, word) ?? levelWordToProfileWord(word);
            const nextState = word.markState === state ? null : state;

            void applyProfileMark(profileWord, nextState);
          }}
          onMnemonicCardDeleteUndoChange={updateMnemonicCardDeleteUndo}
          isAuthenticated={true}
        />
      ) : null}
    </>
  );
}

function ProfileWordCard({
  word,
  markState,
  showMeaning,
  isEditing,
  isLoading,
  isBusy,
  isDeleting,
  isSelected,
  onOpen,
  onMark,
  onDelete
}: {
  word: ProfileWordListItem;
  markState: WordMarkState | null;
  showMeaning: boolean;
  isEditing: boolean;
  isLoading: boolean;
  isBusy: boolean;
  isDeleting: boolean;
  isSelected: boolean;
  onOpen: () => void;
  onMark: (word: ProfileWordListItem, state: WordMarkState | null) => void;
  onDelete: (word: ProfileWordListItem) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-level-word-id={word.id}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "mn-level-word-card group relative flex min-h-44 appearance-none flex-col justify-between rounded-lg border border-[#d8dde6] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[#171a1f] hover:shadow-sm focus:outline-none focus-visible:border-[#1a73e8] focus-visible:ring-2 focus-visible:ring-[#1a73e8] dark:border-border dark:bg-card dark:hover:border-foreground",
        isSelected &&
          "border-[#1a73e8] ring-2 ring-[#1a73e8] dark:border-[#7ab7ff] dark:ring-[#7ab7ff]"
      )}
    >
      <span>
        <span className="flex min-w-0 items-start gap-2">
          <span
            className={cn(
              "word-card-title block min-w-0 truncate font-semibold tracking-normal text-[#171a1f] dark:text-foreground",
              (isEditing || isLoading) && "pr-9"
            )}
          >
            {word.word}
          </span>
          {isLoading ? (
            <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-[#69717f]" />
          ) : null}
        </span>
        <span className="word-card-meaning mt-6 block min-h-12 text-[#323741] dark:text-foreground/80">
          {showMeaning ? word.shortMeaningCn || word.meaningCn || "释义待补" : "••••••"}
        </span>
      </span>
      {isEditing ? (
        <DeleteWordButton
          word={word}
          isDeleting={isDeleting}
          onDelete={onDelete}
          className="absolute right-3 top-3"
        />
      ) : null}
      <ProfileMarkButtons
        word={word}
        markState={markState}
        disabled={isBusy || isDeleting}
        onMark={onMark}
        className="mt-4 border-t border-[#eef2f6] pt-3 dark:border-border"
      />
    </div>
  );
}

function ProfileWordRow({
  word,
  markState,
  showMeaning,
  isEditing,
  isLoading,
  isBusy,
  isDeleting,
  isSelected,
  onOpen,
  onMark,
  onDelete
}: {
  word: ProfileWordListItem;
  markState: WordMarkState | null;
  showMeaning: boolean;
  isEditing: boolean;
  isLoading: boolean;
  isBusy: boolean;
  isDeleting: boolean;
  isSelected: boolean;
  onOpen: () => void;
  onMark: (word: ProfileWordListItem, state: WordMarkState | null) => void;
  onDelete: (word: ProfileWordListItem) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-level-word-id={word.id}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "mn-level-word-row grid min-h-16 w-full appearance-none gap-3 border-b border-[#e5e9f0] px-4 py-3 text-left transition last:border-b-0 hover:bg-[#f6f8fb] focus:outline-none focus-visible:border-[#1a73e8] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1a73e8] dark:border-border dark:hover:bg-muted sm:grid-cols-[220px_minmax(0,1fr)_auto] sm:items-center",
        isSelected &&
          "border-[#1a73e8] ring-2 ring-inset ring-[#1a73e8] dark:border-[#7ab7ff] dark:ring-[#7ab7ff]"
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="word-row-title min-w-0 truncate font-semibold text-[#171a1f] dark:text-foreground">
          {word.word}
        </span>
        {isLoading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#69717f]" /> : null}
      </span>
      <span className="word-row-meaning min-w-0 truncate text-[#323741] dark:text-foreground/80">
        {showMeaning ? word.shortMeaningCn || word.meaningCn || "释义待补" : "••••••"}
      </span>
      <span className="flex items-center gap-2">
        <ProfileMarkButtons
          word={word}
          markState={markState}
          disabled={isBusy || isDeleting}
          onMark={onMark}
        />
        {isEditing ? (
          <DeleteWordButton word={word} isDeleting={isDeleting} onDelete={onDelete} />
        ) : null}
      </span>
    </div>
  );
}

function ProfileMarkButtons({
  word,
  markState,
  disabled,
  onMark,
  className
}: {
  word: ProfileWordListItem;
  markState: WordMarkState | null;
  disabled: boolean;
  onMark: (word: ProfileWordListItem, state: WordMarkState | null) => void;
  className?: string;
}) {
  const buttons = [
    {
      state: "KNOWN" as const,
      label: "熟练单词",
      icon: Check,
      idle: "border-[#b9e5ce] bg-[#effaf3] text-[#168458] hover:border-[#168458]",
      active: "border-[#168458] bg-[#168458] text-white"
    },
    {
      state: "FUZZY" as const,
      label: "模糊单词",
      icon: Circle,
      idle: "border-[#ead38a] bg-[#fff8df] text-[#9a6a00] hover:border-[#c08a00]",
      active: "border-[#c08a00] bg-[#d89a00] text-white"
    },
    {
      state: "UNKNOWN" as const,
      label: "陌生单词",
      icon: X,
      idle: "border-[#f1b8ad] bg-[#fff1ee] text-[#c2412d] hover:border-[#c2412d]",
      active: "border-[#c2412d] bg-[#c2412d] text-white"
    }
  ];

  return (
    <div className={cn("mn-level-mark-buttons flex items-center gap-2", className)}>
      {buttons.map((button) => {
        const Icon = button.icon;
        const active = markState === button.state;
        return (
          <button
            key={button.state}
            type="button"
            disabled={disabled}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onMark(word, active ? null : button.state);
            }}
            onKeyDown={(event) => event.stopPropagation()}
            data-mark-state={button.state}
            data-active={active ? "true" : "false"}
            aria-label={
              active ? `${word.word} 取消${button.label}标记` : `${word.word} 标记为${button.label}`
            }
            aria-pressed={active}
            title={active ? `取消${button.label}` : button.label}
            className={cn(
              "flex h-8 w-8 shrink-0 appearance-none items-center justify-center rounded-full border transition disabled:pointer-events-none disabled:opacity-50",
              active ? button.active : button.idle
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}

function DeleteWordButton({
  word,
  isDeleting,
  onDelete,
  className
}: {
  word: ProfileWordListItem;
  isDeleting: boolean;
  onDelete: (word: ProfileWordListItem) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDelete(word);
      }}
      disabled={isDeleting}
      aria-label={`删除 ${word.word}`}
      title={`删除 ${word.word}`}
      className={cn(
        "mn-profile-delete-button flex h-9 w-9 appearance-none items-center justify-center rounded-md border border-[#f1b8ad] bg-[#fff1ee] text-[#c2412d] transition hover:border-[#c2412d] hover:bg-[#ffe5df] disabled:pointer-events-none disabled:opacity-60 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300",
        className
      )}
    >
      {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </button>
  );
}

const sortOptions: { value: SortMode; label: string }[] = [
  { value: "random", label: "随机" },
  { value: "newest", label: "晚到早" },
  { value: "oldest", label: "早到晚" },
  { value: "az", label: "A-Z" },
  { value: "za", label: "Z-A" }
];

const profileKindToMarkState: Record<ProfileListKind, WordMarkState> = {
  known: "KNOWN",
  fuzzy: "FUZZY",
  unknown: "UNKNOWN"
};

function sortProfileWords(words: ProfileWordListItem[], sortMode: SortMode, randomSeed: string) {
  if (sortMode === "az")
    return [...words].sort((first, second) => first.word.localeCompare(second.word, "en"));
  if (sortMode === "za")
    return [...words].sort((first, second) => second.word.localeCompare(first.word, "en"));
  if (sortMode === "oldest")
    return [...words].sort(
      (first, second) =>
        joinedAtTime(first) - joinedAtTime(second) || first.word.localeCompare(second.word, "en")
    );
  if (sortMode === "newest")
    return [...words].sort(
      (first, second) =>
        joinedAtTime(second) - joinedAtTime(first) || first.word.localeCompare(second.word, "en")
    );

  return [...words].sort((first, second) => {
    const firstRank = randomRank(`${randomSeed}:${first.slug}`);
    const secondRank = randomRank(`${randomSeed}:${second.slug}`);
    return firstRank - secondRank || first.word.localeCompare(second.word, "en");
  });
}

function joinedAtTime(word: ProfileWordListItem) {
  const time = Date.parse(word.joinedAt);
  return Number.isNaN(time) ? 0 : time;
}

function randomRank(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandomSeed() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function adjacentProfileWord(
  words: ProfileWordListItem[],
  word: Pick<LevelWordItem, "id" | "slug">,
  direction: WordNavigationDirection
) {
  if (!words.length) return null;
  const currentIndex = words.findIndex((item) => item.id === word.id || item.slug === word.slug);
  if (currentIndex < 0) return direction === "next" ? words[0] : words[words.length - 1];
  if (words.length === 1) return null;

  const step = direction === "next" ? 1 : -1;
  const nextIndex = (currentIndex + step + words.length) % words.length;
  return words[nextIndex] ?? null;
}

function findProfileWord(words: ProfileWordListItem[], word: Pick<LevelWordItem, "id" | "slug">) {
  return words.find((item) => item.id === word.id || item.slug === word.slug);
}

function focusProfileWordItem(wordId: string) {
  const wordElement = Array.from(
    document.querySelectorAll<HTMLElement>("[data-level-word-id]")
  ).find((element) => element.dataset.levelWordId === wordId);
  if (!wordElement) return;

  wordElement.focus({ preventScroll: true });
  wordElement.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: "auto"
  });
}

function profileWordToLevelWord(
  word: ProfileWordListItem,
  markState: WordMarkState | null
): LevelWordItem {
  return {
    id: word.id,
    word: word.word,
    slug: word.slug,
    phonetic: word.phoneticUs || word.phoneticUk || "",
    audioUkUrl: "",
    audioUsUrl: "",
    partOfSpeech: "",
    meaningCn: word.meaningCn,
    shortMeaningCn: word.shortMeaningCn,
    exampleSentence: "",
    exampleTranslation: "",
    markState,
    isBookmarked: markState === "UNKNOWN",
    mnemonic: null,
    mnemonics: []
  };
}

function levelWordToProfileWord(word: LevelWordItem): ProfileWordListItem {
  return {
    id: word.id,
    slug: word.slug,
    word: word.word,
    phoneticUk: word.phonetic || null,
    phoneticUs: word.phonetic || null,
    shortMeaningCn: word.shortMeaningCn,
    meaningCn: word.meaningCn,
    joinedAt: new Date().toISOString()
  };
}

function isUndoShortcut(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  const isSystemUndo =
    (event.metaKey || event.ctrlKey) &&
    (key === "z" || event.code === "KeyZ") &&
    !event.shiftKey &&
    !event.altKey;
  const isPanelUndo =
    event.shiftKey &&
    (key === "r" || event.code === "KeyR") &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey;
  return isSystemUndo || isPanelUndo;
}

async function saveProfileWordStates(
  changes: Array<[string, WordMarkState | null]>,
  options: { keepalive?: boolean } = {}
) {
  const response = await fetch("/api/word-marks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      changes: changes.map(([wordId, state]) => ({ wordId, state }))
    }),
    cache: "no-store",
    keepalive: options.keepalive
  });
  const result = (await response.json().catch(() => ({}))) as { error?: string };

  if (!response.ok) {
    throw new Error(result.error || "保存失败。");
  }
}

function isTextInputTarget(target: EventTarget | null) {
  return (
    (target instanceof HTMLInputElement &&
      !["range", "button", "checkbox", "radio"].includes(target.type)) ||
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
