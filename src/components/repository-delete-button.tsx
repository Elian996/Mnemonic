"use client";

import { X } from "lucide-react";
import { useRef, useState } from "react";
import { deleteWordFromRepositoryAction, removeWordFromRepositoryPackAction } from "@/lib/services/word-service";
import { dispatchRepositoryPackRemoveEvent } from "@/lib/repository-pack-events";
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
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const removeFromPack = async () => {
    if (!packScope || isPending) return;
    const card = formRef.current?.closest<HTMLElement>("[data-repository-word-card='true']");
    setIsPending(true);
    setErrorMessage("");
    card?.classList.add("mn-repository-word-card-hidden");
    dispatchRepositoryPackRemoveEvent({ status: "pending", count: 1, packScope, word });

    try {
      const response = await fetch("/api/repository/word-pack-exclusions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packScope, wordIds: [id] })
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        removedCount?: number;
      };
      if (!response.ok) throw new Error(result.error || "移出词包失败。");

      dispatchRepositoryPackRemoveEvent({ status: "done", count: result.removedCount || 1, packScope, word });
      setIsPending(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "移出词包失败。";
      card?.classList.remove("mn-repository-word-card-hidden");
      dispatchRepositoryPackRemoveEvent({ status: "error", count: 1, packScope, word, message: `${message} 已恢复显示。` });
      setErrorMessage(message);
      setIsPending(false);
    }
  };

  return (
    <form
      ref={formRef}
      action={isRemoveFromPack ? removeWordFromRepositoryPackAction : deleteWordFromRepositoryAction}
      onSubmit={(event) => {
        if (isRemoveFromPack) {
          event.preventDefault();
          void removeFromPack();
          return;
        }
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
        disabled={isPending}
      >
        <X className={variant === "chip" ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </button>
      {errorMessage ? <span className="sr-only">{errorMessage}</span> : null}
    </form>
  );
}
