export type GuestWordMarkState = "KNOWN" | "FUZZY" | "UNKNOWN";
export type GuestMnemonicReaction = "LIKE" | "DISLIKE";

export type GuestProgress = {
  marks: Record<string, GuestWordMarkState>;
  bookmarkedWordIds: string[];
  mnemonicReactions: Record<string, { wordId: string; reaction: GuestMnemonicReaction }>;
  mnemonicCardOrders: Record<string, string[]>;
};

const MARKS_KEY = "mnemonic_guest_word_marks";
const BOOKMARKS_KEY = "mnemonic_guest_bookmarks";
const MNEMONIC_REACTIONS_KEY = "mnemonic_guest_mnemonic_reactions";
const MNEMONIC_CARD_ORDERS_KEY = "mnemonic_guest_mnemonic_card_orders";
export const GUEST_PROGRESS_CHANGED_EVENT = "mnemonic:guest-progress-changed";

const validMarkStates = new Set<GuestWordMarkState>(["KNOWN", "FUZZY", "UNKNOWN"]);
const validReactions = new Set<GuestMnemonicReaction>(["LIKE", "DISLIKE"]);

export function readGuestProgress(): GuestProgress {
  if (typeof window === "undefined") {
    return { marks: {}, bookmarkedWordIds: [], mnemonicReactions: {}, mnemonicCardOrders: {} };
  }

  const marks = readGuestMarks();
  const bookmarkedWordIds = readGuestBookmarkIds().filter((wordId) => !marks[wordId] || marks[wordId] === "UNKNOWN");
  for (const wordId of bookmarkedWordIds) {
    if (!marks[wordId]) marks[wordId] = "UNKNOWN";
  }

  return {
    marks,
    bookmarkedWordIds,
    mnemonicReactions: readGuestMnemonicReactions(),
    mnemonicCardOrders: readGuestMnemonicCardOrders()
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

export function saveGuestMnemonicReaction(
  wordId: string,
  mnemonicEntryId: string,
  reaction: GuestMnemonicReaction
) {
  if (typeof window === "undefined" || !wordId || !mnemonicEntryId) return null;

  const reactions = readGuestMnemonicReactions();
  const currentReaction = reactions[mnemonicEntryId]?.reaction ?? null;
  const nextReaction = currentReaction === reaction ? null : reaction;

  if (nextReaction) {
    reactions[mnemonicEntryId] = { wordId, reaction: nextReaction };
  } else {
    delete reactions[mnemonicEntryId];
  }

  window.localStorage.setItem(MNEMONIC_REACTIONS_KEY, JSON.stringify(reactions));
  dispatchGuestProgressChanged();
  return nextReaction;
}

export function saveGuestMnemonicCardOrder(wordId: string, mnemonicEntryIds: string[]) {
  if (typeof window === "undefined" || !wordId) return;

  const orders = readGuestMnemonicCardOrders();
  const uniqueIds = Array.from(new Set(mnemonicEntryIds.filter(Boolean)));
  if (uniqueIds.length) {
    orders[wordId] = uniqueIds;
  } else {
    delete orders[wordId];
  }

  window.localStorage.setItem(MNEMONIC_CARD_ORDERS_KEY, JSON.stringify(orders));
  dispatchGuestProgressChanged();
}

export function clearGuestProgress() {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(MARKS_KEY);
  window.localStorage.removeItem(BOOKMARKS_KEY);
  window.localStorage.removeItem(MNEMONIC_REACTIONS_KEY);
  window.localStorage.removeItem(MNEMONIC_CARD_ORDERS_KEY);
  dispatchGuestProgressChanged();
}

export function hasGuestProgress(progress = readGuestProgress()) {
  return (
    Object.keys(progress.marks).length > 0 ||
    progress.bookmarkedWordIds.length > 0 ||
    Object.keys(progress.mnemonicReactions).length > 0 ||
    Object.keys(progress.mnemonicCardOrders).length > 0
  );
}

export function applyGuestProgressToWord<
  T extends {
    id: string;
    markState: GuestWordMarkState | null;
    isBookmarked: boolean;
    mnemonic?: GuestMnemonicEntry | null;
    mnemonics?: GuestMnemonicEntry[];
  }
>(
  word: T,
  progress = readGuestProgress()
): T {
  const markState = progress.marks[word.id] ?? word.markState;
  const isBookmarked = markState === "UNKNOWN" || word.isBookmarked || progress.bookmarkedWordIds.includes(word.id);
  const mnemonics = word.mnemonics ? applyGuestMnemonicProgress(word.id, word.mnemonics, progress) : word.mnemonics;
  const mnemonic = mnemonics?.[0] ?? (word.mnemonic ? applyGuestMnemonicProgress(word.id, [word.mnemonic], progress)[0] : word.mnemonic);
  return { ...word, markState, isBookmarked, mnemonic, mnemonics };
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

function readGuestMnemonicReactions() {
  const value = readJson<Record<string, unknown>>(MNEMONIC_REACTIONS_KEY, {});
  const reactions: GuestProgress["mnemonicReactions"] = {};
  for (const [mnemonicEntryId, raw] of Object.entries(value)) {
    if (!mnemonicEntryId || !raw || typeof raw !== "object") continue;
    const { wordId, reaction } = raw as { wordId?: unknown; reaction?: unknown };
    if (
      typeof wordId === "string" &&
      wordId &&
      typeof reaction === "string" &&
      validReactions.has(reaction as GuestMnemonicReaction)
    ) {
      reactions[mnemonicEntryId] = { wordId, reaction: reaction as GuestMnemonicReaction };
    }
  }
  return reactions;
}

function readGuestMnemonicCardOrders() {
  const value = readJson<Record<string, unknown>>(MNEMONIC_CARD_ORDERS_KEY, {});
  const orders: GuestProgress["mnemonicCardOrders"] = {};
  for (const [wordId, rawIds] of Object.entries(value)) {
    if (!wordId || !Array.isArray(rawIds)) continue;
    const ids = Array.from(new Set(rawIds.filter((item): item is string => typeof item === "string" && item.length > 0)));
    if (ids.length) orders[wordId] = ids;
  }
  return orders;
}

type GuestMnemonicEntry = {
  id: string;
  likeCount: number;
  dislikeCount: number;
  userVoteType: GuestMnemonicReaction | null;
  isSaved: boolean;
};

function applyGuestMnemonicProgress<T extends GuestMnemonicEntry>(
  wordId: string,
  mnemonics: T[],
  progress: GuestProgress
) {
  const withReactions = mnemonics.map((entry) => {
    const guestReaction = progress.mnemonicReactions[entry.id]?.reaction ?? null;
    if (!guestReaction) return entry;
    return {
      ...entry,
      likeCount: entry.likeCount + (guestReaction === "LIKE" && entry.userVoteType !== "LIKE" ? 1 : 0),
      dislikeCount: entry.dislikeCount + (guestReaction === "DISLIKE" && entry.userVoteType !== "DISLIKE" ? 1 : 0),
      userVoteType: guestReaction,
      isSaved: guestReaction === "LIKE" || entry.isSaved
    };
  });
  const order = progress.mnemonicCardOrders[wordId];
  if (!order?.length) return withReactions;

  const orderRank = new Map(order.map((entryId, index) => [entryId, index]));
  return [...withReactions].sort((first, second) => {
    const firstRank = orderRank.get(first.id);
    const secondRank = orderRank.get(second.id);
    if (firstRank === undefined && secondRank === undefined) return 0;
    if (firstRank === undefined) return 1;
    if (secondRank === undefined) return -1;
    return firstRank - secondRank;
  });
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
