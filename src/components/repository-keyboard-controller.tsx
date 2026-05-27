"use client";

import { useEffect } from "react";

export function RepositoryKeyboardController() {
  useEffect(() => {
    let selectedIndex = 0;

    const cards = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-repository-word-card='true']"));

    const canHandleKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
      if (event.defaultPrevented) return false;
      if (isTextEditingTarget(event.target)) return false;
      if (document.querySelector("[data-memory-card-panel='true']")) return false;
      return true;
    };

    const selectCard = (index: number, scroll = true) => {
      const currentCards = cards();
      if (!currentCards.length) return;
      selectedIndex = (index + currentCards.length) % currentCards.length;
      currentCards.forEach((card, cardIndex) => {
        card.dataset.repositorySelected = cardIndex === selectedIndex ? "true" : "false";
      });
      const selectedCard = currentCards[selectedIndex];
      selectedCard.focus({ preventScroll: true });
      if (scroll) selectedCard.scrollIntoView({ block: "nearest", inline: "nearest" });
    };

    const selectedCard = () => {
      const currentCards = cards();
      if (!currentCards.length) return null;
      if (selectedIndex >= currentCards.length) selectedIndex = currentCards.length - 1;
      return currentCards[selectedIndex] ?? currentCards[0] ?? null;
    };

    const openSelectedCard = () => {
      const card = selectedCard();
      const opener = card?.querySelector<HTMLButtonElement>("button[aria-label^='打开 ']");
      opener?.click();
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const card = target?.closest<HTMLElement>("[data-repository-word-card='true']");
      if (!card) return;
      const index = cards().indexOf(card);
      if (index >= 0) selectCard(index, false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!canHandleKey(event)) return;

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        selectCard(selectedIndex + (event.key === "ArrowRight" ? 1 : -1));
        return;
      }

      if ((event.key === " " || event.code === "Space") && !event.repeat) {
        if (isInteractiveTarget(event.target)) return;
        event.preventDefault();
        openSelectedCard();
      }
    };

    selectCard(0, false);
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  return null;
}

function isTextEditingTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable
  );
}

function isInteractiveTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element?.closest("button, a, input, textarea, select, [role='button']"));
}
