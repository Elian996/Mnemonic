"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const storageKey = "mnemonic_memory_card_font";
const minFontSize = 14;
const maxFontSize = 24;
const defaultFontSize = 18;
const mobileFontToggleMediaQuery = "(max-width: 767px)";
const fontVariableNames = [
  "--memory-card-body-size",
  "--memory-card-body-line-height",
  "--memory-card-note-size",
  "--memory-card-heading-size",
  "--memory-card-meaning-size",
  "--word-card-title-size",
  "--word-card-meaning-size",
  "--word-row-title-size",
  "--word-row-meaning-size"
];

const legacySizes: Record<string, number> = {
  normal: 16,
  large: 18,
  xlarge: 20,
  xxlarge: 22
};

function clampFontSize(value: number) {
  return Math.min(Math.max(Math.round(value), minFontSize), maxFontSize);
}

function readStoredFontSize() {
  const stored = window.localStorage.getItem(storageKey);
  if (stored && stored in legacySizes) return legacySizes[stored];

  const parsed = Number.parseInt(stored ?? "", 10);
  return Number.isFinite(parsed) ? clampFontSize(parsed) : defaultFontSize;
}

function applyWordCardFont(size: number) {
  const root = document.documentElement;
  const px = clampFontSize(size);

  root.style.setProperty("--memory-card-body-size", `${px}px`);
  root.style.setProperty("--memory-card-body-line-height", px >= 22 ? "1.95" : "1.9");
  root.style.setProperty("--memory-card-note-size", `${Math.max(14, px - 1)}px`);
  root.style.setProperty("--memory-card-heading-size", `${px + 4}px`);
  root.style.setProperty("--memory-card-meaning-size", `${px + 1}px`);
  root.style.setProperty("--word-card-title-size", `${px + 10}px`);
  root.style.setProperty("--word-card-meaning-size", `${Math.max(14, px - 2)}px`);
  root.style.setProperty("--word-row-title-size", `${px + 4}px`);
  root.style.setProperty("--word-row-meaning-size", `${Math.max(14, px - 2)}px`);
  root.dataset.wordCardFontSize = String(px);
  window.localStorage.setItem(storageKey, String(px));
}

function clearAppliedWordCardFont() {
  const root = document.documentElement;
  for (const name of fontVariableNames) {
    root.style.removeProperty(name);
  }
  delete root.dataset.wordCardFontSize;
}

function isMobileFontToggleDisabled() {
  return window.matchMedia(mobileFontToggleMediaQuery).matches;
}

function isTextInputTarget(target: EventTarget | null) {
  return (
    (target instanceof HTMLInputElement && !["range", "button", "checkbox", "radio"].includes(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function readAppliedFontSize(fallback: number) {
  const currentSize = Number.parseInt(document.documentElement.dataset.wordCardFontSize ?? "", 10);
  return Number.isFinite(currentSize) ? currentSize : fallback;
}

export function MemoryCardFontToggle() {
  const [fontSize, setFontSize] = useState(defaultFontSize);
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const setFont = useCallback((nextSize: number) => {
    const boundedSize = clampFontSize(nextSize);
    setFontSize(boundedSize);
    applyWordCardFont(boundedSize);
  }, []);

  useLayoutEffect(() => {
    if (isMobileFontToggleDisabled()) {
      clearAppliedWordCardFont();
      return;
    }
    setFont(readStoredFontSize());
  }, [setFont]);

  useEffect(() => {
    const media = window.matchMedia(mobileFontToggleMediaQuery);
    const syncMobileState = () => {
      const nextIsMobile = media.matches;
      setIsMobile(nextIsMobile);
      if (nextIsMobile) {
        setIsOpen(false);
        clearAppliedWordCardFont();
      } else {
        setFont(readStoredFontSize());
      }
    };

    syncMobileState();
    media.addEventListener("change", syncMobileState);
    return () => media.removeEventListener("change", syncMobileState);
  }, [setFont]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isMobileFontToggleDisabled()) return;
      if (isTextInputTarget(event.target)) return;
      if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;

      const isIncreaseShortcut =
        event.key === "+" || event.key === "=" || event.code === "Equal" || event.code === "NumpadAdd";
      const isDecreaseShortcut =
        event.key === "-" ||
        event.key === "_" ||
        event.key === "−" ||
        event.key === "Subtract" ||
        event.code === "Minus" ||
        event.code === "NumpadSubtract";

      if (isIncreaseShortcut) {
        event.preventDefault();
        setFont(readAppliedFontSize(fontSize) + 1);
      } else if (isDecreaseShortcut) {
        event.preventDefault();
        setFont(readAppliedFontSize(fontSize) - 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fontSize, setFont]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (wrapperRef.current?.contains(event.target as Node)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const progress = ((fontSize - minFontSize) / (maxFontSize - minFontSize)) * 100;

  if (isMobile) return null;

  return (
    <div ref={wrapperRef} className="mn-memory-card-font-toggle relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-expanded={isOpen}
        aria-label={`单词卡字号 ${fontSize}px`}
        title="调节单词卡字号"
        onClick={() => setIsOpen((value) => !value)}
        className="h-9 w-9 rounded-md border border-[#d8dde6] bg-white text-[#171a1f] hover:border-[#171a1f] hover:bg-white dark:border-border dark:bg-card dark:text-foreground dark:hover:border-foreground"
      >
        <span className="text-sm font-semibold leading-none tracking-normal">Aa</span>
      </Button>

      {isOpen ? (
        <div className="absolute right-0 top-10 z-[90] w-64 rounded-lg border border-[#d8dde6] bg-white p-4 text-[#171a1f] shadow-[0_12px_34px_rgba(23,26,31,0.16)] dark:border-border dark:bg-card dark:text-foreground">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-sm font-semibold text-[#69717f] dark:text-muted-foreground">字号</div>
            <div className="text-lg font-semibold tabular-nums">{fontSize}px</div>
          </div>
          <input
            type="range"
            min={minFontSize}
            max={maxFontSize}
            step={1}
            value={fontSize}
            onChange={(event) => setFont(Number(event.target.value))}
            aria-label="单词卡字号"
            className="font-size-slider mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#e5e9f0] dark:bg-muted"
            style={{
              background: `linear-gradient(to right, var(--font-size-slider-fill) 0%, var(--font-size-slider-fill) ${progress}%, var(--font-size-slider-track) ${progress}%, var(--font-size-slider-track) 100%)`
            }}
          />
          <div className="mt-2 flex justify-between text-xs font-medium text-[#69717f] dark:text-muted-foreground">
            <span>{minFontSize}px</span>
            <span>{maxFontSize}px</span>
          </div>
          <div className="mt-4 border-t border-[#eef2f6] pt-3 text-xs font-medium text-[#69717f] dark:border-border dark:text-muted-foreground">
            快捷键：
            <kbd className="mx-1 rounded bg-[#171a1f] px-1.5 py-0.5 text-[11px] font-semibold text-white dark:bg-foreground dark:text-background">⇧</kbd>
            +
            <kbd className="mx-1 rounded bg-[#171a1f] px-1.5 py-0.5 text-[11px] font-semibold text-white dark:bg-foreground dark:text-background">+</kbd>
            /
            <kbd className="mx-1 rounded bg-[#171a1f] px-1.5 py-0.5 text-[11px] font-semibold text-white dark:bg-foreground dark:text-background">-</kbd>
            调节字号
          </div>
        </div>
      ) : null}
    </div>
  );
}
