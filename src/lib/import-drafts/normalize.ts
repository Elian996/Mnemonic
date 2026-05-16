import { prisma } from "@/lib/db";
import { getWordAutofill } from "@/lib/word-autofill";
import { AgentImportPayload, NormalizedImportDraft } from "./types";

export async function normalizeAgentImportPayload(payload: AgentImportPayload): Promise<NormalizedImportDraft> {
  const word = payload.word?.trim().toLowerCase();
  if (!word) throw new Error("payload.word is required");

  const sourceMarkdown = payload.contentMarkdown ?? payload.mnemonicMarkdown ?? "";
  const existingWord = await prisma.word.findUnique({ where: { word } });
  const autofill = existingWord ? null : await getWordAutofill(word);
  const originalImageUrl = undefined;
  const extractedImageUrls: string[] = [];
  const relatedWords = normalizeRelatedWords(payload.relatedWords, payload.links);
  const linkMarkdown = relatedWords.map((relatedWord) => `[[word:${relatedWord}]]`).join("\n");

  const baseMarkdown = formatMnemonicMarkdown({
    markdown: stripMarkdownImages(stripTrailingRelatedWords(sourceMarkdown)),
    exampleSentence: payload.exampleSentence ?? "",
    exampleTranslation: payload.exampleTranslation ?? ""
  });
  const baseHasExample = Boolean(
    (payload.exampleSentence && baseMarkdown.includes(payload.exampleSentence)) ||
      (payload.exampleTranslation && baseMarkdown.includes(payload.exampleTranslation)) ||
      /例句[:：]/u.test(baseMarkdown)
  );
  const exampleMarkdown =
    !baseHasExample && (payload.exampleSentence || payload.exampleTranslation)
      ? `\n\n例句：\n${payload.exampleSentence ?? ""}${payload.exampleTranslation ? `\n${payload.exampleTranslation}` : ""}`
      : "";
  const relatedMarkdown = linkMarkdown ? `\n\n相关单词：\n${linkMarkdown}` : "";
  const contentMarkdown = [baseMarkdown.trim(), exampleMarkdown.trim(), relatedMarkdown.trim()]
    .filter(Boolean)
    .join("\n\n");
  const savedPayload: AgentImportPayload = {
    ...payload,
    relatedWords,
    embeddedImages: [],
    images: []
  };

  return {
    source: payload.source ?? "external-agent",
    word: existingWord?.word ?? word,
    phoneticUk: existingWord?.phoneticUk ?? autofill?.phoneticUk ?? payload.phoneticUk ?? payload.phonetic ?? "",
    phoneticUs: existingWord?.phoneticUs ?? autofill?.phoneticUs ?? payload.phoneticUs ?? "",
    partOfSpeech: existingWord?.partOfSpeech ?? autofill?.partOfSpeech ?? payload.partOfSpeech ?? "n.",
    meaningCn: existingWord?.meaningCn ?? autofill?.meaningCn ?? payload.meaningCn ?? "",
    meaningEn: existingWord?.meaningEn ?? autofill?.meaningEn ?? payload.meaningEn ?? "",
    shortMeaningCn: existingWord?.shortMeaningCn ?? autofill?.shortMeaningCn ?? payload.shortMeaningCn ?? payload.meaningCn?.split(/[；;，,]/)[0] ?? "",
    difficulty: clampDifficulty(existingWord?.difficulty ?? payload.difficulty ?? autofill?.difficulty ?? 3),
    splitText: payload.splitText ?? parseSplitText(sourceMarkdown),
    title: payload.title ?? `${word} 记忆卡片`,
    contentMarkdown: contentMarkdown || "带你背\n\n联想：\n\n例句：",
    rawText: payload.rawText ?? "",
    originalImageUrl,
    extractedImageUrls,
    agentPayload: savedPayload
  };
}

function clampDifficulty(value: number) {
  if (!Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function normalizeRelatedWords(
  relatedWords: AgentImportPayload["relatedWords"],
  links: AgentImportPayload["links"]
) {
  const explicit = (relatedWords ?? []).map((word) => word.trim().toLowerCase()).filter(Boolean);
  const fromLinks = (links ?? [])
    .filter((link) => (link.type ?? "word").toLowerCase() === "word")
    .map((link) => link.value.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...explicit, ...fromLinks]));
}

function stripTrailingRelatedWords(markdown: string) {
  return markdown.replace(/\n*(?:\*\*)?相关单词(?:\*\*)?\s*[:：][\s\S]*$/u, "").trim();
}

function stripMarkdownImages(markdown: string) {
  return markdown.replace(/\n*!\[[^\]]*]\([^)]+\)\n*/g, "\n\n").trim();
}

function formatMnemonicMarkdown({
  markdown,
  exampleSentence,
  exampleTranslation
}: {
  markdown: string;
  exampleSentence: string;
  exampleTranslation: string;
}) {
  const lines = markdown
    .replace(/\*\*/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const bodyLines = lines.flatMap((line) => {
    if (/^划分\s*[:：]/u.test(line)) return [];
    const inlineMnemonic = line.match(/^带你背\s*[:：]\s*(.+)$/u)?.[1]?.trim();
    if (inlineMnemonic) return [inlineMnemonic];
    const inlineMemoryCard = line.match(/^记忆卡\s*[:：]\s*(.+)$/u)?.[1]?.trim();
    if (inlineMemoryCard) return [inlineMemoryCard];
    if (/^带你背\s*[:：]?$/u.test(line)) return [];
    if (/^记忆卡\s*[:：]?$/u.test(line)) return [];
    if (/^例句\s*[:：]/u.test(line)) return [];
    if (exampleSentence && line.includes(exampleSentence)) return [];
    if (exampleTranslation && line.includes(exampleTranslation)) return [];
    return [line];
  });
  const body = bodyLines.join("\n").trim();
  const example =
    exampleSentence || exampleTranslation
      ? ["例句：", exampleSentence, exampleTranslation].filter(Boolean).join("\n")
      : lines.find((line) => /^例句\s*[:：]/u.test(line)) ?? "";
  return [
    "带你背：",
    body,
    example
  ].filter(Boolean).join("\n\n");
}

function parseSplitText(markdown: string) {
  const line = markdown
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => /^划分\s*[:：]/u.test(item));
  return line?.replace(/^划分\s*[:：]\s*/u, "").trim() ?? "";
}
