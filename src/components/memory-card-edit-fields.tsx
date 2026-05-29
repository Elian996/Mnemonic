"use client";

import type { ReactNode } from "react";
import { Link2 } from "lucide-react";
import { MarkdownImageTextarea } from "@/components/markdown-image-textarea";

export function MemoryCardEditFields({
  title,
  value,
  onValueChange,
  placeholder,
  disabled = false,
  autoFocus = false,
  actionSlot,
  relatedWords,
  onRelatedWordsChange,
  statusLabel,
  message,
  children
}: {
  title: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  autoFocus?: boolean;
  actionSlot?: ReactNode;
  relatedWords?: string;
  onRelatedWordsChange?: (value: string) => void;
  statusLabel: string;
  message?: string;
  children?: ReactNode;
}) {
  const showRelatedWords = typeof relatedWords === "string" && Boolean(onRelatedWordsChange);

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-[#171a1f] dark:text-foreground">{title}</h3>
        {actionSlot}
      </div>
      <MarkdownImageTextarea
        value={value}
        onValueChange={onValueChange}
        autoFocus={autoFocus}
        disabled={disabled}
        className="min-h-72 resize-y rounded-lg border-[#d8dde6] bg-white p-4 font-sans text-base leading-7 tracking-normal text-[#171a1f] shadow-none disabled:opacity-60 dark:border-border dark:bg-card dark:text-foreground"
        statusClassName="text-[#69717f] dark:text-muted-foreground"
        placeholder={placeholder}
      />
      {showRelatedWords ? (
        <label className="flex h-11 items-center gap-2 rounded-lg border border-[#d8dde6] bg-white px-3 text-[#69717f] focus-within:border-[#171a1f] dark:border-border dark:bg-card dark:text-muted-foreground dark:focus-within:border-foreground">
          <Link2 className="h-4 w-4 shrink-0" />
          <input
            type="text"
            value={relatedWords}
            onChange={(event) => onRelatedWordsChange?.(event.target.value)}
            disabled={disabled}
            className="h-full min-w-0 flex-1 bg-transparent font-sans text-sm tracking-normal text-[#171a1f] outline-none placeholder:text-[#8b93a1] disabled:opacity-60 dark:text-foreground dark:placeholder:text-muted-foreground"
            placeholder="相关单词：house, emotion"
          />
        </label>
      ) : null}
      <EditSaveStatus label={statusLabel} />
      {children}
      {message ? (
        <p className="text-xs leading-5 text-[#69717f] dark:text-muted-foreground" data-memory-card-export-hidden="true">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function EditSaveStatus({ label }: { label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#69717f] dark:text-muted-foreground">
      <span className="rounded-full border border-[#d8dde6] px-2 py-1 dark:border-border">
        手动保存
      </span>
      <span>{label}</span>
    </div>
  );
}
