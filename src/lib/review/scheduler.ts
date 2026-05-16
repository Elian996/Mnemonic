import { ReviewCardState, ReviewRating } from "@prisma/client";

export type ReviewCardSnapshot = {
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
};

export function scheduleReview(card: ReviewCardSnapshot, rating: ReviewRating, now = new Date()) {
  let easeFactor = Math.max(1.3, card.easeFactor);
  let intervalDays = card.intervalDays;
  let repetitions = card.repetitions;
  let lapses = card.lapses;
  let state: ReviewCardState = ReviewCardState.REVIEW;

  if (rating === ReviewRating.AGAIN) {
    intervalDays = 0;
    repetitions = 0;
    lapses += 1;
    easeFactor = Math.max(1.3, easeFactor - 0.2);
    state = ReviewCardState.LEARNING;
  } else if (rating === ReviewRating.HARD) {
    intervalDays = Math.max(1, Math.ceil(intervalDays * 1.2));
    easeFactor = Math.max(1.3, easeFactor - 0.15);
    repetitions += 1;
  } else if (rating === ReviewRating.GOOD) {
    repetitions += 1;
    intervalDays = repetitions === 1 ? 1 : repetitions === 2 ? 3 : Math.ceil(intervalDays * easeFactor);
  } else {
    repetitions += 1;
    easeFactor += 0.15;
    intervalDays = repetitions === 1 ? 3 : repetitions === 2 ? 7 : Math.ceil(intervalDays * easeFactor * 1.25);
  }

  const dueAt = new Date(now);
  if (rating === ReviewRating.AGAIN) {
    dueAt.setMinutes(dueAt.getMinutes() + 10);
  } else {
    dueAt.setDate(dueAt.getDate() + intervalDays);
  }

  return {
    dueAt,
    intervalDays,
    easeFactor,
    repetitions,
    lapses,
    state,
    lastReviewedAt: now
  };
}

export function ratingRemembered(rating: ReviewRating) {
  return rating === ReviewRating.GOOD || rating === ReviewRating.EASY;
}
