"use client";

import { ArrowUp, Loader2, Settings2, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { MemoryCardTray, type LevelWordItem } from "@/components/level-word-browser";
import { MnemonicEditor } from "@/components/mnemonic-editor";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { InteriorPanel } from "@/components/interior-shell";

type UserMnemonicEntry = {
  id: string;
  targetWordId: string;
  title: string;
  splitText: string | null;
  contentMarkdown: string;
  plainText: string;
  status: string;
  sourceType: "USER_PRIVATE" | "USER_PUBLIC";
  reviewNote: string | null;
  sortOrder: number;
  updatedAt: string;
  targetWord: {
    word: string;
    slug: string;
    shortMeaningCn: string;
  };
};

type MutationResponse = {
  entries?: UserMnemonicEntry[];
  defaultPublicMnemonics?: boolean;
  error?: string;
};

type Props = {
  initialEntries: UserMnemonicEntry[];
  initialDefaultPublicMnemonics: boolean;
  saveUserMnemonicAction: (formData: FormData) => void | Promise<void>;
};

export function MyMnemonicsManager({
  initialEntries,
  initialDefaultPublicMnemonics,
  saveUserMnemonicAction
}: Props) {
  const [entries, setEntries] = useState(initialEntries);
  const [defaultPublicMnemonics, setDefaultPublicMnemonics] = useState(initialDefaultPublicMnemonics);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [pendingAction, setPendingAction] = useState("");
  const [message, setMessage] = useState("");
  const [openCards, setOpenCards] = useState<LevelWordItem[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const wordCache = useRef(new Map<string, LevelWordItem>());

  const sortedEntries = useMemo(() => sortEntries(entries), [entries]);
  const selectedCount = selectedIds.size;

  async function mutate(payload: Record<string, unknown>, successMessage: string) {
    setPendingAction(String(payload.action ?? "action") + ":" + String(payload.entryId ?? "bulk"));
    setMessage("");
    try {
      const response = await fetch("/api/me/mnemonics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store"
      });
      const result = (await response.json().catch(() => ({}))) as MutationResponse;
      if (!response.ok) throw new Error(result.error || "操作失败。");
      if (Array.isArray(result.entries)) setEntries(result.entries);
      if (typeof result.defaultPublicMnemonics === "boolean") setDefaultPublicMnemonics(result.defaultPublicMnemonics);
      setSelectedIds(new Set());
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败。");
    } finally {
      setPendingAction("");
    }
  }

  const toggleSelected = (entryId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(entryId);
      } else {
        next.delete(entryId);
      }
      return next;
    });
  };

  const openWord = (word: LevelWordItem) => {
    wordCache.current.set(word.slug, word);
    setActiveCardId(word.id);
    setOpenCards((current) => [word, ...current.filter((item) => item.id !== word.id)].slice(0, 5));
  };

  const openWordBySlug = async (slug: string) => {
    const cachedWord = wordCache.current.get(slug);
    if (cachedWord) {
      openWord(cachedWord);
      return true;
    }

    setLoadingSlug(slug);
    setMessage("");
    try {
      const fetchedWord = await fetchWordCard(slug);
      openWord(fetchedWord);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "单词卡加载失败。");
      return false;
    } finally {
      setLoadingSlug((current) => (current === slug ? null : current));
    }
  };

  const updateWord = (updatedWord: LevelWordItem) => {
    wordCache.current.set(updatedWord.slug, updatedWord);
    setOpenCards((current) => current.map((word) => (word.id === updatedWord.id ? { ...word, ...updatedWord } : word)));
  };

  return (
    <>
      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <InteriorPanel className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">我的卡片</h2>
              <p className="mt-1 text-sm text-[var(--mn-muted)]">勾选后可批量删除；单张卡可编辑、公开送审、取消公开或前置排序。</p>
            </div>
            <Button
              type="button"
              variant="destructive"
              disabled={!selectedCount || pendingAction === "bulk-archive:bulk"}
              onClick={() => void mutate({ action: "bulk-archive", entryIds: Array.from(selectedIds) }, `已删除 ${selectedCount} 张记忆卡。`)}
            >
              {pendingAction === "bulk-archive:bulk" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              批量删除
            </Button>
          </div>
          {message ? <p className="mt-4 text-sm font-semibold text-[var(--mn-muted)]">{message}</p> : null}
        </InteriorPanel>

        <InteriorPanel className="p-5">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void mutate({ action: "default-public", enabled: defaultPublicMnemonics }, "默认公开设置已保存。");
            }}
          >
            <div className="flex items-start gap-3">
              <Settings2 className="mt-1 h-5 w-5 text-[var(--mn-muted)]" />
              <div>
                <h2 className="text-xl font-semibold">默认公开</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--mn-muted)]">开启后，此后新建或编辑的个人记忆卡会自动提交公开审核。</p>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={defaultPublicMnemonics}
                onChange={(event) => setDefaultPublicMnemonics(event.target.checked)}
                className="h-4 w-4 accent-[var(--mn-ink)]"
              />
              {defaultPublicMnemonics ? "已默认公开" : "默认保持私有"}
            </label>
            <Button type="submit" variant="outline" disabled={pendingAction === "default-public:bulk"}>
              {pendingAction === "default-public:bulk" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              保存设置
            </Button>
          </form>
        </InteriorPanel>
      </div>

      <div className="mt-5 space-y-4">
        {sortedEntries.map((entry) => {
          const mode = defaultPublicMnemonics || entry.sourceType === "USER_PUBLIC" ? "public" : "private";
          const isPublicSelected = entry.sourceType === "USER_PUBLIC";
          const publicIntent = isPublicSelected && entry.status !== "REJECTED" ? "private" : "public";
          const publicButtonText = publicIntent === "private" ? "取消公开" : entry.status === "REJECTED" ? "重新公开" : "公开";
          const publicActionId = `set-public:${entry.id}`;
          const promoteActionId = `promote:${entry.id}`;
          const archiveActionId = `archive:${entry.id}`;

          return (
            <InteriorPanel key={entry.id} className="p-5">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(entry.id)}
                      onChange={(event) => toggleSelected(entry.id, event.target.checked)}
                      aria-label={`选择 ${entry.targetWord.word} 的记忆卡`}
                      className="h-4 w-4 accent-[var(--mn-ink)]"
                    />
                    <button
                      type="button"
                      onClick={() => void openWordBySlug(entry.targetWord.slug)}
                      disabled={Boolean(loadingSlug)}
                      className="inline-flex items-center gap-2 text-xl font-semibold text-[var(--mn-ink)] transition hover:text-[var(--mn-red)] disabled:pointer-events-none disabled:opacity-60"
                    >
                      {entry.targetWord.word}
                      {loadingSlug === entry.targetWord.slug ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    </button>
                    <StatusBadge value={entry.status} />
                    <span className="rounded-md border border-[var(--mn-line)] px-2 py-0.5 text-xs text-[var(--mn-muted)]">
                      {isPublicSelected ? "已选择公开" : "私有"}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--mn-muted)]">{entry.targetWord.shortMeaningCn}</p>
                  <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm leading-6">{entry.plainText}</p>
                  {entry.reviewNote && entry.status === "REJECTED" ? (
                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">
                      审核意见：{entry.reviewNote}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={publicIntent === "private" ? "outline" : "default"}
                      size="sm"
                      disabled={Boolean(pendingAction)}
                      onClick={() => void mutate({ action: "set-public", entryId: entry.id, intent: publicIntent }, publicIntent === "private" ? "已改为私有。" : "已提交公开审核。")}
                    >
                      {pendingAction === publicActionId ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {publicButtonText}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Boolean(pendingAction)}
                      onClick={() => void mutate({ action: "promote", entryId: entry.id }, "已前置，只影响你的账号。")}
                    >
                      {pendingAction === promoteActionId ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                      前置
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={Boolean(pendingAction)}
                      onClick={() => void mutate({ action: "archive", entryId: entry.id }, "已删除记忆卡。")}
                    >
                      {pendingAction === archiveActionId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      删除
                    </Button>
                  </div>
                </div>

                <details className="rounded-md border border-[var(--mn-line)] bg-[var(--mn-panel)] p-4">
                  <summary className="cursor-pointer text-sm font-semibold">编辑这张记忆卡</summary>
                  <div className="mt-4">
                    <MnemonicEditor
                      action={saveUserMnemonicAction}
                      targetWordId={entry.targetWordId}
                      mode={mode}
                      entry={entry}
                      returnTo="mine"
                      showVisibilityChoice
                    />
                  </div>
                </details>
              </div>
            </InteriorPanel>
          );
        })}

        {!entries.length ? (
          <InteriorPanel className="p-6 text-sm leading-6 text-[var(--mn-muted)]">
            你还没有创建个人记忆卡。可以先进入任意单词页，在「我的记忆卡」里保存一张。
          </InteriorPanel>
        ) : null}
      </div>

      {openCards.length ? (
        <MemoryCardTray
          words={openCards}
          activeCardId={activeCardId}
          onActivate={setActiveCardId}
          onClose={(wordId) => setOpenCards((current) => current.filter((word) => word.id !== wordId))}
          onOpenLinkedWord={openWordBySlug}
          onWordUpdate={updateWord}
          isAuthenticated
          defaultUserCardVisibility={defaultPublicMnemonics ? "public" : "private"}
          canEditOfficialCards={false}
        />
      ) : null}
    </>
  );
}

function sortEntries(entries: UserMnemonicEntry[]) {
  return [...entries].sort((a, b) => {
    const wordCompare = a.targetWord.word.localeCompare(b.targetWord.word, "en");
    if (wordCompare !== 0) return wordCompare;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

async function fetchWordCard(slug: string) {
  const response = await fetch(`/api/word-card/${encodeURIComponent(slug)}?fresh=${Date.now()}`, {
    cache: "no-store"
  });
  const result = (await response.json().catch(() => ({}))) as Partial<LevelWordItem> & { error?: string };

  if (!response.ok) {
    throw new Error(result.error || "单词卡加载失败。");
  }
  if (!result.id || !result.slug || !result.word || !Array.isArray(result.mnemonics)) {
    throw new Error("单词卡返回数据不完整。");
  }

  return result as LevelWordItem;
}
