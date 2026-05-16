export type AgentImageInput = {
  filename?: string;
  mimeType?: string;
  base64?: string;
  url?: string;
  kind?: "original" | "embedded-illustration" | "other";
};

export type AgentImportPayload = {
  source?: string;
  word: string;
  phonetic?: string;
  phoneticUk?: string;
  phoneticUs?: string;
  partOfSpeech?: string;
  meaningCn?: string;
  meaningEn?: string;
  shortMeaningCn?: string;
  difficulty?: number;
  splitText?: string;
  title?: string;
  mnemonicMarkdown?: string;
  contentMarkdown?: string;
  rawText?: string;
  exampleSentence?: string;
  exampleTranslation?: string;
  relatedWords?: string[];
  embeddedImages?: string[];
  confidence?: number;
  warnings?: string[];
  links?: Array<{ type?: string; value: string; alias?: string }>;
  images?: AgentImageInput[];
};

export type NormalizedImportDraft = {
  source: string;
  word: string;
  phoneticUk: string;
  phoneticUs: string;
  partOfSpeech: string;
  meaningCn: string;
  meaningEn: string;
  shortMeaningCn: string;
  difficulty: number;
  splitText: string;
  title: string;
  contentMarkdown: string;
  rawText: string;
  originalImageUrl?: string;
  extractedImageUrls: string[];
  agentPayload: AgentImportPayload;
};
