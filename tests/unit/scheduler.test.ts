import { describe, expect, it } from "vitest";
import { ReviewCardState, ReviewRating } from "@prisma/client";
import { ratingRemembered, scheduleReview } from "@/lib/review/scheduler";

describe("spaced repetition scheduler", () => {
  const card = { intervalDays: 3, easeFactor: 2.5, repetitions: 2, lapses: 0 };

  it("resets on again", () => {
    const next = scheduleReview(card, ReviewRating.AGAIN, new Date("2026-05-02T00:00:00Z"));
    expect(next.intervalDays).toBe(0);
    expect(next.repetitions).toBe(0);
    expect(next.lapses).toBe(1);
    expect(next.state).toBe(ReviewCardState.LEARNING);
  });

  it("expands interval on easy", () => {
    const next = scheduleReview(card, ReviewRating.EASY, new Date("2026-05-02T00:00:00Z"));
    expect(next.intervalDays).toBeGreaterThan(3);
    expect(next.easeFactor).toBeGreaterThan(card.easeFactor);
  });

  it("knows remembered ratings", () => {
    expect(ratingRemembered(ReviewRating.GOOD)).toBe(true);
    expect(ratingRemembered(ReviewRating.HARD)).toBe(false);
  });
});
