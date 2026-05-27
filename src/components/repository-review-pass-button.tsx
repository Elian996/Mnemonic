"use client";

import { Check } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";

export function RepositoryReviewPassButton({
  wordId,
  word,
  scope,
  initialPassed
}: {
  wordId: string;
  word: string;
  scope: string;
  initialPassed: boolean;
}) {
  const [passed, setPassed] = useState(initialPassed);
  const [isPending, startTransition] = useTransition();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const card = buttonRef.current?.closest<HTMLElement>("[data-repository-word-card='true']");
    if (card) card.dataset.reviewPassed = passed ? "true" : "false";
  }, [passed]);

  const togglePassed = () => {
    const nextPassed = !passed;
    setPassed(nextPassed);
    startTransition(async () => {
      try {
        const response = await fetch("/api/repository/review-pass", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId, scope, passed: nextPassed })
        });
        if (!response.ok) {
          setPassed(passed);
        }
      } catch {
        setPassed(passed);
      }
    });
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={passed ? `取消通过 ${word}` : `标记通过 ${word}`}
      aria-pressed={passed}
      title={passed ? "已通过" : "标记通过"}
      disabled={isPending}
      onClick={togglePassed}
      className={cn("mn-repository-review-pass-button", passed && "is-passed")}
    >
      <Check className="h-4 w-4" />
    </button>
  );
}
