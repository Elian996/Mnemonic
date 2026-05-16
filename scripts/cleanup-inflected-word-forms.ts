import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { PrismaClient, type LevelTag } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const INCLUDE_ATTACHED = process.argv.includes("--include-attached");
const dictionaryPath = path.join(process.cwd(), "data", "ecdict.full.csv");
const sourceDir = path.join(process.cwd(), "data", "vocab-categories");
const reportJsonPath = path.join(process.cwd(), "tmp", `inflected-word-cleanup-${APPLY ? "apply" : "dry-run"}.json`);
const reportMdPath = path.join(process.cwd(), "tmp", `inflected-word-cleanup-${APPLY ? "apply" : "dry-run"}.md`);

const formCodes = new Set(["s", "p", "d", "i", "3"]);
const sourceFiles = [
  "level_2.txt",
  "level_3.txt",
  "compulsory.txt",
  "high_school.txt",
  "gaokao_3500.txt",
  "cet4.txt",
  "cet6.txt"
];

type DictionaryEntry = {
  word: string;
  definition: string;
  translation: string;
  pos: string;
  exchange: string;
};

type BaseRef = {
  base: string;
  code: string;
  source: "direct" | "reverse";
};

type WordRecord = {
  id: string;
  word: string;
  slug: string;
  partOfSpeech: string;
  meaningCn: string;
  shortMeaningCn: string;
  levelTags: LevelTag[];
  _count: {
    mnemonicEntries: number;
    bookmarks: number;
    reviewCards: number;
    reviewLogs: number;
  };
};

type DeletePlan = {
  id: string;
  word: string;
  base: string;
  code: string;
  kind: "plural" | "verb-form" | "plural-or-verb";
  reason: string;
  levelTags: LevelTag[];
  hasAttachedData: boolean;
};

type KeepPlan = {
  word: string;
  base: string;
  code: string;
  reason: string;
  translation: string;
};

async function main() {
  if (!fs.existsSync(dictionaryPath)) throw new Error(`Dictionary file not found: ${dictionaryPath}`);
  fs.mkdirSync(path.dirname(reportJsonPath), { recursive: true });

  const { dictionary, reverseForms } = await loadDictionary();
  const words = await prisma.word.findMany({
    select: {
      id: true,
      word: true,
      slug: true,
      partOfSpeech: true,
      meaningCn: true,
      shortMeaningCn: true,
      levelTags: true,
      _count: {
        select: {
          mnemonicEntries: true,
          bookmarks: true,
          reviewCards: true,
          reviewLogs: true
        }
      }
    },
    orderBy: { word: "asc" }
  });
  const wordsByText = new Map(words.map((word) => [word.word.toLowerCase(), word]));

  const deletePlans: DeletePlan[] = [];
  const keepPlans: KeepPlan[] = [];
  const seenDeleteIds = new Set<string>();
  const seenKeepKeys = new Set<string>();

  for (const word of words) {
    if (!word.levelTags.length) continue;
    const entry = dictionary.get(word.word.toLowerCase());
    if (!entry) continue;

    const refs = candidateBaseRefs(entry, reverseForms);
    const keepCandidates: KeepPlan[] = [];
    let deleteCandidate: DeletePlan | null = null;

    for (const ref of refs) {
      if (!isTargetFormCode(ref.code)) continue;
      const baseRecord = wordsByText.get(ref.base);
      const baseEntry = dictionary.get(ref.base);
      if (!baseRecord || !baseEntry || baseRecord.id === word.id) continue;

      const decision = shouldDeleteInflectedForm(entry, baseEntry, ref.code);
      if (decision.delete) {
        const candidate: DeletePlan = {
          id: word.id,
          word: word.word,
          base: ref.base,
          code: ref.code,
          kind: formKind(ref.code),
          reason: decision.reason,
          levelTags: word.levelTags,
          hasAttachedData: hasAttachedData(word)
        };
        if (!deleteCandidate || ref.source === "reverse") deleteCandidate = candidate;
      } else {
        keepCandidates.push({
          word: word.word,
          base: ref.base,
          code: ref.code,
          reason: decision.reason,
          translation: compact(entry.translation || word.meaningCn)
        });
      }
    }

    if (deleteCandidate) {
      if (deleteCandidate.hasAttachedData && !INCLUDE_ATTACHED) {
        keepCandidates.push({
          word: word.word,
          base: deleteCandidate.base,
          code: deleteCandidate.code,
          reason: "带记忆卡/收藏/复习数据，默认不自动删除",
          translation: compact(entry.translation || word.meaningCn)
        });
      } else if (!seenDeleteIds.has(word.id)) {
        seenDeleteIds.add(word.id);
        deletePlans.push(deleteCandidate);
        continue;
      }
    }

    for (const keep of keepCandidates) {
      const key = `${keep.word}:${keep.base}:${keep.code}`;
      if (seenKeepKeys.has(key)) continue;
      seenKeepKeys.add(key);
      keepPlans.push(keep);
    }
  }

  const sourceMatches = findSourceMatches(deletePlans);
  const summary = {
    mode: APPLY ? "APPLY" : "DRY_RUN",
    deleteCount: deletePlans.length,
    keepCount: keepPlans.length,
    attachedDataCount: deletePlans.filter((plan) => plan.hasAttachedData).length,
    includeAttached: INCLUDE_ATTACHED,
    byKind: countBy(deletePlans, (plan) => plan.kind),
    byLevel: countBy(deletePlans.flatMap((plan) => plan.levelTags), (tag) => tag),
    sourceLineMatches: Object.fromEntries(Object.entries(sourceMatches).map(([file, words]) => [file, words.length]))
  };

  writeReports(summary, deletePlans, keepPlans, sourceMatches);
  console.log(`模式：${summary.mode}`);
  console.log(`将移出背诵列表的纯形态变化词：${summary.deleteCount}`);
  console.log(`保留疑似独立含义词：${summary.keepCount}`);
  console.log(`带记忆卡/收藏/复习数据的候选：${summary.attachedDataCount}`);
  console.log(`报告：${path.relative(process.cwd(), reportMdPath)}`);

  if (!APPLY) return;

  const actorId = await getCleanupActorId();
  await prisma.$transaction(async (tx) => {
    for (const plan of deletePlans) {
      await tx.word.update({ where: { id: plan.id }, data: { levelTags: [] } });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "WORD_INFLECTION_LEVEL_TAG_CLEANUP",
          entityType: "Word",
          entityId: plan.id,
          metadataJson: {
            word: plan.word,
            base: plan.base,
            code: plan.code,
            kind: plan.kind,
            reason: plan.reason,
            levelTags: plan.levelTags
          }
        }
      });
    }
  });

  removeFromSourceFiles(new Set(deletePlans.map((plan) => plan.word.toLowerCase())));
  console.log(`已移出背诵列表：${deletePlans.length}`);
}

async function getCleanupActorId() {
  const actor = await prisma.user.findFirst({
    where: { OR: [{ role: "ADMIN" }, { role: "EDITOR" }], status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  if (!actor) throw new Error("找不到可用于记录审计日志的管理员/编辑账号。");
  return actor.id;
}

async function loadDictionary() {
  const dictionary = new Map<string, DictionaryEntry>();
  const reverseForms = new Map<string, BaseRef[]>();
  const rl = readline.createInterface({
    input: fs.createReadStream(dictionaryPath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  let header = true;
  for await (const line of rl) {
    if (header) {
      header = false;
      continue;
    }
    if (!line.trim()) continue;
    const row = parseCsvLine(line);
    const word = (row[0] ?? "").trim().toLowerCase();
    if (!word) continue;
    const entry: DictionaryEntry = {
      word,
      definition: row[2] ?? "",
      translation: row[3] ?? "",
      pos: row[4] ?? "",
      exchange: row[10] ?? ""
    };
    dictionary.set(word, entry);

    for (const [code, value] of exchangeParts(entry.exchange)) {
      if (!formCodes.has(code)) continue;
      for (const form of splitExchangeForms(value)) {
        const normalizedForm = form.toLowerCase();
        if (!normalizedForm || normalizedForm === word) continue;
        const current = reverseForms.get(normalizedForm) ?? [];
        current.push({ base: word, code, source: "reverse" });
        reverseForms.set(normalizedForm, current);
      }
    }
  }
  return { dictionary, reverseForms };
}

function candidateBaseRefs(entry: DictionaryEntry, reverseForms: Map<string, BaseRef[]>) {
  const refs: BaseRef[] = [];
  const parts = exchangeParts(entry.exchange);
  const directBase = parts.find(([key]) => key === "0")?.[1]?.trim().toLowerCase();
  const directCode = parts.find(([key]) => key === "1")?.[1]?.trim();
  if (directBase && directCode && directBase !== entry.word) {
    refs.push({ base: directBase, code: directCode, source: "direct" });
  }
  refs.push(...(reverseForms.get(entry.word) ?? []));

  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.base}:${ref.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shouldDeleteInflectedForm(entry: DictionaryEntry, baseEntry: DictionaryEntry, code: string) {
  const targetTerms = meaningTerms(entry.translation || entry.definition);
  const baseTerms = meaningTerms(baseEntry.translation || baseEntry.definition);
  const morphMarker = hasMorphMarker(entry, baseEntry.word, code);
  const overlap = overlapScore(targetTerms, baseTerms);
  const extraTerms = targetTerms.filter((term) => !hasSimilarTerm(term, baseTerms));
  const independentPos = hasIndependentPos(entry.translation, code);

  if (isKnownIndependentPlural(entry.word)) {
    return { delete: false, reason: "常见复数形独立词义" };
  }

  if (entryIsAlsoLemma(entry, baseEntry.word)) {
    return { delete: false, reason: "该词本身也是独立原形词条" };
  }

  if (independentPos && extraTerms.length >= 2) {
    return { delete: false, reason: `存在独立词性或额外释义：${extraTerms.slice(0, 5).join("；")}` };
  }

  if (morphMarker && !hasStrongIndependentSignal(entry.translation, baseEntry.word, code)) {
    return { delete: true, reason: "释义明确标注为原词形态变化" };
  }

  if (code.includes("s") && morphMarker && extraTerms.length <= 1) {
    return { delete: true, reason: "复数释义未明显超出原词" };
  }

  if (/[pdi3]/.test(code) && overlap >= 0.72 && extraTerms.length <= 2 && !independentPos) {
    return { delete: true, reason: "动词变形释义与原形高度重合" };
  }

  if (code.includes("s") && overlap >= 0.8 && extraTerms.length <= 1) {
    return { delete: true, reason: "复数形式释义与单数高度重合" };
  }

  return {
    delete: false,
    reason: extraTerms.length ? `疑似含义变化：${extraTerms.slice(0, 5).join("；")}` : "无法确认只是形态变化"
  };
}

function isTargetFormCode(code: string) {
  return code.includes("s") || /[pdi3]/.test(code);
}

function formKind(code: string): DeletePlan["kind"] {
  const plural = code.includes("s");
  const verb = /[pdi3]/.test(code);
  if (plural && verb) return "plural-or-verb";
  if (plural) return "plural";
  return "verb-form";
}

function hasMorphMarker(entry: DictionaryEntry, base: string, code: string) {
  const text = `${entry.translation}\n${entry.definition}`.toLowerCase();
  const escapedBase = escapeRegExp(base.toLowerCase());
  const chineseMarkers = [
    "复数",
    "复数形式",
    "第三人称",
    "三单",
    "过去式",
    "过去分词",
    "现在分词",
    "动名词",
    "过去时"
  ];
  const englishMarkers = [
    "plural",
    "third-person",
    "third person",
    "past tense",
    "past participle",
    "present participle",
    "-s form",
    "ing form"
  ];

  if (new RegExp(`${escapedBase}.{0,12}(?:${chineseMarkers.join("|")})`, "iu").test(text)) return true;
  if (new RegExp(`(?:${chineseMarkers.join("|")}).{0,12}${escapedBase}`, "iu").test(text)) return true;
  if (new RegExp(`(?:${englishMarkers.map(escapeRegExp).join("|")}).{0,18}\\b${escapedBase}\\b`, "iu").test(text)) return true;
  if (new RegExp(`\\b${escapedBase}\\b.{0,18}(?:${englishMarkers.map(escapeRegExp).join("|")})`, "iu").test(text)) return true;
  if (code === "s" && /(?:的复数|\bplural\b)/iu.test(text)) return true;
  if (/[pdi3]/.test(code) && /(?:过去式|过去分词|现在分词|第三人称|三单|past tense|past participle|present participle|third person)/iu.test(text)) return true;
  return false;
}

function hasIndependentPos(translation: string, code: string) {
  const cleaned = translation.replace(/\\n/g, "\n");
  if (/[pdi3]/.test(code) && /(^|\n)\s*(?:n\.|a\.|adj\.)/iu.test(cleaned)) return true;
  if (code.includes("s") && /(^|\n)\s*(?:v\.|vt\.|vi\.|a\.|adj\.)/iu.test(cleaned)) return true;
  return false;
}

function hasStrongIndependentSignal(translation: string, base: string, code: string) {
  const text = translation
    .replace(/\\n/g, "\n")
    .replace(new RegExp(`[（(][^）)]*${escapeRegExp(base)}[^）)]*(?:复数|第三人称|过去式|过去分词|现在分词|past|plural|participle)[^）)]*[）)]`, "giu"), "")
    .replace(/\[[^\]]+\]/gu, "");
  const terms = meaningTerms(text);
  if (isKnownIndependentPlural(base)) return true;
  if (code.includes("s") && /海关|武器|军械|国旗|旗帜|衣服|眼镜|剪刀|货物|内容|账目|存款|储蓄|习俗|风俗/u.test(text)) return true;
  if (/[pdi3]/.test(code) && /迷人的|垂死|临终|公认|熟练|有造诣|习惯了|全神贯注|被告|所得|收入/u.test(text)) return true;
  return terms.length >= 4 && !hasMorphMarker({ word: "", definition: "", translation: text, pos: "", exchange: "" }, base, code);
}

function isKnownIndependentPlural(word: string) {
  return new Set([
    "acoustics",
    "aerodynamics",
    "arms",
    "athletics",
    "antics",
    "bacteria",
    "brethren",
    "chopsticks",
    "civics",
    "classics",
    "clothes",
    "contents",
    "customs",
    "dynamics",
    "economics",
    "electronics",
    "ethics",
    "fireworks",
    "furnishings",
    "genetics",
    "glasses",
    "goods",
    "gymnastics",
    "jitters",
    "linguistics",
    "logistics",
    "looks",
    "manners",
    "mathematics",
    "mechanics",
    "means",
    "mnemonics",
    "optics",
    "physics",
    "politics",
    "premises",
    "savings",
    "scissors",
    "seconds",
    "singles",
    "specials",
    "specifics",
    "spirits",
    "sports",
    "statistics",
    "sweets",
    "tectonics",
    "thanks",
    "trousers",
    "vocals",
    "wages"
  ]).has(word.toLowerCase());
}

function entryIsAlsoLemma(entry: DictionaryEntry, base: string) {
  if (new Set(["could", "should", "would"]).has(entry.word)) return true;
  if (entry.word === base) return false;
  const ownFormKeys = exchangeParts(entry.exchange).filter(([key, value]) => formCodes.has(key) && value.trim());
  if (!ownFormKeys.length) return false;
  return ownFormKeys.some(([, value]) => splitExchangeForms(value).some((form) => form.toLowerCase() !== entry.word));
}

function meaningTerms(value: string) {
  return Array.from(
    new Set(
      cleanupTranslation(value)
        .replace(/\([^)]{0,80}\)/gu, "")
        .replace(/（[^）]{0,80}）/gu, "")
        .replace(/\[[^\]]+\]/gu, "")
        .replace(/\b(?:n|v|vt|vi|a|adj|adv|prep|conj|pron|abbr|int|num)\.\s*/giu, "")
        .split(/[\n；;，,、]/u)
        .map((term) => term.trim())
        .filter(Boolean)
        .filter((term) => !/^(?:的)?(?:复数|复数形式|第三人称单数|三单|过去式|过去分词|现在分词|动名词)$/u.test(term))
        .filter((term) => !/^[a-z -]+$/iu.test(term))
        .filter((term) => term.length <= 18)
    )
  );
}

function overlapScore(targetTerms: string[], baseTerms: string[]) {
  if (!targetTerms.length) return 0;
  const matched = targetTerms.filter((term) => hasSimilarTerm(term, baseTerms)).length;
  return matched / targetTerms.length;
}

function hasSimilarTerm(term: string, candidates: string[]) {
  return candidates.some((candidate) => termsSimilar(term, candidate));
}

function termsSimilar(left: string, right: string) {
  if (left === right) return true;
  if (left.length >= 2 && right.includes(left)) return true;
  if (right.length >= 2 && left.includes(right)) return true;
  const normalizedLeft = left.replace(/[的地得了着过]/gu, "");
  const normalizedRight = right.replace(/[的地得了着过]/gu, "");
  return normalizedLeft.length >= 2 && normalizedRight.length >= 2 && (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft));
}

function hasAttachedData(word: WordRecord) {
  return word._count.mnemonicEntries > 0 || word._count.bookmarks > 0 || word._count.reviewCards > 0 || word._count.reviewLogs > 0;
}

function findSourceMatches(plans: DeletePlan[]) {
  const deletedWords = new Set(plans.map((plan) => plan.word.toLowerCase()));
  const matches: Record<string, string[]> = {};
  for (const file of sourceFiles) {
    const filePath = path.join(sourceDir, file);
    if (!fs.existsSync(filePath)) continue;
    const words = fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((word) => word.trim().toLowerCase())
      .filter((word) => deletedWords.has(word));
    if (words.length) matches[file] = Array.from(new Set(words)).sort();
  }
  return matches;
}

function removeFromSourceFiles(deletedWords: Set<string>) {
  for (const file of sourceFiles) {
    const filePath = path.join(sourceDir, file);
    if (!fs.existsSync(filePath)) continue;
    const original = fs.readFileSync(filePath, "utf8");
    const lines = original.split(/\r?\n/);
    const filtered = lines.filter((line) => !deletedWords.has(line.trim().toLowerCase()));
    if (filtered.length === lines.length) continue;
    fs.writeFileSync(filePath, `${filtered.join("\n").replace(/\n+$/u, "")}\n`);
  }
}

function writeReports(summary: unknown, deletePlans: DeletePlan[], keepPlans: KeepPlan[], sourceMatches: Record<string, string[]>) {
  fs.writeFileSync(
    reportJsonPath,
    JSON.stringify(
      {
        summary,
        deletePlans,
        keepPlans,
        sourceMatches
      },
      null,
      2
    )
  );

  const lines = [
    `# Inflected Word Cleanup ${APPLY ? "Apply" : "Dry Run"}`,
    "",
    "## Summary",
    "",
    `- Level-list cleanup candidates: ${deletePlans.length}`,
    `- Kept as possible meaning shifts: ${keepPlans.length}`,
    `- Candidates with attached data: ${deletePlans.filter((plan) => plan.hasAttachedData).length}`,
    "",
    "## Cleanup Sample",
    "",
    ...deletePlans.slice(0, 160).map((plan) => `- ${plan.word} -> ${plan.base} (${plan.code}, ${plan.kind}): ${plan.reason}`),
    "",
    "## Kept Sample",
    "",
    ...keepPlans.slice(0, 120).map((plan) => `- ${plan.word} -> ${plan.base} (${plan.code}): ${plan.reason}；${plan.translation}`),
    "",
    "## Source File Matches",
    "",
    ...Object.entries(sourceMatches).map(([file, words]) => `- ${file}: ${words.length}`)
  ];
  fs.writeFileSync(reportMdPath, `${lines.join("\n")}\n`);
}

function exchangeParts(exchange: string) {
  return exchange
    .split("/")
    .map((part) => part.trim())
    .map((part) => {
      const index = part.indexOf(":");
      return index === -1 ? null : ([part.slice(0, index), part.slice(index + 1)] as const);
    })
    .filter((part): part is readonly [string, string] => Boolean(part));
}

function splitExchangeForms(value: string) {
  return value
    .split(/[,\s]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCsvLine(line: string) {
  const result: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  result.push(value);
  return result;
}

function cleanupTranslation(value: string) {
  return value
    .replace(/\r/gu, "")
    .replace(/\\n/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function compact(value: string) {
  return cleanupTranslation(value).replace(/\s+/gu, " ").slice(0, 120);
}

function countBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, number>>((result, item) => {
    const nextKey = key(item);
    result[nextKey] = (result[nextKey] ?? 0) + 1;
    return result;
  }, {});
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
