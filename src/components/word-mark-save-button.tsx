"use client";

import { AlertCircle, Check, Loader2, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  WORD_MARK_SAVE_REQUEST_EVENT,
  WORD_MARK_SAVE_STATE_EVENT,
  type WordMarkSaveStateDetail
} from "@/lib/word-mark-save-events";

const initialState: WordMarkSaveStateDetail = {
  pendingCount: 0,
  status: "idle"
};

type SaveToast = {
  id: number;
  message: string;
};

function isTextInputTarget(target: EventTarget | null) {
  return (
    (target instanceof HTMLInputElement && !["range", "button", "checkbox", "radio"].includes(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function dispatchSaveRequest() {
  window.dispatchEvent(new Event(WORD_MARK_SAVE_REQUEST_EVENT));
}

export function WordMarkSaveButton() {
  const [state, setState] = useState<WordMarkSaveStateDetail>(initialState);
  const [toast, setToast] = useState<SaveToast | null>(null);
  const stateRef = useRef(initialState);
  const toastTimerRef = useRef<number | null>(null);
  const manualSaveRequestedRef = useRef(false);

  const showToast = (message: string) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }

    setToast({ id: Date.now(), message });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 5_000);
  };

  const requestManualSave = () => {
    const current = stateRef.current;
    if (!current.pendingCount && current.status !== "error") {
      showToast("没有未保存的单词标记。");
      return;
    }

    manualSaveRequestedRef.current = true;
    showToast(current.pendingCount ? `正在保存 ${current.pendingCount} 个单词标记...` : "正在保存单词标记...");
    dispatchSaveRequest();
  };

  useEffect(() => {
    const handleState = (event: Event) => {
      const detail = (event as CustomEvent<WordMarkSaveStateDetail>).detail;
      if (!detail || typeof detail.pendingCount !== "number") return;
      stateRef.current = detail;
      setState(detail);

      if (!manualSaveRequestedRef.current) return;
      if (detail.status === "saving") {
        showToast(detail.message || "正在保存单词标记...");
        return;
      }
      if (detail.status === "saved") {
        manualSaveRequestedRef.current = false;
        showToast(detail.message || "单词标记已保存。");
        return;
      }
      if (detail.status === "error") {
        manualSaveRequestedRef.current = false;
        showToast(detail.message || "保存失败，请重试。");
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== "s") return;
      if (isTextInputTarget(event.target)) return;

      event.preventDefault();
      requestManualSave();
    };

    window.addEventListener(WORD_MARK_SAVE_STATE_EVENT, handleState);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      window.removeEventListener(WORD_MARK_SAVE_STATE_EVENT, handleState);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  const isSaving = state.status === "saving";
  const hasPending = state.pendingCount > 0;
  const hasError = state.status === "error";
  const disabled = isSaving || !hasPending;
  const Icon = isSaving ? Loader2 : hasError ? AlertCircle : state.status === "saved" ? Check : Save;
  const title = isSaving
    ? "正在保存单词标记"
    : hasError
      ? state.message || "保存失败，点击重试 (Shift+S)"
      : hasPending
        ? `保存 ${state.pendingCount} 个单词标记 (Shift+S)`
        : state.status === "saved"
          ? "单词标记已保存"
          : "没有未保存的单词标记";

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={title}
        title={title}
        disabled={disabled}
        onClick={requestManualSave}
        className={cn(
          "relative h-9 w-9 rounded-md border border-[#d8dde6] bg-white text-[#69717f] hover:border-[#171a1f] hover:bg-white hover:text-[#171a1f] dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground",
          hasPending && "border-[#171a1f] text-[#171a1f] dark:border-foreground dark:text-foreground",
          hasError && "border-[#c2412d] text-[#c2412d] hover:border-[#c2412d] hover:text-[#c2412d] dark:border-red-300 dark:text-red-300"
        )}
      >
        <Icon className={cn("h-4 w-4", isSaving && "animate-spin")} />
        {hasPending ? (
          <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[#171a1f] px-1 text-[10px] font-semibold leading-none text-white dark:bg-foreground dark:text-background">
            {state.pendingCount > 99 ? "99+" : state.pendingCount}
          </span>
        ) : null}
      </Button>

      {toast ? (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className="manual-save-toast fixed left-1/2 top-20 z-[80] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md bg-[#4b5563] px-4 py-2 text-sm font-semibold text-white shadow-lg dark:bg-[#6b7280]"
        >
          {toast.message}
        </div>
      ) : null}
    </>
  );
}
