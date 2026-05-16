export type RankableEntry = {
  likeCount: number;
  bookmarkCount: number;
  editorScore: number;
  effectivenessScore: number;
  reportCount: number;
};

export function mnemonicScore(entry: RankableEntry) {
  return (
    entry.likeCount * 3 +
    entry.bookmarkCount * 2 +
    entry.editorScore * 5 +
    entry.effectivenessScore * 10 -
    entry.reportCount * 8
  );
}

export function sortPublicMnemonics<T extends RankableEntry>(entries: T[]) {
  return [...entries].sort((a, b) => mnemonicScore(b) - mnemonicScore(a));
}
