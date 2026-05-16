import fs from "node:fs";
import path from "node:path";
import {
  MnemonicSourceType,
  MnemonicStatus,
  Prisma,
  PrismaClient,
  WordStatus,
  type LevelTag,
  type Word
} from "@prisma/client";
import { ensureWordNode, syncEntryWikiLinks } from "../src/lib/wiki-links/resolve";
import { markdownToPlainText, renderMnemonicMarkdown } from "../src/lib/wiki-links/renderer";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const marker = "codex-p0-source-repair-2026-05-15";
const reportPath = path.join(process.cwd(), "tmp", "mnemonic-logic-audit", "latest.json");
const outputDir = path.join(process.cwd(), "tmp", "p0-source-repair");
const backupDir = path.join(process.cwd(), "backups");

const sourceFiles = [
  { label: "4500单词突围（总）.docx", path: path.join(process.cwd(), "tmp", "source-4500-docx.txt") },
  { label: "Day26-34p_merged.pdf", path: path.join(process.cwd(), "tmp", "source-day26-34.txt") },
  { label: "单词突围上册.pdf", path: path.join(process.cwd(), "tmp", "source-upper.txt") },
  { label: "单词突围5200 下册.pdf OCR", path: path.join(process.cwd(), "tmp", "source-lower-ocr.txt") }
];

const knownSourceMistakeWords = new Set(["conducive"]);
const knownMissingWords = new Set(["teen"]);

type LogicIssue = {
  entryId: string;
  wordId: string;
  word: string;
  slug: string;
  levelTags: LevelTag[];
  severity: "P0" | "P1" | "P2" | "P3";
  issueType: string;
  reason: string;
  evidence: string;
  suggestion: string;
};

type LogicReport = {
  issues: LogicIssue[];
};

type SourceBlock = {
  source: string;
  phonetic: string;
  meaning: string;
  splitText: string;
  body: string;
  prefix: string;
  raw: string;
};

type Candidate = SourceBlock & {
  score: number;
  scoreReasons: string[];
  targetCount: number;
  contentMarkdown: string;
  partOfSpeech: string;
  meaningCn: string;
  shortMeaningCn: string;
  exampleSentence: string;
  exampleTranslation: string;
};

type Plan =
  | {
      action: "repair";
      word: WordInfo;
      issue: LogicIssue;
      candidate: Candidate;
      activeOfficialEntryIds: string[];
    }
  | {
      action: "empty";
      word: WordInfo;
      issue: LogicIssue;
      reason: "missing_source" | "source_word_error";
      bestCandidate?: Pick<Candidate, "source" | "score" | "scoreReasons" | "phonetic" | "meaning" | "body">;
      activeOfficialEntryIds: string[];
    };

type WordInfo = Pick<
  Word,
  | "id"
  | "word"
  | "slug"
  | "phoneticUk"
  | "phoneticUs"
  | "partOfSpeech"
  | "meaningCn"
  | "shortMeaningCn"
  | "exampleSentence"
  | "exampleTranslation"
  | "levelTags"
  | "status"
>;

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as LogicReport;
  const p0Issues = uniqueP0Issues(report.issues);
  const issueWords = p0Issues.map((issue) => issue.word);
  const actor = await prisma.user.findFirst({
    where: { OR: [{ role: "ADMIN" }, { role: "EDITOR" }], status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, username: true }
  });
  if (!actor) throw new Error("找不到可用于批量修复的管理员/编辑账号。");

  const words = await prisma.word.findMany({
    where: { word: { in: issueWords } },
    select: {
      id: true,
      word: true,
      slug: true,
      phoneticUk: true,
      phoneticUs: true,
      partOfSpeech: true,
      meaningCn: true,
      shortMeaningCn: true,
      exampleSentence: true,
      exampleTranslation: true,
      levelTags: true,
      status: true,
      mnemonicEntries: {
        where: { sourceType: MnemonicSourceType.OFFICIAL, status: { not: MnemonicStatus.ARCHIVED } },
        select: { id: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      }
    }
  });
  const wordsByText = new Map(words.map((word) => [word.word, word]));
  const blocks = parseAllSourceBlocks();

  const plans: Plan[] = [];
  for (const issue of p0Issues) {
    const word = wordsByText.get(issue.word);
    if (!word) continue;
    const activeOfficialEntryIds = word.mnemonicEntries.map((entry) => entry.id);
    const wordInfo: WordInfo = {
      id: word.id,
      word: word.word,
      slug: word.slug,
      phoneticUk: word.phoneticUk,
      phoneticUs: word.phoneticUs,
      partOfSpeech: word.partOfSpeech,
      meaningCn: word.meaningCn,
      shortMeaningCn: word.shortMeaningCn,
      exampleSentence: word.exampleSentence,
      exampleTranslation: word.exampleTranslation,
      levelTags: word.levelTags,
      status: word.status
    };

    const candidates = rankCandidates(wordInfo, blocks);
    const best = candidates[0];
    const reliable = candidates.find(isReliableCandidate);
    if (knownSourceMistakeWords.has(word.word)) {
      plans.push({
        action: "empty",
        word: wordInfo,
        issue,
        reason: "source_word_error",
        bestCandidate: best ? summarizeCandidate(best) : undefined,
        activeOfficialEntryIds
      });
    } else if (knownMissingWords.has(word.word)) {
      plans.push({
        action: "empty",
        word: wordInfo,
        issue,
        reason: "missing_source",
        bestCandidate: best ? summarizeCandidate(best) : undefined,
        activeOfficialEntryIds
      });
    } else if (reliable) {
      plans.push({
        action: "repair",
        word: wordInfo,
        issue,
        candidate: reliable,
        activeOfficialEntryIds
      });
    } else {
      plans.push({
        action: "empty",
        word: wordInfo,
        issue,
        reason: "missing_source",
        bestCandidate: best ? summarizeCandidate(best) : undefined,
        activeOfficialEntryIds
      });
    }
  }

  const dryRunPath = path.join(outputDir, `dry-run-${Date.now()}.json`);
  fs.writeFileSync(dryRunPath, JSON.stringify(summarizePlans(plans), null, 2));
  printSummary(plans, dryRunPath);

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to write database changes.");
    return;
  }

  const backupPath = await writeBackup(plans);
  const applyResult = await applyPlans(plans, actor.id);
  const applyPath = path.join(outputDir, `apply-${Date.now()}.json`);
  fs.writeFileSync(applyPath, JSON.stringify({ marker, backupPath, ...applyResult, plans: summarizePlans(plans) }, null, 2));
  console.log(`Applied repair. backup=${backupPath}`);
  console.log(`Result written to ${applyPath}`);
}

function uniqueP0Issues(issues: LogicIssue[]) {
  const seen = new Set<string>();
  const result: LogicIssue[] = [];
  for (const issue of issues) {
    if (issue.severity !== "P0") continue;
    const key = issue.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(issue);
  }
  return result;
}

function parseAllSourceBlocks() {
  const blocks: SourceBlock[] = [];
  for (const source of sourceFiles) {
    if (!fs.existsSync(source.path)) {
      console.warn(`Missing source text cache: ${source.path}`);
      continue;
    }
    const text = cleanText(fs.readFileSync(source.path, "utf8"));
    blocks.push(...parseSourceBlocks(source.label, text));
  }
  return blocks;
}

function parseSourceBlocks(source: string, text: string) {
  const markers = Array.from(text.matchAll(sourceMarkerPattern())).map((match) => match.index ?? 0);
  const blocks: SourceBlock[] = [];
  for (let index = 0; index < markers.length; index += 1) {
    const start = markers[index];
    const end = markers[index + 1] ?? text.length;
    const raw = text.slice(start, end);
    const parsed = parseSourceBlock(source, raw, normalizeWhitespace(text.slice(Math.max(0, start - 180), start)));
    if (parsed) blocks.push(parsed);
  }
  return blocks;
}

function parseSourceBlock(source: string, rawText: string, prefix: string): SourceBlock | null {
  const compact = normalizeWhitespace(cleanText(rawText));
  const marker = sourceMarkerPattern().source;
  const match = compact.match(
    new RegExp(`${marker}\\s*(.*?)\\s*(?:释义|异义|义)[:：]\\s*(.*?)\\s*(?:老王带你背|带你背|带你记|敬背)[:：-]?\\s*(.*)`, "iu")
  );
  if (!match) return null;
  const phonetic = normalizeWhitespace(match[1] ?? "");
  const meaning = normalizeWhitespace(match[2] ?? "");
  let body = normalizeWhitespace(match[3] ?? "");
  body = body
    .replace(/===\s*(?:PAGE|LOWER PAGE)\s+\d+(?:\s+(?:LEFT|RIGHT))?\s*===/giu, " ")
    .replace(/\b(?:DAY|Day)\s*\d+\b/gu, " ")
    .replace(/学海学院店铺|修订完整|单词突围第\d+天/gu, " ");
  body = normalizeWhitespace(body);

  let splitText = "";
  const splitMatch = body.match(
    /^划分[:：]\s*(.*?)(?=\s*(?:针对第\s*1|针对第1|针对整个|综合考虑|联系|想象|属于|[a-zA-Z]+(?:\s+为|\s+作)|①|②))/u
  );
  if (splitMatch?.[1]) {
    splitText = cleanSplitText(splitMatch[1]);
    body = normalizeWhitespace(body.slice(splitMatch[0].length));
  }

  return {
    source,
    phonetic,
    meaning,
    splitText,
    body,
    prefix,
    raw: compact
  };
}

function rankCandidates(word: WordInfo, blocks: SourceBlock[]): Candidate[] {
  return blocks
    .map((block) => toCandidate(word, block))
    .filter((candidate): candidate is Candidate => candidate !== null && candidate.score > 0)
    .sort((a, b) => b.score - a.score);
}

function toCandidate(word: WordInfo, block: SourceBlock): Candidate | null {
  const wordText = word.word.toLowerCase();
  const raw = `${block.prefix} ${block.raw} ${block.body}`.toLowerCase();
  const targetPattern = new RegExp(`(?<![a-z])${escapeRegExp(wordText)}(?![a-z])`, "giu");
  const targetCount = Array.from(raw.matchAll(targetPattern)).length;
  const scoreReasons: string[] = [];
  let score = 0;
  const sourcePhonetic = normalizePhonetic(block.phonetic);
  const wordPhonetics = [normalizePhonetic(word.phoneticUk), normalizePhonetic(word.phoneticUs)].filter(Boolean);
  if (sourcePhonetic && wordPhonetics.some((phonetic) => phonetic === sourcePhonetic)) {
    score += 10;
    scoreReasons.push("phonetic=");
  } else if (
    sourcePhonetic &&
    wordPhonetics.some((phonetic) => phonetic.length > 2 && sourcePhonetic.length > 2 && (phonetic.includes(sourcePhonetic) || sourcePhonetic.includes(phonetic)))
  ) {
    score += 7;
    scoreReasons.push("phonetic~");
  }
  if (new RegExp(`(?<![a-z])${escapeRegExp(wordText)}(?![a-z])`, "iu").test(block.prefix)) {
    score += 3;
    scoreReasons.push("prefix");
  }
  if (targetCount) {
    score += Math.min(targetCount, 5);
    scoreReasons.push(`count${targetCount}`);
  }
  if (new RegExp(`(?<![a-z])${escapeRegExp(wordText)}(?![a-z])\\s*(?:为|表示|作|发音|的发音|谐音)`, "iu").test(raw)) {
    score += 3;
    scoreReasons.push("phrase");
  }
  if (block.splitText.toLowerCase().includes(wordText)) {
    score += 2;
    scoreReasons.push("split");
  }
  if (hasMeaningOverlap(block.meaning, word.meaningCn)) {
    score += 4;
    scoreReasons.push("meaning");
  }
  if (targetCount <= 1 && !scoreReasons.some((reason) => reason.startsWith("phonetic"))) {
    score -= 3;
    scoreReasons.push("weak-target");
  }

  if (score <= 0) return null;
  const wordFields = parseMeaningFields(block.meaning, word);
  const example = parseExample(block.body);
  const mnemonicBody = normalizeExampleMarker(example.beforeExample || block.body);
  const contentMarkdown = buildContentMarkdown(mnemonicBody, example.exampleSentence, example.exampleTranslation);
  if (contentMarkdown.length < 8) return null;

  return {
    ...block,
    score,
    scoreReasons,
    targetCount,
    contentMarkdown,
    partOfSpeech: wordFields.partOfSpeech,
    meaningCn: wordFields.meaningCn,
    shortMeaningCn: shortMeaningFrom(wordFields.meaningCn),
    exampleSentence: example.exampleSentence,
    exampleTranslation: example.exampleTranslation
  };
}

function isReliableCandidate(candidate: Candidate) {
  const hasTargetAnchor =
    candidate.targetCount > 0 ||
    candidate.scoreReasons.includes("prefix") ||
    candidate.scoreReasons.includes("phrase") ||
    candidate.scoreReasons.includes("split");
  const hasSourceAnchor =
    candidate.scoreReasons.includes("meaning") ||
    candidate.scoreReasons.includes("phonetic=") ||
    candidate.scoreReasons.includes("phonetic~");
  if (candidate.score >= 7 && hasTargetAnchor && hasSourceAnchor) return true;
  if (candidate.score >= 6 && candidate.targetCount >= 2 && candidate.scoreReasons.includes("meaning")) return true;
  if (
    candidate.score >= 5 &&
    candidate.targetCount >= 1 &&
    candidate.scoreReasons.includes("prefix") &&
    candidate.scoreReasons.includes("meaning")
  ) {
    return true;
  }
  return false;
}

function parseMeaningFields(meaning: string, word: WordInfo) {
  const clean = normalizeWhitespace(meaning).replace(/^[:：]/u, "");
  const cjkIndex = clean.search(/[\u3400-\u9fff]/u);
  if (cjkIndex > 0 && cjkIndex <= 30) {
    const partOfSpeech = clean.slice(0, cjkIndex).replace(/[，,；;、\s]+$/u, "").trim();
    const meaningCn = clean.slice(cjkIndex).trim();
    if (partOfSpeech && meaningCn) return { partOfSpeech, meaningCn };
  }
  return {
    partOfSpeech: word.partOfSpeech || "n.",
    meaningCn: clean || word.meaningCn
  };
}

function parseExample(body: string) {
  const marker = body.search(exampleMarkerPattern());
  if (marker === -1) {
    return { beforeExample: body, exampleSentence: "", exampleTranslation: "" };
  }
  const beforeExample = normalizeWhitespace(body.slice(0, marker));
  const after = normalizeWhitespace(body.slice(marker).replace(exampleMarkerPattern(), ""));
  const nextSection = after.search(/(?:常见搭配|词汇扩充|对比辨析|词根词缀积累|注意[:：]|总结[:：]|相关单词[:：])/u);
  const exampleText = normalizeWhitespace(nextSection === -1 ? after : after.slice(0, nextSection));
  const cjkIndex = exampleText.search(/[\u3400-\u9fff]/u);
  if (cjkIndex > 0) {
    return {
      beforeExample,
      exampleSentence: normalizeWhitespace(exampleText.slice(0, cjkIndex)),
      exampleTranslation: normalizeWhitespace(exampleText.slice(cjkIndex))
    };
  }
  return { beforeExample, exampleSentence: exampleText, exampleTranslation: "" };
}

function buildContentMarkdown(body: string, exampleSentence: string, exampleTranslation: string) {
  const sections = [`带你背：\n${body.trim()}`];
  if (exampleSentence || exampleTranslation) {
    sections.push(["例句：", exampleSentence, exampleTranslation].filter(Boolean).join("\n"));
  }
  return sections.filter((section) => section.trim()).join("\n\n").trim();
}

async function writeBackup(plans: Plan[]) {
  const wordIds = plans.map((plan) => plan.word.id);
  const snapshot = await prisma.word.findMany({
    where: { id: { in: wordIds } },
    include: {
      mnemonicEntries: {
        include: {
          versions: true,
          links: true,
          userCardOrders: true
        }
      }
    },
    orderBy: { word: "asc" }
  });
  const backupPath = path.join(backupDir, `mnemonic-before-p0-source-repair-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ marker, createdAt: new Date().toISOString(), words: snapshot }, null, 2));
  return backupPath;
}

async function applyPlans(plans: Plan[], actorId: string) {
  let repaired = 0;
  let emptied = 0;
  let archived = 0;

  for (const plan of plans) {
    const contentHtml = plan.action === "repair" ? await renderMnemonicMarkdown(plan.candidate.contentMarkdown) : "";
    const plainText =
      plan.action === "repair"
        ? markdownToPlainText([plan.candidate.splitText ? `划分：${plan.candidate.splitText}` : "", plan.candidate.contentMarkdown].filter(Boolean).join("\n\n"))
        : "";

    await prisma.$transaction(async (tx) => {
      const activeOfficialEntries = await tx.mnemonicEntry.findMany({
        where: {
          targetWordId: plan.word.id,
          sourceType: MnemonicSourceType.OFFICIAL,
          status: { not: MnemonicStatus.ARCHIVED }
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      });

      for (const entry of activeOfficialEntries) {
        await tx.mnemonicEntryVersion.create({
          data: {
            mnemonicEntryId: entry.id,
            contentMarkdown: entry.contentMarkdown,
            splitText: entry.splitText,
            title: entry.title,
            editorId: actorId
          }
        });
        await tx.memoryLink.deleteMany({ where: { sourceMnemonicEntryId: entry.id } });
        await tx.mnemonicEntry.update({
          where: { id: entry.id },
          data: {
            status: MnemonicStatus.ARCHIVED,
            isPublic: false,
            isOfficialRecommended: false,
            editorNote: appendEditorNote(entry.editorNote, `${marker}: archived before source repair`)
          }
        });
      }
      archived += activeOfficialEntries.length;

      if (plan.action === "repair") {
        const entry = await tx.mnemonicEntry.create({
          data: {
            targetWordId: plan.word.id,
            authorId: actorId,
            sourceType: MnemonicSourceType.OFFICIAL,
            status: MnemonicStatus.APPROVED,
            title: `${plan.word.word} 记忆卡片`,
            splitText: plan.candidate.splitText,
            contentMarkdown: plan.candidate.contentMarkdown,
            contentHtml,
            plainText,
            editorNote: `${marker}; source=${plan.candidate.source}; score=${plan.candidate.score}`,
            isPublic: true,
            isOfficialRecommended: true,
            sortOrder: 0,
            editorScore: 9
          }
        });
        await tx.word.update({
          where: { id: plan.word.id },
          data: {
            phoneticUk: plan.candidate.phonetic || plan.word.phoneticUk,
            phoneticUs: plan.candidate.phonetic || plan.word.phoneticUs,
            partOfSpeech: plan.candidate.partOfSpeech || plan.word.partOfSpeech,
            meaningCn: plan.candidate.meaningCn || plan.word.meaningCn,
            shortMeaningCn: plan.candidate.shortMeaningCn || plan.word.shortMeaningCn,
            exampleSentence: plan.candidate.exampleSentence || plan.word.exampleSentence,
            exampleTranslation: plan.candidate.exampleTranslation || plan.word.exampleTranslation,
            status: WordStatus.PUBLISHED
          }
        });
        await ensureWordNode(plan.word.id, tx);
        await syncEntryWikiLinks(entry.id, actorId, tx);
        await tx.auditLog.create({
          data: {
            actorId,
            action: "CODEX_P0_SOURCE_REPAIR",
            entityType: "MnemonicEntry",
            entityId: entry.id,
            metadataJson: {
              marker,
              word: plan.word.word,
              source: plan.candidate.source,
              score: plan.candidate.score,
              scoreReasons: plan.candidate.scoreReasons,
              archivedEntryIds: activeOfficialEntries.map((entry) => entry.id),
              issue: plan.issue
            } satisfies Prisma.InputJsonObject
          }
        });
        repaired += 1;
      } else {
        await tx.word.update({
          where: { id: plan.word.id },
          data: { status: WordStatus.NEEDS_REVISION }
        });
        await ensureWordNode(plan.word.id, tx);
        await tx.auditLog.create({
          data: {
            actorId,
            action: "CODEX_P0_SOURCE_EMPTY",
            entityType: "Word",
            entityId: plan.word.id,
            metadataJson: {
              marker,
              word: plan.word.word,
              reason: plan.reason,
              archivedEntryIds: activeOfficialEntries.map((entry) => entry.id),
              bestCandidate: plan.bestCandidate ?? null,
              issue: plan.issue
            } satisfies Prisma.InputJsonObject
          }
        });
        emptied += 1;
      }
    });
  }

  return { repaired, emptied, archived };
}

function summarizeCandidate(candidate: Candidate) {
  return {
    source: candidate.source,
    score: candidate.score,
    scoreReasons: candidate.scoreReasons,
    phonetic: candidate.phonetic,
    meaning: candidate.meaning,
    body: candidate.body.slice(0, 280)
  };
}

function summarizePlans(plans: Plan[]) {
  return {
    marker,
    total: plans.length,
    repair: plans.filter((plan) => plan.action === "repair").length,
    empty: plans.filter((plan) => plan.action === "empty").length,
    byEmptyReason: countBy(
      plans.filter((plan): plan is Extract<Plan, { action: "empty" }> => plan.action === "empty"),
      (plan) => plan.reason
    ),
    repairedWords: plans
      .filter((plan): plan is Extract<Plan, { action: "repair" }> => plan.action === "repair")
      .map((plan) => ({
        word: plan.word.word,
        source: plan.candidate.source,
        score: plan.candidate.score,
        scoreReasons: plan.candidate.scoreReasons,
        splitText: plan.candidate.splitText,
        meaning: plan.candidate.meaningCn
      })),
    emptyWords: plans
      .filter((plan): plan is Extract<Plan, { action: "empty" }> => plan.action === "empty")
      .map((plan) => ({
        word: plan.word.word,
        reason: plan.reason,
        bestCandidate: plan.bestCandidate
      }))
  };
}

function printSummary(plans: Plan[], dryRunPath: string) {
  const repaired = plans.filter((plan) => plan.action === "repair");
  const empty = plans.filter((plan): plan is Extract<Plan, { action: "empty" }> => plan.action === "empty");
  console.log(`P0 plans: total=${plans.length}, repair=${repaired.length}, empty=${empty.length}`);
  console.log(`Empty reasons: ${JSON.stringify(countBy(empty, (plan) => plan.reason))}`);
  console.log(`Dry-run report: ${dryRunPath}`);
  console.log(`Repair sample: ${repaired.slice(0, 12).map((plan) => `${plan.word.word}:${plan.candidate.source}:${plan.candidate.score}`).join(", ")}`);
  console.log(`Empty sample: ${empty.slice(0, 20).map((plan) => `${plan.word.word}:${plan.reason}`).join(", ")}`);
}

function appendEditorNote(current: string | null, note: string) {
  return [current?.trim(), note].filter(Boolean).join("\n");
}

function cleanText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/⾳/gu, "音")
    .replace(/\u0000/gu, "")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/gu, "")
    .replace(/\{,?[^\n]{0,30}榰[^\n]{0,30}/gu, " ");
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function cleanSplitText(value: string) {
  return normalizeWhitespace(value)
    .replace(/[|｜]/gu, " | ")
    .replace(/\s+/gu, " ")
    .replace(/^\W+|\W+$/gu, "")
    .trim();
}

function normalizePhonetic(value: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ә/gu, "ə")
    .replace(/ɒ/gu, "ɔ")
    .replace(/[ɑa]/gu, "a")
    .replace(/ː/gu, ":")
    .replace(/[\s/[\](),;，。·`’‘"'ˈˌ:.\-]/gu, "");
}

function normalizeExampleMarker(value: string) {
  return value.replace(exampleMarkerPattern(), "例句：");
}

function shortMeaningFrom(meaning: string) {
  return normalizeWhitespace(meaning).split(/[；;。]/u)[0] || meaning;
}

function hasMeaningOverlap(sourceMeaning: string, targetMeaning: string) {
  const source = cjkOnly(sourceMeaning);
  const target = cjkOnly(targetMeaning);
  if (!source || !target) return false;
  for (let index = 0; index < target.length - 1; index += 1) {
    const token = target.slice(index, index + 2);
    if (source.includes(token)) return true;
  }
  const ignored = new Set("的一是在有和与或及等把对使为从中个某种表示含义核心".split(""));
  const sourceChars = new Set(Array.from(source).filter((char) => !ignored.has(char)));
  const common = Array.from(new Set(Array.from(target).filter((char) => !ignored.has(char)))).filter((char) =>
    sourceChars.has(char)
  );
  if (common.length >= 2) return true;
  const strongSingleCharMeanings = new Set("粥诗开".split(""));
  return common.some((char) => strongSingleCharMeanings.has(char));
}

function cjkOnly(value: string) {
  return Array.from(value.matchAll(/[\u3400-\u9fff]/gu), (match) => match[0]).join("");
}

function sourceMarkerPattern() {
  return /(?:[音⾳]标|#t\S{0,8}|ส\S{0,8})[:：]/giu;
}

function exampleMarkerPattern() {
  return /(?:例句|例旬|9Jf|BJf|ĐJf|Q\||9\|5|9\|f|DJf)[:：]/iu;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countBy<T>(items: T[], keyFn: (item: T) => string) {
  const result: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
