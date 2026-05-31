"use client";

import { useEffect, useRef, useState } from "react";
import {
  REPOSITORY_PACK_REMOVE_EVENT,
  type RepositoryPackRemoveEventDetail
} from "@/lib/repository-pack-events";

export function RepositoryPackRemoveNotice() {
  const [message, setMessage] = useState("");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleRemove = (event: Event) => {
      const detail = (event as CustomEvent<RepositoryPackRemoveEventDetail>).detail;
      const count = Math.max(0, Number(detail?.count ?? 0));
      if (!count) return;

      if (timerRef.current) window.clearTimeout(timerRef.current);
      setMessage(`已从词包移出 ${count} 个单词。单词和单词卡仍然保留。`);
      timerRef.current = window.setTimeout(() => {
        setMessage("");
        timerRef.current = null;
      }, 5_000);
    };

    window.addEventListener(REPOSITORY_PACK_REMOVE_EVENT, handleRemove);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      window.removeEventListener(REPOSITORY_PACK_REMOVE_EVENT, handleRemove);
    };
  }, []);

  if (!message) return null;
  return <div className="mn-repository-notice mn-repository-pack-runtime-notice">{message}</div>;
}
