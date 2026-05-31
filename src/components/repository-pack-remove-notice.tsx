"use client";

import { useEffect, useRef, useState } from "react";
import {
  REPOSITORY_PACK_REMOVE_EVENT,
  type RepositoryPackRemoveEventDetail
} from "@/lib/repository-pack-events";

export function RepositoryPackRemoveNotice() {
  const [notice, setNotice] = useState<{ message: string; status: "pending" | "done" | "error" } | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleRemove = (event: Event) => {
      const detail = (event as CustomEvent<RepositoryPackRemoveEventDetail>).detail;
      const status = detail?.status || "done";
      const count = Math.max(0, Number(detail?.count ?? 0));
      const word = detail?.word ? `「${detail.word}」` : "";
      let message = detail?.message || "";

      if (timerRef.current) window.clearTimeout(timerRef.current);

      if (!message) {
        if (status === "pending") {
          message = word
            ? `已从界面移出${word}，正在保存。`
            : `已从界面移出 ${count} 个单词，正在保存。`;
        } else if (status === "error") {
          message = word ? `${word}移出失败，已恢复显示。` : "移出词包失败，已恢复显示。";
        } else {
          message = word
            ? `已从词包移出${word}。单词和单词卡仍然保留。`
            : `已从词包移出 ${count} 个单词。单词和单词卡仍然保留。`;
        }
      }

      if (!message || (status !== "error" && !word && !count)) return;

      setNotice({ message, status });
      if (status !== "pending") {
        timerRef.current = window.setTimeout(() => {
          setNotice(null);
          timerRef.current = null;
        }, status === "error" ? 7_000 : 5_000);
      }
    };

    window.addEventListener(REPOSITORY_PACK_REMOVE_EVENT, handleRemove);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      window.removeEventListener(REPOSITORY_PACK_REMOVE_EVENT, handleRemove);
    };
  }, []);

  if (!notice) return null;
  return (
    <div className="mn-repository-notice mn-repository-pack-runtime-notice" data-status={notice.status} aria-live="polite">
      {notice.message}
    </div>
  );
}
