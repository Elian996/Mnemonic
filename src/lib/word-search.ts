export type SearchRankableWord = {
  word: string;
  slug: string;
  shortMeaningCn: string;
  meaningCn: string;
  meaningEn?: string | null;
};

export function compareWordSearchResults(query: string) {
  return (first: SearchRankableWord, second: SearchRankableWord) =>
    searchRank(first, query) - searchRank(second, query) ||
    first.word.length - second.word.length ||
    first.word.localeCompare(second.word, "en");
}

function searchRank(word: SearchRankableWord, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedWord = normalizeSearchText(word.word);
  const normalizedSlug = normalizeSearchText(word.slug);
  const normalizedShortMeaningCn = normalizeSearchText(word.shortMeaningCn);
  const normalizedMeaningCn = normalizeSearchText(word.meaningCn);
  const normalizedMeaningEn = normalizeSearchText(word.meaningEn ?? "");

  if (normalizedWord === normalizedQuery) return 0;
  if (normalizedSlug === normalizedQuery) return 1;
  if (normalizedWord.startsWith(normalizedQuery)) return 2;
  if (normalizedSlug.startsWith(normalizedQuery)) return 3;
  if (normalizedShortMeaningCn === normalizedQuery) return 4;
  if (normalizedMeaningCn === normalizedQuery) return 5;
  if (normalizedShortMeaningCn.startsWith(normalizedQuery)) return 6;
  if (normalizedMeaningCn.startsWith(normalizedQuery)) return 7;
  if (normalizedWord.includes(normalizedQuery)) return 8;
  if (normalizedSlug.includes(normalizedQuery)) return 9;
  if (normalizedShortMeaningCn.includes(normalizedQuery)) return 10;
  if (normalizedMeaningCn.includes(normalizedQuery)) return 11;
  if (normalizedMeaningEn.includes(normalizedQuery)) return 12;
  return 13;
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
