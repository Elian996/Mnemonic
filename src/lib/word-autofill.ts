import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/slug";
import { getAiWordAutofill } from "@/lib/ai-word-autofill";
import { translateEnglishToChineseOfficial } from "@/lib/official-translation";

export type WordAutofill = {
  word: string;
  phoneticUk: string;
  phoneticUs: string;
  partOfSpeech: string;
  meaningCn: string;
  meaningEn: string;
  shortMeaningCn: string;
  exampleSentence: string;
  exampleTranslation: string;
  difficulty: number;
  source: string;
  warning?: string;
};

const localDictionary: Record<string, Omit<WordAutofill, "word" | "source">> = {
  cylinder: {
    phoneticUk: "/ˈsɪlɪndə(r)/",
    phoneticUs: "/ˈsɪlɪndər/",
    partOfSpeech: "n.",
    meaningCn: "圆柱体；圆筒；气缸；泵（或筒）体",
    meaningEn: "A solid or hollow object with circular ends and straight sides.",
    shortMeaningCn: "圆柱体；气缸",
    exampleSentence: "The engine has four cylinders.",
    exampleTranslation: "这台发动机有四个气缸。",
    difficulty: 3
  },
  harangue: {
    phoneticUk: "/həˈræŋ/",
    phoneticUs: "/həˈræŋ/",
    partOfSpeech: "n./v.",
    meaningCn: "长篇大论；高谈阔论；热烈的演说；向……滔滔不绝地演讲；大声训斥",
    meaningEn: "A long forceful speech, often criticizing someone or persuading people.",
    shortMeaningCn: "长篇演说；训斥",
    exampleSentence: "The manager gave the team a harangue.",
    exampleTranslation: "经理训斥了团队一番。",
    difficulty: 5
  },
  prospect: {
    phoneticUk: "/ˈprɒspekt/",
    phoneticUs: "/ˈprɑːspekt/",
    partOfSpeech: "n.",
    meaningCn: "前景；可能性；景象；有希望的候选人",
    meaningEn: "The possibility that something will happen, or a view into the future.",
    shortMeaningCn: "前景；可能性",
    exampleSentence: "The prospects for peace are improving.",
    exampleTranslation: "和平的前景正在改善。",
    difficulty: 4
  },
  cycle: {
    phoneticUk: "/ˈsaɪkl/",
    phoneticUs: "/ˈsaɪkl/",
    partOfSpeech: "n./v.",
    meaningCn: "周期；循环；自行车；骑自行车",
    meaningEn: "A series of events repeated in the same order.",
    shortMeaningCn: "周期；循环",
    exampleSentence: "The seasons move in a cycle.",
    exampleTranslation: "季节循环更替。",
    difficulty: 2
  },
  line: {
    phoneticUk: "/laɪn/",
    phoneticUs: "/laɪn/",
    partOfSpeech: "n./v.",
    meaningCn: "线；线条；排；台词；给……加衬里",
    meaningEn: "A long narrow mark, row, or boundary.",
    shortMeaningCn: "线；线条",
    exampleSentence: "Draw a straight line.",
    exampleTranslation: "画一条直线。",
    difficulty: 1
  },
  argue: {
    phoneticUk: "/ˈɑːɡjuː/",
    phoneticUs: "/ˈɑːrɡjuː/",
    partOfSpeech: "v.",
    meaningCn: "争论；说服；争辩；辩论",
    meaningEn: "To speak angrily with someone, or to give reasons for an opinion.",
    shortMeaningCn: "争论；说服",
    exampleSentence: "They often argue about money.",
    exampleTranslation: "他们经常为钱争论。",
    difficulty: 2
  },
  put: {
    phoneticUk: "/pʊt/",
    phoneticUs: "/pʊt/",
    partOfSpeech: "v.",
    meaningCn: "放；摆；使处于",
    meaningEn: "To move something into a place or position.",
    shortMeaningCn: "放；摆",
    exampleSentence: "Put the book on the table.",
    exampleTranslation: "把书放在桌子上。",
    difficulty: 1
  },
  teach: {
    phoneticUk: "/tiːtʃ/",
    phoneticUs: "/tiːtʃ/",
    partOfSpeech: "v.",
    meaningCn: "教；教授；教导；使懂得",
    meaningEn: "To give lessons to students, or help someone learn something.",
    shortMeaningCn: "教；教授",
    exampleSentence: "She teaches English.",
    exampleTranslation: "她教英语。",
    difficulty: 1
  },
  teacher: {
    phoneticUk: "/ˈtiːtʃə(r)/",
    phoneticUs: "/ˈtiːtʃər/",
    partOfSpeech: "n.",
    meaningCn: "教师；老师",
    meaningEn: "A person whose job is to teach.",
    shortMeaningCn: "教师；老师",
    exampleSentence: "My teacher is very patient.",
    exampleTranslation: "我的老师很有耐心。",
    difficulty: 1
  },
  learn: {
    phoneticUk: "/lɜːn/",
    phoneticUs: "/lɜːrn/",
    partOfSpeech: "v.",
    meaningCn: "学习；学会；得知",
    meaningEn: "To get knowledge or skill by studying or experience.",
    shortMeaningCn: "学习；学会",
    exampleSentence: "Children learn quickly.",
    exampleTranslation: "孩子学得很快。",
    difficulty: 1
  },
  study: {
    phoneticUk: "/ˈstʌdi/",
    phoneticUs: "/ˈstʌdi/",
    partOfSpeech: "v./n.",
    meaningCn: "学习；研究；书房",
    meaningEn: "To learn about a subject, especially in school or by reading.",
    shortMeaningCn: "学习；研究",
    exampleSentence: "I study English every day.",
    exampleTranslation: "我每天学习英语。",
    difficulty: 1
  },
  take: {
    phoneticUk: "/teɪk/",
    phoneticUs: "/teɪk/",
    partOfSpeech: "v./n.",
    meaningCn: "v. 拿；取；带走；携带；接受；采取；采用；需要；花费；乘坐；参加；n. 镜头；场景；看法；态度",
    meaningEn: "To get something into your hands, carry something, accept something, or require time.",
    shortMeaningCn: "拿；带走；接受",
    exampleSentence: "Take your umbrella with you.",
    exampleTranslation: "带上你的伞。",
    difficulty: 1
  }
};

type WordAutofillOptions = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  requireAi?: boolean;
};

export async function getWordAutofill(wordInput: string, options: WordAutofillOptions = {}): Promise<WordAutofill | null> {
  const word = wordInput.trim().toLowerCase();
  if (!word) return null;

  const existing = await prisma.word.findUnique({ where: { slug: slugify(word) } });
  let ai: Omit<WordAutofill, "word" | "source"> | null = null;
  let warning: string | undefined;
  const hasAiConfig = Boolean(options.apiKey || process.env.AI_AUTOFILL_API_KEY || process.env.AI_AGENT_API_KEY || process.env.OPENAI_API_KEY);

  if (options.requireAi && !hasAiConfig) {
    throw new Error("未配置 AI。请先打开 AI 设置，填写 API Key、Base URL 和模型。");
  }

  if (options.requireAi && hasAiConfig) {
    try {
      ai = await getAiWordAutofill(word, options);
    } catch (error) {
      throw error;
    }
  }

  if (options.requireAi) {
    if (!ai) throw new Error("AI 未返回可靠词条。请检查模型是否支持结构化 JSON 输出。");
    const phoneticUk = firstFilled(ai.phoneticUk, ai.phoneticUs);
    const phoneticUs = firstFilled(ai.phoneticUs, ai.phoneticUk);
    const meaningCn = firstFilled(ai.meaningCn, ai.shortMeaningCn);
    if (!phoneticUk || !meaningCn) {
      throw new Error("AI 返回内容不完整：缺少音标或中文释义。请重试或更换模型。");
    }
    return {
      word,
      phoneticUk,
      phoneticUs,
      partOfSpeech: firstFilled(ai.partOfSpeech, "n."),
      meaningCn,
      meaningEn: firstFilled(ai.meaningEn),
      shortMeaningCn: firstFilled(ai.shortMeaningCn, meaningCn.split(/[；;，,\n]/)[0]),
      exampleSentence: firstFilled(ai.exampleSentence),
      exampleTranslation: firstFilled(ai.exampleTranslation),
      difficulty: ai.difficulty ?? 3,
      source: "AI"
    };
  }

  const local = localDictionary[word];
  const existingNeedsBetterMeaning = needsBetterDictionaryMeaning(existing?.meaningCn ?? "");
  const existingIsComplete = Boolean(
    existing?.phoneticUk &&
      existing.meaningCn &&
      existing.meaningCn.trim().length >= 8 &&
      !existingNeedsBetterMeaning
  );
  const csvDictionary = await lookupCsvDictionary(word);
  const premium = !csvDictionary && (!existingIsComplete || existingNeedsBetterMeaning) ? await lookupPremiumDictionary(word) : null;
  const needsOnline =
    !csvDictionary &&
    !premium &&
    (!existing ||
      !existing.phoneticUk ||
      !existing.meaningCn ||
      existing.meaningCn.trim().length < 2 ||
      existingNeedsBetterMeaning);
  const online = needsOnline ? await lookupOnlineDictionary(word) : null;
  const needsAiFallback = hasAiConfig && !csvDictionary && !premium && !online && !existingIsComplete;

  if (needsAiFallback) {
    try {
      ai = await getAiWordAutofill(word, options);
    } catch (error) {
      warning = error instanceof Error ? error.message : "AI 自动填写失败，已尝试使用词典数据";
    }
  }

  if (ai || existing || local || csvDictionary || premium || online) {
    return {
      word: existing?.word ?? word,
      phoneticUk: firstFilled(csvDictionary?.phoneticUk, premium?.phoneticUk, online?.phoneticUk, local?.phoneticUk, existing?.phoneticUk, ai?.phoneticUk),
      phoneticUs: firstFilled(csvDictionary?.phoneticUs, premium?.phoneticUs, online?.phoneticUs, local?.phoneticUs, existing?.phoneticUs, ai?.phoneticUs),
      partOfSpeech: firstFilled(csvDictionary?.partOfSpeech, premium?.partOfSpeech, online?.partOfSpeech, local?.partOfSpeech, existing?.partOfSpeech, ai?.partOfSpeech, "n."),
      meaningCn: firstFilled(csvDictionary?.meaningCn, premium?.meaningCn, online?.meaningCn, local?.meaningCn, existing?.meaningCn, ai?.meaningCn),
      meaningEn: firstFilled(csvDictionary?.meaningEn, premium?.meaningEn, online?.meaningEn, local?.meaningEn, existing?.meaningEn, ai?.meaningEn),
      shortMeaningCn: firstFilled(csvDictionary?.shortMeaningCn, premium?.shortMeaningCn, online?.shortMeaningCn, local?.shortMeaningCn, existing?.shortMeaningCn, ai?.shortMeaningCn),
      exampleSentence: firstFilled(existing?.exampleSentence, premium?.exampleSentence, online?.exampleSentence, local?.exampleSentence, ai?.exampleSentence),
      exampleTranslation: firstFilled(existing?.exampleTranslation, premium?.exampleTranslation, online?.exampleTranslation, local?.exampleTranslation, ai?.exampleTranslation),
      difficulty: csvDictionary?.difficulty ?? premium?.difficulty ?? online?.difficulty ?? existing?.difficulty ?? local?.difficulty ?? ai?.difficulty ?? 3,
      source: [csvDictionary ? "内置词典" : "", premium ? "Merriam-Webster Learner's" : "", online ? "在线词典" : "", local ? "本地校对词库" : "", existing ? "数据库" : "", ai ? "AI" : ""]
        .filter(Boolean)
        .join(" + "),
      warning
    };
  }

  return null;
}

async function lookupCsvDictionary(word: string): Promise<Omit<WordAutofill, "word" | "source"> | null> {
  const filePath = fs.existsSync(path.join(process.cwd(), "data", "ecdict.full.csv"))
    ? path.join(process.cwd(), "data", "ecdict.full.csv")
    : path.join(process.cwd(), "data", "ecdict.csv");
  if (!fs.existsSync(filePath)) return null;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  try {
    for await (const line of rl) {
      if (!line.toLowerCase().startsWith(`${word},`)) continue;
      const row = parseCsvLine(line);
      const phonetic = normalizePhonetic(row[1] ?? "");
      const definition = cleanText(row[2] ?? "");
      const translation = cleanupDictionaryTranslation(row[3] ?? "");
      const partOfSpeech = normalizeDictionaryPos([row[4] ?? "", translation, definition].join("\n"));
      if (!isUsableDictionaryEntry(word, phonetic, translation, partOfSpeech)) return null;
      const meaningCn = compactDictionaryMeaning(translation);
      return {
        phoneticUk: phonetic,
        phoneticUs: phonetic,
        partOfSpeech,
        meaningCn,
        meaningEn: definition,
        shortMeaningCn: shortDictionaryMeaning(meaningCn),
        exampleSentence: "",
        exampleTranslation: "",
        difficulty: 3
      };
    }
  } finally {
    rl.close();
  }

  return null;
}

async function lookupPremiumDictionary(word: string): Promise<Omit<WordAutofill, "word" | "source"> | null> {
  const mwKey = process.env.MERRIAM_WEBSTER_LEARNERS_API_KEY;
  if (!mwKey) return null;
  const payload = await fetchJsonWithTimeout<MerriamWebsterEntry[]>(
    `https://dictionaryapi.com/api/v3/references/learners/json/${encodeURIComponent(word)}?key=${encodeURIComponent(mwKey)}`,
    10000
  );
  const entry = Array.isArray(payload) ? payload.find((item) => typeof item === "object" && "hwi" in item) : null;
  if (!entry) return null;

  const phonetic = normalizePhonetic(entry.hwi?.prs?.find((item) => item.mw)?.mw ?? "");
  const definitions = entry.shortdef?.filter(Boolean).slice(0, 3) ?? [];
  const meaningEn = definitions.join("; ");
  const definitionTranslation = cleanupOnlineTranslation(await translateEnglishToChinese(meaningEn));
  const wordTranslation = cleanupOnlineTranslation(await translateEnglishToChinese(word));
  const meaningCn = normalizeShortMeaning(preferWordTranslation(wordTranslation) ? wordTranslation : definitionTranslation || wordTranslation, word);
  const exampleSentence = extractMerriamExample(entry) ?? "";
  const exampleTranslation = exampleSentence ? cleanupOnlineTranslation(await translateEnglishToChinese(exampleSentence)) : "";

  return {
    phoneticUk: phonetic,
    phoneticUs: phonetic,
    partOfSpeech: posAbbr(entry.fl) || entry.fl || "n.",
    meaningCn,
    meaningEn,
    shortMeaningCn: meaningCn.split(/[；;，,。]/)[0]?.trim() || meaningCn,
    exampleSentence,
    exampleTranslation,
    difficulty: 3
  };
}

async function lookupOnlineDictionary(word: string): Promise<Omit<WordAutofill, "word" | "source"> | null> {
  const dictionary = await fetchJsonWithTimeout<Array<DictionaryApiEntry>>(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
    10000
  );
  const entry = Array.isArray(dictionary) ? dictionary[0] : null;
  if (!entry) return null;

  const phonetic = normalizePhonetic(
    entry.phonetics?.find((item) => item.text)?.text ?? entry.phonetic ?? ""
  );
  const meanings = (entry.meanings ?? []).slice(0, 3);
  const partOfSpeech = meanings.map((meaning) => posAbbr(meaning.partOfSpeech)).filter(Boolean).join("/");
  const exampleSentence = meanings
    .flatMap((meaning) => meaning.definitions?.map((definition) => definition.example) ?? [])
    .find(Boolean) ?? "";
  const definitions = meanings
    .flatMap((meaning) => meaning.definitions?.slice(0, 2).map((definition) => definition.definition) ?? [])
    .filter(Boolean)
    .slice(0, 3);
  const meaningEn = definitions.join("; ");
  const definitionTranslation = cleanupOnlineTranslation(await translateEnglishToChinese(meaningEn));
  const wordTranslation = cleanupOnlineTranslation(await translateEnglishToChinese(word));
  const exampleTranslation = exampleSentence ? await translateEnglishToChinese(exampleSentence) : "";
  const meaningCn = normalizeShortMeaning(preferWordTranslation(wordTranslation) ? wordTranslation : definitionTranslation || wordTranslation, word);

  return {
    phoneticUk: phonetic,
    phoneticUs: phonetic,
    partOfSpeech: partOfSpeech || "n.",
    meaningCn,
    meaningEn,
    shortMeaningCn: meaningCn.split(/[；;，,。]/)[0]?.trim() || meaningCn || word,
    exampleSentence,
    exampleTranslation: cleanupOnlineTranslation(exampleTranslation),
    difficulty: 3
  };
}

async function translateEnglishToChinese(text: string) {
  const official = await translateEnglishToChineseOfficial(text);
  if (official?.text) return official.text;

  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`;
  const payload = await fetchJsonWithTimeout<{ responseData?: { translatedText?: string } }>(url, 10000);
  return payload?.responseData?.translatedText ?? "";
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "mnemonic-local-editor" }
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function firstFilled(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
}

function parseCsvLine(line: string) {
  const result: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      value += '"';
      i += 1;
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

function cleanText(value: string) {
  return value.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeDictionaryPos(value: string) {
  const normalized = value.replace(/\bvt\./g, "v.").replace(/\bvi\./g, "v.");
  const matches = Array.from(normalized.matchAll(/\b(n|v|adj|adv|prep|conj|pron|abbr|int)\./g)).map((match) => match[0]);
  return Array.from(new Set(matches)).join("/") || "n.";
}

function cleanupDictionaryTranslation(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes("[网络]"))
    .filter((line) => !/^\s*\[(计|地名|医|化|经|法|生|军|矿|植|动|航|天|数)\]/.test(line))
    .map((line) =>
      line
        .replace(/\[(?:古|俚|口|美|英|罕|废|诗|方|贬|褒|正式|非正式|音|语法|亦作|常用)\]/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/【[^】]+】/g, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .join("\n")
    .trim();
}

function compactDictionaryMeaning(value: string) {
  const groups = new Map<string, string[]>();
  for (const line of value.split("\n").map((item) => item.trim()).filter(Boolean)) {
    const normalized = line.replace(/\bvt\./g, "v.").replace(/\bvi\./g, "v.");
    const match = normalized.match(/^(n|v|adj|adv|prep|conj|pron|abbr|int|suf)\.\s*(.+)$/);
    const pos = match?.[1] ? `${match[1]}.` : "";
    const body = match?.[2] ?? normalized;
    const terms = body
      .split(/[；;，,、]/)
      .map((item) => item.replace(/\([^)]{0,24}\)/g, "").trim())
      .filter(Boolean)
      .filter((item) => !item.includes("=") && !item.includes("等于"))
      .filter((item) => item.length <= 18);
    const key = pos || "释义";
    const current = groups.get(key) ?? [];
    groups.set(key, [...current, ...terms]);
  }

  const output = Array.from(groups.entries())
    .map(([pos, terms]) => {
      const unique = Array.from(new Set(terms)).slice(0, pos === "v." ? 18 : 10);
      if (!unique.length) return "";
      return pos === "释义" ? unique.join("；") : `${pos} ${unique.join("；")}`;
    })
    .filter(Boolean)
    .slice(0, 4)
    .join("；");

  return output || value.replace(/\n/g, "；").slice(0, 120);
}

function shortDictionaryMeaning(value: string) {
  const withoutPos = value.replace(/^(n|v|adj|adv|prep|conj|pron|abbr|int|num|art|aux)\.\s*/i, "");
  const parts = withoutPos
    .split(/[；;，,、。]/)
    .map((item) => item.replace(/^(n|v|adj|adv|prep|conj|pron|abbr|int|num|art|aux)\.\s*/i, "").trim())
    .filter(Boolean)
    .filter((item) => item.length <= 12)
    .slice(0, 2);
  return parts.join("；") || withoutPos.slice(0, 16) || "未填写";
}

function needsBetterDictionaryMeaning(value: string) {
  const meaning = value.trim();
  if (!meaning) return true;
  if (/undefined|null|待补|未填写/i.test(meaning)) return true;
  if (/^\[(计|地名|医|化|经|法|生|军|矿|植|动|航|天|数)\]/.test(meaning)) return true;
  const hasPosPrefix = /^(n|v|adj|adv|prep|conj|pron|abbr|int|num|art|aux|pl)\.\s*/i.test(meaning);
  const withoutPos = meaning.replace(/^(n|v|adj|adv|prep|conj|pron|abbr|int|num|art|aux|pl)\.\s*/i, "").trim();
  if (!hasPosPrefix && withoutPos.length <= 6) return true;
  return false;
}

function isUsableDictionaryEntry(word: string, phonetic: string, translation: string, partOfSpeech: string) {
  if (!/^[a-z]{2,32}$/.test(word)) return false;
  if (!phonetic || !translation) return false;
  if (!partOfSpeech || partOfSpeech === "n.") return /\bn\./.test(translation);
  if (/^\s*\[/.test(translation)) return false;
  if (translation.length > 900) return false;
  return true;
}

type DictionaryApiEntry = {
  phonetic?: string;
  phonetics?: Array<{ text?: string }>;
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{ definition?: string; example?: string }>;
  }>;
};

type MerriamWebsterEntry = {
  hwi?: { prs?: Array<{ mw?: string }> };
  fl?: string;
  shortdef?: string[];
  def?: unknown;
};

function normalizePhonetic(value: string) {
  const text = value.trim();
  if (!text) return "";
  return text.startsWith("/") && text.endsWith("/") ? text : `/${text.replace(/^\/|\/$/g, "")}/`;
}

function posAbbr(value?: string) {
  const map: Record<string, string> = {
    noun: "n.",
    verb: "v.",
    adjective: "adj.",
    adverb: "adv.",
    preposition: "prep.",
    conjunction: "conj.",
    pronoun: "pron.",
    interjection: "int."
  };
  return value ? map[value.toLowerCase()] ?? value : "";
}

function cleanupOnlineTranslation(value: string) {
  return value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[.;]\s*/g, "；")
    .replace(/\s+/g, "")
    .replace(/^；+|；+$/g, "")
    .trim();
}

function preferWordTranslation(value: string) {
  const compact = value.replace(/\s+/g, "");
  return compact.length >= 3 && compact.length <= 12 && !/[a-z]/i.test(compact);
}

function extractMerriamExample(entry: MerriamWebsterEntry) {
  const text = JSON.stringify(entry.def ?? "");
  return text.match(/"t":"{it}([^"]+){\/it}"/)?.[1]?.replace(/\\(.)/g, "$1");
}

function normalizeShortMeaning(value: string, fallback: string) {
  const cleaned = cleanupOnlineTranslation(value)
    .replace(/^一个|^一种|^某个/, "")
    .replace(/的人$/g, "人");
  const parts = cleaned
    .split(/[；;，,、。]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length <= 12)
    .slice(0, 4);
  return Array.from(new Set(parts)).join("；") || cleaned.slice(0, 24) || fallback;
}
