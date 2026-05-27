export type RankableEntry = {
  likeCount: number;
  dislikeCount?: number;
  bookmarkCount: number;
  editorScore: number;
  effectivenessScore: number;
  reportCount: number;
};

export function mnemonicFeedbackScore(entry: Pick<RankableEntry, "likeCount" | "dislikeCount">) {
  return entry.likeCount - (entry.dislikeCount ?? 0);
}

export function mnemonicScore(entry: RankableEntry) {
  return (
    mnemonicFeedbackScore(entry) * 3 +
    entry.bookmarkCount * 2 +
    entry.editorScore * 5 +
    entry.effectivenessScore * 10 -
    entry.reportCount * 8
  );
}

export function sortPublicMnemonics<T extends RankableEntry>(entries: T[]) {
  return [...entries].sort((a, b) => {
    const feedbackCompare = mnemonicFeedbackScore(b) - mnemonicFeedbackScore(a);
    return feedbackCompare || mnemonicScore(b) - mnemonicScore(a);
  });
}
