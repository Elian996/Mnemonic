"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  Eye,
  EyeOff,
  Grid2X2,
  ImagePlus,
  List,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Star,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  X
} from "lucide-react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  PointerEvent
} from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LOGIN_REQUIRED_INTERACTION_MESSAGE,
  LoginRequiredPrompt
} from "@/components/login-required-prompt";
import { EditSaveStatus, MemoryCardEditFields } from "@/components/memory-card-edit-fields";
import { MemoryCardReadView } from "@/components/memory-card-read-view";
import {
  GUEST_PROGRESS_CHANGED_EVENT,
  applyGuestProgressToWord,
  applyGuestProgressToWords,
  saveGuestMnemonicCardOrder,
  saveGuestMnemonicReaction,
  saveGuestWordMarkState,
  saveGuestWordMarkStates
} from "@/lib/guest-progress";
import { cn } from "@/lib/utils";
import {
  WORD_MARK_SAVE_REQUEST_EVENT,
  WORD_MARK_SAVE_STATE_EVENT,
  type WordMarkSaveStateDetail,
  type WordMarkSaveStatus
} from "@/lib/word-mark-save-events";
import {
  editableMnemonicContentFromParts,
  relatedWordText,
  withRelatedWordLinks
} from "@/lib/mnemonic-card-editing";

type MnemonicCardItem = {
  id: string;
  title: string;
  splitText: string;
  contentMarkdown: string;
  contentHtml: string;
  plainText: string;
  sourceType: "OFFICIAL" | "USER_PRIVATE" | "USER_PUBLIC";
  status: string;
  likeCount: number;
  dislikeCount: number;
  userVoteType: "LIKE" | "DISLIKE" | null;
  isSaved: boolean;
  updatedAt: string;
  canEdit: boolean;
};

export type LevelWordItem = {
  id: string;
  word: string;
  slug: string;
  phonetic: string;
  audioUkUrl: string;
  audioUsUrl: string;
  partOfSpeech: string;
  meaningCn: string;
  shortMeaningCn: string;
  exampleSentence: string;
  exampleTranslation: string;
  markState: WordMarkState | null;
  isBookmarked: boolean;
  mnemonic?: MnemonicCardItem | null;
  mnemonics: MnemonicCardItem[];
  canEditOfficialCards?: boolean;
  canExportMemoryCardImages?: boolean;
};

type ViewMode = "grid" | "list";
type SortMode = "random" | "az" | "za";
type WordMarkState = "KNOWN" | "FUZZY" | "UNKNOWN";
type MemoryCardPosition = { x: number; y: number };
type MobileSearchStatus = "idle" | "loading" | "ready" | "error";
type WordSearchResult = Pick<
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
  words?: WordSearchResult[];
  error?: string;
};
type MarkHistoryItem = {
  wordId: string;
  previousState: WordMarkState | null;
  previousWord: LevelWordItem;
  previousWasRoundReset: boolean;
  previousWords: LevelWordItem[];
};
type DeletedMnemonicCard = {
  card: MnemonicCardItem;
  previousIndex: number;
};
type MnemonicCardDeleteUndoState = {
  wordId: string;
  canUndo: boolean;
  restore: () => void | Promise<void>;
};
type WordNavigationDirection = "previous" | "next";
type AutoSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";
type DocumentScrollLock = {
  release: () => void;
  runWithUnlockedPage: (callback: () => void) => void;
};

const mnemonicCardAutoSaveDelayMs = 15_000;
const mnemonicCardAutoSaveDelaySeconds = mnemonicCardAutoSaveDelayMs / 1000;
const memoryCardViewModeStorageKey = "mnemonic_memory_card_view_mode";

const sortOptions: { value: SortMode; label: string }[] = [
  { value: "random", label: "随机" },
  { value: "az", label: "A-Z" },
  { value: "za", label: "Z-A" }
];

export function LevelWordBrowser({
  words,
  sort,
  basePath,
  isAuthenticated,
  defaultUserCardVisibility = "private",
  canEditOfficialCards = false,
  canExportMemoryCardImages = false
}: {
  words: LevelWordItem[];
  sort: SortMode;
  basePath: string;
  isAuthenticated: boolean;
  defaultUserCardVisibility?: "private" | "public";
  canEditOfficialCards?: boolean;
  canExportMemoryCardImages?: boolean;
}) {
  const router = useRouter();
  const [displayWords, setDisplayWords] = useState(() =>
    prepareWordsForDisplay(words, isAuthenticated)
  );
  const [activeSort, setActiveSort] = useState(sort);
  const [wordStates, setWordStates] = useState(() =>
    markMapFromWords(wordsWithClientProgress(words, isAuthenticated))
  );
  const [pendingSaveCount, setPendingSaveCount] = useState(0);
  const [saveStatus, setSaveStatus] = useState<WordMarkSaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [roundResetWordIds, setRoundResetWordIds] = useState<Set<string>>(() => new Set());
  const [markHistory, setMarkHistory] = useState<MarkHistoryItem[]>([]);
  const [showMeaning, setShowMeaning] = useState(false);
  const [view, setView] = useState<ViewMode>("grid");
  const [openCards, setOpenCards] = useState<LevelWordItem[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [selectedWordId, setSelectedWordId] = useState<string | null>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileSearchQuery, setMobileSearchQuery] = useState("");
  const [mobileSearchResults, setMobileSearchResults] = useState<WordSearchResult[]>([]);
  const [mobileSearchStatus, setMobileSearchStatus] = useState<MobileSearchStatus>("idle");
  const [mobileSearchMessage, setMobileSearchMessage] = useState("");
  const [mobileSearchLoadingSlug, setMobileSearchLoadingSlug] = useState<string | null>(null);
  const [loginPromptMessage, setLoginPromptMessage] = useState("");
  const linkedWordCache = useRef(new Map<string, LevelWordItem>());
  const mnemonicCardDeleteUndoRef = useRef(new Map<string, () => void | Promise<void>>());
  const markHistoryRef = useRef<MarkHistoryItem[]>([]);
  const committedWordStatesRef = useRef(
    markMapFromWords(wordsWithClientProgress(words, isAuthenticated))
  );
  const pendingMarkChangesRef = useRef(new Map<string, WordMarkState | null>());
  const pendingScrollRestoreRef = useRef<{ left: number; top: number } | null>(null);
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const mobileSearchRequestIdRef = useRef(0);
  const [mnemonicCardDeleteUndoIds, setMnemonicCardDeleteUndoIds] = useState<string[]>([]);
  const wordBySlug = useMemo(
    () => new Map(displayWords.map((word) => [word.slug, word])),
    [displayWords]
  );
  const showLoginPrompt = useCallback((message = LOGIN_REQUIRED_INTERACTION_MESSAGE) => {
    setLoginPromptMessage(message);
  }, []);

  const updateWord = useCallback((updatedWord: LevelWordItem) => {
    const hasPendingMark = pendingMarkChangesRef.current.has(updatedWord.id);
    const pendingMarkState = hasPendingMark
      ? (pendingMarkChangesRef.current.get(updatedWord.id) ?? null)
      : null;
    const nextUpdatedWord = {
      ...updatedWord,
      markState: hasPendingMark ? pendingMarkState : (updatedWord.markState ?? null),
      isBookmarked: hasPendingMark ? pendingMarkState === "UNKNOWN" : updatedWord.isBookmarked
    };
    const mergeWord = (word: LevelWordItem) =>
      word.id === nextUpdatedWord.id
        ? {
            ...word,
            ...nextUpdatedWord
          }
        : word;

    linkedWordCache.current.set(nextUpdatedWord.slug, nextUpdatedWord);
    setOpenCards((current) => current.map(mergeWord));
    setDisplayWords((current) => current.map(mergeWord));
    setWordStates((current) => {
      const next = new Map(current);
      if (nextUpdatedWord.markState) {
        next.set(nextUpdatedWord.id, nextUpdatedWord.markState);
      } else {
        next.delete(nextUpdatedWord.id);
      }
      return next;
    });
  }, []);
  const refreshWordCard = useCallback(
    async (slug: string) => {
      const fetchedWord = await fetchWordCard(slug);
      if (!fetchedWord) return;
      const wordWithProgress = isAuthenticated
        ? fetchedWord
        : applyGuestProgressToWord(fetchedWord);
      updateWord(wordWithProgress);
    },
    [isAuthenticated, updateWord]
  );
  const activateWordCard = useCallback((wordId: string | null) => {
    setActiveCardId(wordId);
    if (wordId) setSelectedWordId(wordId);
  }, []);
  const openWord = useCallback(
    (word: LevelWordItem) => {
      activateWordCard(word.id);
      setOpenCards((current) =>
        [word, ...current.filter((item) => item.id !== word.id)].slice(0, 5)
      );
      void refreshWordCard(word.slug);
    },
    [activateWordCard, refreshWordCard]
  );

  const closeWord = (wordId: string) => {
    setOpenCards((current) => current.filter((item) => item.id !== wordId));
  };
  const replaceActiveWordCard = useCallback(
    (currentWordId: string, nextWord: LevelWordItem | null) => {
      if (!nextWord) {
        setOpenCards((current) => current.filter((item) => item.id !== currentWordId));
        setActiveCardId((current) => (current === currentWordId ? null : current));
        setSelectedWordId((current) => (current === currentWordId ? null : current));
        return;
      }

      activateWordCard(nextWord.id);
      setOpenCards((current) =>
        [
          nextWord,
          ...current.filter((item) => item.id !== currentWordId && item.id !== nextWord.id)
        ].slice(0, 5)
      );
      void refreshWordCard(nextWord.slug);
    },
    [activateWordCard, refreshWordCard]
  );

  useEffect(() => {
    const nextWords = wordsWithClientProgress(words, isAuthenticated);
    const committedStates = markMapFromWords(nextWords);
    const pendingChanges = new Map(pendingMarkChangesRef.current);
    for (const [wordId, pendingState] of pendingChanges) {
      if (pendingState === (committedStates.get(wordId) ?? null)) {
        pendingChanges.delete(wordId);
      }
    }
    const visibleStates = mergeMarkStates(committedStates, pendingChanges);
    const nextPendingCount = pendingChanges.size;

    committedWordStatesRef.current = committedStates;
    pendingMarkChangesRef.current = pendingChanges;
    setDisplayWords(prepareWordsForDisplay(words, isAuthenticated, visibleStates));
    setActiveSort(sort);
    setWordStates(visibleStates);
    setPendingSaveCount(nextPendingCount);
    if (nextPendingCount) {
      const isSaving = Boolean(saveInFlightRef.current);
      setSaveStatus(isSaving ? "saving" : "dirty");
      setSaveMessage(
        isSaving
          ? `正在保存 ${nextPendingCount} 个单词标记...`
          : `${nextPendingCount} 个单词标记未保存。`
      );
    } else if (!saveInFlightRef.current) {
      setSaveStatus("idle");
      setSaveMessage("");
    }
    setRoundResetWordIds(new Set());
    markHistoryRef.current = [];
    setMarkHistory([]);

    const scrollPosition = pendingScrollRestoreRef.current;
    if (scrollPosition) {
      pendingScrollRestoreRef.current = null;
      restoreWindowScroll(scrollPosition);
    }
  }, [isAuthenticated, sort, words]);

  useEffect(() => {
    if (isAuthenticated) return;

    const refreshGuestProgress = () => {
      const nextWords = wordsWithClientProgress(words, false);
      const committedStates = markMapFromWords(nextWords);
      const visibleStates = mergeMarkStates(committedStates, pendingMarkChangesRef.current);
      setDisplayWords(prepareWordsForDisplay(words, false, visibleStates));
      setWordStates(visibleStates);
      setRoundResetWordIds(new Set());
      setOpenCards((current) => current.map((word) => applyGuestProgressToWord(word)));
    };

    window.addEventListener(GUEST_PROGRESS_CHANGED_EVENT, refreshGuestProgress);
    window.addEventListener("storage", refreshGuestProgress);
    return () => {
      window.removeEventListener(GUEST_PROGRESS_CHANGED_EVENT, refreshGuestProgress);
      window.removeEventListener("storage", refreshGuestProgress);
    };
  }, [isAuthenticated, words]);

  const sortHref = (value: SortMode) => {
    return `${basePath}?sort=${value}`;
  };
  const persistMarkStates = useCallback(
    async (changes: Array<[string, WordMarkState | null]>) => {
      if (!isAuthenticated) {
        saveGuestWordMarkStates(changes);
        showLoginPrompt();
        return;
      }
      await saveWordMarkStates(changes);
    },
    [isAuthenticated, showLoginPrompt]
  );
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
  const updatePendingMarkChange = useCallback((wordId: string, state: WordMarkState | null) => {
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
        await persistMarkStates(changes);
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
  }, [applySavedMarkChanges, persistMarkStates]);
  const flushPendingMarksInBackground = useCallback(() => {
    const changes = Array.from(pendingMarkChangesRef.current.entries());
    if (!changes.length) return;

    if (!isAuthenticated) {
      saveGuestWordMarkStates(changes);
      applySavedMarkChanges(changes);
      showLoginPrompt();
      return;
    }

    void saveWordMarkStates(changes, { keepalive: true })
      .then(() => applySavedMarkChanges(changes))
      .catch(() => {
        // The explicit save button and beforeunload warning remain the visible recovery path.
      });
  }, [applySavedMarkChanges, isAuthenticated, showLoginPrompt]);
  const reshuffleWords = useCallback(async () => {
    const saved = await savePendingMarks();
    if (!saved) return;

    const query = new URLSearchParams({ sort: "random", seed: createRandomSeed() });
    pendingScrollRestoreRef.current = { left: window.scrollX, top: window.scrollY };
    setOpenCards([]);
    setActiveCardId(null);
    setActiveSort("random");
    setRoundResetWordIds(new Set());
    router.push(`${basePath}?${query.toString()}`, { scroll: false });
  }, [basePath, router, savePendingMarks]);
  const markWord = useCallback(
    (word: LevelWordItem, state: WordMarkState | null) => {
      const previousWords = displayWords;
      const previousState = wordStates.has(word.id)
        ? (wordStates.get(word.id) ?? null)
        : word.markState;
      const previousWord = applyMarkSnapshot(word, previousState);
      const previousWasRoundReset = roundResetWordIds.has(word.id);

      markHistoryRef.current = [
        ...markHistoryRef.current,
        { wordId: word.id, previousState, previousWord, previousWasRoundReset, previousWords }
      ];
      setMarkHistory(markHistoryRef.current);
      setRoundResetWordIds((current) => {
        const next = new Set(current);
        next.delete(word.id);
        return next;
      });
      setWordStates((current) => {
        const next = new Map(current);
        if (state) {
          next.set(word.id, state);
        } else {
          next.delete(word.id);
        }
        return next;
      });
      setDisplayWords((current) => applyMarkedWord(current, word, state));
      setOpenCards((current) =>
        current.map((item) => (item.id === word.id ? applyMarkSnapshot(item, state) : item))
      );
      linkedWordCache.current.set(
        word.slug,
        applyMarkSnapshot(linkedWordCache.current.get(word.slug) ?? word, state)
      );
      updatePendingMarkChange(word.id, state);
      if (!isAuthenticated) showLoginPrompt();
    },
    [
      displayWords,
      isAuthenticated,
      roundResetWordIds,
      showLoginPrompt,
      updatePendingMarkChange,
      wordStates
    ]
  );
  const undoLastMark = useCallback(() => {
    const last = markHistoryRef.current.at(-1);
    if (!last) return;

    markHistoryRef.current = markHistoryRef.current.slice(0, -1);
    setMarkHistory(markHistoryRef.current);
    setDisplayWords(last.previousWords);
    setRoundResetWordIds((current) => {
      const next = new Set(current);
      if (last.previousWasRoundReset) {
        next.add(last.wordId);
      } else {
        next.delete(last.wordId);
      }
      return next;
    });
    setWordStates((current) => {
      const next = new Map(current);
      if (last.previousState) {
        next.set(last.wordId, last.previousState);
      } else {
        next.delete(last.wordId);
      }
      return next;
    });
    setOpenCards((current) =>
      current.map((word) =>
        word.id === last.wordId ? applyMarkSnapshot(word, last.previousState) : word
      )
    );
    linkedWordCache.current.set(last.previousWord.slug, last.previousWord);
    updatePendingMarkChange(last.wordId, last.previousState);
  }, [updatePendingMarkChange]);
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
  }, [activeCardId, mnemonicCardDeleteUndoIds, undoLastMark]);
  const canUndoLastAction = markHistory.length > 0 || mnemonicCardDeleteUndoIds.length > 0;

  const searchMobileWords = useCallback(async () => {
    const query = mobileSearchQuery.trim();
    if (!query) {
      setMobileSearchResults([]);
      setMobileSearchStatus("idle");
      setMobileSearchMessage("输入英文单词或中文释义。");
      return;
    }

    const requestId = mobileSearchRequestIdRef.current + 1;
    mobileSearchRequestIdRef.current = requestId;
    setMobileSearchStatus("loading");
    setMobileSearchMessage("");

    try {
      const response = await fetch(`/api/word-search?q=${encodeURIComponent(query)}`, {
        cache: "no-store"
      });
      const result = (await response.json().catch(() => ({}))) as WordSearchResponse;
      if (!response.ok) throw new Error(result.error || "搜索失败。");
      if (mobileSearchRequestIdRef.current !== requestId) return;

      const nextResults = (result.words ?? []).map((word) =>
        isAuthenticated ? word : applyGuestProgressToWord(word)
      );
      setMobileSearchResults(nextResults);
      setMobileSearchStatus("ready");
      setMobileSearchMessage(nextResults.length ? "" : "没有找到匹配单词。");
    } catch (error) {
      if (mobileSearchRequestIdRef.current !== requestId) return;
      setMobileSearchResults([]);
      setMobileSearchStatus("error");
      setMobileSearchMessage(error instanceof Error ? error.message : "搜索失败。");
    }
  }, [isAuthenticated, mobileSearchQuery]);

  const openMobileSearchResult = useCallback(
    async (result: WordSearchResult) => {
      const localWord = wordBySlug.get(result.slug);
      if (localWord) {
        setMobileSearchMessage("");
        openWord(localWord);
        return;
      }

      const cachedWord = linkedWordCache.current.get(result.slug);
      if (cachedWord) {
        setMobileSearchMessage("");
        openWord(cachedWord);
        return;
      }

      setMobileSearchLoadingSlug(result.slug);
      setMobileSearchMessage("");
      try {
        const fetchedWord = await fetchWordCard(result.slug);
        if (!fetchedWord) throw new Error("没有找到这个单词卡。");
        const wordWithProgress = isAuthenticated
          ? fetchedWord
          : applyGuestProgressToWord(fetchedWord);
        linkedWordCache.current.set(wordWithProgress.slug, wordWithProgress);
        openWord(wordWithProgress);
      } catch (error) {
        setMobileSearchStatus("error");
        setMobileSearchMessage(error instanceof Error ? error.message : "打开单词卡失败。");
      } finally {
        setMobileSearchLoadingSlug((current) => (current === result.slug ? null : current));
      }
    },
    [isAuthenticated, openWord, wordBySlug]
  );

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
      if (isTextEditingTarget(event.target)) return;

      event.preventDefault();
      undoLastAction();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [undoLastAction]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isSpaceShortcut(event) || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isTextEditingTarget(event.target)) return;

      const activeOpenWordId = activeCardId ?? openCards[0]?.id ?? null;
      if (activeOpenWordId) {
        return;
      }

      if (isInteractiveShortcutTarget(event.target)) return;

      const targetWord =
        (selectedWordId && displayWords.find((word) => word.id === selectedWordId)) ??
        displayWords[0] ??
        null;
      if (!targetWord) return;

      event.preventDefault();
      event.stopPropagation();
      openWord(targetWord);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activeCardId, displayWords, openCards, openWord, selectedWordId]);

  useEffect(() => {
    if (!selectedWordId) return;
    if (isMobileCardGestureViewport() && openCards.length > 0) return;

    let secondFrameId = 0;
    const frameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(() => {
        focusLevelWordItem(selectedWordId);
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      window.cancelAnimationFrame(secondFrameId);
    };
  }, [activeCardId, openCards.length, selectedWordId, view]);

  const openLinkedWord = async (slug: string) => {
    const linkedWord = wordBySlug.get(slug) ?? linkedWordCache.current.get(slug);
    if (linkedWord) {
      openWord(linkedWord);
      return true;
    }

    const fetchedWord = await fetchWordCard(slug);
    if (!fetchedWord) return false;
    const wordWithProgress = isAuthenticated ? fetchedWord : applyGuestProgressToWord(fetchedWord);
    linkedWordCache.current.set(wordWithProgress.slug, wordWithProgress);
    openWord(wordWithProgress);
    return true;
  };

  return (
    <section className="mn-level-browser mt-8">
      <div className="mn-desktop-mode">
        <div className="mn-level-browser-toolbar flex flex-wrap items-center justify-between gap-3 border-y border-[#d8dde6] py-3 dark:border-border">
          <div className="mn-level-browser-count text-sm font-medium text-[#69717f] dark:text-muted-foreground">
            {displayWords.length} 个单词
          </div>
          <div className="mn-level-browser-actions flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={undoLastAction}
              disabled={!canUndoLastAction}
              title="撤销上一步，含记忆卡删除 (⌘Z / Ctrl+Z / Shift+R)"
              aria-label="撤销上一步，快捷键 Command Z、Control Z 或 Shift R"
              className="mn-level-icon-button flex h-10 w-10 appearance-none items-center justify-center rounded-md border border-[#d8dde6] bg-white text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] disabled:pointer-events-none disabled:opacity-35 dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <div className="mn-level-sort-control grid grid-cols-3 overflow-hidden rounded-md border border-[#d8dde6] bg-white dark:border-border dark:bg-card">
              {sortOptions.map((option) =>
                option.value === "random" ? (
                  <button
                    key={option.value}
                    type="button"
                    onClick={reshuffleWords}
                    aria-pressed={activeSort === option.value}
                    className={cn(
                      "flex h-10 appearance-none items-center justify-center border-l border-[#d8dde6] px-3 text-sm font-semibold transition first:border-l-0",
                      activeSort === option.value
                        ? "bg-[#171a1f] text-white dark:bg-foreground dark:text-background"
                        : "text-[#69717f] hover:bg-[#eef2f6] hover:text-[#171a1f] dark:border-border dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
                    )}
                  >
                    {option.label}
                  </button>
                ) : (
                  <Link
                    key={option.value}
                    href={sortHref(option.value)}
                    className={cn(
                      "flex h-10 items-center justify-center border-l border-[#d8dde6] px-3 text-sm font-semibold transition first:border-l-0",
                      activeSort === option.value
                        ? "bg-[#171a1f] text-white dark:bg-foreground dark:text-background"
                        : "text-[#69717f] hover:bg-[#eef2f6] hover:text-[#171a1f] dark:border-border dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
                    )}
                  >
                    {option.label}
                  </Link>
                )
              )}
            </div>
            <div className="mn-level-view-control grid grid-cols-2 overflow-hidden rounded-md border border-[#d8dde6] bg-white dark:border-border dark:bg-card">
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
                  "flex h-10 w-11 appearance-none items-center justify-center border-l border-[#d8dde6] transition",
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
              className="inline-flex h-10 appearance-none items-center gap-2 rounded-md border border-[#d8dde6] bg-white px-3 text-sm font-semibold text-[#171a1f] transition hover:border-[#171a1f] dark:border-border dark:bg-card dark:text-foreground dark:hover:border-foreground"
            >
              {showMeaning ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {showMeaning ? "隐藏释义" : "显示释义"}
            </button>
          </div>
        </div>

        {displayWords.length === 0 ? (
          <div className="mt-8 rounded-lg border border-dashed border-[#cbd3df] bg-white p-10 text-center text-sm font-medium text-[#69717f] dark:border-border dark:bg-card dark:text-muted-foreground">
            当前分类暂无单词。
          </div>
        ) : view === "grid" ? (
          <div className="mn-level-word-grid mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {displayWords.map((word, index) => (
              <WordCard
                key={`${word.id}-${index}`}
                word={word}
                markState={visibleMarkState(
                  word.id,
                  wordStates.get(word.id) ?? null,
                  roundResetWordIds
                )}
                showMeaning={showMeaning}
                isSelected={selectedWordId === word.id}
                onOpen={openWord}
                onMark={markWord}
              />
            ))}
          </div>
        ) : (
          <div className="mn-level-word-list mt-5 overflow-hidden rounded-lg border border-[#d8dde6] bg-white dark:border-border dark:bg-card">
            {displayWords.map((word, index) => (
              <WordRow
                key={`${word.id}-${index}`}
                word={word}
                markState={visibleMarkState(
                  word.id,
                  wordStates.get(word.id) ?? null,
                  roundResetWordIds
                )}
                showMeaning={showMeaning}
                isSelected={selectedWordId === word.id}
                onOpen={openWord}
                onMark={markWord}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mn-mobile-mode">
        <MobileLevelWordList
          words={displayWords}
          wordStates={wordStates}
          roundResetWordIds={roundResetWordIds}
          showMeaning={showMeaning}
          selectedWordId={selectedWordId}
          canUndoLastAction={canUndoLastAction}
          searchOpen={mobileSearchOpen}
          searchQuery={mobileSearchQuery}
          searchResults={mobileSearchResults}
          searchStatus={mobileSearchStatus}
          searchMessage={mobileSearchMessage}
          searchLoadingSlug={mobileSearchLoadingSlug}
          onUndo={undoLastAction}
          onToggleMeaning={() => setShowMeaning((value) => !value)}
          onOpen={openWord}
          onOpenSearch={() => setMobileSearchOpen(true)}
          onCloseSearch={() => setMobileSearchOpen(false)}
          onSearchQueryChange={(value) => {
            setMobileSearchQuery(value);
            if (!value.trim()) {
              setMobileSearchResults([]);
              setMobileSearchStatus("idle");
              setMobileSearchMessage("");
            }
          }}
          onSearchSubmit={searchMobileWords}
          onOpenSearchResult={openMobileSearchResult}
          onMark={markWord}
        />
      </div>

      {openCards.length ? (
        <MemoryCardTray
          words={openCards}
          activeCardId={activeCardId}
          onActivate={activateWordCard}
          onClose={closeWord}
          onOpenLinkedWord={openLinkedWord}
          onWordUpdate={updateWord}
          onCollectionMark={markWord}
          onNavigateWord={(word, direction) => {
            const nextWord = adjacentDisplayWord(displayWords, word, direction);
            replaceActiveWordCard(word.id, nextWord);
          }}
          onKeyboardMark={(word, state) => {
            const currentState = wordStates.has(word.id)
              ? (wordStates.get(word.id) ?? null)
              : (word.markState ?? null);
            const nextState = currentState === state ? null : state;

            markWord(word, nextState);
          }}
          onMnemonicCardDeleteUndoChange={updateMnemonicCardDeleteUndo}
          isAuthenticated={isAuthenticated}
          defaultUserCardVisibility={defaultUserCardVisibility}
          canEditOfficialCards={canEditOfficialCards}
          canExportMemoryCardImages={canExportMemoryCardImages}
          onRequireLogin={showLoginPrompt}
        />
      ) : null}
      <LoginRequiredPrompt message={loginPromptMessage} onClose={() => setLoginPromptMessage("")} />
    </section>
  );
}

function markMapFromWords(words: LevelWordItem[]) {
  const markMap = new Map<string, WordMarkState>();
  for (const word of words) {
    if (word.markState) markMap.set(word.id, word.markState);
  }
  return markMap;
}

function mergeMarkStates(
  committedStates: Map<string, WordMarkState>,
  pendingChanges: Map<string, WordMarkState | null>
) {
  const mergedStates = new Map(committedStates);
  for (const [wordId, state] of pendingChanges) {
    if (state) {
      mergedStates.set(wordId, state);
    } else {
      mergedStates.delete(wordId);
    }
  }
  return mergedStates;
}

function wordsWithClientProgress(words: LevelWordItem[], isAuthenticated: boolean) {
  return isAuthenticated ? words : applyGuestProgressToWords(words);
}

function prepareWordsForDisplay(
  words: LevelWordItem[],
  isAuthenticated: boolean,
  states?: Map<string, WordMarkState>
) {
  return uniqueWords(wordsWithClientProgress(words, isAuthenticated))
    .map((word) => {
      const state = states ? (states.get(word.id) ?? null) : word.markState;
      return {
        ...word,
        markState: state
      };
    })
    .filter((word) => word.markState !== "KNOWN");
}

function uniqueWords(words: LevelWordItem[]) {
  const seen = new Set<string>();
  const unique: LevelWordItem[] = [];
  for (const word of words) {
    if (seen.has(word.id)) continue;
    seen.add(word.id);
    unique.push(word);
  }
  return unique;
}

function visibleMarkState(
  wordId: string,
  state: WordMarkState | null,
  roundResetWordIds: Set<string>
) {
  return roundResetWordIds.has(wordId) ? null : state;
}

function createRandomSeed() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function restoreWindowScroll(position: { left: number; top: number }) {
  window.requestAnimationFrame(() => {
    window.scrollTo(position.left, position.top);
    window.requestAnimationFrame(() => window.scrollTo(position.left, position.top));
  });
}

function lockDocumentScroll(): DocumentScrollLock {
  const html = document.documentElement;
  const body = document.body;
  let scrollX = window.scrollX;
  let scrollY = window.scrollY;
  let isLocked = false;
  let isReleased = false;
  const previousBodyStyle = {
    left: body.style.left,
    overflow: body.style.overflow,
    position: body.style.position,
    right: body.style.right,
    top: body.style.top,
    width: body.style.width
  };
  const previousHtmlOverflow = html.style.overflow;

  const applyLock = () => {
    if (isReleased || isLocked) return;
    scrollX = window.scrollX;
    scrollY = window.scrollY;
    html.classList.add("mn-memory-card-open");
    html.style.overflow = "hidden";
    if (isMobileCardGestureViewport()) {
      body.style.overflow = "hidden";
      isLocked = true;
      return;
    }
    body.style.left = `-${scrollX}px`;
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.right = "0";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    isLocked = true;
  };

  const releaseLock = (restoreScroll: boolean) => {
    if (!isLocked) return;
    html.classList.remove("mn-memory-card-open");
    html.style.overflow = previousHtmlOverflow;
    body.style.left = previousBodyStyle.left;
    body.style.overflow = previousBodyStyle.overflow;
    body.style.position = previousBodyStyle.position;
    body.style.right = previousBodyStyle.right;
    body.style.top = previousBodyStyle.top;
    body.style.width = previousBodyStyle.width;
    isLocked = false;
    if (restoreScroll) window.scrollTo(scrollX, scrollY);
  };

  applyLock();

  return {
    release: () => {
      isReleased = true;
      releaseLock(true);
    },
    runWithUnlockedPage: (callback) => {
      if (isReleased) return;
      releaseLock(true);
      window.requestAnimationFrame(() => {
        if (isReleased) return;
        callback();
        window.requestAnimationFrame(applyLock);
      });
    }
  };
}

function focusLevelWordItem(wordId: string) {
  const matchingElements = Array.from(
    document.querySelectorAll<HTMLElement>("[data-level-word-id]")
  ).filter((element) => element.dataset.levelWordId === wordId);
  const wordElement =
    matchingElements.find((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    }) ??
    matchingElements[0] ??
    null;
  if (!wordElement) return;

  wordElement.focus({ preventScroll: true });
  wordElement.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: "auto"
  });
}

function adjacentDisplayWord(
  words: LevelWordItem[],
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

function keyboardMarkState(
  event: Pick<KeyboardEvent | ReactKeyboardEvent<HTMLElement>, "key" | "code">
): WordMarkState | null {
  const normalizedKey = event.key.toLowerCase();
  if (normalizedKey === "v" || event.code === "KeyV") return "KNOWN";
  if (normalizedKey === "o" || event.code === "KeyO") return "FUZZY";
  if (
    normalizedKey === "s" ||
    event.code === "KeyS" ||
    normalizedKey === "x" ||
    event.code === "KeyX"
  )
    return "UNKNOWN";
  return null;
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

function isSpaceShortcut(
  event: Pick<KeyboardEvent | ReactKeyboardEvent<HTMLElement>, "key" | "code">
) {
  return event.key === " " || event.code === "Space";
}

function isTextEditingTarget(target: EventTarget | null) {
  return (
    (target instanceof HTMLInputElement &&
      !["button", "checkbox", "radio", "range"].includes(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function isInteractiveShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "a[href], button, input, textarea, select, summary, [role='button'], [role='link'], [contenteditable='true']"
    )
  );
}

function isLevelWordShortcutTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("[data-level-word-id]"));
}

function isDocumentScrollKey(event: KeyboardEvent) {
  return (
    event.key === " " ||
    event.key === "PageUp" ||
    event.key === "PageDown" ||
    event.key === "Home" ||
    event.key === "End" ||
    event.key === "ArrowUp" ||
    event.key === "ArrowDown"
  );
}

const mobileCardViewportQuery = "(max-width: 767px), (max-height: 560px) and (pointer: coarse)";

function isMobileCardGestureViewport() {
  return typeof window !== "undefined" && window.matchMedia(mobileCardViewportQuery).matches;
}

const memoryCardViewportMargin = 16;

function constrainMemoryCardPosition(
  next: MemoryCardPosition,
  current: MemoryCardPosition,
  element: HTMLElement | null
) {
  if (typeof window === "undefined" || !element || isMobileCardGestureViewport()) return next;

  const rect = element.getBoundingClientRect();
  let x = next.x;
  let y = next.y;

  const nextLeft = rect.left + next.x - current.x;
  const minLeft = memoryCardViewportMargin;
  const maxLeft = Math.max(minLeft, window.innerWidth - memoryCardViewportMargin - rect.width);
  if (nextLeft < minLeft) x += minLeft - nextLeft;
  if (nextLeft > maxLeft) x -= nextLeft - maxLeft;

  const nextTop = rect.top + next.y - current.y;
  const minTop = memoryCardViewportMargin;
  const maxTop = Math.max(minTop, window.innerHeight - memoryCardViewportMargin - rect.height);
  if (nextTop < minTop) y += minTop - nextTop;
  if (nextTop > maxTop) y -= nextTop - maxTop;

  return { x, y };
}

function sameMemoryCardPosition(first: MemoryCardPosition, second: MemoryCardPosition) {
  return first.x === second.x && first.y === second.y;
}

function applyMarkedWord(words: LevelWordItem[], word: LevelWordItem, state: WordMarkState | null) {
  const nextWord = applyMarkSnapshot(word, state);
  return uniqueWords(words).map((item) => (item.id === word.id ? nextWord : item));
}

function applyMarkSnapshot(word: LevelWordItem, state: WordMarkState | null) {
  return {
    ...word,
    markState: state,
    isBookmarked: state === "UNKNOWN"
  };
}

async function saveWordMarkStates(
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

  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(result.error || "Failed to save word marks.");
  }
}

async function fetchWordCard(slug: string) {
  const response = await fetch(`/api/word-card/${encodeURIComponent(slug)}?fresh=${Date.now()}`, {
    cache: "no-store"
  });
  if (!response.ok) return null;
  return (await response.json()) as LevelWordItem;
}

function WordCard({
  word,
  markState,
  showMeaning,
  isSelected,
  onOpen,
  onMark
}: {
  word: LevelWordItem;
  markState: WordMarkState | null;
  showMeaning: boolean;
  isSelected: boolean;
  onOpen: (word: LevelWordItem) => void;
  onMark: (word: LevelWordItem, state: WordMarkState | null) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-level-word-id={word.id}
      onClick={() => onOpen(word)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(word);
        }
      }}
      className={cn(
        "mn-level-word-card group flex min-h-44 appearance-none flex-col justify-between rounded-lg border border-[#d8dde6] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[#171a1f] hover:shadow-sm focus:outline-none focus-visible:border-[#1a73e8] focus-visible:ring-2 focus-visible:ring-[#1a73e8] dark:border-border dark:bg-card dark:hover:border-foreground",
        isSelected &&
          "border-[#1a73e8] ring-2 ring-[#1a73e8] dark:border-[#7ab7ff] dark:ring-[#7ab7ff]"
      )}
    >
      <span>
        <span className="word-card-title block truncate font-semibold tracking-normal text-[#171a1f] dark:text-foreground">
          {word.word}
        </span>
        <span className="word-card-meaning mt-6 block min-h-12 text-[#323741] dark:text-foreground/80">
          {showMeaning ? word.shortMeaningCn || word.meaningCn || "释义待补" : "••••••"}
        </span>
      </span>
      <MarkButtons
        word={word}
        markState={markState}
        onMark={onMark}
        className="mt-4 border-t border-[#eef2f6] pt-3 dark:border-border"
      />
    </div>
  );
}

function WordRow({
  word,
  markState,
  showMeaning,
  isSelected,
  onOpen,
  onMark
}: {
  word: LevelWordItem;
  markState: WordMarkState | null;
  showMeaning: boolean;
  isSelected: boolean;
  onOpen: (word: LevelWordItem) => void;
  onMark: (word: LevelWordItem, state: WordMarkState | null) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-level-word-id={word.id}
      onClick={() => onOpen(word)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(word);
        }
      }}
      className={cn(
        "mn-level-word-row grid min-h-16 w-full appearance-none gap-3 border-b border-[#e5e9f0] px-4 py-3 text-left transition last:border-b-0 hover:bg-[#f6f8fb] focus:outline-none focus-visible:border-[#1a73e8] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1a73e8] dark:border-border dark:hover:bg-muted sm:grid-cols-[220px_minmax(0,1fr)_auto] sm:items-center",
        isSelected &&
          "border-[#1a73e8] ring-2 ring-inset ring-[#1a73e8] dark:border-[#7ab7ff] dark:ring-[#7ab7ff]"
      )}
    >
      <span className="word-row-title min-w-0 truncate font-semibold text-[#171a1f] dark:text-foreground">
        {word.word}
      </span>
      <span className="word-row-meaning min-w-0 truncate text-[#323741] dark:text-foreground/80">
        {showMeaning ? word.shortMeaningCn || word.meaningCn || "释义待补" : "••••••"}
      </span>
      <MarkButtons word={word} markState={markState} onMark={onMark} />
    </div>
  );
}

function MobileLevelWordList({
  words,
  wordStates,
  roundResetWordIds,
  showMeaning,
  selectedWordId,
  canUndoLastAction,
  searchOpen,
  searchQuery,
  searchResults,
  searchStatus,
  searchMessage,
  searchLoadingSlug,
  onUndo,
  onToggleMeaning,
  onOpen,
  onOpenSearch,
  onCloseSearch,
  onSearchQueryChange,
  onSearchSubmit,
  onOpenSearchResult,
  onMark
}: {
  words: LevelWordItem[];
  wordStates: Map<string, WordMarkState>;
  roundResetWordIds: Set<string>;
  showMeaning: boolean;
  selectedWordId: string | null;
  canUndoLastAction: boolean;
  searchOpen: boolean;
  searchQuery: string;
  searchResults: WordSearchResult[];
  searchStatus: MobileSearchStatus;
  searchMessage: string;
  searchLoadingSlug: string | null;
  onUndo: () => void;
  onToggleMeaning: () => void;
  onOpen: (word: LevelWordItem) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onSearchQueryChange: (value: string) => void;
  onSearchSubmit: () => void;
  onOpenSearchResult: (word: WordSearchResult) => void | Promise<void>;
  onMark: (word: LevelWordItem, state: WordMarkState | null) => void;
}) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!searchOpen) return;
    const frameId = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, [searchOpen]);

  useEffect(() => {
    const closeForUsageManual = () => {
      searchInputRef.current?.blur();
      onCloseSearch();
    };

    window.addEventListener("mnemonic:usage-manual-open", closeForUsageManual);
    return () => window.removeEventListener("mnemonic:usage-manual-open", closeForUsageManual);
  }, [onCloseSearch]);

  return (
    <div className="mn-mobile-word-surface">
      <div className="mn-mobile-word-toolbar">
        <span className="mn-mobile-word-count">{words.length} words</span>
        <div className="mn-mobile-word-actions">
          <button
            type="button"
            onClick={searchOpen ? onCloseSearch : onOpenSearch}
            className="mn-mobile-word-tool"
            aria-expanded={searchOpen}
            aria-label={searchOpen ? "收起全局搜索" : "打开全局搜索"}
            title={searchOpen ? "收起搜索" : "全局搜索"}
          >
            {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndoLastAction}
            className="mn-mobile-word-tool"
            aria-label="撤销上一步"
            title="撤销"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggleMeaning}
            className="mn-mobile-word-tool"
            aria-label={showMeaning ? "隐藏释义" : "显示释义"}
            title={showMeaning ? "隐藏释义" : "显示释义"}
          >
            {showMeaning ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {searchOpen ? (
        <div className="mn-mobile-word-search-panel">
          <form
            className="mn-mobile-word-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSearchSubmit();
            }}
          >
            <label className="sr-only" htmlFor="mn-mobile-level-search">
              搜索全部单词
            </label>
            <input
              ref={searchInputRef}
              id="mn-mobile-level-search"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="搜索英文或中文释义"
              className="mn-mobile-word-search-input"
            />
            <button
              type="submit"
              className="mn-mobile-word-search-submit"
              disabled={searchStatus === "loading"}
              aria-label="搜索"
              title="搜索"
            >
              {searchStatus === "loading" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </button>
          </form>
          {searchResults.length || searchMessage ? (
            <div className="mn-mobile-word-search-results">
              {searchMessage ? (
                <div className="mn-mobile-word-search-message">{searchMessage}</div>
              ) : null}
              {searchResults.map((word) => {
                const isOpening = searchLoadingSlug === word.slug;
                return (
                  <button
                    key={word.id}
                    type="button"
                    onClick={() => void onOpenSearchResult(word)}
                    disabled={Boolean(searchLoadingSlug)}
                    className={cn(
                      "mn-mobile-word-search-result",
                      isOpening && "mn-mobile-word-search-result-loading"
                    )}
                  >
                    <span className="mn-mobile-word-search-result-main">
                      <span className="mn-mobile-word-search-result-word">{word.word}</span>
                      {word.phonetic ? (
                        <span className="mn-mobile-word-search-result-phonetic">
                          {word.phonetic}
                        </span>
                      ) : null}
                      {word.markState ? (
                        <span className="mn-mobile-word-search-result-state">
                          {mobileMarkLabel(word.markState)}
                        </span>
                      ) : null}
                      {isOpening ? (
                        <Loader2 className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin" />
                      ) : null}
                    </span>
                    <span className="mn-mobile-word-search-result-meaning">
                      {word.shortMeaningCn || word.meaningCn || "释义待补"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {words.length ? (
        <div className="mn-mobile-word-list">
          {words.map((word, index) => (
            <MobileWordRow
              key={`${word.id}-${index}`}
              word={word}
              markState={visibleMarkState(
                word.id,
                wordStates.get(word.id) ?? null,
                roundResetWordIds
              )}
              showMeaning={showMeaning}
              isSelected={selectedWordId === word.id}
              onOpen={onOpen}
              onMark={onMark}
            />
          ))}
        </div>
      ) : (
        <div className="mn-mobile-word-empty">当前分类暂无单词。</div>
      )}
    </div>
  );
}

function MobileWordRow({
  word,
  markState,
  showMeaning,
  isSelected,
  onOpen,
  onMark
}: {
  word: LevelWordItem;
  markState: WordMarkState | null;
  showMeaning: boolean;
  isSelected: boolean;
  onOpen: (word: LevelWordItem) => void;
  onMark: (word: LevelWordItem, state: WordMarkState | null) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-level-word-id={word.id}
      onClick={() => onOpen(word)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(word);
        }
      }}
      className={cn("mn-mobile-word-row", isSelected && "mn-mobile-word-row-selected")}
    >
      <span className="mn-mobile-word-main">
        <span className="mn-mobile-word-title">{word.word}</span>
        <span className="mn-mobile-word-meaning">
          {showMeaning ? word.shortMeaningCn || word.meaningCn || "释义待补" : "••••••"}
        </span>
      </span>
      <MarkButtons
        word={word}
        markState={markState}
        onMark={onMark}
        className="mn-mobile-word-mark-buttons"
      />
    </div>
  );
}

function mobileMarkLabel(markState: WordMarkState) {
  if (markState === "KNOWN") return "熟";
  if (markState === "FUZZY") return "模糊";
  return "生词";
}

function MarkButtons({
  word,
  markState,
  onMark,
  className
}: {
  word: LevelWordItem;
  markState: WordMarkState | null;
  onMark: (word: LevelWordItem, state: WordMarkState | null) => void;
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
              "flex h-8 w-8 shrink-0 appearance-none items-center justify-center rounded-full border transition",
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

function MemoryCardMarkButtons({
  word,
  markState,
  onMark
}: {
  word: LevelWordItem;
  markState: WordMarkState | null;
  onMark: (state: WordMarkState) => void;
}) {
  const buttons = [
    {
      state: "KNOWN" as const,
      label: "熟悉",
      icon: Check,
      idle: "border-[#b9e5ce] bg-[#effaf3] text-[#168458]",
      active: "border-[#168458] bg-[#168458] text-white"
    },
    {
      state: "FUZZY" as const,
      label: "模糊",
      icon: Circle,
      idle: "border-[#ead38a] bg-[#fff8df] text-[#9a6a00]",
      active: "border-[#c08a00] bg-[#d89a00] text-white"
    },
    {
      state: "UNKNOWN" as const,
      label: "生词",
      icon: X,
      idle: "border-[#f1b8ad] bg-[#fff1ee] text-[#c2412d]",
      active: "border-[#c2412d] bg-[#c2412d] text-white"
    }
  ];

  return (
    <div className="mn-memory-card-mark-strip" data-memory-card-export-hidden="true">
      {buttons.map((button) => {
        const Icon = button.icon;
        const active = markState === button.state;
        return (
          <button
            key={button.state}
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onMark(button.state);
            }}
            aria-label={
              active ? `${word.word} 取消${button.label}标记` : `${word.word} 标记为${button.label}`
            }
            aria-pressed={active}
            data-mark-state={button.state}
            data-active={active ? "true" : "false"}
            title={active ? `取消${button.label}` : button.label}
            className={cn(
              "mn-memory-card-mark-button flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border transition",
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

export function MemoryCardTray({
  words,
  activeCardId,
  onActivate,
  onClose,
  onOpenLinkedWord,
  onWordUpdate,
  onCollectionMark,
  onNavigateWord,
  onKeyboardMark,
  onMnemonicCardDeleteUndoChange,
  isAuthenticated,
  defaultUserCardVisibility = "private",
  canEditOfficialCards = false,
  canExportMemoryCardImages = false,
  overlayClassName,
  onRequireLogin
}: {
  words: LevelWordItem[];
  activeCardId: string | null;
  onActivate: (wordId: string | null) => void;
  onClose: (wordId: string) => void;
  onOpenLinkedWord: (slug: string) => Promise<boolean>;
  onWordUpdate: (word: LevelWordItem) => void;
  onCollectionMark?: (word: LevelWordItem, state: WordMarkState | null) => void;
  onNavigateWord?: (word: LevelWordItem, direction: WordNavigationDirection) => void;
  onKeyboardMark?: (word: LevelWordItem, state: WordMarkState) => void;
  onMnemonicCardDeleteUndoChange?: (state: MnemonicCardDeleteUndoState) => void;
  isAuthenticated: boolean;
  defaultUserCardVisibility?: "private" | "public";
  canEditOfficialCards?: boolean;
  canExportMemoryCardImages?: boolean;
  overlayClassName?: string;
  onRequireLogin?: (message?: string) => void;
}) {
  const scrollLockRef = useRef<DocumentScrollLock | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [isWhiteCardMode, setIsWhiteCardMode] = useState(() => readMemoryCardWhiteMode());
  const toggleWhiteCardMode = useCallback(() => {
    setIsWhiteCardMode((value) => {
      const nextValue = !value;
      rememberMemoryCardWhiteMode(nextValue);
      return nextValue;
    });
  }, []);
  const showFullCardMode = useCallback(() => {
    rememberMemoryCardWhiteMode(false);
    setIsWhiteCardMode(false);
  }, []);
  const closeCard = (wordId: string) => {
    const remainingWords = words.filter((word) => word.id !== wordId);
    const activeCardWasClosed = activeCardId === wordId;
    const activeCardStillOpen = remainingWords.some((word) => word.id === activeCardId);
    const nextActiveCardId =
      activeCardWasClosed || !activeCardStillOpen ? (remainingWords[0]?.id ?? null) : activeCardId;

    onClose(wordId);
    if (nextActiveCardId !== activeCardId) {
      onActivate(nextActiveCardId);
    }
  };

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  const handleTrayKeyDown = useCallback(
    (event: KeyboardEvent | ReactKeyboardEvent<HTMLElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isTextEditingTarget(event.target)) return;
      if (!activeCardId && !words.length) return;

      const activeWord = words.find((word) => word.id === activeCardId) ?? words[0];
      if (!activeWord) return;

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (!onNavigateWord) return;
        const direction: WordNavigationDirection = event.key === "ArrowLeft" ? "previous" : "next";
        event.preventDefault();
        event.stopPropagation();
        onNavigateWord(activeWord, direction);
        return;
      }

      if (isSpaceShortcut(event) && !event.repeat && !isMobileCardGestureViewport()) {
        if (isInteractiveShortcutTarget(event.target) && !isLevelWordShortcutTarget(event.target))
          return;

        event.preventDefault();
        event.stopPropagation();
        toggleWhiteCardMode();
        return;
      }

      const shortcutState = keyboardMarkState(event);
      if (!shortcutState || event.repeat || !onKeyboardMark) return;

      event.preventDefault();
      event.stopPropagation();
      onKeyboardMark(activeWord, shortcutState);
      if (!isAuthenticated) onRequireLogin?.();
    },
    [
      activeCardId,
      isAuthenticated,
      onKeyboardMark,
      onNavigateWord,
      onRequireLogin,
      toggleWhiteCardMode,
      words
    ]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      handleTrayKeyDown(event);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [handleTrayKeyDown]);

  useEffect(() => {
    const scrollLock = lockDocumentScroll();
    scrollLockRef.current = scrollLock;

    const canMoveInsideCard = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest("[data-memory-card-scroll-area='true']"));
    const isInsideCard = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest("[data-memory-card-panel='true']"));
    const preventBackgroundMove = (event: WheelEvent | TouchEvent) => {
      if (canMoveInsideCard(event.target)) return;
      event.preventDefault();
    };
    const preventBackgroundScrollKeys = (event: KeyboardEvent) => {
      if (!isDocumentScrollKey(event) || isTextEditingTarget(event.target)) return;
      if (isInsideCard(event.target)) return;
      event.preventDefault();
    };

    window.addEventListener("wheel", preventBackgroundMove, { capture: true, passive: false });
    window.addEventListener("touchmove", preventBackgroundMove, { capture: true, passive: false });
    window.addEventListener("keydown", preventBackgroundScrollKeys, true);
    return () => {
      if (scrollLockRef.current === scrollLock) scrollLockRef.current = null;
      scrollLock.release();
      window.removeEventListener("wheel", preventBackgroundMove, true);
      window.removeEventListener("touchmove", preventBackgroundMove, true);
      window.removeEventListener("keydown", preventBackgroundScrollKeys, true);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !isMobileCardGestureViewport()) return;

    const root = document.documentElement;
    const visualViewport = window.visualViewport;
    let frameId = 0;

    const updateViewportVars = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const viewport = window.visualViewport;
        const viewportHeight = viewport?.height ?? window.innerHeight;
        const offsetTop = viewport?.offsetTop ?? 0;
        const offsetBottom = Math.max(0, window.innerHeight - viewportHeight - offsetTop);

        root.style.setProperty("--mn-card-visual-height", `${viewportHeight}px`);
        root.style.setProperty("--mn-card-visual-offset-top", `${offsetTop}px`);
        root.style.setProperty("--mn-card-visual-offset-bottom", `${offsetBottom}px`);
      });
    };

    updateViewportVars();
    visualViewport?.addEventListener("resize", updateViewportVars);
    visualViewport?.addEventListener("scroll", updateViewportVars);
    window.addEventListener("resize", updateViewportVars);
    window.addEventListener("orientationchange", updateViewportVars);

    return () => {
      window.cancelAnimationFrame(frameId);
      visualViewport?.removeEventListener("resize", updateViewportVars);
      visualViewport?.removeEventListener("scroll", updateViewportVars);
      window.removeEventListener("resize", updateViewportVars);
      window.removeEventListener("orientationchange", updateViewportVars);
      root.style.removeProperty("--mn-card-visual-height");
      root.style.removeProperty("--mn-card-visual-offset-top");
      root.style.removeProperty("--mn-card-visual-offset-bottom");
    };
  }, []);

  useEffect(() => {
    if (!activeCardId) return;
    if (isMobileCardGestureViewport()) return;
    scrollLockRef.current?.runWithUnlockedPage(() => focusLevelWordItem(activeCardId));
  }, [activeCardId]);

  const tray = (
    <div
      data-memory-card-tray="true"
      className={cn("pointer-events-auto fixed inset-0 z-50", overlayClassName)}
      onKeyDownCapture={handleTrayKeyDown}
    >
      <div className="mn-memory-card-backdrop absolute inset-0 bg-[#171a1f]/10 backdrop-blur-[1px] dark:bg-black/35" />
      <div className="absolute inset-0">
        {words.map((word, index) => (
          <MemoryCard
            key={word.id}
            word={word}
            index={index}
            isActive={activeCardId === word.id}
            isWhiteCard={isWhiteCardMode}
            onActivate={() => onActivate(word.id)}
            onToggleWhiteCard={toggleWhiteCardMode}
            onShowFullCard={showFullCardMode}
            onClose={() => closeCard(word.id)}
            onOpenLinkedWord={onOpenLinkedWord}
            onWordUpdate={onWordUpdate}
            onCollectionMark={onCollectionMark}
            onNavigatePrevious={onNavigateWord ? () => onNavigateWord(word, "previous") : undefined}
            onNavigateNext={onNavigateWord ? () => onNavigateWord(word, "next") : undefined}
            onKeyboardMark={onKeyboardMark ? (state) => onKeyboardMark(word, state) : undefined}
            onMnemonicCardDeleteUndoChange={onMnemonicCardDeleteUndoChange}
            isAuthenticated={isAuthenticated}
            defaultUserCardVisibility={defaultUserCardVisibility}
            canEditOfficialCards={canEditOfficialCards}
            canExportMemoryCardImages={canExportMemoryCardImages}
            onRequireLogin={onRequireLogin}
          />
        ))}
      </div>
    </div>
  );

  return portalRoot ? createPortal(tray, portalRoot) : tray;
}

function MemoryCard({
  word,
  index,
  isActive,
  isWhiteCard,
  onActivate,
  onToggleWhiteCard,
  onShowFullCard,
  onClose,
  onOpenLinkedWord,
  onWordUpdate,
  onCollectionMark,
  onNavigatePrevious,
  onNavigateNext,
  onKeyboardMark,
  onMnemonicCardDeleteUndoChange,
  isAuthenticated,
  defaultUserCardVisibility,
  canEditOfficialCards,
  canExportMemoryCardImages,
  onRequireLogin
}: {
  word: LevelWordItem;
  index: number;
  isActive: boolean;
  isWhiteCard: boolean;
  onActivate: () => void;
  onToggleWhiteCard: () => void;
  onShowFullCard: () => void;
  onClose: () => void;
  onOpenLinkedWord: (slug: string) => Promise<boolean>;
  onWordUpdate: (word: LevelWordItem) => void;
  onCollectionMark?: (word: LevelWordItem, state: WordMarkState | null) => void;
  onNavigatePrevious?: () => void;
  onNavigateNext?: () => void;
  onKeyboardMark?: (state: WordMarkState) => void;
  onMnemonicCardDeleteUndoChange?: (state: MnemonicCardDeleteUndoState) => void;
  isAuthenticated: boolean;
  defaultUserCardVisibility: "private" | "public";
  canEditOfficialCards: boolean;
  canExportMemoryCardImages: boolean;
  onRequireLogin?: (message?: string) => void;
}) {
  const mnemonicCards = useMemo(
    () => (word.mnemonics.length ? word.mnemonics : word.mnemonic ? [word.mnemonic] : []),
    [word.mnemonic, word.mnemonics]
  );
  const [activeMnemonicId, setActiveMnemonicId] = useState(() => mnemonicCards[0]?.id ?? "");
  const [isEditing, setIsEditing] = useState(false);
  const [editingMnemonicId, setEditingMnemonicId] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState(() => defaultCustomCardTemplate(word.word));
  const [isEditingMeaning, setIsEditingMeaning] = useState(false);
  const [meaningDraft, setMeaningDraft] = useState(() => word.meaningCn || "");
  const [isSavingMeaning, setIsSavingMeaning] = useState(false);
  const [draftVisibility, setDraftVisibility] = useState<"private" | "public">(
    defaultUserCardVisibility
  );
  const [relatedWords, setRelatedWords] = useState("");
  const [editorMessage, setEditorMessage] = useState("");
  const [isSavingCard, setIsSavingCard] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isExportingImage, setIsExportingImage] = useState(false);
  const [isBookmarking, setIsBookmarking] = useState(false);
  const [reactingCardId, setReactingCardId] = useState<string | null>(null);
  const [isBookmarkMenuOpen, setIsBookmarkMenuOpen] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>("idle");
  const [deletedHistory, setDeletedHistory] = useState<DeletedMnemonicCard[]>([]);
  const [isMobileCardLayout, setIsMobileCardLayout] = useState(
    () => typeof window !== "undefined" && window.matchMedia(mobileCardViewportQuery).matches
  );
  const [position, setPosition] = useState<MemoryCardPosition>({
    x: index * 30,
    y: index * 26
  });
  const articleRef = useRef<HTMLElement>(null);
  const whiteWordRef = useRef<HTMLSpanElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const bookmarkMenuRef = useRef<HTMLDivElement>(null);
  const pronunciationAudioRef = useRef<HTMLAudioElement | null>(null);
  const restoreLastDeletedRef = useRef<() => void | Promise<void>>(() => undefined);
  const lastAutoSavedSignatureRef = useRef("");
  const autoSaveRunRef = useRef(0);
  const dragRef = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0
  });
  const activeMnemonic =
    mnemonicCards.find((card) => card.id === activeMnemonicId) ?? mnemonicCards[0] ?? null;
  const activeMnemonicIsPublic = activeMnemonic
    ? isPubliclyReactableMnemonic(activeMnemonic)
    : false;
  const collectionMarkState =
    word.markState === "FUZZY" || word.markState === "UNKNOWN" ? word.markState : null;
  const editingCard = editingMnemonicId
    ? (mnemonicCards.find((card) => card.id === editingMnemonicId) ?? null)
    : null;
  const effectiveCanEditOfficialCards = canEditOfficialCards || Boolean(word.canEditOfficialCards);
  const effectiveCanExportMemoryCardImages =
    canExportMemoryCardImages || Boolean(word.canExportMemoryCardImages);
  const showDraftVisibilityChoice =
    isAuthenticated &&
    !effectiveCanEditOfficialCards &&
    (!editingCard || editingCard.sourceType !== "OFFICIAL");
  const saveCardLabel = effectiveCanEditOfficialCards ? "保存官方记忆卡" : "保存记忆卡";
  const isEditingAny = isEditing || isEditingMeaning;
  const isSavingCurrentEdit = isEditingMeaning ? isSavingMeaning : isSavingCard;
  const saveCurrentEditLabel = isEditingMeaning ? "保存中文释义" : saveCardLabel;
  const cancelCurrentEditLabel = isEditingMeaning ? "放弃中文释义修改" : "退出编辑，保留草稿";
  const editSaveVisibility = effectiveCanEditOfficialCards ? "public" : draftVisibility;
  const editSignature = useCallback(
    (entryId: string | null = editingMnemonicId) =>
      isEditingMeaning
        ? `meaning:${meaningDraft.trim()}`
        : `card:${entryId ?? "new"}:${editSaveVisibility}:${draftContent}:${relatedWords}`,
    [
      draftContent,
      editSaveVisibility,
      editingMnemonicId,
      isEditingMeaning,
      meaningDraft,
      relatedWords
    ]
  );
  const autoSaveLabel = autoSaveStatusLabel(autoSaveStatus);
  const whiteCardToggleLabel = isWhiteCard ? "显示完整单词卡" : "切换到白卡";
  const requireLogin = useCallback(
    (message = LOGIN_REQUIRED_INTERACTION_MESSAGE) => {
      setIsBookmarkMenuOpen(false);
      setEditorMessage(message);
      onRequireLogin?.(message);
    },
    [onRequireLogin]
  );
  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      isTextEditingTarget(event.target)
    )
      return;

    if (event.key === "ArrowLeft" && onNavigatePrevious) {
      event.preventDefault();
      event.stopPropagation();
      onNavigatePrevious();
      return;
    }

    if (event.key === "ArrowRight" && onNavigateNext) {
      event.preventDefault();
      event.stopPropagation();
      onNavigateNext();
      return;
    }

    const shortcutState = keyboardMarkState(event);
    if (!shortcutState || event.repeat || !onKeyboardMark) return;

    event.preventDefault();
    event.stopPropagation();
    onKeyboardMark(shortcutState);
  };

  useEffect(() => {
    if (!mnemonicCards.length) {
      setActiveMnemonicId("");
      return;
    }
    if (!mnemonicCards.some((card) => card.id === activeMnemonicId)) {
      setActiveMnemonicId(mnemonicCards[0].id);
    }
  }, [activeMnemonicId, mnemonicCards]);

  useLayoutEffect(() => {
    const media = window.matchMedia(mobileCardViewportQuery);
    const syncMobileLayout = () => setIsMobileCardLayout(media.matches);

    syncMobileLayout();
    media.addEventListener("change", syncMobileLayout);
    return () => media.removeEventListener("change", syncMobileLayout);
  }, []);

  useEffect(() => {
    if (!isEditingMeaning) setMeaningDraft(word.meaningCn || "");
  }, [isEditingMeaning, word.meaningCn]);

  useEffect(() => {
    if (isEditingAny) onShowFullCard();
  }, [isEditingAny, onShowFullCard]);

  useEffect(() => {
    if (!isActive || isEditingAny) return;

    const frameId = window.requestAnimationFrame(() => {
      articleRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isActive, isEditingAny, word.id]);

  const constrainPositionToViewport = useCallback(() => {
    if (isMobileCardGestureViewport()) return;
    setPosition((current) => {
      const next = constrainMemoryCardPosition(current, current, articleRef.current);
      return sameMemoryCardPosition(current, next) ? current : next;
    });
  }, []);

  useEffect(() => {
    if (!isActive || isMobileCardGestureViewport()) return;

    const frameId = window.requestAnimationFrame(constrainPositionToViewport);
    const element = articleRef.current;
    const observer =
      typeof ResizeObserver !== "undefined" && element
        ? new ResizeObserver(() => constrainPositionToViewport())
        : null;

    if (element) observer?.observe(element);
    window.addEventListener("resize", constrainPositionToViewport);
    return () => {
      window.cancelAnimationFrame(frameId);
      observer?.disconnect();
      window.removeEventListener("resize", constrainPositionToViewport);
    };
  }, [constrainPositionToViewport, isActive, word.id]);

  useEffect(() => {
    if (!isBookmarkMenuOpen) return;

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && bookmarkMenuRef.current?.contains(target)) return;
      setIsBookmarkMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsBookmarkMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isBookmarkMenuOpen]);

  useEffect(() => {
    if (!isActive || isEditingAny || isBookmarkMenuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      )
        return;

      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, isBookmarkMenuOpen, isEditingAny, onClose]);

  useEffect(() => {
    if (!isEditing) return;
    saveMemoryCardDraft(
      word.id,
      editingMnemonicId,
      draftContent,
      relatedWords,
      draftVisibility,
      editingCard?.updatedAt ?? ""
    );
  }, [
    draftContent,
    draftVisibility,
    editingCard?.updatedAt,
    editingMnemonicId,
    isEditing,
    relatedWords,
    word.id
  ]);

  useEffect(() => {
    if (!isEditingAny) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isEditingAny]);

  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if (isMobileCardGestureViewport()) return;
    onActivate();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const drag = (event: PointerEvent<HTMLElement>) => {
    if (isMobileCardGestureViewport()) return;
    if (dragRef.current.pointerId !== event.pointerId) return;
    const nextPosition = {
      x: dragRef.current.originX + event.clientX - dragRef.current.startX,
      y: dragRef.current.originY + event.clientY - dragRef.current.startY
    };
    setPosition((current) =>
      constrainMemoryCardPosition(nextPosition, current, articleRef.current)
    );
  };

  const stopDrag = (event: PointerEvent<HTMLElement>) => {
    if (isMobileCardGestureViewport()) return;
    if (dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current.pointerId = -1;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    constrainPositionToViewport();
  };
  const articleStyle: CSSProperties = isMobileCardLayout
    ? {
        bottom:
          "calc(var(--mn-card-visual-offset-bottom, 0px) + var(--mn-mobile-card-edge-bottom, max(12px, env(safe-area-inset-bottom))))",
        height: "auto",
        left: "50%",
        maxHeight: "none",
        top:
          "calc(var(--mn-card-visual-offset-top, 0px) + var(--mn-mobile-card-edge-top, max(10px, env(safe-area-inset-top))))",
        transform: "translateX(-50%)",
        zIndex: isActive ? 70 : 60 - index
      }
    : {
        transform: `translate(calc(-50% + ${position.x}px), ${position.y}px)`,
        zIndex: isActive ? 70 : 60 - index
      };
  const handleMnemonicClick = async (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest("a") : null;
    const href = target?.getAttribute("href");
    if (!href?.startsWith("/word/")) return;
    const slug = decodeURIComponent(href.replace("/word/", "").split(/[?#]/)[0] ?? "");
    if (!slug) return;

    event.preventDefault();
    event.stopPropagation();
    await onOpenLinkedWord(slug);
  };
  const playPronunciation = async () => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();

    const audioUrls = uniqueStrings([
      word.audioUsUrl,
      word.audioUkUrl,
      ...pronunciationAudioCandidates(word.word)
    ]);
    for (const audioUrl of audioUrls) {
      try {
        await playAudioUrl(audioUrl, pronunciationAudioRef);
        return;
      } catch {
        // Try the next pronunciation source.
      }
    }

    speakWord(word.word);
  };
  const startNewCard = () => {
    if (isEditingMeaning) return;
    if (!isAuthenticated) {
      requireLogin("草稿会临时保存在本机。未登录数据可能会丢失，登录或注册后再提交。");
    }

    const savedDraft = readMemoryCardDraft(word.id, null);
    const nextVisibility = savedDraft?.visibility ?? defaultUserCardVisibility;
    const nextContent = savedDraft?.content ?? defaultCustomCardTemplate(word.word);
    const nextRelatedWords = savedDraft?.relatedWords ?? "";
    setEditingMnemonicId(null);
    setDraftVisibility(nextVisibility);
    setDraftContent(nextContent);
    setRelatedWords(nextRelatedWords);
    setEditorMessage(savedDraft ? "已恢复未保存草稿。" : "");
    lastAutoSavedSignatureRef.current = savedDraft
      ? ""
      : `card:new:${effectiveCanEditOfficialCards ? "public" : nextVisibility}:${nextContent}:${nextRelatedWords}`;
    setAutoSaveStatus("idle");
    setIsEditing(true);
  };
  const startEditCard = (entryId: string) => {
    if (isEditingMeaning || isSavingCard || isUploadingImage || isSavingMeaning) return;
    const card = mnemonicCards.find((item) => item.id === entryId);
    if (!card) return;
    if (!card.canEdit) {
      setActiveMnemonicId(card.id);
      if (!isAuthenticated) {
        requireLogin("可以先新建本地草稿。公开卡不能直接改，登录或注册后可保存自己的记忆卡。");
      } else {
        setEditorMessage(cardPermissionMessage(card));
      }
      return;
    }

    const savedDraft = usableMemoryCardDraft(word.id, entryId, card);
    const nextVisibility =
      savedDraft?.visibility ?? (card.sourceType === "USER_PUBLIC" ? "public" : "private");
    const nextContent = savedDraft?.content ?? editableMnemonicContent(card);
    const nextRelatedWords = savedDraft?.relatedWords ?? relatedWordText(card.contentMarkdown);
    setActiveMnemonicId(card.id);
    setEditingMnemonicId(card.id);
    setDraftVisibility(nextVisibility);
    setDraftContent(nextContent);
    setRelatedWords(nextRelatedWords);
    setEditorMessage(savedDraft ? "已恢复未保存草稿。" : "");
    lastAutoSavedSignatureRef.current = savedDraft
      ? ""
      : `card:${card.id}:${effectiveCanEditOfficialCards ? "public" : nextVisibility}:${nextContent}:${nextRelatedWords}`;
    setAutoSaveStatus(savedDraft ? "pending" : "idle");
    setIsEditing(true);
  };
  const cancelNewCard = () => {
    if (isSavingCard || isUploadingImage) return;
    setEditingMnemonicId(null);
    setDraftVisibility(defaultUserCardVisibility);
    setDraftContent(defaultCustomCardTemplate(word.word));
    setRelatedWords("");
    setEditorMessage("未保存草稿已保留，下次编辑会自动恢复。");
    setAutoSaveStatus("idle");
    setIsEditing(false);
  };
  const startEditMeaning = () => {
    if (isEditingAny || isSavingCard || isUploadingImage || isSavingMeaning) return;
    if (!effectiveCanEditOfficialCards) {
      setEditorMessage("中文释义只能由编辑员修改。");
      return;
    }

    setMeaningDraft(word.meaningCn || "");
    setEditorMessage("");
    lastAutoSavedSignatureRef.current = `meaning:${(word.meaningCn || "").trim()}`;
    setAutoSaveStatus("idle");
    setIsEditingMeaning(true);
  };
  const cancelMeaningEdit = () => {
    if (isSavingMeaning) return;
    setMeaningDraft(word.meaningCn || "");
    setEditorMessage("已放弃中文释义修改。");
    setAutoSaveStatus("idle");
    setIsEditingMeaning(false);
  };
  const autoSaveCurrentEdit = useCallback(
    async (signature: string) => {
      if (!isEditingAny || isUploadingImage) return;
      const runId = ++autoSaveRunRef.current;

      if (isEditingMeaning) {
        const nextMeaning = meaningDraft.trim();
        if (!nextMeaning) return;

        setIsSavingMeaning(true);
        setAutoSaveStatus("saving");
        try {
          const result = await updateWordMeaning(word.slug, nextMeaning);
          if (runId !== autoSaveRunRef.current) return;
          if (result.word) onWordUpdate(result.word);
          lastAutoSavedSignatureRef.current = signature;
          setAutoSaveStatus("saved");
          setEditorMessage("已自动保存。");
        } catch (error) {
          if (runId !== autoSaveRunRef.current) return;
          setAutoSaveStatus("error");
          setEditorMessage(error instanceof Error ? error.message : "自动保存失败。");
        } finally {
          if (runId === autoSaveRunRef.current) setIsSavingMeaning(false);
        }
        return;
      }

      if (!isEditing) return;
      const finalContent = withRelatedWordLinks(draftContent, relatedWords);
      if (!finalContent.trim()) return;

      setIsSavingCard(true);
      setAutoSaveStatus("saving");
      const draftEntryId = editingMnemonicId;
      try {
        const result = draftEntryId
          ? await updateMnemonicCard(word.slug, draftEntryId, finalContent, editSaveVisibility)
          : await saveMnemonicCard(word.slug, finalContent, editSaveVisibility);
        if (runId !== autoSaveRunRef.current) return;
        if (result.word) onWordUpdate(result.word);
        clearMemoryCardDraft(word.id, draftEntryId);
        setActiveMnemonicId(result.activeEntryId);
        if (!draftEntryId) setEditingMnemonicId(result.activeEntryId);
        lastAutoSavedSignatureRef.current = draftEntryId
          ? signature
          : editSignature(result.activeEntryId);
        setAutoSaveStatus("saved");
        setEditorMessage("已自动保存。");
      } catch (error) {
        if (runId !== autoSaveRunRef.current) return;
        setAutoSaveStatus("error");
        setEditorMessage(error instanceof Error ? error.message : "自动保存失败。");
      } finally {
        if (runId === autoSaveRunRef.current) setIsSavingCard(false);
      }
    },
    [
      draftContent,
      editSaveVisibility,
      editSignature,
      editingMnemonicId,
      isEditing,
      isEditingAny,
      isEditingMeaning,
      isUploadingImage,
      meaningDraft,
      onWordUpdate,
      relatedWords,
      word.id,
      word.slug
    ]
  );
  useEffect(() => {
    if (!isEditingAny) {
      setAutoSaveStatus("idle");
      return;
    }
    if (isSavingCurrentEdit || isUploadingImage) return;

    const signature = editSignature();
    if (signature === lastAutoSavedSignatureRef.current) {
      setAutoSaveStatus((current) => (current === "pending" ? "idle" : current));
      return;
    }

    const hasSavableContent = isEditingMeaning
      ? Boolean(meaningDraft.trim())
      : Boolean(withRelatedWordLinks(draftContent, relatedWords).trim());
    if (!hasSavableContent) {
      setAutoSaveStatus("idle");
      return;
    }

    setAutoSaveStatus("pending");
    const timer = window.setTimeout(() => {
      void autoSaveCurrentEdit(signature);
    }, mnemonicCardAutoSaveDelayMs);

    return () => window.clearTimeout(timer);
  }, [
    autoSaveCurrentEdit,
    draftContent,
    editSignature,
    isEditingAny,
    isEditingMeaning,
    isSavingCurrentEdit,
    isUploadingImage,
    meaningDraft,
    relatedWords
  ]);
  const saveMeaning = async () => {
    if (isSavingMeaning) return;
    const nextMeaning = meaningDraft.trim();
    if (!nextMeaning) {
      setEditorMessage("中文释义不能为空。");
      return;
    }

    setIsSavingMeaning(true);
    setAutoSaveStatus("saving");
    setEditorMessage("");
    try {
      const result = await updateWordMeaning(word.slug, nextMeaning);
      if (result.word) onWordUpdate(result.word);
      lastAutoSavedSignatureRef.current = editSignature();
      setAutoSaveStatus("saved");
      setIsEditingMeaning(false);
      setEditorMessage("手动保存成功。");
    } catch (error) {
      setAutoSaveStatus("error");
      setEditorMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setIsSavingMeaning(false);
    }
  };
  const chooseBookmarkMark = async (state: Extract<WordMarkState, "FUZZY" | "UNKNOWN"> | null) => {
    if (isBookmarking) return;

    setIsBookmarking(true);
    setIsBookmarkMenuOpen(false);
    setEditorMessage("");
    try {
      if (onCollectionMark) {
        await onCollectionMark(word, state);
      } else {
        const result = await setWordCollectionMark(word.id, state, isAuthenticated);
        onWordUpdate({ ...word, isBookmarked: result.isBookmarked, markState: result.markState });
      }
      if (!isAuthenticated) requireLogin();
    } catch (error) {
      setEditorMessage(error instanceof Error ? error.message : "标记失败。");
    } finally {
      setIsBookmarking(false);
    }
  };
  const reactToActiveMnemonic = async (reaction: "LIKE" | "DISLIKE") => {
    if (!activeMnemonic || reactingCardId) return;
    if (!isAuthenticated) {
      const nextReaction = saveGuestMnemonicReaction(word.id, activeMnemonic.id, reaction);
      const updatedMnemonics = mnemonicCards.map((card) =>
        card.id === activeMnemonic.id
          ? applyGuestReactionToMnemonic(card, activeMnemonic.userVoteType, nextReaction)
          : card
      );
      onWordUpdate({ ...word, mnemonic: updatedMnemonics[0] ?? null, mnemonics: updatedMnemonics });
      setActiveMnemonicId(activeMnemonic.id);
      requireLogin();
      return;
    }
    if (!activeMnemonicIsPublic) return;

    setReactingCardId(activeMnemonic.id);
    setEditorMessage("");
    try {
      const result = await reactToMnemonicCard(word.slug, activeMnemonic.id, reaction);
      if (result.word) onWordUpdate(result.word);
      setActiveMnemonicId(result.activeEntryId);
    } catch (error) {
      setEditorMessage(error instanceof Error ? error.message : "操作失败。");
    } finally {
      setReactingCardId(null);
    }
  };
  const markCurrentWordFromCard = (state: WordMarkState) => {
    const nextState = word.markState === state ? null : state;
    if (onCollectionMark) {
      void onCollectionMark(word, nextState);
      return;
    }

    onKeyboardMark?.(state);
  };
  const saveNewCard = async () => {
    if (isEditingMeaning || isSavingCard) return;
    if (!isAuthenticated) {
      requireLogin("草稿已临时保存在本机。未登录数据可能会丢失，登录或注册后再提交。");
      return;
    }

    const finalContent = withRelatedWordLinks(draftContent, relatedWords);
    if (!finalContent.trim()) {
      setEditorMessage("记忆卡内容不能为空。");
      return;
    }

    setIsSavingCard(true);
    setAutoSaveStatus("saving");
    setEditorMessage("");
    const draftEntryId = editingMnemonicId;
    try {
      const result = editingMnemonicId
        ? await updateMnemonicCard(word.slug, editingMnemonicId, finalContent, editSaveVisibility)
        : await saveMnemonicCard(word.slug, finalContent, editSaveVisibility);
      if (result.word) onWordUpdate(result.word);
      clearMemoryCardDraft(word.id, draftEntryId);
      lastAutoSavedSignatureRef.current = draftEntryId
        ? editSignature()
        : editSignature(result.activeEntryId);
      setActiveMnemonicId(result.activeEntryId);
      setEditingMnemonicId(null);
      setDraftVisibility(defaultUserCardVisibility);
      setDraftContent(defaultCustomCardTemplate(word.word));
      setRelatedWords("");
      setAutoSaveStatus("saved");
      setIsEditing(false);
      setEditorMessage("手动保存成功。");
    } catch (error) {
      setAutoSaveStatus("error");
      setEditorMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setIsSavingCard(false);
    }
  };
  const promoteCard = async (entryId: string) => {
    if (isEditingAny || isSavingCard || isSavingMeaning) return;
    if (!isAuthenticated) {
      const targetCard = mnemonicCards.find((item) => item.id === entryId);
      if (!targetCard) return;
      const reorderedCards = [targetCard, ...mnemonicCards.filter((item) => item.id !== entryId)];
      saveGuestMnemonicCardOrder(
        word.id,
        reorderedCards.map((item) => item.id)
      );
      onWordUpdate({ ...word, mnemonic: reorderedCards[0] ?? null, mnemonics: reorderedCards });
      setActiveMnemonicId(entryId);
      requireLogin();
      return;
    }
    const card = mnemonicCards.find((item) => item.id === entryId);
    if (card && !card.canEdit && card.sourceType !== "OFFICIAL") {
      setActiveMnemonicId(card.id);
      setEditorMessage(cardPermissionMessage(card));
      return;
    }

    setEditorMessage("");
    try {
      const result = await promoteMnemonicCard(word.slug, entryId);
      if (result.word) onWordUpdate(result.word);
      setActiveMnemonicId(result.activeEntryId);
    } catch (error) {
      setEditorMessage(error instanceof Error ? error.message : "排序失败。");
    }
  };
  const restoreLastDeleted = useCallback(async () => {
    const lastDeleted = deletedHistory.at(-1);
    if (!lastDeleted || isEditingAny || isSavingCard || isSavingMeaning) return;

    setIsSavingCard(true);
    setEditorMessage("正在撤销删除...");
    try {
      const result = await restoreMnemonicCard(
        word.slug,
        lastDeleted.card.id,
        lastDeleted.previousIndex
      );
      if (result.word) onWordUpdate(result.word);
      setActiveMnemonicId(result.activeEntryId);
      setDeletedHistory((current) => current.slice(0, -1));
      setEditorMessage("");
    } catch (error) {
      setEditorMessage(error instanceof Error ? error.message : "撤销失败。");
    } finally {
      setIsSavingCard(false);
    }
  }, [deletedHistory, isEditingAny, isSavingCard, isSavingMeaning, onWordUpdate, word.slug]);
  useEffect(() => {
    restoreLastDeletedRef.current = restoreLastDeleted;
  }, [restoreLastDeleted]);
  const deleteCard = async (entryId: string, previousIndex: number) => {
    if (isEditingAny || isSavingCard || isSavingMeaning) return;
    const deletedCard = mnemonicCards.find((card) => card.id === entryId);
    if (!deletedCard) return;
    if (!deletedCard.canEdit) {
      setActiveMnemonicId(deletedCard.id);
      setEditorMessage(cardPermissionMessage(deletedCard));
      return;
    }

    const remainingCards = mnemonicCards.filter((card) => card.id !== entryId);
    const fallbackActiveId =
      remainingCards[Math.min(previousIndex, Math.max(remainingCards.length - 1, 0))]?.id ?? "";
    const nextActiveId = activeMnemonicId === entryId ? fallbackActiveId : activeMnemonicId;
    const previousWord = word;

    onWordUpdate({ ...word, mnemonic: remainingCards[0] ?? null, mnemonics: remainingCards });
    setActiveMnemonicId(nextActiveId);
    setIsSavingCard(true);
    setEditorMessage("已删除，按 ⌘Z / Ctrl+Z 可撤销。");
    try {
      const result = await deleteMnemonicCard(word.slug, entryId);
      if (result.word) onWordUpdate(result.word);
      setActiveMnemonicId(result.activeEntryId);
      setDeletedHistory((current) => [...current, { card: deletedCard, previousIndex }]);
      setEditorMessage("已删除，按 ⌘Z / Ctrl+Z 可撤销。");
    } catch (error) {
      onWordUpdate(previousWord);
      setActiveMnemonicId(activeMnemonicId);
      setEditorMessage(error instanceof Error ? error.message : "删除失败。");
    } finally {
      setIsSavingCard(false);
    }
  };
  const isPointInsideCard = (clientX: number, clientY: number) => {
    const rect = articleRef.current?.getBoundingClientRect();
    if (!rect) return true;
    return (
      clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    );
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      const isSystemUndo =
        (event.metaKey || event.ctrlKey) && key === "z" && !event.shiftKey && !event.altKey;
      const isPanelUndo =
        event.shiftKey && key === "r" && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!isSystemUndo && !isPanelUndo) return;
      if (!deletedHistory.length || isEditingAny) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      )
        return;

      event.preventDefault();
      void restoreLastDeleted();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deletedHistory.length, isEditingAny, restoreLastDeleted]);

  useEffect(() => {
    onMnemonicCardDeleteUndoChange?.({
      wordId: word.id,
      canUndo: deletedHistory.length > 0 && !isEditingAny && !isSavingCard && !isSavingMeaning,
      restore: () => restoreLastDeletedRef.current()
    });

    return () => {
      onMnemonicCardDeleteUndoChange?.({
        wordId: word.id,
        canUndo: false,
        restore: () => undefined
      });
    };
  }, [
    deletedHistory.length,
    isEditingAny,
    isSavingCard,
    isSavingMeaning,
    onMnemonicCardDeleteUndoChange,
    word.id
  ]);

  useLayoutEffect(() => {
    if (!isWhiteCard) return;

    const panel = articleRef.current;
    const whiteWord = whiteWordRef.current;
    if (!panel || !whiteWord) return;

    let animationFrame = 0;
    const updateWhiteWordScale = () => {
      const panelWidth = panel.getBoundingClientRect().width;
      const availableWidth = Math.max(160, panelWidth - 48);
      const naturalWidth = whiteWord.scrollWidth || whiteWord.getBoundingClientRect().width;
      const scale = naturalWidth > availableWidth ? Math.max(0.32, availableWidth / naturalWidth) : 1;
      whiteWord.style.setProperty("--mn-white-card-word-scale", scale.toFixed(3));
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateWhiteWordScale);
    };

    scheduleUpdate();
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleUpdate) : null;
    resizeObserver?.observe(panel);
    resizeObserver?.observe(whiteWord);
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      whiteWord.style.removeProperty("--mn-white-card-word-scale");
    };
  }, [isWhiteCard, word.word]);

  const uploadDraftImage = async (file: File) => {
    setIsUploadingImage(true);
    setEditorMessage("正在保存图片...");
    try {
      const formData = new FormData();
      formData.append("image", file, file.name || "memory-card-image.png");
      const response = await fetch("/api/uploads/image", { method: "POST", body: formData });
      const result = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error || "图片上传失败。");
      setDraftContent((current) => `${current.trimEnd()}\n\n![记忆图](${result.url})\n`);
      setEditorMessage("图片已插入。");
    } catch (error) {
      setEditorMessage(error instanceof Error ? error.message : "图片上传失败。");
    } finally {
      setIsUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };
  const exportCurrentCardImage = async () => {
    if (!articleRef.current || isExportingImage || isEditingAny) return;

    setIsExportingImage(true);
    setEditorMessage("正在生成完整卡片图片...");
    try {
      const blob = await exportMemoryCardElementToPng(articleRef.current);
      downloadBlob(blob, memoryCardImageFilename(word.word));
      setEditorMessage("已导出完整卡片图片。");
    } catch (error) {
      setEditorMessage(error instanceof Error ? error.message : "导出图片失败。");
    } finally {
      setIsExportingImage(false);
    }
  };

  return (
    <article
      ref={articleRef}
      tabIndex={-1}
      data-memory-card-panel="true"
      className={cn(
        "mn-memory-card-panel pointer-events-auto fixed left-1/2 top-20 isolate flex max-h-[calc(100vh-7rem)] w-[min(640px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-[#e5e5e7] bg-white opacity-100 shadow-[0_24px_80px_rgba(23,26,31,0.16)] outline-none dark:border-border dark:bg-[#1c1c1e]",
        isWhiteCard && "mn-memory-card-panel-white"
      )}
      style={articleStyle}
      onPointerDown={() => onActivate()}
      onKeyDownCapture={handleCardKeyDown}
    >
      <header
        className="flex shrink-0 cursor-move touch-none items-start justify-between gap-4 border-b border-[#f0f0f2] bg-white p-5 dark:border-border dark:bg-[#1c1c1e]"
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        {isWhiteCard ? (
          <div className="min-w-0" />
        ) : (
          <div className="min-w-0">
            <h2
              className="cursor-text select-text truncate text-4xl font-semibold tracking-normal text-[#171a1f] dark:text-foreground"
              onPointerDown={(event) => {
                onActivate();
                if (!isMobileCardGestureViewport()) event.stopPropagation();
              }}
            >
              {word.word}
            </h2>
            <div className="mt-2 flex items-center gap-2">
              <p className="min-w-0 truncate text-sm text-[#69717f] dark:text-muted-foreground">
                {[word.phonetic, word.partOfSpeech].filter(Boolean).join(" · ") || "单词信息"}
              </p>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void playPronunciation();
                }}
                aria-label={`播放 ${word.word} 的读音`}
                title="播放读音"
                data-memory-card-export-hidden="true"
                className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
              >
                <Volume2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {!isEditingAny && (onKeyboardMark || onCollectionMark) ? (
              <MemoryCardMarkButtons
                word={word}
                markState={word.markState ?? null}
                onMark={markCurrentWordFromCard}
              />
            ) : null}
          </div>
        )}
        <div
          className="flex shrink-0 flex-col items-end gap-2"
          data-memory-card-export-hidden="true"
        >
          <div className="flex items-center gap-2">
            {isEditingAny ? (
              <>
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    void (isEditingMeaning ? saveMeaning() : saveNewCard());
                  }}
                  disabled={isSavingCurrentEdit || isUploadingImage}
                  aria-label={saveCurrentEditLabel}
                  title={saveCurrentEditLabel}
                  className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#b9e5ce] bg-[#effaf3] text-[#168458] transition hover:border-[#168458] disabled:pointer-events-none disabled:opacity-50 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
                >
                  {isSavingCurrentEdit ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (isEditingMeaning) {
                      cancelMeaningEdit();
                    } else {
                      cancelNewCard();
                    }
                  }}
                  disabled={isSavingCurrentEdit || isUploadingImage}
                  aria-label={cancelCurrentEditLabel}
                  title={cancelCurrentEditLabel}
                  className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#f1b8ad] bg-[#fff1ee] text-[#c2412d] transition hover:border-[#c2412d] disabled:pointer-events-none disabled:opacity-50 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleWhiteCard();
                  }}
                  aria-pressed={isWhiteCard}
                  aria-label={whiteCardToggleLabel}
                  title={whiteCardToggleLabel}
                  className="mn-memory-card-view-toggle flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-[#d8dde6] px-3 text-sm font-semibold text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
                >
                  {isWhiteCard ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  <span>{isWhiteCard ? "完整" : "白卡"}</span>
                </button>
                {isWhiteCard ? null : (
                  <>
                    <div ref={bookmarkMenuRef} className="mn-memory-card-desktop-action relative">
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (collectionMarkState) {
                            void chooseBookmarkMark(null);
                            return;
                          }
                          setIsBookmarkMenuOpen((value) => !value);
                        }}
                        disabled={isBookmarking}
                        aria-expanded={isBookmarkMenuOpen}
                        aria-label={collectionMarkState ? "取消收藏标记" : "选择加入不熟或陌生"}
                        title={collectionMarkState ? "取消收藏标记" : "加入不熟或陌生"}
                        className={cn(
                          "flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border transition disabled:pointer-events-none disabled:opacity-60",
                          collectionMarkState
                            ? "border-[#e7c766] bg-[#fff8df] text-[#d89a00] hover:border-[#d89a00] dark:border-yellow-800/70 dark:bg-yellow-950/30 dark:text-yellow-300"
                            : "border-[#d8dde6] text-[#69717f] hover:border-[#171a1f] hover:text-[#171a1f] dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
                        )}
                      >
                        {isBookmarking ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Star
                            className={cn("h-4 w-4", collectionMarkState ? "fill-current" : "")}
                          />
                        )}
                      </button>
                      {isBookmarkMenuOpen ? (
                        <div
                          className="absolute right-0 top-11 z-[80] flex flex-col gap-2 rounded-lg border border-[#d8dde6] bg-white p-2 shadow-lg dark:border-border dark:bg-card"
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void chooseBookmarkMark("FUZZY");
                            }}
                            disabled={isBookmarking}
                            aria-label="加入不熟单词"
                            aria-pressed={collectionMarkState === "FUZZY"}
                            title="加入不熟"
                            className={cn(
                              "flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border transition disabled:pointer-events-none disabled:opacity-60",
                              collectionMarkState === "FUZZY"
                                ? "border-[#c08a00] bg-[#d89a00] text-white"
                                : "border-[#ead38a] bg-[#fff8df] text-[#9a6a00] hover:border-[#c08a00]"
                            )}
                          >
                            <Circle className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void chooseBookmarkMark("UNKNOWN");
                            }}
                            disabled={isBookmarking}
                            aria-label="加入陌生单词"
                            aria-pressed={collectionMarkState === "UNKNOWN"}
                            title="加入陌生"
                            className={cn(
                              "flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border transition disabled:pointer-events-none disabled:opacity-60",
                              collectionMarkState === "UNKNOWN"
                                ? "border-[#c2412d] bg-[#c2412d] text-white"
                                : "border-[#f1b8ad] bg-[#fff1ee] text-[#c2412d] hover:border-[#c2412d]"
                            )}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        startNewCard();
                      }}
                      aria-label="新增记忆卡"
                      title="新增记忆卡"
                      className="mn-memory-card-desktop-action flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        startNewCard();
                      }}
                      aria-label="新增记忆卡"
                      title="新增记忆卡"
                      className="mn-memory-card-mobile-action h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] dark:border-border dark:text-muted-foreground dark:hover:border-foreground"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {effectiveCanExportMemoryCardImages ? (
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          void exportCurrentCardImage();
                        }}
                        disabled={isExportingImage || isSavingCard || isSavingMeaning}
                        aria-label="导出完整单词卡图片"
                        title="导出完整单词卡图片"
                        className="mn-memory-card-desktop-action flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] disabled:pointer-events-none disabled:opacity-50 dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
                      >
                        {isExportingImage ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </button>
                    ) : null}
                    {deletedHistory.length ? (
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          void restoreLastDeleted();
                        }}
                        disabled={isSavingCard || isSavingMeaning || isEditingAny}
                        aria-label="撤销删除的记忆卡"
                        title="撤销删除的记忆卡 (⌘Z / Ctrl+Z / Shift+R)"
                        className="mn-memory-card-desktop-action flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] disabled:pointer-events-none disabled:opacity-50 dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    ) : null}
                    {deletedHistory.length ? (
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          void restoreLastDeleted();
                        }}
                        disabled={isSavingCard || isSavingMeaning || isEditingAny}
                        aria-label="撤销删除的记忆卡"
                        title="撤销删除的记忆卡"
                        className="mn-memory-card-mobile-action h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] disabled:pointer-events-none disabled:opacity-50 dark:border-border dark:text-muted-foreground dark:hover:border-foreground"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    ) : null}
                  </>
                )}
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => {
                    if (event.pointerType === "mouse") return;
                    event.preventDefault();
                    event.stopPropagation();
                    onClose();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose();
                  }}
                  aria-label="关闭助记卡，快捷键 Esc"
                  title="关闭助记卡 (Esc)"
                  className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
          {!isWhiteCard && !isEditingAny && mnemonicCards.length > 0 ? (
            <div className="mn-memory-card-tabs">
              <MnemonicCardTabs
                cards={mnemonicCards}
                activeCardId={activeMnemonic?.id ?? ""}
                onSelect={setActiveMnemonicId}
                onEdit={startEditCard}
                onPromote={promoteCard}
                onDelete={deleteCard}
                isPointInsideCard={isPointInsideCard}
                disabled={isSavingCard || isSavingMeaning}
              />
            </div>
          ) : null}
          {!isEditingAny && (onNavigatePrevious || onNavigateNext) ? (
            <div className="mn-memory-card-word-nav flex items-center gap-1">
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onNavigatePrevious?.();
                }}
                disabled={!onNavigatePrevious}
                aria-label="上一个单词，快捷键左方向键"
                title="上一个单词 (←)"
                className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] disabled:pointer-events-none disabled:opacity-40 dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onNavigateNext?.();
                }}
                disabled={!onNavigateNext}
                aria-label="下一个单词，快捷键右方向键"
                title="下一个单词 (→)"
                className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] disabled:pointer-events-none disabled:opacity-40 dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {isWhiteCard ? (
        <section
          data-memory-card-scroll-area="true"
          className="mn-memory-card-white-face min-h-0 flex-1 bg-white p-5 dark:bg-[#1c1c1e]"
          title="白卡模式"
        >
          <span className="mn-memory-card-white-word-wrap">
            <span ref={whiteWordRef} className="mn-memory-card-white-word">
              {word.word}
            </span>
          </span>
          {!isEditingAny && (onKeyboardMark || onCollectionMark) ? (
            <MemoryCardMarkButtons
              word={word}
              markState={word.markState ?? null}
              onMark={markCurrentWordFromCard}
            />
          ) : null}
        </section>
      ) : (
        <div
          data-memory-card-scroll-area="true"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white p-5 dark:bg-[#1c1c1e]"
        >
          <section
            className={cn(
              "memory-card-meaning-panel",
              effectiveCanEditOfficialCards && !isEditingAny
                ? "cursor-text transition hover:border-[#c6a46f] hover:bg-[#fffaf1] dark:hover:border-yellow-900/70 dark:hover:bg-yellow-950/20"
                : ""
            )}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              startEditMeaning();
            }}
            title={effectiveCanEditOfficialCards ? "右键编辑中文释义" : undefined}
          >
            {isEditingMeaning ? (
              <div className="space-y-2">
                <textarea
                  value={meaningDraft}
                  onChange={(event) => setMeaningDraft(event.target.value)}
                  autoFocus
                  disabled={isSavingMeaning}
                  className="memory-card-meaning min-h-32 w-full resize-y rounded-md border border-[#d8dde6] bg-white px-3 py-2 font-semibold leading-8 text-[#171a1f] outline-none transition focus:border-[#171a1f] focus:ring-2 focus:ring-[#171a1f]/10 disabled:opacity-60 dark:border-border dark:bg-card dark:text-foreground dark:focus:border-foreground"
                />
                <EditSaveStatus label={autoSaveLabel} />
              </div>
            ) : (
              <div className="memory-card-meaning font-semibold">
                {word.meaningCn || "释义待补"}
              </div>
            )}
          </section>

          <section className="mt-4 border-t border-[#eef2f6] pt-4 dark:border-border">
            <div className="text-xs font-semibold tracking-normal text-[#8b93a1] dark:text-muted-foreground">
              记忆卡
            </div>
            {isEditing ? (
              <MemoryCardEditFields
                title={editingMnemonicId ? "编辑记忆卡" : "新记忆卡"}
                value={draftContent}
                onValueChange={setDraftContent}
                placeholder={defaultCustomCardTemplate(word.word)}
                relatedWords={relatedWords}
                onRelatedWordsChange={setRelatedWords}
                statusLabel={autoSaveLabel}
                message={editorMessage}
                actionSlot={
                  <>
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={isSavingCard || isUploadingImage}
                      aria-label="插入图片"
                      title="插入图片"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] disabled:pointer-events-none disabled:opacity-50 dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
                    >
                      {isUploadingImage ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ImagePlus className="h-4 w-4" />
                      )}
                    </button>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadDraftImage(file);
                      }}
                    />
                  </>
                }
              >
                {showDraftVisibilityChoice ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#d8dde6] bg-white px-3 py-2 text-sm font-semibold text-[#171a1f] dark:border-border dark:bg-card dark:text-foreground">
                    <span className="text-[#69717f] dark:text-muted-foreground">保存为</span>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        checked={draftVisibility === "private"}
                        onChange={() => setDraftVisibility("private")}
                        className="h-4 w-4 accent-[#171a1f] dark:accent-foreground"
                      />
                      私有
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        checked={draftVisibility === "public"}
                        onChange={() => setDraftVisibility("public")}
                        className="h-4 w-4 accent-[#171a1f] dark:accent-foreground"
                      />
                      公开审核
                    </label>
                  </div>
                ) : null}
              </MemoryCardEditFields>
            ) : activeMnemonic ? (
              <MemoryCardReadView
                title={activeMnemonic.title}
                splitText={activeMnemonic.splitText}
                html={activeMnemonic.contentHtml}
                onContentClick={handleMnemonicClick}
                message={editorMessage}
                footerSlot={
                  activeMnemonicIsPublic ? (
                    <div
                      className="mt-4 flex flex-wrap items-center gap-2"
                      data-memory-card-export-hidden="true"
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void reactToActiveMnemonic("LIKE");
                        }}
                        disabled={reactingCardId === activeMnemonic.id}
                        aria-pressed={activeMnemonic.userVoteType === "LIKE"}
                        title="赞同并收藏这张记忆卡"
                        className={cn(
                          "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-60",
                          activeMnemonic.userVoteType === "LIKE"
                            ? "border-[#168458] bg-[#effaf3] text-[#168458] dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
                            : "border-[#d8dde6] text-[#69717f] hover:border-[#168458] hover:text-[#168458] dark:border-border dark:text-muted-foreground"
                        )}
                      >
                        {reactingCardId === activeMnemonic.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ThumbsUp className="h-4 w-4" />
                        )}
                        {activeMnemonic.likeCount.toLocaleString("zh-CN")}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void reactToActiveMnemonic("DISLIKE");
                        }}
                        disabled={reactingCardId === activeMnemonic.id}
                        aria-pressed={activeMnemonic.userVoteType === "DISLIKE"}
                        title="不推荐这张记忆卡"
                        className={cn(
                          "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-60",
                          activeMnemonic.userVoteType === "DISLIKE"
                            ? "border-[#c2412d] bg-[#fff1ee] text-[#c2412d] dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                            : "border-[#d8dde6] text-[#69717f] hover:border-[#c2412d] hover:text-[#c2412d] dark:border-border dark:text-muted-foreground"
                        )}
                      >
                        <ThumbsDown className="h-4 w-4" />
                        {activeMnemonic.dislikeCount.toLocaleString("zh-CN")}
                      </button>
                    </div>
                  ) : null
                }
              />
            ) : (
              <p className="mt-3 rounded-md border border-dashed border-[#cbd3df] px-3 py-8 text-center text-sm text-[#69717f] dark:border-border dark:text-muted-foreground">
                暂无助记卡。
              </p>
            )}
          </section>

          {word.exampleSentence ? (
            <section className="mt-4 border-t border-[#eef2f6] pt-4 dark:border-border">
              <div className="text-xs font-semibold tracking-normal text-[#8b93a1] dark:text-muted-foreground">
                例句
              </div>
              <p className="memory-card-note mt-2 text-[#323741] dark:text-foreground/85">
                {word.exampleSentence}
              </p>
              {word.exampleTranslation ? (
                <p className="memory-card-note mt-1 text-[#69717f] dark:text-muted-foreground">
                  {word.exampleTranslation}
                </p>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
    </article>
  );
}

function autoSaveStatusLabel(status: AutoSaveStatus) {
  if (status === "pending") return `${mnemonicCardAutoSaveDelaySeconds} 秒后自动保存`;
  if (status === "saving") return "正在自动保存...";
  if (status === "saved") return "已自动保存";
  if (status === "error") return "自动保存失败，可手动保存";
  return `${mnemonicCardAutoSaveDelaySeconds} 秒自动保存`;
}

const mobileCardDoubleTapMs = 340;
const mobileCardLongPressMs = 560;

function MnemonicCardTabs({
  cards,
  activeCardId,
  onSelect,
  onEdit,
  onPromote,
  onDelete,
  isPointInsideCard,
  disabled
}: {
  cards: MnemonicCardItem[];
  activeCardId: string;
  onSelect: (cardId: string) => void;
  onEdit: (cardId: string) => void;
  onPromote: (cardId: string) => void;
  onDelete: (cardId: string, previousIndex: number) => void;
  isPointInsideCard: (clientX: number, clientY: number) => boolean;
  disabled: boolean;
}) {
  type DraggingCardState = {
    id: string;
    index: number;
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    isDragging: boolean;
    isOutside: boolean;
  };
  const [draggingCard, setDraggingCard] = useState<DraggingCardState | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const draggingCardRef = useRef<DraggingCardState | null>(null);
  const dragElementRef = useRef<HTMLButtonElement | null>(null);
  const skipClickRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const lastMobileTapRef = useRef<{ id: string; time: number } | null>(null);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  const setCurrentDraggingCard = (next: DraggingCardState | null) => {
    draggingCardRef.current = next;
    setDraggingCard(next);
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const releaseCardPointerCapture = (pointerId: number) => {
    const element = dragElementRef.current;
    if (!element) return;
    try {
      if (element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
    } catch {
      // Pointer capture may already be gone after blur/cancel; clearing drag state is enough.
    }
  };

  const nextCardDragState = (
    current: DraggingCardState,
    clientX: number,
    clientY: number
  ): DraggingCardState => {
    const offsetX = clientX - current.startX;
    const offsetY = clientY - current.startY;
    const isDragging = current.isDragging || Math.hypot(offsetX, offsetY) > 5;

    return {
      ...current,
      offsetX,
      offsetY,
      isDragging,
      isOutside: isDragging && !isPointInsideCard(clientX, clientY)
    };
  };

  const updateCardDrag = (pointerId: number, clientX: number, clientY: number) => {
    const current = draggingCardRef.current;
    if (!current || current.pointerId !== pointerId) return;
    const next = nextCardDragState(current, clientX, clientY);
    if (next.isDragging) clearLongPressTimer();
    setCurrentDraggingCard(next);
  };

  const finishCardDrag = (
    pointerId: number,
    clientX: number,
    clientY: number,
    shouldDelete: boolean
  ) => {
    const current = draggingCardRef.current;
    if (!current || current.pointerId !== pointerId) return;
    clearLongPressTimer();

    const finalState = current.isDragging ? nextCardDragState(current, clientX, clientY) : current;
    releaseCardPointerCapture(pointerId);
    dragElementRef.current = null;
    setCurrentDraggingCard(null);

    if (!finalState.isDragging) return;
    skipClickRef.current = true;
    window.setTimeout(() => {
      skipClickRef.current = false;
    }, 0);

    if (shouldDelete && finalState.isOutside) {
      onDelete(finalState.id, finalState.index);
    }
  };

  const cancelCardDrag = (pointerId?: number) => {
    const current = draggingCardRef.current;
    if (!current) return;
    if (pointerId !== undefined && current.pointerId !== pointerId) return;

    clearLongPressTimer();
    releaseCardPointerCapture(current.pointerId);
    dragElementRef.current = null;
    setCurrentDraggingCard(null);
    if (current.isDragging) {
      skipClickRef.current = true;
      window.setTimeout(() => {
        skipClickRef.current = false;
      }, 0);
    }
  };

  useEffect(() => {
    if (draggingCard?.pointerId === undefined) return;

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      updateCardDrag(event.pointerId, event.clientX, event.clientY);
    };
    const handlePointerUp = (event: globalThis.PointerEvent) => {
      finishCardDrag(event.pointerId, event.clientX, event.clientY, true);
    };
    const handlePointerCancel = (event: globalThis.PointerEvent) => {
      cancelCardDrag(event.pointerId);
    };
    const handleWindowBlur = () => {
      cancelCardDrag();
    };

    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleWindowBlur);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleWindowBlur);
    };
  }, [draggingCard?.pointerId]);

  const startCardDrag = (cardId: string, index: number, event: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    dragElementRef.current = event.currentTarget;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The global pointer listeners below still keep the drag interaction recoverable.
    }
    setCurrentDraggingCard({
      id: cardId,
      index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      width: rect.width,
      height: rect.height,
      offsetX: 0,
      offsetY: 0,
      isDragging: false,
      isOutside: false
    });
    if (isMobileCardGestureViewport()) {
      const pointerId = event.pointerId;
      longPressTimerRef.current = window.setTimeout(() => {
        const current = draggingCardRef.current;
        if (!current || current.pointerId !== pointerId || current.isDragging) return;
        skipClickRef.current = true;
        cancelCardDrag(pointerId);
        onEdit(cardId);
      }, mobileCardLongPressMs);
    }
  };
  const moveCardDrag = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    updateCardDrag(event.pointerId, event.clientX, event.clientY);
  };
  const stopCardDrag = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    finishCardDrag(event.pointerId, event.clientX, event.clientY, true);
  };

  return (
    <>
      <div className="mn-memory-card-tab-strip flex max-w-48 flex-wrap justify-end gap-1 rounded-md border border-[#d8dde6] bg-[#f7f8fb] p-1 dark:border-border dark:bg-muted">
        {cards.map((card, index) => {
          const active = card.id === activeCardId;
          const dragging = draggingCard?.id === card.id ? draggingCard : null;
          return (
            <button
              key={card.id}
              type="button"
              disabled={disabled}
              onPointerDown={(event) => startCardDrag(card.id, index, event)}
              onPointerMove={moveCardDrag}
              onPointerUp={stopCardDrag}
              onPointerCancel={(event) => {
                event.stopPropagation();
                cancelCardDrag(event.pointerId);
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (skipClickRef.current) {
                  skipClickRef.current = false;
                  return;
                }
                if (isMobileCardGestureViewport()) {
                  const now = Date.now();
                  const previousTap = lastMobileTapRef.current;
                  const isDoubleTap =
                    previousTap?.id === card.id && now - previousTap.time <= mobileCardDoubleTapMs;
                  lastMobileTapRef.current = isDoubleTap ? null : { id: card.id, time: now };
                  if (isDoubleTap) {
                    onPromote(card.id);
                    return;
                  }
                }
                onSelect(card.id);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (isMobileCardGestureViewport()) return;
                onPromote(card.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onEdit(card.id);
              }}
              aria-label={`打开第 ${index + 1} 张记忆卡`}
              title={
                card.canEdit
                  ? "单击切换，双击设为默认，右键/长按编辑；拖出弹窗删除"
                  : card.sourceType === "OFFICIAL"
                    ? "单击切换，双击设为我的默认；公开记忆卡不可直接编辑或删除"
                    : "单击切换，双击设为我的默认；只能编辑或删除自己的记忆卡"
              }
              className={cn(
                mnemonicTabClassName(active, dragging?.isOutside ?? false),
                "disabled:pointer-events-none disabled:opacity-50",
                dragging?.isDragging ? "opacity-0" : "cursor-grab"
              )}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
      {portalRoot && draggingCard?.isDragging
        ? createPortal(
            <div
              aria-hidden="true"
              style={{
                position: "fixed",
                left: draggingCard.originLeft + draggingCard.offsetX,
                top: draggingCard.originTop + draggingCard.offsetY,
                width: draggingCard.width,
                height: draggingCard.height,
                zIndex: 120,
                pointerEvents: "none"
              }}
              className={cn(
                mnemonicTabClassName(draggingCard.id === activeCardId, draggingCard.isOutside),
                "cursor-grabbing shadow-lg transition-none"
              )}
            >
              {draggingCard.index + 1}
            </div>,
            portalRoot
          )
        : null}
    </>
  );
}

function mnemonicTabClassName(active: boolean, deleting: boolean) {
  return cn(
    "flex h-8 w-7 touch-none items-center justify-center rounded-[3px] border text-xs font-semibold leading-none transition",
    active
      ? "border-[#171a1f] bg-white text-[#171a1f] shadow-sm dark:border-foreground dark:bg-card dark:text-foreground"
      : "border-[#cbd3df] bg-white/70 text-[#69717f] hover:border-[#171a1f] hover:text-[#171a1f] dark:border-border dark:bg-card/70 dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground",
    deleting
      ? "border-[#c2412d] bg-[#fff1ee] text-[#c2412d] shadow-sm dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
      : ""
  );
}

type MnemonicCardMutationResult = {
  word: LevelWordItem | null;
  activeEntryId: string;
};

type WordMarkMutationResult = {
  isBookmarked: boolean;
  markState: WordMarkState | null;
};

async function setWordCollectionMark(
  wordId: string,
  state: WordMarkState | null,
  isAuthenticated: boolean
) {
  if (!isAuthenticated) {
    saveGuestWordMarkState(wordId, state);
    return { isBookmarked: state === "UNKNOWN", markState: state };
  }

  const response = await fetch("/api/word-marks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wordId, state })
  });
  const result = (await response.json().catch(() => ({}))) as Partial<WordMarkMutationResult> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(result.error || "标记失败。");
  }
  if (typeof result.isBookmarked !== "boolean" || !("markState" in result)) {
    throw new Error("标记返回数据不完整。");
  }

  return result as WordMarkMutationResult;
}

async function saveMnemonicCard(
  slug: string,
  contentMarkdown: string,
  visibility: "private" | "public"
) {
  return mutateMnemonicCard(slug, {
    action: "create",
    contentMarkdown,
    visibility
  });
}

async function updateMnemonicCard(
  slug: string,
  entryId: string,
  contentMarkdown: string,
  visibility: "private" | "public"
) {
  return mutateMnemonicCard(slug, {
    action: "update",
    entryId,
    contentMarkdown,
    visibility
  });
}

async function updateWordMeaning(slug: string, meaningCn: string) {
  return mutateMnemonicCard(slug, {
    action: "update-meaning",
    meaningCn
  });
}

async function promoteMnemonicCard(slug: string, entryId: string) {
  return mutateMnemonicCard(slug, {
    action: "promote",
    entryId
  });
}

async function reactToMnemonicCard(slug: string, entryId: string, reaction: "LIKE" | "DISLIKE") {
  return mutateMnemonicCard(slug, {
    action: "react",
    entryId,
    reaction
  });
}

async function deleteMnemonicCard(slug: string, entryId: string) {
  return mutateMnemonicCard(slug, {
    action: "delete",
    entryId
  });
}

async function restoreMnemonicCard(slug: string, entryId: string, sortOrder: number) {
  return mutateMnemonicCard(slug, {
    action: "restore",
    entryId,
    sortOrder: String(sortOrder)
  });
}

async function mutateMnemonicCard(slug: string, payload: Record<string, string>) {
  const response = await fetch(`/api/word-card/${encodeURIComponent(slug)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  const result = (await response
    .json()
    .catch(() => ({}))) as Partial<MnemonicCardMutationResult> & { error?: string };

  if (!response.ok) {
    throw new Error(result.error || "记忆卡操作失败。");
  }
  if (!result.word || typeof result.activeEntryId !== "string") {
    throw new Error("记忆卡返回数据不完整。");
  }

  return result as MnemonicCardMutationResult;
}

function editableMnemonicContent(card: MnemonicCardItem) {
  return editableMnemonicContentFromParts(card.contentMarkdown, card.splitText);
}

function isPubliclyReactableMnemonic(card: MnemonicCardItem) {
  if (card.sourceType === "OFFICIAL") return card.status !== "ARCHIVED";
  return (
    card.sourceType === "USER_PUBLIC" && (card.status === "APPROVED" || card.status === "FEATURED")
  );
}

function applyGuestReactionToMnemonic(
  card: MnemonicCardItem,
  previousReaction: "LIKE" | "DISLIKE" | null,
  nextReaction: "LIKE" | "DISLIKE" | null
) {
  let likeCount = card.likeCount;
  let dislikeCount = card.dislikeCount;
  if (previousReaction === "LIKE") likeCount = Math.max(0, likeCount - 1);
  if (previousReaction === "DISLIKE") dislikeCount = Math.max(0, dislikeCount - 1);
  if (nextReaction === "LIKE") likeCount += 1;
  if (nextReaction === "DISLIKE") dislikeCount += 1;
  return {
    ...card,
    likeCount,
    dislikeCount,
    userVoteType: nextReaction,
    isSaved: nextReaction === "LIKE" ? true : card.isSaved
  };
}

const MEMORY_CARD_DRAFT_KEY_PREFIX = "mnemonic_memory_card_draft";

type MemoryCardLocalDraft = {
  content: string;
  relatedWords: string;
  visibility: "private" | "public";
  savedAt: number;
  entryUpdatedAt: string;
};

function readMemoryCardDraft(wordId: string, entryId: string | null): MemoryCardLocalDraft | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(memoryCardDraftKey(wordId, entryId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MemoryCardLocalDraft>;
    if (typeof parsed.content !== "string") return null;
    return {
      content: parsed.content,
      relatedWords: typeof parsed.relatedWords === "string" ? parsed.relatedWords : "",
      visibility: parsed.visibility === "public" ? "public" : "private",
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
      entryUpdatedAt: typeof parsed.entryUpdatedAt === "string" ? parsed.entryUpdatedAt : ""
    };
  } catch {
    return null;
  }
}

function usableMemoryCardDraft(
  wordId: string,
  entryId: string,
  card: Pick<MnemonicCardItem, "updatedAt">
) {
  const draft = readMemoryCardDraft(wordId, entryId);
  if (!draft) return null;
  if (isMemoryCardDraftCurrent(draft, card.updatedAt)) return draft;

  clearMemoryCardDraft(wordId, entryId);
  return null;
}

function isMemoryCardDraftCurrent(draft: MemoryCardLocalDraft, entryUpdatedAt: string) {
  if (!entryUpdatedAt) return true;
  if (draft.entryUpdatedAt && draft.entryUpdatedAt === entryUpdatedAt) return true;

  const entryUpdatedTime = Date.parse(entryUpdatedAt);
  if (!Number.isFinite(entryUpdatedTime)) return true;
  return draft.savedAt >= entryUpdatedTime;
}

function readMemoryCardWhiteMode() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(memoryCardViewModeStorageKey) === "white";
  } catch {
    return false;
  }
}

function rememberMemoryCardWhiteMode(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(memoryCardViewModeStorageKey, enabled ? "white" : "full");
  } catch {
    // Ignore unavailable localStorage; the in-memory mode still works for the current tray.
  }
}

function saveMemoryCardDraft(
  wordId: string,
  entryId: string | null,
  content: string,
  relatedWords: string,
  visibility: "private" | "public",
  entryUpdatedAt = ""
) {
  if (typeof window === "undefined" || !wordId) return;

  window.localStorage.setItem(
    memoryCardDraftKey(wordId, entryId),
    JSON.stringify({
      content,
      relatedWords,
      visibility,
      entryUpdatedAt,
      savedAt: Date.now()
    })
  );
}

function clearMemoryCardDraft(wordId: string, entryId: string | null) {
  if (typeof window === "undefined" || !wordId) return;
  window.localStorage.removeItem(memoryCardDraftKey(wordId, entryId));
}

function memoryCardDraftKey(wordId: string, entryId: string | null) {
  return `${MEMORY_CARD_DRAFT_KEY_PREFIX}:${wordId}:${entryId ?? "new"}`;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function pronunciationAudioCandidates(word: string) {
  const trimmedWord = word.trim();
  const dictionaryWord = trimmedWord
    .toLowerCase()
    .replace(/[^a-z'-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!dictionaryWord) return [];

  return [
    `https://ssl.gstatic.com/dictionary/static/sounds/20200429/${encodeURIComponent(dictionaryWord)}--_us_1.mp3`,
    `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(trimmedWord)}&type=2`
  ];
}

async function playAudioUrl(
  audioUrl: string,
  activeAudioRef: { current: HTMLAudioElement | null }
) {
  activeAudioRef.current?.pause();

  const audio = new Audio(audioUrl);
  activeAudioRef.current = audio;

  try {
    await audio.play();
  } catch (error) {
    if (activeAudioRef.current === audio) {
      activeAudioRef.current = null;
    }
    throw error;
  }
}

function speakWord(word: string) {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;

  window.speechSynthesis.cancel();
  const utterance = new window.SpeechSynthesisUtterance(word);
  utterance.lang = "en-US";
  utterance.rate = 0.9;

  const voices = window.speechSynthesis.getVoices();
  const preferredVoice =
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en-us")) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en"));
  if (preferredVoice) utterance.voice = preferredVoice;

  window.speechSynthesis.speak(utterance);
}

function defaultCustomCardTemplate(word: string) {
  return `划分：${word}\n\n带你背：`;
}

function cardPermissionMessage(card: MnemonicCardItem) {
  if (card.sourceType === "OFFICIAL") {
    return "这张公开记忆卡不能直接修改或删除。普通账号可以点铅笔新建自己的记忆卡。";
  }

  return "只能编辑或删除自己创建的记忆卡。";
}

async function exportMemoryCardElementToPng(source: HTMLElement) {
  const { default: html2canvas } = await import("html2canvas");
  const sourceRect = source.getBoundingClientRect();
  const width = Math.ceil(sourceRect.width);
  if (!width) throw new Error("没有找到可导出的单词卡。");

  const clone = source.cloneNode(true) as HTMLElement;
  prepareMemoryCardExportClone(clone, width);
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.zIndex = "-1";
  host.style.pointerEvents = "none";
  host.style.width = `${width}px`;
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    await document.fonts?.ready;
    await inlineCloneImages(clone);
    await nextAnimationFrame();

    const height = Math.ceil(Math.max(clone.scrollHeight, clone.getBoundingClientRect().height));
    if (!height) throw new Error("单词卡内容为空，无法导出。");

    clone.style.height = `${height}px`;
    const backgroundColor = window.getComputedStyle(clone).backgroundColor || "#fffaf0";
    const scale = memoryCardExportScale(width, height);
    const canvas = await html2canvas(clone, {
      allowTaint: false,
      backgroundColor,
      height,
      logging: false,
      scale,
      useCORS: true,
      width,
      windowHeight: Math.max(window.innerHeight, height),
      windowWidth: Math.max(window.innerWidth, width)
    });
    return await canvasToPngBlob(canvas);
  } finally {
    host.remove();
  }
}

function prepareMemoryCardExportClone(clone: HTMLElement, width: number) {
  clone.removeAttribute("tabindex");
  clone.querySelectorAll("[data-memory-card-export-hidden='true']").forEach((element) => {
    element.remove();
  });

  clone.style.position = "relative";
  clone.style.left = "0";
  clone.style.top = "0";
  clone.style.transform = "none";
  clone.style.width = `${width}px`;
  clone.style.maxWidth = `${width}px`;
  clone.style.height = "auto";
  clone.style.maxHeight = "none";
  clone.style.overflow = "visible";
  clone.style.pointerEvents = "none";
  clone.style.zIndex = "0";

  const title = clone.querySelector<HTMLElement>("h2");
  if (title) {
    title.style.overflow = "visible";
    title.style.textOverflow = "clip";
    title.style.whiteSpace = "normal";
    title.style.wordBreak = "break-word";
    title.style.lineHeight = "1.18";
    title.style.paddingBottom = "0.08em";
  }

  const meta = clone.querySelector<HTMLElement>("h2 + div p");
  if (meta) {
    meta.style.overflow = "visible";
    meta.style.textOverflow = "clip";
    meta.style.whiteSpace = "normal";
    meta.style.lineHeight = "1.45";
    meta.style.paddingBottom = "0.08em";
  }

  clone.querySelectorAll<HTMLElement>(".wiki-link").forEach((link) => {
    link.style.alignItems = "center";
    link.style.boxSizing = "border-box";
    link.style.display = "inline-flex";
    link.style.justifyContent = "center";
    link.style.lineHeight = "1.35";
    link.style.minHeight = "1.95em";
    link.style.overflow = "visible";
    link.style.paddingBottom = "0.18em";
    link.style.paddingTop = "0.14em";
    link.style.verticalAlign = "middle";
  });

  const meaningPanel = clone.querySelector<HTMLElement>(".memory-card-meaning-panel");
  if (meaningPanel) {
    meaningPanel.style.background = "#f7efe2";
    meaningPanel.style.borderColor = "#d7c7b3";
    meaningPanel.style.borderLeftColor = "#b89a67";
    meaningPanel.style.boxShadow = "none";
  }

  clone.querySelectorAll<HTMLElement>(".memory-card-split").forEach((split) => {
    split.style.background = "#fbf4e8";
    split.style.border = "1px solid #e5d8c6";
    split.style.boxShadow = "none";
  });

  const scrollArea = clone.querySelector<HTMLElement>("[data-memory-card-scroll-area='true']");
  if (scrollArea) {
    scrollArea.style.flex = "0 0 auto";
    scrollArea.style.height = "auto";
    scrollArea.style.maxHeight = "none";
    scrollArea.style.minHeight = "0";
    scrollArea.style.overflow = "visible";
  }

  clone.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if (!href) return;
    anchor.setAttribute("href", new URL(href, window.location.href).href);
  });
}

async function inlineCloneImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(async (image) => {
      const src = image.currentSrc || image.getAttribute("src");
      if (!src) return;
      const absoluteSrc = new URL(src, window.location.href).href;
      image.removeAttribute("srcset");
      image.setAttribute("crossorigin", "anonymous");
      if (absoluteSrc.startsWith("data:")) return;

      try {
        const response = await fetch(absoluteSrc, { cache: "force-cache" });
        if (!response.ok) throw new Error("图片读取失败。");
        image.src = await blobToDataUrl(await response.blob());
      } catch {
        image.src = transparentImageDataUrl;
      }
    })
  );

  await Promise.all(
    images.map(async (image) => {
      if (image.complete) return;
      try {
        await image.decode();
      } catch {
        await new Promise<void>((resolve) => {
          image.onload = () => resolve();
          image.onerror = () => resolve();
        });
      }
    })
  );
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败。"));
    reader.readAsDataURL(blob);
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("图片生成失败。"));
      }
    }, "image/png");
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function memoryCardImageFilename(word: string) {
  const safeWord = word
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${safeWord || "word"}-memory-card.png`;
}

function memoryCardExportScale(width: number, height: number) {
  const preferredScale = 3;
  const maxPixels = 42_000_000;
  const maxScale = Math.sqrt(maxPixels / Math.max(1, width * height));
  return Math.max(2, Math.min(preferredScale, maxScale));
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

const transparentImageDataUrl =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
