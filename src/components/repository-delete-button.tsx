"use client";

import { X } from "lucide-react";
import { useRef, useState } from "react";
import { LoadingBox } from "@/components/loading-line";
import { deleteWordFromRepositoryAction, removeWordFromRepositoryPackAction } from "@/lib/services/word-service";
import { REPOSITORY_PACK_REMOVE_EVENT } from "@/lib/repository-pack-events";
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
    setIsPending(true);
    setErrorMessage("");
    formRef.current
      ?.closest("[data-repository-word-card]")
      ?.classList.add("mn-repository-word-card-removing");

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

      formRef.current?.closest("[data-repository-word-card]")?.setAttribute("hidden", "true");
      window.dispatchEvent(
        new CustomEvent(REPOSITORY_PACK_REMOVE_EVENT, {
          detail: { count: result.removedCount || 1, packScope }
        })
      );
    } catch (error) {
      formRef.current
        ?.closest("[data-repository-word-card]")
        ?.classList.remove("mn-repository-word-card-removing");
      setErrorMessage(error instanceof Error ? error.message : "移出词包失败。");
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
      {isPending ? (
        <div className="mn-repository-card-loading">
          <LoadingBox label="正在移出词包" description="单词和单词卡会保留" />
        </div>
      ) : null}
      {errorMessage ? <span className="sr-only">{errorMessage}</span> : null}
    </form>
  );
}
