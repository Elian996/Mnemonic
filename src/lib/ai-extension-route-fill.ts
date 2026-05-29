import { ImportDraftStatus, MnemonicStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { renderMnemonicMarkdown } from "@/lib/wiki-links/renderer";

export const aiExtensionDraftSource = "ai-extension-route-fill";
export const aiExtensionRouteFillPausedReason =
  "AI 延伸生成已暂停：上一批草稿暴露出未核准中文释义和构词关系错配，必须先做人工释义核验。";

const activeMnemonicEntryWhere: Prisma.MnemonicEntryWhereInput = {
  status: { not: MnemonicStatus.ARCHIVED }
};

type WordSeed = {
  id: string;
  word: string;
  slug: string;
  meaningCn: string;
  shortMeaningCn: string;
  exampleSentence: string | null;
  exampleTranslation: string | null;
};

type RouteRule = {
  key: string;
  routeType: "prefix" | "suffix" | "agent" | "reverse-agent" | "spelling";
  ruleLabel: string;
  confidence: number;
  target: string;
  splitText: string;
  explanation: (baseWord: string, targetWord: string) => string;
  note: string;
};

export type AiExtensionCandidate = {
  baseWordId: string;
  baseWord: string;
  baseSlug: string;
  targetWordId: string;
  targetWord: string;
  targetSlug: string;
  targetMeaning: string;
  routeType: RouteRule["routeType"];
  ruleKey: string;
  ruleLabel: string;
  confidence: number;
  splitText: string;
  explanation: string;
  contentMarkdown: string;
  existingDraftId?: string;
};

export type AiExtensionDraftPayload = {
  type: typeof aiExtensionDraftSource;
  baseWordId: string;
  baseWord: string;
  baseSlug: string;
  targetWordId: string;
  targetWord: string;
  targetSlug: string;
  routeType: RouteRule["routeType"];
  ruleKey: string;
  ruleLabel: string;
  confidence: number;
  splitText: string;
  explanation: string;
};

export function normalizeSplitTextForWord(splitText: string | null | undefined, word: string) {
  const target = word.trim().toLowerCase().replace(/-/g, "");
  if (!target) return "";
  const cleaned = String(splitText ?? "")
    .replace(/^\s*划分\s*[:：]\s*/u, "")
    .replace(/｜/gu, "|")
    .trim();
  if (!cleaned) return "";

  const parentheticalSplitText = normalizeParentheticalSplitTextForWord(cleaned, target);
  if (parentheticalSplitText) return parentheticalSplitText;

  const parts = cleaned
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  if (!parts.every((part) => /^[a-z]+$/iu.test(part))) return "";
  if (parts.join("").toLowerCase() !== target) return "";
  return parts.join(" | ");
}

export function isParentheticalSplitTextValidForWord(splitText: string | null | undefined, word: string) {
  const target = word.trim().toLowerCase().replace(/-/g, "");
  if (!target) return false;
  const cleaned = String(splitText ?? "")
    .replace(/^\s*划分\s*[:：]\s*/u, "")
    .replace(/｜/gu, "|")
    .trim();
  return Boolean(normalizeParentheticalSplitTextForWord(cleaned, target));
}

function normalizeParentheticalSplitTextForWord(splitText: string, target: string) {
  if (!/[()（）]/u.test(splitText)) return "";
  const parts = splitText
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return "";
  if (!parts.every((part) => /^[a-z()（）]+$/iu.test(part))) return "";
  if (!canParentheticalSplitSpellTarget(parts.join(""), target)) return "";
  return parts.join(" | ");
}

function canParentheticalSplitSpellTarget(text: string, target: string) {
  let candidates = [""];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(" || char === "（") {
      const close = char === "(" ? ")" : "）";
      const closeIndex = text.indexOf(close, index + 1);
      if (closeIndex === -1) return false;
      const inner = text.slice(index + 1, closeIndex).toLowerCase();
      if (!/^[a-z]+$/iu.test(inner)) return false;
      candidates = candidates.flatMap((candidate) => [candidate, candidate + inner]);
      index = closeIndex;
      continue;
    }
    if (!/^[a-z]$/iu.test(char)) return false;
    candidates = candidates.map((candidate) => candidate + char.toLowerCase());
  }
  return candidates.some((candidate) => candidate === target);
}

export async function getAiExtensionCandidatesForBase(baseWordId: string, limit = 18) {
  if (aiExtensionRouteFillPausedReason) return [];
  const baseWord = await prisma.word.findUnique({
    where: { id: baseWordId },
    select: {
      id: true,
      word: true,
      slug: true,
      meaningCn: true,
      shortMeaningCn: true,
      exampleSentence: true,
      exampleTranslation: true,
      mnemonicEntries: {
        where: activeMnemonicEntryWhere,
        select: { id: true },
        take: 1
      }
    }
  });
  if (!baseWord?.mnemonicEntries.length) return [];

  const rules = buildRules(baseWord.word.toLowerCase());
  const uniqueTargets = Array.from(new Set(rules.map((rule) => rule.target))).filter((target) => target !== baseWord.word.toLowerCase());
  if (!uniqueTargets.length) return [];

  const targetWords = await prisma.word.findMany({
    where: {
      word: { in: uniqueTargets },
      mnemonicEntries: { none: activeMnemonicEntryWhere }
    },
    select: {
      id: true,
      word: true,
      slug: true,
      meaningCn: true,
      shortMeaningCn: true,
      exampleSentence: true,
      exampleTranslation: true
    }
  });
  const wordsByText = new Map(targetWords.map((word) => [word.word.toLowerCase(), word]));
  const pendingDrafts = await findPendingDraftsForBase(baseWord.id);
  const draftByTargetId = new Map(pendingDrafts.map((draft) => [readDraftPayload(draft.agentPayload)?.targetWordId ?? "", draft.id]));

  const candidates: AiExtensionCandidate[] = [];
  const seenWordIds = new Set<string>();
  for (const rule of rules) {
    const targetWord = wordsByText.get(rule.target);
    if (!targetWord || seenWordIds.has(targetWord.id)) continue;
    if (!isLikelyUsefulRoute(baseWord, targetWord, rule)) continue;
    seenWordIds.add(targetWord.id);
    candidates.push(toCandidate(baseWord, targetWord, rule, draftByTargetId.get(targetWord.id)));
    if (candidates.length >= limit) break;
  }

  return candidates;
}

export async function getAiExtensionBatchCandidates({
  limit,
  minConfidence = 0.85,
  skipExistingDrafts = true
}: {
  limit?: number;
  minConfidence?: number;
  skipExistingDrafts?: boolean;
} = {}) {
  if (aiExtensionRouteFillPausedReason) return [];
  const [baseWords, targetWords, pendingDrafts] = await Promise.all([
    prisma.word.findMany({
      where: { mnemonicEntries: { some: activeMnemonicEntryWhere } },
      select: {
        id: true,
        word: true,
        slug: true,
        meaningCn: true,
        shortMeaningCn: true,
        exampleSentence: true,
        exampleTranslation: true
      },
      orderBy: { word: "asc" }
    }),
    prisma.word.findMany({
      where: { mnemonicEntries: { none: activeMnemonicEntryWhere } },
      select: {
        id: true,
        word: true,
        slug: true,
        meaningCn: true,
        shortMeaningCn: true,
        exampleSentence: true,
        exampleTranslation: true
      }
    }),
    findPendingAiExtensionDrafts()
  ]);

  const targetByText = new Map(targetWords.map((word) => [word.word.toLowerCase(), word]));
  const pendingDraftByTargetId = new Map(pendingDrafts.map((draft) => [readDraftPayload(draft.agentPayload)?.targetWordId ?? "", draft.id]));
  const candidateByTargetId = new Map<string, AiExtensionCandidate>();

  for (const baseWord of baseWords) {
    for (const rule of buildRules(baseWord.word.toLowerCase())) {
      if (rule.confidence < minConfidence) continue;
      const targetWord = targetByText.get(rule.target);
      if (!targetWord || targetWord.id === baseWord.id) continue;
      const existingDraftId = pendingDraftByTargetId.get(targetWord.id);
      if (skipExistingDrafts && existingDraftId) continue;
      if (!isLikelyUsefulRoute(baseWord, targetWord, rule)) continue;

      const candidate = toCandidate(baseWord, targetWord, rule, existingDraftId);
      const current = candidateByTargetId.get(targetWord.id);
      if (current && compareCandidateQuality(current, candidate) >= 0) continue;
      candidateByTargetId.set(targetWord.id, candidate);
    }
  }

  const candidates = Array.from(candidateByTargetId.values()).sort((left, right) => {
    const confidenceDelta = right.confidence - left.confidence;
    if (confidenceDelta) return confidenceDelta;
    const targetDelta = left.targetWord.localeCompare(right.targetWord);
    if (targetDelta) return targetDelta;
    return left.baseWord.localeCompare(right.baseWord);
  });

  return typeof limit === "number" ? candidates.slice(0, Math.max(0, limit)) : candidates;
}

export async function buildAiExtensionCandidate(baseWordId: string, targetWordId: string, ruleKey: string) {
  if (aiExtensionRouteFillPausedReason) return null;
  const candidates = await getAiExtensionCandidatesForBase(baseWordId, 80);
  return candidates.find((candidate) => candidate.targetWordId === targetWordId && candidate.ruleKey === ruleKey) ?? null;
}

export async function getAiExtensionReviewCount() {
  return prisma.importDraft.count({
    where: {
      source: aiExtensionDraftSource,
      status: ImportDraftStatus.DRAFT
    }
  });
}

export async function getAiExtensionReviewItems(limit = 80, offset = 0) {
  const drafts = await prisma.importDraft.findMany({
    where: {
      source: aiExtensionDraftSource,
      status: ImportDraftStatus.DRAFT
    },
    orderBy: [{ createdAt: "desc" }],
    skip: offset,
    take: limit
  });
  const payloads = drafts
    .map((draft) => ({ draft, payload: readDraftPayload(draft.agentPayload) }))
    .filter((item): item is { draft: typeof item.draft; payload: AiExtensionDraftPayload } => Boolean(item.payload));
  const targetWordIds = Array.from(new Set(payloads.map((item) => item.payload.targetWordId)));
  const activeCounts = targetWordIds.length
    ? await prisma.mnemonicEntry.groupBy({
        by: ["targetWordId"],
        where: {
          targetWordId: { in: targetWordIds },
          status: { not: MnemonicStatus.ARCHIVED }
        },
        _count: { _all: true }
      })
    : [];
  const activeCountByWordId = new Map(activeCounts.map((count) => [count.targetWordId, count._count._all]));
  const targetWords = targetWordIds.length
    ? await prisma.word.findMany({
        where: { id: { in: targetWordIds } },
        select: {
          id: true,
          word: true,
          slug: true,
          phoneticUk: true,
          phoneticUs: true,
          partOfSpeech: true,
          meaningCn: true,
          shortMeaningCn: true
        }
      })
    : [];
  const targetWordById = new Map(targetWords.map((word) => [word.id, word]));

  return Promise.all(
    payloads.map(async ({ draft, payload }) => {
      const targetWord = targetWordById.get(payload.targetWordId);
      const word = targetWord?.word || draft.word;
      return {
        id: draft.id,
        word,
        slug: targetWord?.slug || payload.targetSlug,
        phonetic: targetWord?.phoneticUs || targetWord?.phoneticUk || "",
        partOfSpeech: targetWord?.partOfSpeech || "",
        meaning: targetWord?.shortMeaningCn || draft.shortMeaningCn || draft.meaningCn || "",
        fullMeaning: targetWord?.meaningCn || draft.meaningCn || "",
        splitText: normalizeSplitTextForWord(draft.splitText || payload.splitText, word),
        contentMarkdown: draft.contentMarkdown,
        contentHtml: await renderMnemonicMarkdown(draft.contentMarkdown),
        createdAt: draft.createdAt,
        payload,
        targetHasActiveCard: (activeCountByWordId.get(payload.targetWordId) ?? 0) > 0
      };
    })
  );
}

export function readDraftPayload(value: Prisma.JsonValue | null | undefined): AiExtensionDraftPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, Prisma.JsonValue>;
  if (record.type !== aiExtensionDraftSource) return null;
  const routeType = readRouteType(record.routeType);
  if (!routeType) return null;
  const payload: AiExtensionDraftPayload = {
    type: aiExtensionDraftSource,
    baseWordId: readString(record.baseWordId),
    baseWord: readString(record.baseWord),
    baseSlug: readString(record.baseSlug),
    targetWordId: readString(record.targetWordId),
    targetWord: readString(record.targetWord),
    targetSlug: readString(record.targetSlug),
    routeType,
    ruleKey: readString(record.ruleKey),
    ruleLabel: readString(record.ruleLabel),
    confidence: readNumber(record.confidence),
    splitText: readString(record.splitText),
    explanation: readString(record.explanation)
  };
  return payload.baseWordId && payload.targetWordId && payload.ruleKey ? payload : null;
}

export function candidateToDraftPayload(candidate: AiExtensionCandidate): AiExtensionDraftPayload {
  return {
    type: aiExtensionDraftSource,
    baseWordId: candidate.baseWordId,
    baseWord: candidate.baseWord,
    baseSlug: candidate.baseSlug,
    targetWordId: candidate.targetWordId,
    targetWord: candidate.targetWord,
    targetSlug: candidate.targetSlug,
    routeType: candidate.routeType,
    ruleKey: candidate.ruleKey,
    ruleLabel: candidate.ruleLabel,
    confidence: candidate.confidence,
    splitText: candidate.splitText,
    explanation: candidate.explanation
  };
}

function buildRules(base: string) {
  const rules: RouteRule[] = [];
  for (const prefix of prefixRules) {
    const target = `${prefix.value}${base}`;
    rules.push({
      key: `prefix:${prefix.value}`,
      routeType: "prefix",
      target,
      splitText: splitTextFromParts(target, prefix.value, base),
      ruleLabel: `${prefix.value}-`,
      confidence: prefix.confidence,
      explanation: (_base, target) => `${prefix.label}；${target} 可以用 ${_base} 加这个前缀来记。`,
      note: prefix.label
    });
  }

  for (const suffix of suffixRules) {
    const exactTarget = `${base}${suffix.value}`;
    addRule(rules, {
      key: `suffix:exact:${suffix.value}`,
      routeType: "suffix",
      target: exactTarget,
      splitText: splitTextFromParts(exactTarget, base, suffix.value),
      ruleLabel: `-${suffix.value}`,
      confidence: suffix.confidence,
      explanation: (_base, target) => `${suffix.label}；${target} 保留 ${_base} 的核心拼写，再加这个后缀。`,
      note: suffix.label
    });
    if (base.endsWith("e") && suffix.allowDropE) {
      const stem = base.slice(0, -1);
      const target = `${stem}${suffix.value}`;
      addRule(rules, {
        key: `suffix:drop-e:${suffix.value}`,
        routeType: "spelling",
        target,
        splitText: splitTextFromParts(target, stem, suffix.value),
        ruleLabel: `去 e + -${suffix.value}`,
        confidence: Math.max(0.85, suffix.confidence - 0.01),
        explanation: (_base, target) => `${suffix.label}；${target} 先去掉 ${_base} 结尾的 e，再加这个后缀。`,
        note: suffix.label
      });
    }
    if (base.endsWith("y") && suffix.allowYToI) {
      const stem = base.slice(0, -1);
      const target = `${stem}i${suffix.value}`;
      addRule(rules, {
        key: `suffix:y-i:${suffix.value}`,
        routeType: "spelling",
        target,
        splitText: splitTextFromParts(target, `${stem}i`, suffix.value),
        ruleLabel: `y -> i + -${suffix.value}`,
        confidence: Math.max(0.85, suffix.confidence - 0.01),
        explanation: (_base, target) => `${suffix.label}；${target} 把 ${_base} 结尾的 y 变成 i，再加这个后缀。`,
        note: suffix.label
      });
    }
  }

  if (base.endsWith("le")) {
    const stem = base.slice(0, -2);
    const ilityTarget = `${stem}ility`;
    addRule(rules, {
      key: "suffix:le-ility",
      routeType: "spelling",
      target: ilityTarget,
      splitText: splitTextFromParts(ilityTarget, ilityTarget.slice(0, -"ity".length), "ity"),
      ruleLabel: "-ility",
      confidence: 0.9,
      explanation: (_base, target) => `-${"ility"} 常构成表示“性质、能力、状态”的名词；${target} 可以从 ${_base} 的形容词意义转成名词来记。`,
      note: "-ility 表示性质、能力或状态"
    });
    const lyTarget = `${base.slice(0, -1)}y`;
    addRule(rules, {
      key: "suffix:le-ly",
      routeType: "spelling",
      target: lyTarget,
      splitText: splitTextFromParts(lyTarget, lyTarget.slice(0, -1), "y"),
      ruleLabel: "-ly",
      confidence: 0.88,
      explanation: (_base, target) => `-${"ly"} 常构成副词；${target} 可以从 ${_base} 的形容词意义转成副词来记。`,
      note: "-ly 构成副词"
    });
  }

  for (const reverse of reverseAgentRules(base)) addRule(rules, reverse);
  return rules;
}

function toCandidate(baseWord: WordSeed, targetWord: WordSeed, rule: RouteRule, existingDraftId?: string): AiExtensionCandidate {
  const explanation = rule.explanation(baseWord.word, targetWord.word);
  const candidate = {
    baseWordId: baseWord.id,
    baseWord: baseWord.word,
    baseSlug: baseWord.slug,
    targetWordId: targetWord.id,
    targetWord: targetWord.word,
    targetSlug: targetWord.slug,
    targetMeaning: compactMeaning(targetWord.shortMeaningCn || targetWord.meaningCn),
    routeType: rule.routeType,
    ruleKey: rule.key,
    ruleLabel: rule.ruleLabel,
    confidence: rule.confidence,
    splitText: rule.splitText,
    explanation,
    contentMarkdown: "",
    existingDraftId
  };
  return {
    ...candidate,
    contentMarkdown: buildCandidateMarkdown(candidate, baseWord, targetWord, rule)
  };
}

function buildCandidateMarkdown(
  candidate: Omit<AiExtensionCandidate, "contentMarkdown">,
  baseWord: WordSeed,
  targetWord: WordSeed,
  rule: RouteRule
) {
  const baseMeaning = compactMeaning(baseWord.shortMeaningCn || baseWord.meaningCn);
  const targetMeaning = compactMeaning(targetWord.shortMeaningCn || targetWord.meaningCn);
  const exampleLines = buildExampleLines(targetWord, rule);
  return [
    "带你背：",
    "",
    `${baseWord.word} 为已经记忆过的单词，表示 ${baseMeaning}；`,
    `${targetWord.word} 可以通过 ${baseWord.word} 来记：`,
    candidate.explanation,
    `由此记住 ${targetWord.word} 表示 ${targetMeaning}。`,
    "",
    "词根词缀积累：",
    "",
    `${candidate.ruleLabel}：${rule.note}。`,
    "",
    "例：",
    ...exampleLines,
    "",
    "相关单词：",
    `[[word:${baseWord.word.toLowerCase()}]]`
  ].join("\n");
}

function splitTextFromParts(target: string, ...parts: string[]) {
  return normalizeSplitTextForWord(parts.join(" | "), target);
}

function buildExampleLines(targetWord: WordSeed, rule: RouteRule) {
  const targetMeaning = compactMeaning(targetWord.shortMeaningCn || targetWord.meaningCn);
  const lines = [`${targetWord.word}（${targetMeaning}）`];
  for (const example of constructionExamplesFor(rule)) {
    if (example.toLowerCase().startsWith(`${targetWord.word.toLowerCase()}（`)) continue;
    lines.push(example);
    if (lines.length >= 3) break;
  }
  while (lines.length < 3) {
    lines.push("例词待人工补充。");
  }
  return lines.slice(0, 3);
}

function constructionExamplesFor(rule: RouteRule) {
  if (rule.routeType === "prefix") {
    const prefix = rule.key.split(":")[1] ?? "";
    return prefixExampleBank[prefix] ?? [];
  }
  if (rule.routeType === "reverse-agent") return reverseAgentExampleBank;
  const suffix = suffixFromRule(rule);
  return suffixExampleBank[suffix] ?? [];
}

function reverseAgentRules(base: string) {
  const rules: RouteRule[] = [];
  if (base.endsWith("er") && base.length > 4) {
    const stem = base.slice(0, -2);
    for (const target of [stem, `${stem}e`]) {
      addRule(rules, {
        key: `reverse-agent:er:${target}`,
        routeType: "reverse-agent",
        target,
        splitText: splitTextFromParts(target, target),
        ruleLabel: "反推 -er",
        confidence: 0.86,
        explanation: (_base, targetWord) => `${_base} 是常见的“做某事的人”形式，可以反推出动作词 ${targetWord}。`,
        note: "-er 常表示做某事的人，反推时只用于缺卡目标词"
      });
    }
  }
  if (base.endsWith("or") && base.length > 4) {
    const stem = base.slice(0, -2);
    for (const target of [stem, `${stem}e`]) {
      addRule(rules, {
        key: `reverse-agent:or:${target}`,
        routeType: "reverse-agent",
        target,
        splitText: splitTextFromParts(target, target),
        ruleLabel: "反推 -or",
        confidence: 0.86,
        explanation: (_base, targetWord) => `${_base} 是常见的“执行者/创造者”形式，可以反推出动作词 ${targetWord}。`,
        note: "-or 常表示执行者，反推时只用于缺卡目标词"
      });
    }
  }
  if (base.endsWith("ologist") && base.length > 8) {
    const target = `${base.slice(0, -"ologist".length)}ology`;
    addRule(rules, {
      key: `reverse-agent:ologist:${target}`,
      routeType: "reverse-agent",
      target,
      splitText: splitTextFromParts(target, target),
      ruleLabel: "反推 -ologist",
      confidence: 0.86,
      explanation: (_base, targetWord) => `${_base} 表示研究某领域的人，可以反推出对应学科词 ${targetWord}。`,
      note: "-ologist 表示某领域研究者"
    });
  }
  return rules;
}

async function findPendingDraftsForBase(baseWordId: string) {
  const drafts = await findPendingAiExtensionDrafts();
  return drafts.filter((draft) => readDraftPayload(draft.agentPayload)?.baseWordId === baseWordId);
}

async function findPendingAiExtensionDrafts() {
  return prisma.importDraft.findMany({
    where: {
      source: aiExtensionDraftSource,
      status: ImportDraftStatus.DRAFT
    },
    select: { id: true, agentPayload: true },
    take: 20000
  });
}

function addRule(rules: RouteRule[], rule: RouteRule) {
  if (!/^[a-z][a-z-]{1,38}$/u.test(rule.target)) return;
  if (rules.some((item) => item.target === rule.target)) return;
  rules.push(rule);
}

function compareCandidateQuality(left: AiExtensionCandidate, right: AiExtensionCandidate) {
  const confidenceDelta = left.confidence - right.confidence;
  if (confidenceDelta) return confidenceDelta;
  const routeDelta = routeTypeRank(left.routeType) - routeTypeRank(right.routeType);
  if (routeDelta) return routeDelta;
  return left.baseWord.length - right.baseWord.length;
}

function routeTypeRank(routeType: RouteRule["routeType"]) {
  const rank: Record<RouteRule["routeType"], number> = {
    spelling: 5,
    suffix: 4,
    prefix: 3,
    "reverse-agent": 2,
    agent: 1
  };
  return rank[routeType];
}

function isLikelyUsefulRoute(baseWord: WordSeed, targetWord: WordSeed, rule: RouteRule) {
  const baseMeaning = compactMeaning(baseWord.shortMeaningCn || baseWord.meaningCn);
  const targetMeaning = compactMeaning(targetWord.shortMeaningCn || targetWord.meaningCn);
  const commonLength = longestCommonChineseSubstringLength(baseMeaning, targetMeaning);

  if (rule.routeType === "prefix") {
    const prefix = rule.key.split(":")[1] ?? "";
    return commonLength >= 1 && prefixMeaningFits(prefix, targetMeaning);
  }

  if (rule.routeType === "reverse-agent") {
    return commonLength >= 1 && hasAnyChinese(targetMeaning, ["做", "动", "行为", "动作"]);
  }

  const suffix = suffixFromRule(rule);
  if (suffix === "er" || suffix === "or" || suffix === "ist") {
    return commonLength >= 1 && hasAnyChinese(targetMeaning, ["者", "人", "员", "家", "师", "手", "工", "器", "机", "物", "剂"]);
  }
  if (suffix === "ly") {
    return (commonLength >= 1 && targetMeaning.includes("地")) || commonLength >= 2;
  }
  if (suffix === "less") {
    return (commonLength >= 1 && hasAnyChinese(targetMeaning, ["无", "没有", "缺", "不"])) || commonLength >= 2;
  }
  if (suffix === "ful") {
    return (commonLength >= 1 && hasAnyChinese(targetMeaning, ["满", "充满", "多", "量"])) || commonLength >= 2;
  }
  if (suffix === "ness" || suffix === "ity" || suffix === "cy" || suffix === "ment" || suffix === "ance" || suffix === "ence" || suffix === "ship" || suffix === "hood") {
    return commonLength >= 2 || (commonLength >= 1 && hasAnyChinese(targetMeaning, ["性", "状态", "程度", "行为", "过程", "结果", "关系", "身份", "时期", "情况"]));
  }
  if (suffix === "ize" || suffix === "en") {
    return (commonLength >= 1 && hasAnyChinese(targetMeaning, ["使", "化", "变", "成为"])) || commonLength >= 2;
  }

  return commonLength >= 2;
}

function suffixFromRule(rule: RouteRule) {
  if (rule.key.startsWith("suffix:le-")) return rule.key === "suffix:le-ility" ? "ity" : "ly";
  const parts = rule.key.split(":");
  return parts[parts.length - 1] ?? "";
}

function prefixMeaningFits(prefix: string, targetMeaning: string) {
  const cues: Record<string, string[]> = {
    un: ["不", "非", "无", "未"],
    in: ["不", "非", "无", "未"],
    im: ["不", "非", "无", "未"],
    il: ["不", "非", "无", "未"],
    ir: ["不", "非", "无", "未"],
    non: ["不", "非", "无", "未"],
    dis: ["不", "非", "无", "反", "相反", "取消", "除去"],
    mis: ["误", "错"],
    re: ["再", "重新", "回", "复"],
    pre: ["前", "预", "先"],
    post: ["后"],
    over: ["过", "超过", "太", "上"],
    under: ["下", "不足", "低"],
    inter: ["间", "互", "相互"],
    anti: ["反", "抗", "防"],
    trans: ["转", "跨", "变"],
    en: ["使", "成", "变"],
    em: ["使", "成", "变"]
  };
  return hasAnyChinese(targetMeaning, cues[prefix] ?? []);
}

function longestCommonChineseSubstringLength(left: string, right: string) {
  const a = onlyChinese(left);
  const b = onlyChinese(right);
  if (!a || !b) return 0;
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  let best = 0;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] !== b[j - 1]) continue;
      dp[i][j] = dp[i - 1][j - 1] + 1;
      best = Math.max(best, dp[i][j]);
    }
  }
  return best;
}

function onlyChinese(value: string) {
  return Array.from(value).filter((char) => /\p{Script=Han}/u.test(char)).join("");
}

function hasAnyChinese(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

const suffixExampleBank: Record<string, string[]> = {
  ly: ["quickly（快速地）", "clearly（清楚地）", "carefully（小心地）"],
  er: ["teacher（教师）", "worker（工人）", "writer（作者）"],
  or: ["actor（演员）", "creator（创造者）", "collector（收藏者）"],
  ist: ["artist（艺术家）", "scientist（科学家）", "specialist（专家）"],
  ment: ["development（发展）", "movement（运动）", "agreement（协议）"],
  ness: ["happiness（幸福）", "darkness（黑暗）", "kindness（善良）"],
  ity: ["ability（能力）", "reality（现实）", "activity（活动）"],
  cy: ["accuracy（准确性）", "privacy（隐私）", "fluency（流利）"],
  ful: ["hopeful（有希望的）", "careful（小心的）", "useful（有用的）"],
  less: ["hopeless（无望的）", "careless（粗心的）", "useless（无用的）"],
  able: ["readable（可读的）", "usable（可用的）", "enjoyable（愉快的）"],
  ible: ["visible（可见的）", "possible（可能的）", "responsible（负责的）"],
  ion: ["action（行动）", "creation（创造）", "connection（连接）"],
  tion: ["creation（创造）", "connection（连接）", "education（教育）"],
  ation: ["education（教育）", "information（信息）", "organization（组织）"],
  ance: ["appearance（出现）", "performance（表现）", "importance（重要性）"],
  ence: ["difference（差异）", "existence（存在）", "dependence（依赖）"],
  ive: ["active（活跃的）", "creative（有创造力的）", "effective（有效的）"],
  ative: ["creative（有创造力的）", "talkative（健谈的）", "imaginative（有想象力的）"],
  ous: ["dangerous（危险的）", "famous（著名的）", "nervous（紧张的）"],
  ic: ["basic（基本的）", "historic（历史性的）", "scientific（科学的）"],
  ize: ["modernize（使现代化）", "realize（意识到）", "organize（组织）"],
  en: ["widen（加宽）", "strengthen（加强）", "shorten（缩短）"],
  ship: ["friendship（友谊）", "leadership（领导力）", "membership（会员身份）"],
  hood: ["childhood（童年）", "neighborhood（社区）", "brotherhood（兄弟关系）"],
  ant: ["assistant（助手）", "important（重要的）", "applicant（申请人）"],
  ent: ["student（学生）", "dependent（依赖的）", "different（不同的）"],
  y: ["rainy（多雨的）", "cloudy（多云的）", "sleepy（困倦的）"]
};

const prefixExampleBank: Record<string, string[]> = {
  un: ["unhappy（不快乐的）", "unable（不能的）", "unknown（未知的）"],
  in: ["inactive（不活跃的）", "incorrect（不正确的）", "invisible（看不见的）"],
  im: ["impossible（不可能的）", "impatient（不耐烦的）", "imperfect（不完美的）"],
  il: ["illegal（非法的）", "illogical（不合逻辑的）", "illiterate（不识字的）"],
  ir: ["irregular（不规则的）", "irresponsible（不负责的）", "irrelevant（不相关的）"],
  non: ["nonstop（不停的）", "nonviolent（非暴力的）", "nonsense（胡说）"],
  dis: ["disagree（不同意）", "disappear（消失）", "dishonest（不诚实的）"],
  mis: ["misunderstand（误解）", "misuse（误用）", "mislead（误导）"],
  re: ["rewrite（重写）", "review（复习）", "rebuild（重建）"],
  pre: ["preview（预览）", "prepay（预付）", "prewar（战前的）"],
  post: ["postwar（战后的）", "postgraduate（研究生）", "postpone（推迟）"],
  over: ["overwork（过度工作）", "overeat（吃得过多）", "overweight（超重的）"],
  under: ["underpay（少付工资）", "underestimate（低估）", "underground（地下的）"],
  inter: ["interact（互动）", "international（国际的）", "interchange（交换）"],
  anti: ["antiwar（反战的）", "antibody（抗体）", "antibiotic（抗生素）"],
  trans: ["transport（运输）", "transform（转变）", "translate（翻译）"],
  en: ["enable（使能够）", "enlarge（扩大）", "enrich（使丰富）"],
  em: ["empower（授权）", "embody（体现）", "emphasize（强调）"]
};

const reverseAgentExampleBank = ["singer -> sing（歌手 -> 唱歌）", "dancer -> dance（舞者 -> 跳舞）", "creator -> create（创造者 -> 创造）"];

const prefixRules = [
  { value: "un", label: "un- 表示“不、相反”", confidence: 0.9 },
  { value: "in", label: "in- 表示“不、非”", confidence: 0.88 },
  { value: "im", label: "im- 表示“不、非”", confidence: 0.88 },
  { value: "il", label: "il- 表示“不、非”", confidence: 0.88 },
  { value: "ir", label: "ir- 表示“不、非”", confidence: 0.88 },
  { value: "non", label: "non- 表示“非、不”", confidence: 0.88 },
  { value: "dis", label: "dis- 表示“相反、取消、使不”", confidence: 0.9 },
  { value: "mis", label: "mis- 表示“错误地、误”", confidence: 0.9 },
  { value: "re", label: "re- 表示“再次、重新”", confidence: 0.89 },
  { value: "pre", label: "pre- 表示“之前、预先”", confidence: 0.88 },
  { value: "post", label: "post- 表示“之后”", confidence: 0.87 },
  { value: "over", label: "over- 表示“过度、超过、在上方”", confidence: 0.88 },
  { value: "under", label: "under- 表示“不足、在下方”", confidence: 0.87 },
  { value: "inter", label: "inter- 表示“之间、相互”", confidence: 0.87 },
  { value: "anti", label: "anti- 表示“反对、抗”", confidence: 0.87 },
  { value: "trans", label: "trans- 表示“跨越、转变”", confidence: 0.86 },
  { value: "en", label: "en- 表示“使成为、使进入某种状态”", confidence: 0.9 },
  { value: "em", label: "em- 表示“使成为、使进入某种状态”", confidence: 0.87 }
];

const suffixRules = [
  { value: "ly", label: "-ly 常构成副词，表示“以……方式”", confidence: 0.88, allowYToI: true },
  { value: "er", label: "-er 常表示“做某事的人/物”", confidence: 0.9, allowDropE: true },
  { value: "or", label: "-or 常表示“执行者、创造者或相关物”", confidence: 0.9, allowDropE: true },
  { value: "ist", label: "-ist 常表示“某领域的人、从事者”", confidence: 0.88 },
  { value: "ment", label: "-ment 常构成名词，表示动作、结果或状态", confidence: 0.9 },
  { value: "ness", label: "-ness 常构成名词，表示状态或性质", confidence: 0.9, allowYToI: true },
  { value: "ity", label: "-ity 常构成名词，表示性质、状态或程度", confidence: 0.88 },
  { value: "cy", label: "-cy 常构成名词，表示状态、性质或职位", confidence: 0.86 },
  { value: "ful", label: "-ful 常构成形容词，表示“充满、有”", confidence: 0.9 },
  { value: "less", label: "-less 常构成形容词，表示“没有、缺少”", confidence: 0.9 },
  { value: "able", label: "-able 常构成形容词，表示“能够……的、可……的”", confidence: 0.88, allowDropE: true },
  { value: "ible", label: "-ible 常构成形容词，表示“能够……的、可……的”", confidence: 0.86, allowDropE: true },
  { value: "ion", label: "-ion 常构成名词，表示动作、过程或结果", confidence: 0.88, allowDropE: true },
  { value: "tion", label: "-tion 常构成名词，表示动作、过程或结果", confidence: 0.88 },
  { value: "ation", label: "-ation 常构成名词，表示动作、过程或状态", confidence: 0.88 },
  { value: "ance", label: "-ance 常构成名词，表示状态、性质或行为", confidence: 0.88 },
  { value: "ence", label: "-ence 常构成名词，表示状态、性质或行为", confidence: 0.88 },
  { value: "ive", label: "-ive 常构成形容词，表示“有……性质的”", confidence: 0.88, allowDropE: true },
  { value: "ative", label: "-ative 常构成形容词，表示“有……倾向/性质的”", confidence: 0.86 },
  { value: "ous", label: "-ous 常构成形容词，表示“充满、有……性质的”", confidence: 0.86 },
  { value: "ic", label: "-ic 常构成形容词，表示“……的、与……有关的”", confidence: 0.86 },
  { value: "ize", label: "-ize 常构成动词，表示“使成为、使……化”", confidence: 0.88 },
  { value: "en", label: "-en 常构成动词，表示“使变得……”", confidence: 0.88 },
  { value: "ship", label: "-ship 常构成名词，表示身份、关系或状态", confidence: 0.88 },
  { value: "hood", label: "-hood 常构成名词，表示身份、时期或状态", confidence: 0.88 },
  { value: "ant", label: "-ant 常表示具有某性质的人、物或形容词", confidence: 0.85, allowDropE: true },
  { value: "ent", label: "-ent 常表示具有某性质的人、物或形容词", confidence: 0.85, allowDropE: true },
  { value: "y", label: "-y 常构成形容词，表示“有……的、像……的”", confidence: 0.85, allowDropE: false }
];

function compactMeaning(value: string) {
  return value
    .replace(/\s+/gu, "")
    .replace(/[;；]+/gu, "，")
    .replace(/,+/gu, "，")
    .replace(/，$/u, "")
    .slice(0, 90) || "相关含义";
}

function readString(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" ? value : "";
}

function readNumber(value: Prisma.JsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readRouteType(value: Prisma.JsonValue | undefined): RouteRule["routeType"] | null {
  if (value === "prefix" || value === "suffix" || value === "agent" || value === "reverse-agent" || value === "spelling") {
    return value;
  }
  return null;
}
