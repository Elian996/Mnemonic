"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";

export function HiddenRepositoryGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const clickCount = useRef(0);
  const timer = useRef<number | null>(null);

  const handleClick = () => {
    clickCount.current += 1;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      clickCount.current = 0;
    }, 1800);

    if (clickCount.current >= 5) {
      clickCount.current = 0;
      router.push("/repository");
    }
  };

  return (
    <button type="button" onClick={handleClick} className="cursor-default text-left" aria-label="单词">
      {children}
    </button>
  );
}
