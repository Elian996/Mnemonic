import { MnemonicStatus, type LevelTag } from "@prisma/client";
import { prisma } from "@/lib/db";

export type ContaminationAuditWord = {
  id: string;
  slug: string;
  word: string;
  meaning: string;
  levelTags: LevelTag[];
  details: string[];
};

export type ContaminationAuditGroup = {
  id: string;
  title: string;
  tone: "danger" | "warning" | "info";
  description: string;
  words: ContaminationAuditWord[];
};

const PART_CLEANED_WORDS = new Set([
  "amuse",
  "awake",
  "barn",
  "bonus",
  "bulb",
  "campaign",
  "capacity",
  "chip",
  "compensate",
  "continuous",
  "coupon",
  "cracker",
  "devise",
  "discount",
  "edition",
  "era",
  "erect",
  "exaggerate",
  "fame",
  "fashion",
  "fond",
  "gang",
  "geology",
  "gratitude",
  "herb",
  "huge",
  "ignorance",
  "imaginary",
  "inflation",
  "institution",
  "interpretation",
  "kilometer",
  "light",
  "loop",
  "market",
  "meat",
  "melt",
  "minister",
  "nerve",
  "pave",
  "people",
  "pirate",
  "plentiful",
  "pond",
  "possibly",
  "prescribe",
  "rational",
  "roast",
  "rock",
  "scientist",
  "solve",
  "thoughtful",
  "thumb",
  "ultimate",
  "variety",
  "whenever",
  "zero"
]);

const otherMeaningLabels = /^\s*(?:样义|原义|拜义|额标|音杯)[:：]/imu;
const duplicateTakeYouBack = /(?:^|\n)\s*[带帶帯]你背[：:；;]?\s*(?:\n\s*)+(?:[带帶帯]你背[：:；;]?)/u;
const wikiWord = /\[\[word:([^\]|]+)(?:\|[^\]]+)?\]\]/giu;
const standaloneEnglishWord = /^[A-Za-z][A-Za-z'-]{1,32}$/u;
const cardMarkerLine = /^\s*(?:音标|释义|样义|原义|额标|康义|划分|词汇扩充|问汇扩充|常见搭配|例句)[:：]/u;
const phoneticArtifactLine = /^\s*#?\s*[:：]\s*\/[^/\n]{2,}\/?\s*$/u;
const takeYouBackLine = /^\s*[带帶帯]你背[：:；;]?/u;
const exampleHeading = /^\s*例句[:：]\s*$/u;
const relatedHeading = /^\s*相关单词[:：]\s*$/u;
const shapeMnemonicForeignWord = /针对整个单词采用字形联想法[：:][\s\S]{0,90}?由\s+([A-Za-z][A-Za-z'-]{1,32})\s+的字形/u;
const ocrNoiseTokens = [
  "bcer",
  "botles",
  "bortle",
  "cratc",
  "crerte",
  "creale",
  "cxist",
  "Diffcrent",
  "delgencrate",
  "gcncrate",
  "hcad",
  "jackct",
  "kncw",
  "oftiny",
  "opcrate",
  "outsidc",
  "pcddlc",
  "sidc",
  "slore",
  "Strcct",
  "thcir"
] as const;

type EntryForAudit = Awaited<ReturnType<typeof loadEntriesForAudit>>[number];
type KnownWordSet = ReadonlySet<string>;

export type InspectableMnemonicEntry = {
  splitText: string | null;
  contentMarkdown: string;
  targetWord: {
    word: string;
  };
};

export type MnemonicContaminationSignals = {
  embeddedCard: string[];
  longExample: string[];
  ocrNoise: string[];
  splitTextMismatch: string[];
};

export async function getMnemonicContaminationAudit() {
  const [entries, knownWords] = await Promise.all([loadEntriesForAudit(), loadKnownWords()]);
  const groups: ContaminationAuditGroup[] = [
    {
      id: "emptyish",
      title: "空壳或坏卡",
      tone: "danger",
      description: "正文几乎为空，或只剩无意义残片。",
      words: entries.filter(isEmptyish).map((entry) => auditWord(entry, ["内容过短或只剩空结构"]))
    },
    {
      id: "foreign-card",
      title: "混入其他单词卡",
      tone: "danger",
      description: "正文里出现相邻单词词头、音标残片或另一张卡的带你背内容。",
      words: entries.flatMap((entry) => {
        const details = getMnemonicEntryContaminationSignals(entry, knownWords).embeddedCard;
        return details.length ? [auditWord(entry, details)] : [];
      })
    },
    {
      id: "example-contamination",
      title: "例句区串线",
      tone: "danger",
      description: "例句区域异常过长，或同时混入多句英文/中文解释。",
      words: entries.flatMap((entry) => {
        const details = getMnemonicEntryContaminationSignals(entry, knownWords).longExample;
        return details.length ? [auditWord(entry, details)] : [];
      })
    },
    {
      id: "ocr-label",
      title: "OCR 标签残留",
      tone: "warning",
      description: "包含样义、原义、拜义、额标、音杯等错识别标签。",
      words: entries.filter((entry) => otherMeaningLabels.test(entry.contentMarkdown)).map((entry) => auditWord(entry, ["存在 OCR 错识别标签"]))
    },
    {
      id: "split-text-mismatch",
      title: "划分拼写不一致",
      tone: "warning",
      description: "划分内容拼回去不是目标单词，通常是 OCR 把字母识别错了。",
      words: entries.flatMap((entry) => {
        const details = getMnemonicEntryContaminationSignals(entry, knownWords).splitTextMismatch;
        return details.length ? [auditWord(entry, details)] : [];
      })
    },
    {
      id: "ocr-noise",
      title: "OCR 高频错字",
      tone: "warning",
      description: "出现 sidc、bcer、cratc 等高频识别错字，需要优先复核。",
      words: entries.flatMap((entry) => {
        const details = getMnemonicEntryContaminationSignals(entry, knownWords).ocrNoise;
        return details.length ? [auditWord(entry, details)] : [];
      })
    },
    {
      id: "part-link-tail",
      title: "Part 清理后残留相关词",
      tone: "warning",
      description: "正文已清掉混入卡片，但相关单词里还可能残留外卡链接。",
      words: entries.flatMap((entry) => {
        const leftovers = suspiciousRelatedWordsAfterPartCleanup(entry);
        return leftovers.length ? [auditWord(entry, [`疑似残留：${leftovers.join(", ")}`])] : [];
      })
    },
    {
      id: "duplicate-section",
      title: "重复带你背",
      tone: "info",
      description: "出现连续两个带你背，可能只是格式问题，也可能是 OCR 拼接。",
      words: entries.filter((entry) => duplicateTakeYouBack.test(entry.contentMarkdown)).map((entry) => auditWord(entry, ["重复带你背段落"]))
    },
    {
      id: "odd-separator",
      title: "异常分隔符",
      tone: "info",
      description: "正文含全角竖线等非标准分隔符，需要人工确认是否保留。",
      words: entries.filter((entry) => /[丨｜]/u.test(entry.contentMarkdown)).map((entry) => auditWord(entry, ["含全角竖线分隔符"]))
    }
  ];

  return groups;
}

async function loadEntriesForAudit() {
  return prisma.mnemonicEntry.findMany({
    where: { status: { not: MnemonicStatus.ARCHIVED } },
    select: {
      id: true,
      splitText: true,
      contentMarkdown: true,
      targetWord: {
        select: {
          id: true,
          slug: true,
          word: true,
          levelTags: true,
          shortMeaningCn: true,
          meaningCn: true
        }
      }
    },
    orderBy: [{ targetWord: { word: "asc" } }]
  });
}

async function loadKnownWords() {
  const words = await prisma.word.findMany({ select: { word: true } });
  return new Set(words.map((word) => normalizeWordCandidate(word.word)).filter(Boolean));
}

function auditWord(entry: EntryForAudit, details: string[]): ContaminationAuditWord {
  return {
    id: entry.targetWord.id,
    slug: entry.targetWord.slug,
    word: entry.targetWord.word,
    meaning: entry.targetWord.shortMeaningCn || entry.targetWord.meaningCn || "释义待补",
    levelTags: entry.targetWord.levelTags,
    details
  };
}

export function getMnemonicEntryContaminationSignals(
  entry: InspectableMnemonicEntry,
  knownWords: KnownWordSet = new Set()
): MnemonicContaminationSignals {
  return {
    embeddedCard: embeddedCardDetails(entry, knownWords),
    longExample: longExampleDetails(entry),
    ocrNoise: ocrNoiseDetails(entry),
    splitTextMismatch: splitTextMismatchDetails(entry)
  };
}

function isEmptyish(entry: EntryForAudit) {
  return (
    entry.contentMarkdown.replace(/\s|带你背[:：]?|相关单词[:：]?|例句[:：]?|\[\[word:[^\]]+\]\]/gu, "").length < 8
  );
}

function suspiciousRelatedWordsAfterPartCleanup(entry: EntryForAudit) {
  if (!PART_CLEANED_WORDS.has(entry.targetWord.word)) return [];

  const lines = entry.contentMarkdown.split(/\r?\n/u);
  const relatedIndex = lines.findIndex((line) => /^\s*相关单词[:：]\s*$/u.test(line));
  if (relatedIndex < 0) return [];

  const body = lines.slice(0, relatedIndex).join("\n").toLowerCase();
  const linkedWords = new Set<string>();
  for (const line of lines.slice(relatedIndex + 1)) {
    wikiWord.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = wikiWord.exec(line))) {
      linkedWords.add(match[1].trim());
    }
  }

  return [...linkedWords].filter((word) => !body.includes(word.toLowerCase()));
}

function embeddedCardDetails(entry: InspectableMnemonicEntry, knownWords: KnownWordSet) {
  const details = new Set<string>();
  const target = normalizeWordCandidate(entry.targetWord.word);
  const lines = entry.contentMarkdown.replace(/\r\n?/gu, "\n").split("\n");

  const shapeMatch = shapeMnemonicForeignWord.exec(entry.contentMarkdown);
  const shapeWord = normalizeWordCandidate(shapeMatch?.[1] ?? "");
  if (shapeWord && shapeWord !== target && isKnownOrLikelyWord(shapeWord, knownWords)) {
    details.add(`开头在讲 ${shapeWord} 的字形，不是 ${target}`);
  }

  lines.forEach((line, index) => {
    const candidate = normalizeWordCandidate(line.trim());
    if (!candidate || candidate === target || !standaloneEnglishWord.test(line.trim())) return;
    if (!isKnownOrLikelyWord(candidate, knownWords)) return;

    const lookaheadLines = lines.slice(index + 1, index + 9);
    if (lookaheadLooksLikeCard(lookaheadLines)) {
      details.add(`疑似混入 ${candidate} 卡片块`);
    }
  });

  const takeYouBackCount = lines.filter((line) => takeYouBackLine.test(line)).length;
  if (takeYouBackCount >= 2) {
    details.add(`正文出现 ${takeYouBackCount} 个「带你背」段落，疑似拼接多张卡`);
  }

  return [...details];
}

function longExampleDetails(entry: InspectableMnemonicEntry) {
  const block = exampleBlock(entry.contentMarkdown);
  if (!block) return [];

  const details: string[] = [];
  const englishSentences = block.match(/[A-Z][A-Za-z0-9'" (),;-]{8,}[.!?]/gu) ?? [];
  const chineseSentenceCount = (block.match(/[。！？]/gu) ?? []).length;

  if (block.length > 260 && englishSentences.length >= 2) {
    details.push(`例句区过长且含 ${englishSentences.length} 句英文，疑似多卡串线`);
  } else if (block.length > 360 && chineseSentenceCount >= 2) {
    details.push("例句区过长且含多段中文解释，疑似串入其他卡内容");
  }

  const noisyMatches = findOcrNoiseMatches(block);
  if (noisyMatches.length >= 2) {
    details.push(`例句区含 OCR 错字：${noisyMatches.slice(0, 6).join(", ")}`);
  }

  return details;
}

function ocrNoiseDetails(entry: InspectableMnemonicEntry) {
  const matches = findOcrNoiseMatches(`${entry.splitText ?? ""}\n${entry.contentMarkdown}`);
  return matches.length ? [`OCR 错字：${matches.slice(0, 8).join(", ")}`] : [];
}

function splitTextMismatchDetails(entry: InspectableMnemonicEntry) {
  const splitText = entry.splitText?.trim();
  if (!splitText) return [];

  const actual = normalizeLetters(splitText);
  const expected = normalizeLetters(entry.targetWord.word);
  if (!actual || !expected || actual === expected) return [];

  return [`划分拼回 ${actual}，目标词是 ${expected}`];
}

function lookaheadLooksLikeCard(lines: string[]) {
  const nonBlank = lines.map((line) => line.trim()).filter(Boolean);
  if (!nonBlank.length) return false;

  return nonBlank.some((line) => cardMarkerLine.test(line) || phoneticArtifactLine.test(line) || takeYouBackLine.test(line));
}

function exampleBlock(markdown: string) {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const start = lines.findIndex((line) => exampleHeading.test(line));
  if (start < 0) return "";

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (relatedHeading.test(lines[index])) {
      end = index;
      break;
    }
  }

  return lines.slice(start + 1, end).join("\n").trim();
}

function findOcrNoiseMatches(value: string) {
  const matches = new Set<string>();
  for (const token of ocrNoiseTokens) {
    const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`, "iu");
    if (pattern.test(value)) matches.add(token.toLowerCase());
  }
  return [...matches];
}

function isKnownOrLikelyWord(word: string, knownWords: KnownWordSet) {
  return knownWords.has(word) || word.length >= 5;
}

function normalizeWordCandidate(value: string) {
  return value.trim().toLowerCase().replace(/^[^a-z]+|[^a-z]+$/giu, "");
}

function normalizeLetters(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
