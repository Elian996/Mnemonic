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
  canExportMemoryCardImages = false
}: {
  words: RepositoryBulkDeleteWord[];
  returnTo: string;
  bulkDeleteAction: (formData: FormData) => void | Promise<void>;
  isAuthenticated: boolean;
  defaultUserCardVisibility?: "private" | "public";
  canEditOfficialCards?: boolean;
  canExportMemoryCardImages?: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
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
          window.alert("先勾选要删除的单词。");
          return;
        }

        const preview = selectedWords.slice(0, 12).map((word) => word.word).join(", ");
        const suffix = selectedWords.length > 12 ? ` 等 ${selectedWords.length} 个` : "";
        if (!window.confirm(`确认删除 ${selectedWords.length} 个单词吗？\n${preview}${suffix}\n\n这个操作会同时删除它们的记忆方法和链接。`)) {
          event.preventDefault();
        }
      }}
      className="mn-repository-bulk-list overflow-hidden rounded-[28px] bg-white shadow-sm ring-1 ring-black/5"
    >
      <input type="hidden" name="returnTo" value={returnTo} />
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
        <Button type="submit" variant="destructive" className="rounded-full" disabled={!selectedWords.length}>
          <Trash2 className="h-4 w-4" />
          删除已选
        </Button>
      </div>

      {words.map((word, index) => {
        const selected = selectedIds.has(word.id);
        return (
          <div
            key={word.id}
            className={cn(
              "mn-repository-bulk-row",
              "grid grid-cols-[32px_minmax(120px,1.1fr)_minmax(90px,0.7fr)_96px_minmax(160px,2.4fr)] items-center gap-4 px-5 py-7 text-sm sm:px-7",
              index === 0 ? "bg-[#fbfbfd]" : "border-t border-black/5",
              selected && "bg-sky-50/80"
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
              className="mn-repository-bulk-word truncate text-2xl font-semibold hover:text-[#06c]"
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
              className="mn-repository-bulk-meaning truncate text-muted-foreground hover:text-foreground"
            >
              {word.meaning}
            </WordCardPopupButton>
          </div>
        );
      })}
    </form>
  );
}
