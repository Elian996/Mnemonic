"use client";

import { Check, Loader2, Pencil, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MemoryCardEditFields } from "@/components/memory-card-edit-fields";
import { MemoryCardReadView } from "@/components/memory-card-read-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MemoryCardTray, type LevelWordItem } from "@/components/level-word-browser";
import {
  approveAiGeneratedWordCardDraftInlineAction,
  rejectAiGeneratedWordCardDraftInlineAction,
  undoAiGeneratedWordCardDraftApprovalInlineAction,
  updateAiGeneratedWordCardDraftInlineAction
} from "@/lib/services/ai-generated-word-card-service";
import { cn } from "@/lib/utils";
import {
  editableMnemonicContentFromParts,
  relatedWordText,
  withRelatedWordLinks
} from "@/lib/mnemonic-card-editing";

export type AiGeneratedWordCardGridItem = {
  id: string;
  word: string;
  slug: string;
  phonetic: string;
  partOfSpeech: string;
  meaning: string;
  fullMeaning: string;
  splitText: string;
  contentMarkdown: string;
  contentHtml: string;
  imageUrl: string;
  targetHasActiveCard: boolean;
  payload: {
    methodLabel: string;
    routeSummary: string;
    confidence: number;
  };
};

export function AiGeneratedWordCardGrid({ items }: { items: AiGeneratedWordCardGridItem[] }) {
  const router = useRouter();
  const [visibleItems, setVisibleItems] = useState(items);
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [approvedHistory, setApprovedHistory] = useState<Array<{ item: AiGeneratedWordCardGridItem; index: number }>>([]);
  const [linkedOpenCards, setLinkedOpenCards] = useState<LevelWordItem[]>([]);
  const [activeLinkedCardId, setActiveLinkedCardId] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [message, setMessage] = useState("");
  const itemButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const linkedWordCache = useRef(new Map<string, LevelWordItem>());
  const activeItem = useMemo(() => visibleItems.find((item) => item.id === activeId) ?? null, [activeId, visibleItems]);
  const selectedItem = useMemo(() => visibleItems.find((item) => item.id === selectedId) ?? visibleItems[0] ?? null, [selectedId, visibleItems]);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  useEffect(() => {
    setVisibleItems(items);
    setSelectedId((current) => (current && items.some((item) => item.id === current) ? current : (items[0]?.id ?? null)));
    setActiveId((current) => (current && items.some((item) => item.id === current) ? current : null));
  }, [items]);

  useEffect(() => {
    const html = document.documentElement;
    if (activeItem) html.classList.add("mn-memory-card-open");
    else html.classList.remove("mn-memory-card-open");
    return () => {
      html.classList.remove("mn-memory-card-open");
    };
  }, [activeItem]);

  const updateVisibleItem = useCallback((updatedItem: AiGeneratedWordCardGridItem) => {
    setVisibleItems((current) => current.map((item) => (item.id === updatedItem.id ? updatedItem : item)));
  }, []);

  const openLinkedWordCard = useCallback((word: LevelWordItem) => {
    linkedWordCache.current.set(word.slug, word);
    setActiveLinkedCardId(word.id);
    setLinkedOpenCards((current) => [word, ...current.filter((item) => item.id !== word.id)].slice(0, 5));
  }, []);

  const updateLinkedWordCard = useCallback((updatedWord: LevelWordItem) => {
    linkedWordCache.current.set(updatedWord.slug, updatedWord);
    setLinkedOpenCards((current) =>
      current.map((word) => (word.id === updatedWord.id ? { ...word, ...updatedWord } : word))
    );
  }, []);

  const openLinkedWordBySlug = useCallback(
    async (slug: string) => {
      const normalizedSlug = slug.trim();
      if (!normalizedSlug) return false;

      const cachedWord = linkedWordCache.current.get(normalizedSlug);
      if (cachedWord) {
        openLinkedWordCard(cachedWord);
        void refreshWordCard(normalizedSlug, updateLinkedWordCard);
        return true;
      }

      setMessage("");
      try {
        const fetchedWord = await fetchWordCard(normalizedSlug);
        openLinkedWordCard(fetchedWord);
        return true;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "相关单词卡加载失败。");
        return false;
      }
    },
    [openLinkedWordCard, updateLinkedWordCard]
  );

  const selectByIndex = useCallback(
    (index: number, open = false) => {
      if (!visibleItems.length) return;
      const nextIndex = (index + visibleItems.length) % visibleItems.length;
      const nextItem = visibleItems[nextIndex];
      setSelectedId(nextItem.id);
      if (open) setActiveId(nextItem.id);
      requestAnimationFrame(() => {
        itemButtonRefs.current.get(nextItem.id)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    },
    [visibleItems]
  );

  const moveSelection = useCallback(
    (direction: 1 | -1, open = Boolean(activeItem)) => {
      const currentId = activeItem?.id ?? selectedItem?.id;
      const currentIndex = Math.max(0, visibleItems.findIndex((item) => item.id === currentId));
      selectByIndex(currentIndex + direction, open);
    },
    [activeItem, selectByIndex, selectedItem, visibleItems]
  );

  const approveActive = useCallback(async () => {
    if (!activeItem || isApproving || isRejecting || activeItem.targetHasActiveCard) return;
    if (!activeItem.contentMarkdown.trim()) {
      setMessage(`${activeItem.word} 暂未生成可发布内容，不能审核通过。`);
      return;
    }
    const currentItems = visibleItems;
    const currentIndex = currentItems.findIndex((item) => item.id === activeItem.id);
    const nextItem = currentItems[currentIndex + 1] ?? currentItems[currentIndex - 1] ?? null;
    setIsApproving(true);
    setMessage("");
    try {
      await approveAiGeneratedWordCardDraftInlineAction(activeItem.id);
      setApprovedHistory((current) => [{ item: activeItem, index: Math.max(0, currentIndex) }, ...current].slice(0, 5));
      setVisibleItems((current) => current.filter((item) => item.id !== activeItem.id));
      setSelectedId(nextItem?.id ?? null);
      setActiveId(nextItem?.id ?? null);
      setMessage(`已通过 ${activeItem.word}，发布为官方记忆卡。`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "审核通过失败。");
    } finally {
      setIsApproving(false);
    }
  }, [activeItem, isApproving, isRejecting, router, visibleItems]);

  const rejectActive = useCallback(async () => {
    if (!activeItem || isApproving || isRejecting) return;
    const currentItems = visibleItems;
    const currentIndex = currentItems.findIndex((item) => item.id === activeItem.id);
    const nextItem = currentItems[currentIndex + 1] ?? currentItems[currentIndex - 1] ?? null;
    setIsRejecting(true);
    setMessage("");
    try {
      await rejectAiGeneratedWordCardDraftInlineAction(activeItem.id);
      setVisibleItems((current) => current.filter((item) => item.id !== activeItem.id));
      setSelectedId(nextItem?.id ?? null);
      setActiveId(nextItem?.id ?? null);
      setMessage(`已驳回 ${activeItem.word}。`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "驳回失败。");
    } finally {
      setIsRejecting(false);
    }
  }, [activeItem, isApproving, isRejecting, router, visibleItems]);

  const undoLastApproval = useCallback(async () => {
    const last = approvedHistory[0];
    if (!last || isUndoing || isApproving || isRejecting) return;
    setIsUndoing(true);
    setMessage("");
    try {
      await undoAiGeneratedWordCardDraftApprovalInlineAction(last.item.id);
      setVisibleItems((current) => {
        if (current.some((item) => item.id === last.item.id)) return current;
        const next = [...current];
        next.splice(Math.min(last.index, next.length), 0, last.item);
        return next;
      });
      setApprovedHistory((current) => current.slice(1));
      setSelectedId(last.item.id);
      setActiveId(last.item.id);
      setMessage(`已撤回 ${last.item.word}，草稿回到待审。`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "撤回失败。");
    } finally {
      setIsUndoing(false);
    }
  }, [approvedHistory, isApproving, isRejecting, isUndoing, router]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEditingTarget(event.target)) return;
      if (isAiGeneratedDraftEditorOpen()) return;
      if (linkedOpenCards.length) return;

      if (isAiGeneratedUndoShortcut(event)) {
        if (!approvedHistory.length || isApproving || isRejecting || isUndoing) return;
        event.preventDefault();
        void undoLastApproval();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (!visibleItems.length) return;
      const isInteractiveTarget = isShortcutInteractiveTarget(event.target);

      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveSelection(1);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveSelection(-1);
        return;
      }
      if ((event.key === " " || event.code === "Space") && !isInteractiveTarget) {
        event.preventDefault();
        if (activeItem) setActiveId(null);
        else if (selectedItem) setActiveId(selectedItem.id);
        return;
      }
      if (event.key === "Escape" && activeItem) {
        event.preventDefault();
        setActiveId(null);
        return;
      }
      if (event.key === "Enter" && activeItem && !isInteractiveTarget) {
        event.preventDefault();
        void approveActive();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    activeItem,
    approveActive,
    approvedHistory.length,
    isApproving,
    isRejecting,
    isUndoing,
    linkedOpenCards.length,
    moveSelection,
    selectedItem,
    undoLastApproval,
    visibleItems.length
  ]);

  return (
    <>
      <div className="mn-level-word-grid mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visibleItems.map((item) => {
          const selected = selectedItem?.id === item.id;
          return (
            <button
              key={item.id}
              type="button"
              ref={(node) => {
                if (node) itemButtonRefs.current.set(item.id, node);
                else itemButtonRefs.current.delete(item.id);
              }}
              data-level-word-id={draftWordId(item.id)}
              onClick={() => {
                setSelectedId(item.id);
                setActiveId(item.id);
              }}
              className={cn(
                "mn-level-word-card group flex min-h-44 appearance-none flex-col justify-between rounded-lg border border-[#d8dde6] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[#171a1f] hover:shadow-sm focus:outline-none focus-visible:border-[#1a73e8] focus-visible:ring-2 focus-visible:ring-[#1a73e8] dark:border-border dark:bg-card dark:hover:border-foreground",
                selected &&
                  "border-[#1a73e8] ring-2 ring-[#1a73e8] dark:border-[#7ab7ff] dark:ring-[#7ab7ff]"
              )}
              aria-label={`审核 ${item.word} AI生成单词卡`}
              aria-current={selected ? "true" : undefined}
            >
              <span>
                <span className="word-card-title block truncate font-semibold tracking-normal text-[#171a1f] dark:text-foreground">
                  {item.word}
                </span>
                <span className="word-card-meaning mt-6 block min-h-12 text-[#323741] dark:text-foreground/80">
                  {item.meaning || item.fullMeaning || "释义待补"}
                </span>
              </span>
              <span className="mt-4 block border-t border-[#eef2f6] pt-3 text-xs font-semibold leading-5 text-[#69717f] dark:border-border dark:text-muted-foreground">
                <span className="block truncate">
                  {item.targetHasActiveCard ? "目标已有卡" : item.splitText || item.payload.methodLabel || "AI生成单词卡"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {message ? <p className="mt-3 text-sm font-medium text-[#64748b] dark:text-muted-foreground">{message}</p> : null}

      {portalRoot && activeItem
        ? createPortal(
            <AiGeneratedReviewCardDialog
              item={activeItem}
              onClose={() => setActiveId(null)}
              onPrevious={() => moveSelection(-1, true)}
              onNext={() => moveSelection(1, true)}
              onApprove={approveActive}
              onReject={rejectActive}
              onUndo={approvedHistory.length ? undoLastApproval : undefined}
              onItemUpdate={updateVisibleItem}
              onOpenLinkedWord={openLinkedWordBySlug}
              isApproving={isApproving}
              isRejecting={isRejecting}
              isUndoing={isUndoing}
              lastApprovedWord={approvedHistory[0]?.item.word ?? ""}
            />,
            portalRoot
          )
        : null}
      {linkedOpenCards.length ? (
        <MemoryCardTray
          words={linkedOpenCards}
          activeCardId={activeLinkedCardId}
          onActivate={setActiveLinkedCardId}
          onClose={(wordId) =>
            setLinkedOpenCards((current) => current.filter((word) => word.id !== wordId))
          }
          onOpenLinkedWord={openLinkedWordBySlug}
          onWordUpdate={updateLinkedWordCard}
          isAuthenticated
          overlayClassName="z-[90]"
        />
      ) : null}
    </>
  );
}

function AiGeneratedReviewCardDialog({
  item,
  onClose,
  onPrevious,
  onNext,
  onApprove,
  onReject,
  onUndo,
  onItemUpdate,
  onOpenLinkedWord,
  isApproving,
  isRejecting,
  isUndoing,
  lastApprovedWord
}: {
  item: AiGeneratedWordCardGridItem;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onApprove: () => void;
  onReject: () => void;
  onUndo?: () => void;
  onItemUpdate: (item: AiGeneratedWordCardGridItem) => void;
  onOpenLinkedWord: (slug: string) => Promise<boolean>;
  isApproving: boolean;
  isRejecting: boolean;
  isUndoing: boolean;
  lastApprovedWord: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState(() => editableDraftContent(item));
  const [relatedWords, setRelatedWords] = useState(() => relatedWordText(item.contentMarkdown));
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [editorMessage, setEditorMessage] = useState("");
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const lastSavedSignatureRef = useRef(draftEditSignature(editableDraftContent(item), relatedWordText(item.contentMarkdown)));
  const autoSaveRunRef = useRef(0);

  useEffect(() => {
    const nextContent = editableDraftContent(item);
    setIsEditing(false);
    setDraftContent(nextContent);
    setRelatedWords(relatedWordText(item.contentMarkdown));
    setEditorMessage("");
    setAutoSaveStatus("idle");
    lastSavedSignatureRef.current = draftEditSignature(nextContent, relatedWordText(item.contentMarkdown));
  }, [item.id]);

  const saveDraft = useCallback(
    async (closeAfterSave: boolean) => {
      if (isSavingDraft) return false;
      const content = withRelatedWordLinks(draftContent, relatedWords).trim();
      if (!content) {
        setAutoSaveStatus("error");
        setEditorMessage("记忆卡内容不能为空。");
        return false;
      }

      const runId = ++autoSaveRunRef.current;
      setIsSavingDraft(true);
      setAutoSaveStatus("saving");
      setEditorMessage("");
      try {
        const result = await updateAiGeneratedWordCardDraftInlineAction({
          draftId: item.id,
          contentMarkdown: content
        });
        if (runId !== autoSaveRunRef.current) return true;
        const updatedItem = {
          ...item,
          splitText: result.splitText,
          contentMarkdown: result.contentMarkdown,
          contentHtml: result.contentHtml
        };
        onItemUpdate(updatedItem);
        const updatedRelatedWords = relatedWordText(updatedItem.contentMarkdown);
        setRelatedWords(updatedRelatedWords);
        lastSavedSignatureRef.current = draftEditSignature(editableDraftContent(updatedItem), updatedRelatedWords);
        setAutoSaveStatus("saved");
        setEditorMessage(closeAfterSave ? "已保存草稿。" : "已自动保存。");
        if (closeAfterSave) setIsEditing(false);
        return true;
      } catch (error) {
        if (runId !== autoSaveRunRef.current) return false;
        setAutoSaveStatus("error");
        setEditorMessage(error instanceof Error ? error.message : "保存失败。");
        return false;
      } finally {
        if (runId === autoSaveRunRef.current) setIsSavingDraft(false);
      }
    },
    [draftContent, isSavingDraft, item, onItemUpdate, relatedWords]
  );

  useEffect(() => {
    if (!isEditing || isSavingDraft) return;
    const signature = draftEditSignature(draftContent, relatedWords);
    if (!withRelatedWordLinks(draftContent, relatedWords).trim() || signature === lastSavedSignatureRef.current) {
      setAutoSaveStatus("idle");
      return;
    }

    setAutoSaveStatus("pending");
    const timer = window.setTimeout(() => {
      void saveDraft(false);
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [draftContent, isEditing, isSavingDraft, relatedWords, saveDraft]);

  const cancelEdit = () => {
    if (isSavingDraft) return;
    setDraftContent(editableDraftContent(item));
    setRelatedWords(relatedWordText(item.contentMarkdown));
    setEditorMessage("");
    setAutoSaveStatus("idle");
    setIsEditing(false);
  };

  const handleCardContentClick = async (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a.wiki-link-word[href]") : null;
    const slug = anchor ? wordSlugFromHref(anchor.getAttribute("href")) : "";
    if (!slug) return;

    event.preventDefault();
    event.stopPropagation();
    await onOpenLinkedWord(slug);
  };

  const busy = isApproving || isRejecting || isUndoing || isSavingDraft;
  const hasDraftContent = Boolean(item.contentMarkdown.trim());
  const canApprove = hasDraftContent && !item.targetHasActiveCard;
  const shouldShowImagePreview = Boolean(item.imageUrl && !item.contentMarkdown.includes(item.imageUrl));

  return (
    <div className="pointer-events-auto fixed inset-0 z-[70]" role="presentation">
      <button
        type="button"
        className="mn-memory-card-backdrop absolute inset-0 bg-[#171a1f]/10 backdrop-blur-[1px] dark:bg-black/35"
        aria-label="关闭 AI生成单词卡"
        onClick={onClose}
      />
      <article
        data-memory-card-panel="true"
        role="dialog"
        aria-modal="true"
        aria-label={`${item.word} AI生成单词卡审核`}
        data-ai-generated-draft-editor={isEditing ? "true" : undefined}
        className="mn-memory-card-panel pointer-events-auto fixed left-1/2 top-20 isolate flex max-h-[calc(100vh-7rem)] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-[#e5e5e7] bg-white opacity-100 shadow-[0_24px_80px_rgba(23,26,31,0.16)] outline-none dark:border-border dark:bg-[#1c1c1e]"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#f0f0f2] bg-white p-5 dark:border-border dark:bg-[#1c1c1e]">
          <div className="min-w-0">
            <h2 className="truncate text-4xl font-semibold tracking-normal text-[#171a1f] dark:text-foreground">
              {item.word}
            </h2>
            <p className="mt-2 min-w-0 truncate text-sm text-[#69717f] dark:text-muted-foreground">
              {[item.phonetic, item.partOfSpeech].filter(Boolean).join(" · ") || "单词信息"}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2" data-memory-card-export-hidden="true">
            <div className="flex items-center gap-2">
              {isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={() => void saveDraft(true)}
                    disabled={isSavingDraft}
                    aria-label="保存 AI生成单词卡草稿"
                    title="保存草稿"
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#b9e5ce] bg-[#effaf3] text-[#168458] transition hover:border-[#168458] disabled:pointer-events-none disabled:opacity-50 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
                  >
                    {isSavingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={isSavingDraft}
                    aria-label="退出 AI生成单词卡草稿编辑"
                    title="退出编辑"
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#f1b8ad] bg-[#fff1ee] text-[#c2412d] transition hover:border-[#c2412d] disabled:pointer-events-none disabled:opacity-50 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    aria-label="改写 AI生成单词卡草稿"
                    title="改写草稿"
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={onPrevious}
                    aria-label="上一张 AI生成单词卡，快捷键左方向键"
                    title="上一张 (←)"
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
                  >
                    <span aria-hidden="true">‹</span>
                  </button>
                  <button
                    type="button"
                    onClick={onNext}
                    aria-label="下一张 AI生成单词卡，快捷键右方向键"
                    title="下一张 (→)"
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
                  >
                    <span aria-hidden="true">›</span>
                  </button>
                  <Badge className={cn("rounded-full px-3 py-1 text-xs", item.targetHasActiveCard ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900")}>
                    {item.targetHasActiveCard ? "目标已有卡" : hasDraftContent ? "待审核" : "暂不生成"}
                  </Badge>
                </>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭 AI生成单词卡，快捷键 Esc"
                title="关闭 (Esc)"
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <div data-memory-card-scroll-area="true" className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white p-5 dark:bg-[#1c1c1e]">
          <section className="memory-card-meaning-panel">
            <div className="memory-card-meaning font-semibold">{item.fullMeaning || item.meaning || "释义待补"}</div>
          </section>

          <section className="mt-4 border-t border-[#eef2f6] pt-4 dark:border-border">
            <div className="text-xs font-semibold tracking-normal text-[#8b93a1] dark:text-muted-foreground">
              记忆卡
            </div>
            {isEditing ? (
              <MemoryCardEditFields
                title="编辑记忆卡"
                value={draftContent}
                onValueChange={setDraftContent}
                autoFocus
                disabled={isSavingDraft}
                placeholder={editableDraftContent(item)}
                relatedWords={relatedWords}
                onRelatedWordsChange={setRelatedWords}
                statusLabel={aiGeneratedDraftSaveStatusLabel(autoSaveStatus)}
                message={editorMessage}
              />
            ) : (
              <MemoryCardReadView
                title={`${item.word} 记忆卡片`}
                splitText={item.splitText}
                html={hasDraftContent ? item.contentHtml : ""}
                onContentClick={handleCardContentClick}
                message={editorMessage}
                emptyMessage="这张暂不生成：当前逻辑牵强，等待人工重写。"
                mediaSlot={
                  shouldShowImagePreview ? (
                    <figure className="mt-3 overflow-hidden rounded-lg border border-[#eef2f6] bg-[#f8fafc] dark:border-border dark:bg-muted/30">
                      <img
                        src={item.imageUrl}
                        alt={`${item.word} 助记图`}
                        className="max-h-80 w-full object-contain"
                        loading="lazy"
                      />
                    </figure>
                  ) : null
                }
              />
            )}
          </section>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#f0f0f2] bg-white px-5 py-4 dark:border-border dark:bg-[#1c1c1e]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#f5f5f7] px-2.5 py-1 text-xs font-semibold text-[#69717f] dark:bg-muted dark:text-muted-foreground">
                {item.payload.methodLabel || "AI生成"}
              </span>
              <span className="rounded-full bg-[#f5f5f7] px-2.5 py-1 text-xs font-semibold text-[#69717f] dark:bg-muted dark:text-muted-foreground">
                {Math.round(item.payload.confidence * 100)}%
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#64748b] dark:text-muted-foreground">{item.payload.routeSummary}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {onUndo ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || isEditing}
                onClick={onUndo}
                title="撤回上一次审核通过 (⌘Z / Ctrl+Z / Shift+R)"
                className="h-9 rounded-full border-[#d7dde8]"
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />
                撤回{lastApprovedWord ? ` ${lastApprovedWord}` : ""}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={!canApprove || busy || isEditing}
              onClick={onApprove}
              className="h-9 rounded-full"
            >
              {isApproving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
              {item.targetHasActiveCard
                ? "目标已有卡"
                : !hasDraftContent
                  ? "内容为空"
                  : isEditing || isSavingDraft
                    ? "先保存草稿"
                    : "审核通过"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || isEditing}
              onClick={onReject}
              className="h-9 rounded-full border-[#d7dde8]"
            >
              {isRejecting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <X className="mr-1.5 h-4 w-4" />}
              驳回
            </Button>
          </div>
        </footer>
      </article>
    </div>
  );
}

function editableDraftContent(item: AiGeneratedWordCardGridItem) {
  return editableMnemonicContentFromParts(item.contentMarkdown, item.splitText);
}

function draftEditSignature(content: string, relatedWords: string) {
  return `${content.trim()}\n---related---\n${relatedWords.trim()}`;
}

function aiGeneratedDraftSaveStatusLabel(status: "idle" | "pending" | "saving" | "saved" | "error") {
  if (status === "pending") return "检测到修改，3 秒后自动保存";
  if (status === "saving") return "正在保存...";
  if (status === "saved") return "已保存";
  if (status === "error") return "保存失败";
  return "可直接改写草稿，保存后再审核通过";
}

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function isShortcutInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("button, a, input, textarea, select, [role='button'], [contenteditable='true']"));
}

function isAiGeneratedDraftEditorOpen() {
  return Boolean(document.querySelector("[data-ai-generated-draft-editor='true']"));
}

function isAiGeneratedUndoShortcut(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  const isSystemUndo =
    (event.metaKey || event.ctrlKey) &&
    (key === "z" || event.code === "KeyZ") &&
    !event.shiftKey &&
    !event.altKey;
  const isPanelUndo =
    event.shiftKey &&
    (key === "r" || event.code === "KeyR") &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey;
  return isSystemUndo || isPanelUndo;
}

function draftWordId(id: string) {
  return `ai-generated-word-card:${id}`;
}

async function fetchWordCard(slug: string) {
  const response = await fetch(`/api/word-card/${encodeURIComponent(slug)}?fresh=${Date.now()}`, {
    cache: "no-store"
  });
  const result = (await response.json().catch(() => ({}))) as Partial<LevelWordItem> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(result.error || "单词卡加载失败。");
  }
  if (!result.id || !result.slug || !result.word || !Array.isArray(result.mnemonics)) {
    throw new Error("单词卡返回数据不完整。");
  }

  return result as LevelWordItem;
}

async function refreshWordCard(slug: string, updateWord: (word: LevelWordItem) => void) {
  try {
    updateWord(await fetchWordCard(slug));
  } catch {
    // Keep the cached linked card open if the background refresh fails.
  }
}

function wordSlugFromHref(href: string | null) {
  if (!href) return "";
  try {
    const url = new URL(href, window.location.origin);
    if (!url.pathname.startsWith("/word/")) return "";
    return decodeURIComponent(url.pathname.replace(/^\/word\//, "").split("/")[0] ?? "").trim();
  } catch {
    return "";
  }
}
