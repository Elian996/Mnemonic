"use client";

import { ChevronRight } from "lucide-react";
import { WordCardPopupButton } from "@/components/word-card-popup-button";
import type { MnemonicMissingImageItem } from "@/lib/mnemonic-missing-image-report";

export function RepositoryMissingImageResults({
  items,
  navigationSlugs,
  isAuthenticated,
  defaultUserCardVisibility,
  canEditOfficialCards,
  canExportMemoryCardImages
}: {
  items: MnemonicMissingImageItem[];
  navigationSlugs: string[];
  isAuthenticated: boolean;
  defaultUserCardVisibility: "private" | "public";
  canEditOfficialCards: boolean;
  canExportMemoryCardImages: boolean;
}) {
  return (
    <div className="mt-5 divide-y divide-border/70">
      {items.map((item) => (
        <MissingImageItem
          key={item.entryId}
          item={item}
          navigationSlugs={navigationSlugs}
          isAuthenticated={isAuthenticated}
          defaultUserCardVisibility={defaultUserCardVisibility}
          canEditOfficialCards={canEditOfficialCards}
          canExportMemoryCardImages={canExportMemoryCardImages}
        />
      ))}
    </div>
  );
}

function MissingImageItem({
  item,
  navigationSlugs,
  isAuthenticated,
  defaultUserCardVisibility,
  canEditOfficialCards,
  canExportMemoryCardImages
}: {
  item: MnemonicMissingImageItem;
  navigationSlugs: string[];
  isAuthenticated: boolean;
  defaultUserCardVisibility: "private" | "public";
  canEditOfficialCards: boolean;
  canExportMemoryCardImages: boolean;
}) {
  return (
    <details className="group py-4">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 marker:hidden">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <WordCardPopupButton
            slug={item.slug}
            navigationSlugs={navigationSlugs}
            stopClickPropagation
            isAuthenticated={isAuthenticated}
            defaultUserCardVisibility={defaultUserCardVisibility}
            canEditOfficialCards={canEditOfficialCards}
            canExportMemoryCardImages={canExportMemoryCardImages}
            className="min-w-0 text-left text-base font-semibold text-foreground transition hover:text-[var(--mn-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mn-accent)] focus-visible:ring-offset-2"
            ariaLabel={`打开 ${item.word} 当前单词卡`}
          >
            {item.word}
          </WordCardPopupButton>
          <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-100">
            {item.cueMatches.slice(0, 3).join(" / ")}
          </span>
          <span className="rounded-md bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
            {item.sourceType}
          </span>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground transition group-open:rotate-90" />
      </summary>

      <div className="mt-3 rounded-lg border border-border/70 bg-muted/50 p-3">
        <p className="text-xs font-semibold text-muted-foreground">{item.reason}</p>
        <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{item.preview}</pre>
      </div>
    </details>
  );
}
