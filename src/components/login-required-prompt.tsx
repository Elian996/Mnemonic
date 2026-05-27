"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

export const LOGIN_REQUIRED_INTERACTION_MESSAGE =
  "已临时保存在本机。未登录数据可能会丢失，登录或注册后可合并到账号。";

export function LoginRequiredPrompt({
  message,
  onClose,
  className,
  autoDismissMs = 4800
}: {
  message: string;
  onClose: () => void;
  className?: string;
  autoDismissMs?: number;
}) {
  useEffect(() => {
    if (!message || autoDismissMs <= 0) return;
    const timer = window.setTimeout(onClose, autoDismissMs);
    return () => window.clearTimeout(timer);
  }, [autoDismissMs, message, onClose]);

  if (!message) return null;

  return (
    <div
      role="status"
      className={cn(
        "fixed bottom-4 left-1/2 z-[120] w-[min(360px,calc(100vw-32px))] -translate-x-1/2 rounded-md border border-[#d8dde6] bg-white px-4 py-3 text-sm font-semibold text-[#171a1f] shadow-[0_18px_50px_rgba(23,26,31,0.16)] dark:border-border dark:bg-[#1c1c1e] dark:text-foreground sm:left-auto sm:right-4 sm:translate-x-0",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 leading-5">
          {message}
          <span className="ml-2 inline-flex gap-2 whitespace-nowrap">
            <Link href="/login" className="text-[#0057d8] hover:underline dark:text-blue-300">
              登录
            </Link>
            <Link href="/register" className="text-[#69717f] hover:underline dark:text-muted-foreground">
              注册
            </Link>
          </span>
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭登录提示"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[#69717f] transition hover:bg-[#eef2f6] hover:text-[#171a1f] dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
