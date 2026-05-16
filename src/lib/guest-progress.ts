export type GuestWordMarkState = "KNOWN" | "FUZZY" | "UNKNOWN";

export type GuestProgress = {
  marks: Record<string, GuestWordMarkState>;
  bookmarkedWordIds: string[];
};

const MARKS_KEY = "mnemonic_guest_word_marks";
const BOOKMARKS_KEY = "mnemonic_guest_bookmarks";
export const GUEST_PROGRESS_CHANGED_EVENT = "mnemonic:guest-progress-changed";

const validMarkStates = new Set<GuestWordMarkState>(["KNOWN", "FUZZY", "UNKNOWN"]);

export function readGuestProgress(): GuestProgress {
  if (typeof window === "undefined") return { marks: {}, bookmarkedWordIds: [] };

  const marks = readGuestMarks();
  const bookmarkedWordIds = readGuestBookmarkIds().filter((wordId) => !marks[wordId] || marks[wordId] === "UNKNOWN");
  for (const wordId of bookmarkedWordIds) {
    if (!marks[wordId]) marks[wordId] = "UNKNOWN";
  }

  return {
    marks,
    bookmarkedWordIds
  };
}

export function saveGuestWordMarkState(wordId: string, state: GuestWordMarkState | null) {
  saveGuestWordMarkStates([[wordId, state]]);
}

export function saveGuestWordMarkStates(changes: Array<[string, GuestWordMarkState | null]>) {
  if (typeof window === "undefined" || !changes.length) return;

  const marks = readGuestMarks();
  const bookmarkIds = new Set(readGuestBookmarkIds());
  for (const [wordId, state] of changes) {
    if (!wordId) continue;
    if (state) {
      marks[wordId] = state;
    } else {
      delete marks[wordId];
    }
    if (state === "UNKNOWN") {
      bookmarkIds.add(wordId);
    } else {
      bookmarkIds.delete(wordId);
    }
  }
  window.localStorage.setItem(MARKS_KEY, JSON.stringify(marks));
  window.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(Array.from(bookmarkIds)));
  dispatchGuestProgressChanged();
}

export function saveGuestBookmarkState(wordId: string, bookmarked: boolean) {
  if (typeof window === "undefined" || !wordId) return;

  const bookmarkIds = new Set(readGuestBookmarkIds());
  const marks = readGuestMarks();
  if (bookmarked) {
    bookmarkIds.add(wordId);
    marks[wordId] = "UNKNOWN";
  } else {
    bookmarkIds.delete(wordId);
    if (marks[wordId] === "UNKNOWN") delete marks[wordId];
  }
  window.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(Array.from(bookmarkIds)));
  window.localStorage.setItem(MARKS_KEY, JSON.stringify(marks));
  dispatchGuestProgressChanged();
}

export function clearGuestProgress() {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(MARKS_KEY);
  window.localStorage.removeItem(BOOKMARKS_KEY);
  dispatchGuestProgressChanged();
}

export function hasGuestProgress(progress = readGuestProgress()) {
  return Object.keys(progress.marks).length > 0 || progress.bookmarkedWordIds.length > 0;
}

export function applyGuestProgressToWord<T extends { id: string; markState: GuestWordMarkState | null; isBookmarked: boolean }>(
  word: T,
  progress = readGuestProgress()
): T {
  const markState = progress.marks[word.id] ?? word.markState;
  const isBookmarked = markState === "UNKNOWN" || word.isBookmarked || progress.bookmarkedWordIds.includes(word.id);
  return { ...word, markState, isBookmarked };
}

export function applyGuestProgressToWords<T extends { id: string; markState: GuestWordMarkState | null; isBookmarked: boolean }>(
  words: T[],
  progress = readGuestProgress()
) {
  return words.map((word) => applyGuestProgressToWord(word, progress));
}

function readGuestMarks() {
  const value = readJson<Record<string, unknown>>(MARKS_KEY, {});
  const marks: Record<string, GuestWordMarkState> = {};
  for (const [wordId, state] of Object.entries(value)) {
    if (typeof wordId === "string" && typeof state === "string" && validMarkStates.has(state as GuestWordMarkState)) {
      marks[wordId] = state as GuestWordMarkState;
    }
  }
  return marks;
}

function readGuestBookmarkIds() {
  const value = readJson<unknown[]>(BOOKMARKS_KEY, []);
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0)));
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function dispatchGuestProgressChanged() {
  window.dispatchEvent(new Event(GUEST_PROGRESS_CHANGED_EVENT));
}
