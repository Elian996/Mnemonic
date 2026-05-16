"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearGuestProgress, hasGuestProgress, readGuestProgress, type GuestProgress } from "@/lib/guest-progress";

export function GuestProgressSync({
  isAuthenticated,
  accountLabel = ""
}: {
  isAuthenticated: boolean;
  accountLabel?: string;
}) {
  const router = useRouter();
  const promptedRef = useRef(false);
  const [pendingProgress, setPendingProgress] = useState<GuestProgress | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!isAuthenticated) {
      promptedRef.current = false;
      setPendingProgress(null);
      return;
    }
    if (promptedRef.current) return;

    const progress = readGuestProgress();
    if (!hasGuestProgress(progress)) return;

    promptedRef.current = true;
    setPendingProgress(progress);
  }, [isAuthenticated]);

  async function syncProgress() {
    const progress = pendingProgress ?? readGuestProgress();
    if (!hasGuestProgress(progress)) {
      setPendingProgress(null);
      return;
    }

    setStatus("正在合并...");
    try {
      const response = await fetch("/api/me/sync-guest-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(progress)
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "合并失败。");
      }
      clearGuestProgress();
      setPendingProgress(null);
      setStatus("");
      router.refresh();
    } catch (error) {
      promptedRef.current = false;
      setStatus(error instanceof Error ? error.message : "合并失败。");
    }
  }

  if (!pendingProgress) return null;

  const markCount = Object.keys(pendingProgress.marks).length;
  const bookmarkCount = pendingProgress.bookmarkedWordIds.length;
  const target = accountLabel ? `「${accountLabel}」` : "当前账号";

  return (
    <div className="fixed bottom-4 right-4 z-[80] w-[min(380px,calc(100vw-2rem))] rounded-lg border border-[var(--mn-line)] bg-[var(--mn-panel)] p-4 text-[var(--mn-ink)] shadow-2xl">
      <p className="text-sm font-semibold">发现本浏览器的游客进度</p>
      <p className="mt-2 text-sm leading-6 text-[var(--mn-muted)]">
        是否合并到{target}？包含 {markCount} 条单词状态、{bookmarkCount} 条收藏。共享电脑上请先确认账号。
      </p>
      {status ? <p className="mt-2 text-xs font-semibold text-[var(--mn-red)]">{status}</p> : null}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            promptedRef.current = false;
            setPendingProgress(null);
          }}
          className="rounded-md border border-[var(--mn-line)] px-3 py-2 text-sm font-semibold text-[var(--mn-muted)] hover:text-[var(--mn-ink)]"
        >
          稍后
        </button>
        <button
          type="button"
          onClick={() => void syncProgress()}
          className="rounded-md bg-[var(--mn-ink)] px-3 py-2 text-sm font-semibold text-[var(--mn-paper)]"
        >
          合并
        </button>
      </div>
    </div>
  );
}
