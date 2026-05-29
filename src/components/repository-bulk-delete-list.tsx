"use client";

import { CheckSquare, Square, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WordCardPopupButton } from "@/components/word-card-popup-button";
import { cn } from "@/lib/utils";

export type RepositoryBulkDeleteWord = {
  id: string;
  word: string;
  slug: string;
  phonetic: string;
  meaning: string;
  statusLabel: string;
};

export function RepositoryBulkDeleteList({
  words,
  returnTo,
  bulkDeleteAction,
  isAuthenticated,
  defaultUserCardVisibility = "private",
  canEditOfficialCards = false,
  canExportMemoryCardImages = false,
  mode = "delete",
  packScope
}: {
  words: RepositoryBulkDeleteWord[];
  returnTo: string;
  bulkDeleteAction: (formData: FormData) => void | Promise<void>;
  isAuthenticated: boolean;
  defaultUserCardVisibility?: "private" | "public";
  canEditOfficialCards?: boolean;
  canExportMemoryCardImages?: boolean;
  mode?: "delete" | "removeFromPack";
  packScope?: string;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const isRemoveFromPack = mode === "removeFromPack";
  const selectedWords = useMemo(
    () => words.filter((word) => selectedIds.has(word.id)),
    [selectedIds, words]
  );
  const allSelected = words.length > 0 && selectedIds.size === words.length;

  const setAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(words.map((word) => word.id)) : new Set());
  };

  const toggleWord = (wordId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(wordId);
      } else {
        next.delete(wordId);
      }
      return next;
    });
  };

  return (
    <form
      action={bulkDeleteAction}
      onSubmit={(event) => {
        if (!selectedWords.length) {
          event.preventDefault();
          window.alert(isRemoveFromPack ? "先勾选要移出词包的单词。" : "先勾选要删除的单词。");
          return;
        }

        const preview = selectedWords.slice(0, 12).map((word) => word.word).join(", ");
        const suffix = selectedWords.length > 12 ? ` 等 ${selectedWords.length} 个` : "";
        const message = isRemoveFromPack
          ? `确认把 ${selectedWords.length} 个单词移出这个词包吗？\n${preview}${suffix}\n\n单词和单词卡都会保留。`
          : `确认删除 ${selectedWords.length} 个单词吗？\n${preview}${suffix}\n\n这个操作会同时删除它们的记忆方法和链接。`;
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
      className="mn-level-word-list mt-5 overflow-hidden rounded-lg border border-[#d8dde6] bg-white dark:border-border dark:bg-card"
    >
      <input type="hidden" name="returnTo" value={returnTo} />
      {packScope ? <input type="hidden" name="packScope" value={packScope} /> : null}
      <div className="mn-repository-bulk-toolbar flex flex-wrap items-center justify-between gap-3 border-b border-black/5 bg-white/95 px-5 py-4 sm:px-7">
        <div className="mn-repository-bulk-actions flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" className="rounded-full" onClick={() => setAll(!allSelected)} disabled={!words.length}>
            {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            {allSelected ? "已全选本页" : "全选本页"}
          </Button>
          <Button type="button" variant="ghost" className="rounded-full" onClick={() => setAll(false)} disabled={!selectedWords.length}>
            取消勾选
          </Button>
          <span className="text-sm font-semibold text-[#6e6e73]">
            已选 {selectedWords.length} / {words.length}
          </span>
        </div>
        <Button type="submit" variant={isRemoveFromPack ? "outline" : "destructive"} className="rounded-full" disabled={!selectedWords.length}>
          <Trash2 className="h-4 w-4" />
          {isRemoveFromPack ? "移出已选" : "删除已选"}
        </Button>
      </div>

      {words.map((word) => {
        const selected = selectedIds.has(word.id);
        return (
          <div
            key={word.id}
            className={cn(
              "mn-level-word-row grid min-h-16 w-full appearance-none gap-3 border-b border-[#e5e9f0] px-4 py-3 text-left text-sm transition last:border-b-0 hover:bg-[#f6f8fb] dark:border-border dark:hover:bg-muted sm:grid-cols-[32px_minmax(160px,220px)_minmax(90px,0.7fr)_96px_minmax(160px,2.4fr)] sm:items-center",
              selected && "bg-sky-50/80 dark:bg-sky-950/20"
            )}
          >
            <input
              type="checkbox"
              name="wordId"
              value={word.id}
              checked={selected}
              onChange={(event) => toggleWord(word.id, event.target.checked)}
              aria-label={`选择 ${word.word}`}
              className="h-5 w-5 rounded border-[#b7c0ce] text-[#0071e3] focus:ring-[#0071e3]"
            />
            <WordCardPopupButton
              slug={word.slug}
              isAuthenticated={isAuthenticated}
              defaultUserCardVisibility={defaultUserCardVisibility}
              canEditOfficialCards={canEditOfficialCards}
              canExportMemoryCardImages={canExportMemoryCardImages}
              ariaLabel={`打开 ${word.word} 单词卡弹窗`}
              className="word-row-title min-w-0 truncate font-semibold text-[#171a1f] hover:text-[#06c] dark:text-foreground"
            >
              {word.word}
            </WordCardPopupButton>
            <span className="mn-repository-bulk-phonetic truncate text-muted-foreground">{word.phonetic || "未填写音标"}</span>
            <Badge className="mn-repository-status-badge">{word.statusLabel}</Badge>
            <WordCardPopupButton
              slug={word.slug}
              isAuthenticated={isAuthenticated}
              defaultUserCardVisibility={defaultUserCardVisibility}
              canEditOfficialCards={canEditOfficialCards}
              canExportMemoryCardImages={canExportMemoryCardImages}
              ariaLabel={`打开 ${word.word} 单词卡弹窗`}
              className="word-row-meaning min-w-0 truncate text-[#323741] hover:text-foreground dark:text-foreground/80"
            >
              {word.meaning}
            </WordCardPopupButton>
          </div>
        );
      })}
    </form>
  );
}
