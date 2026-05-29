export function editableMnemonicContentFromParts(contentMarkdown: string, splitText: string) {
  const content = stripRelatedWordBlock(contentMarkdown).trim();
  if (hasSplitLine(content)) return content;
  const splitLine = `划分：${splitText.trim() ? ` ${splitText.trim()}` : ""}`;
  return [splitLine, content].filter(Boolean).join("\n\n").trim();
}

export function withRelatedWordLinks(content: string, relatedWords: string) {
  const words = relatedWords
    .split(/[,，\s]+/)
    .map((word) => normalizeRelatedWord(word))
    .filter(Boolean);
  const cleanContent = stripRelatedWordBlock(content);
  if (!words.length) return cleanContent;

  const linkBlock = [
    "",
    "相关单词：",
    ...Array.from(new Set(words)).map((word) => `[[word:${word}]]`)
  ].join("\n");
  return `${cleanContent.trimEnd()}\n${linkBlock}`;
}

export function relatedWordText(markdown: string) {
  return Array.from(
    new Set(
      Array.from(markdown.matchAll(/\[\[\s*word\s*:\s*([^|\]\s]+)(?:\|[^\]]+)?\]\]/giu))
        .map((match) =>
          String(match[1] ?? "")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    )
  ).join(", ");
}

export function stripRelatedWordBlock(markdown: string) {
  return markdown.replace(/\n*相关单词[:：][\s\S]*$/u, "").trimEnd();
}

function normalizeRelatedWord(word: string) {
  return word
    .trim()
    .replace(/^\[\[\s*word\s*:\s*/iu, "")
    .replace(/\]\]$/u, "")
    .trim()
    .toLowerCase();
}

function hasSplitLine(markdown: string) {
  return /^\s*划分\s*[:：]/mu.test(markdown);
}
