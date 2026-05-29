"use client";

import { X } from "lucide-react";
import { deleteWordFromRepositoryAction, removeWordFromRepositoryPackAction } from "@/lib/services/word-service";
import { cn } from "@/lib/utils";

export function RepositoryDeleteButton({
  id,
  word,
  returnTo,
  variant = "icon",
  mode = "delete",
  packScope
}: {
  id: string;
  word: string;
  returnTo?: string;
  variant?: "icon" | "chip";
  mode?: "delete" | "removeFromPack";
  packScope?: string;
}) {
  const isRemoveFromPack = mode === "removeFromPack";
  return (
    <form
      action={isRemoveFromPack ? removeWordFromRepositoryPackAction : deleteWordFromRepositoryAction}
      onSubmit={(event) => {
        if (isRemoveFromPack) return;
        if (!window.confirm(`确认删除「${word}」吗？这个操作会同时删除它的记忆方法和链接。`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      {packScope ? <input type="hidden" name="packScope" value={packScope} /> : null}
      <button
        type="submit"
        className={cn(
          "inline-flex items-center justify-center text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive",
          variant === "chip" ? "h-7 w-7 rounded-full" : "h-9 w-9 rounded-md"
        )}
        aria-label={isRemoveFromPack ? `从词包移出 ${word}` : `删除 ${word}`}
        title={isRemoveFromPack ? "移出词包" : "删除"}
      >
        <X className={variant === "chip" ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </button>
    </form>
  );
}
