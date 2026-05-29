"use client";

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { WikiRichText } from "@/components/wiki-rich-text";

export function MemoryCardReadView({
  title,
  splitText,
  html,
  onContentClick,
  mediaSlot,
  footerSlot,
  message,
  emptyMessage = "暂无助记卡。"
}: {
  title: string;
  splitText?: string;
  html?: string;
  onContentClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  mediaSlot?: ReactNode;
  footerSlot?: ReactNode;
  message?: string;
  emptyMessage?: string;
}) {
  const hasHtml = Boolean(html?.trim());

  return (
    <>
      <h3 className="memory-card-heading mt-2 font-semibold text-[#171a1f] dark:text-foreground">
        {title}
      </h3>
      {splitText?.trim() ? (
        <div className="memory-card-note memory-card-split mt-3 rounded-md px-3 py-2 font-medium text-[#323741] dark:text-foreground/85">
          {splitText}
        </div>
      ) : null}
      {mediaSlot}
      <div
        className="memory-card-readable mt-3 text-[#323741] dark:text-foreground/85"
        onClick={onContentClick}
      >
        {hasHtml ? (
          <WikiRichText html={html ?? ""} />
        ) : (
          <p className="rounded-md border border-dashed border-[#cbd3df] px-3 py-8 text-center text-sm text-[#69717f] dark:border-border dark:text-muted-foreground">
            {emptyMessage}
          </p>
        )}
      </div>
      {footerSlot}
      {message ? (
        <p
          className="mt-3 text-xs leading-5 text-[#69717f] dark:text-muted-foreground"
          data-memory-card-export-hidden="true"
        >
          {message}
        </p>
      ) : null}
    </>
  );
}
