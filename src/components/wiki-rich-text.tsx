"use client";

import { ExternalLink, Loader2, X } from "lucide-react";
import { type MouseEvent, type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type WordCardPayload = {
  id: string;
  word: string;
  slug: string;
  phonetic: string | null;
  partOfSpeech: string | null;
  meaningCn: string | null;
  exampleSentence: string | null;
  exampleTranslation: string | null;
  mnemonic: {
    title: string | null;
    splitText: string | null;
    contentHtml: string;
    plainText: string | null;
  } | null;
};

type PopoverState = {
  slug: string;
  href: string;
  label: string;
  requestId: number;
  position: {
    left: number;
    top: number;
    width: number;
  };
  status: "loading" | "ready" | "error";
  word?: WordCardPayload;
  message?: string;
};

export function WikiRichText({ html, wordCardPopover = false }: { html: string; wordCardPopover?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef(new Map<string, WordCardPayload>());
  const requestIdRef = useRef(0);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    if (!popover) return;

    const close = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && (rootRef.current?.contains(target) || popoverRef.current?.contains(target))) return;
      setPopover(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopover(null);
    };

    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [popover]);

  const openAnchor = (anchor: HTMLAnchorElement) => {
    const link = readWordLink(anchor);
    if (!link) return false;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const cachedWord = cacheRef.current.get(link.slug);
    setPopover({
      ...link,
      requestId,
      position: popoverPosition(anchor.getBoundingClientRect()),
      status: cachedWord ? "ready" : "loading",
      word: cachedWord
    });

    if (cachedWord) return true;

    fetch(`/api/word-card/${encodeURIComponent(link.slug)}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(response.status === 404 ? "not-found" : "failed");
        }
        return (await response.json()) as WordCardPayload;
      })
      .then((word) => {
        cacheRef.current.set(word.slug, word);
        setPopover((current) => (current?.requestId === requestId ? { ...current, status: "ready", word } : current));
      })
      .catch((error: Error) => {
        const message = error.message === "not-found" ? "词库里还没有这个单词的信息。" : "单词信息暂时打不开。";
        setPopover((current) => (current?.requestId === requestId ? { ...current, status: "error", message } : current));
      });

    return true;
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!wordCardPopover || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const anchor = findWordAnchor(event.target);
    if (!anchor || !rootRef.current?.contains(anchor)) return;
    if (!openAnchor(anchor)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePopoverClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!wordCardPopover || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const anchor = findWordAnchor(event.target);
    if (!anchor || !popoverRef.current?.contains(anchor)) return;
    if (!openAnchor(anchor)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <>
      <div ref={rootRef} className="reading" onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />
      {wordCardPopover && portalRoot && popover
        ? createPortal(
            <WordInfoPopover
              popoverRef={popoverRef}
              state={popover}
              onClose={() => setPopover(null)}
              onClick={handlePopoverClick}
            />,
            portalRoot
          )
        : null}
    </>
  );
}

function WordInfoPopover({
  popoverRef,
  state,
  onClose,
  onClick
}: {
  popoverRef: RefObject<HTMLDivElement | null>;
  state: PopoverState;
  onClose: () => void;
  onClick: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`${state.label} 单词信息`}
      className="fixed z-[90] max-h-[min(70vh,520px)] overflow-auto rounded-lg border border-[#d8dde6] bg-white text-[#171a1f] shadow-[0_18px_60px_rgba(23,26,31,0.18)] dark:border-border dark:bg-card dark:text-foreground"
      style={{ left: state.position.left, top: state.position.top, width: state.position.width }}
      onClick={onClick}
    >
      <header className="flex items-start justify-between gap-3 border-b border-[#eef2f6] p-4 dark:border-border">
        <div className="min-w-0">
          <div className="truncate text-2xl font-semibold tracking-normal">{state.word?.word ?? state.label}</div>
          {state.word ? (
            <div className="mt-1 truncate text-sm text-[#69717f] dark:text-muted-foreground">
              {[state.word.phonetic, state.word.partOfSpeech].filter(Boolean).join(" · ") || "单词信息"}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="关闭单词信息"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="p-4">
        {state.status === "loading" ? (
          <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-[#69717f] dark:text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取单词信息
          </div>
        ) : state.status === "error" ? (
          <div className="rounded-md border border-dashed border-[#cbd3df] px-3 py-8 text-center text-sm text-[#69717f] dark:border-border dark:text-muted-foreground">
            {state.message}
          </div>
        ) : state.word ? (
          <>
            <section className="rounded-md bg-[#f7f8fb] p-3 text-sm font-medium leading-6 text-[#323741] dark:bg-muted dark:text-foreground/85">
              {state.word.meaningCn || "释义待补"}
            </section>

            <section className="mt-4 border-t border-[#eef2f6] pt-4 dark:border-border">
              <div className="text-xs font-semibold text-[#8b93a1] dark:text-muted-foreground">记忆卡</div>
              {state.word.mnemonic ? (
                <>
                  {state.word.mnemonic.title ? <h3 className="mt-2 text-base font-semibold">{state.word.mnemonic.title}</h3> : null}
                  {state.word.mnemonic.splitText ? (
                    <div className="mt-2 rounded-md border border-[#d8dde6] bg-white px-3 py-2 text-sm text-[#323741] dark:border-border dark:bg-card dark:text-foreground/85">
                      划分：{state.word.mnemonic.splitText}
                    </div>
                  ) : null}
                  <div
                    className="reading mt-2 max-h-48 overflow-auto text-sm leading-7 text-[#323741] dark:text-foreground/85"
                    dangerouslySetInnerHTML={{ __html: state.word.mnemonic.contentHtml }}
                  />
                </>
              ) : (
                <p className="mt-2 rounded-md border border-dashed border-[#cbd3df] px-3 py-6 text-center text-sm text-[#69717f] dark:border-border dark:text-muted-foreground">
                  暂无记忆卡。
                </p>
              )}
            </section>

            {state.word.exampleSentence ? (
              <section className="mt-4 border-t border-[#eef2f6] pt-4 text-sm leading-6 dark:border-border">
                <div className="text-xs font-semibold text-[#8b93a1] dark:text-muted-foreground">例句</div>
                <p className="mt-2 text-[#323741] dark:text-foreground/85">{state.word.exampleSentence}</p>
                {state.word.exampleTranslation ? <p className="mt-1 text-[#69717f] dark:text-muted-foreground">{state.word.exampleTranslation}</p> : null}
              </section>
            ) : null}
          </>
        ) : null}

        <a
          href={state.href}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-[#d8dde6] px-3 text-sm font-semibold text-[#171a1f] transition hover:border-[#171a1f] dark:border-border dark:text-foreground dark:hover:border-foreground"
        >
          打开单词页
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}

function findWordAnchor(target: EventTarget | null) {
  const element = target instanceof Element ? target.closest("a.wiki-link-word[href]") : null;
  return element instanceof HTMLAnchorElement ? element : null;
}

function readWordLink(anchor: HTMLAnchorElement) {
  const rawHref = anchor.getAttribute("href");
  if (!rawHref) return null;
  const url = new URL(rawHref, window.location.origin);
  if (!url.pathname.startsWith("/word/")) return null;
  const slug = decodeURIComponent(url.pathname.replace(/^\/word\//, "").split("/")[0] ?? "").trim();
  if (!slug) return null;
  return {
    slug,
    href: `${url.pathname}${url.search}${url.hash}`,
    label: anchor.textContent?.trim() || slug
  };
}

function popoverPosition(rect: DOMRect) {
  const width = Math.max(260, Math.min(380, window.innerWidth - 24));
  const centeredLeft = rect.left + rect.width / 2 - width / 2;
  const left = Math.max(12, Math.min(centeredLeft, window.innerWidth - width - 12));
  const belowTop = rect.bottom + 10;
  const aboveTop = rect.top - 370;
  const hasRoomBelow = belowTop + 320 <= window.innerHeight;
  const top = hasRoomBelow || aboveTop < 12 ? Math.min(belowTop, window.innerHeight - 96) : Math.max(12, aboveTop);
  return { left, top, width };
}
