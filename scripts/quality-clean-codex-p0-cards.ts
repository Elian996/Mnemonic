import fs from "node:fs";
import path from "node:path";
import { MnemonicSourceType, MnemonicStatus, Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseWikiLinks } from "@/lib/wiki-links/parser";
import { syncEntryWikiLinks } from "@/lib/wiki-links/resolve";
import { markdownToPlainText, renderMnemonicMarkdown } from "@/lib/wiki-links/renderer";

const apply = process.argv.includes("--apply");
const marker = "codex-p0-source-repair-2026-05-15";
const qualityMarker = "codex-p0-quality-clean-v1-2026-05-15";
const adminEmail = process.env.MNEMONIC_CLEANUP_ACTOR_EMAIL ?? "maoshangjian2021@163.com";
const reportDir = path.join(process.cwd(), "tmp/p0-source-repair");
const backupDir = path.join(process.cwd(), "backups");

const sourceFiles = [
  { label: "4500单词突围（总）.docx", path: path.join(process.cwd(), "tmp/source-4500-docx.txt") },
  { label: "Day26-34p_merged.pdf", path: path.join(process.cwd(), "tmp/source-day26-34.txt") },
  { label: "单词突围上册.pdf", path: path.join(process.cwd(), "tmp/source-upper.txt") },
  { label: "单词突围5200 下册.pdf OCR", path: path.join(process.cwd(), "tmp/source-lower-ocr.txt") }
];

type Entry = {
  id: string;
  title: string;
  splitText: string | null;
  contentMarkdown: string;
  editorNote: string | null;
  targetWord: {
    id: string;
    word: string;
    slug: string;
    phoneticUk: string | null;
    phoneticUs: string | null;
    partOfSpeech: string;
    meaningCn: string;
    shortMeaningCn: string;
    exampleSentence: string | null;
    exampleTranslation: string | null;
  };
};

type SourceBlock = {
  source: string;
  word: string;
  phonetic: string;
  meaning: string;
  splitText: string;
  body: string;
};

type DictionaryEntry = {
  phonetic: string;
  partOfSpeech: string;
  meaningCn: string;
  shortMeaningCn: string;
};

type Plan = {
  entry: Entry;
  source?: SourceBlock;
  nextSplitText: string | null;
  nextContentMarkdown: string;
  nextPhoneticUk: string | null;
  nextPhoneticUs: string | null;
  nextPartOfSpeech: string;
  nextMeaningCn: string;
  nextShortMeaningCn: string;
  nextExampleSentence: string | null;
  nextExampleTranslation: string | null;
  relatedWords: string[];
  issuesBefore: string[];
  issuesAfter: string[];
  changed: boolean;
};

const manualBodies: Record<string, string> = {
  scrub:
    "针对第1个元素采用谐音记忆法:sc 在单词里的发音类似中文“使”,表示使劲\n针对第2个元素采用含义联想法:rub 为已经记忆过的单词,表示 v.擦,摩擦\n综合考虑 sc(使劲)+rub(擦,摩擦)——>使劲擦,即 vt.用力擦洗,把...擦净;擦掉;由“擦掉”延伸为 v.取消(计划等)\n针对整个单词重新划分:s | crub。crub 在单词里的发音类似中文“灌木”;综合考虑 s(是)+crub(灌木)——>是灌木,作名词表示 n.矮树丛,灌木丛;",
  mortal:
    "针对第1个元素采用谐音记忆法:mort 在单词里的发音类似中文“摩托”,联想到骑摩托车的人\n针对第2个元素采用词根词缀分析:-al 为形容词后缀,表示形容词含义\n综合考虑 mort(摩托)+al(...的)——>凡人普通人才骑摩托车,由此记住 n.凡人;人类,并延伸为 adj.终有一死的;致命的\n针对整个单词采用谐音记忆法:mortal 的发音类似中文“魔头”,把对方视为魔头,引申为 adj.你死我活的,不共戴天的;",
  orientation:
    "orient 为已经记忆过的单词,表示 v.朝向,确定方位;使熟悉,帮助适应;末尾加上 -ation 名词后缀,得到核心含义相同的名词含义\n当 orient 表示“朝向、确定方位”时,orientation 表示 n.方向;目标;方位,并进一步延伸为 n.观点,取向\n当 orient 表示“使熟悉、帮助适应”时,orientation 表示 n.(任职、上学等之前的)情况介绍,培训;",
  thrifty: "thrift 为已经记忆过的单词,表示 n.节俭,节约;末尾加上 -y 形容词后缀,得到核心含义相同的形容词含义,表示 adj.节俭的,节约的;",
  turnover:
    "turn 为已经记忆过的单词,表示 v.转动,转向;over 表示翻过去、彻底的意向\n综合考虑 turn(转动)+over(翻过去)——>彻底翻转;联系经营中钱货周转,表示 n.营业额,成交量;联系人员翻动更替,表示 n.人员更替率;",
  yearning: "yearn 为已经记忆过的单词,表示 vi.渴望,向往;思念,想念;末尾加上 -ing 动名词后缀,得到核心含义相同的名词含义,表示 n.渴望;怀念;",
  treasurer: "treasure 为已经记忆过的单词,表示 n.金银财宝,财富;末尾加上 -er 表示人的名词后缀,得到核心含义相同且与人有关的名词含义,即 n.(团体等的)司库,财务主管;",
  metaphorical: "metaphor 为已经记忆过的单词,表示 n.隐喻;暗喻;末尾加上 -ical 形容词后缀,得到核心含义相同的形容词含义,表示 adj.隐喻般的;含有隐喻的;",
  extravagance: "extravagant 为已经记忆过的单词,表示 adj.奢侈的;过度的;末尾去掉 -t 再加上 -ce 名词后缀,得到核心含义相同的名词含义,表示 n.奢侈;挥霍;",
  subtraction: "subtract 为已经记忆过的单词,表示 v.减,减去;去掉;末尾加上 -ion 名词后缀,得到核心含义相同的名词含义,表示 n.减,减法;",
  tighten: "tight 为已经记忆过的单词,表示 adj./adv.紧的(地);末尾加上 -en 表示“使...的”动词后缀,得到核心含义相同的动词含义,表示 v.绷紧,变紧;",
  thorn:
    "针对整个单词采用谐音记忆法:thorn 的发音类似中文“缩”,这里引申为把伸出的手缩回来\n联系 n.刺,荆棘;带刺小灌木的含义进行联想:当我们伸手摸到荆棘或带刺小灌木时,手会被刺伤并感到疼痛,于是会把手缩回来,由此记住 thorn 表示 n.刺,荆棘;带刺小灌木;",
  strait:
    "针对整个单词采用含义联想法:由 strait 的字形和发音联想到已经记忆过的单词 straight adj.直的;把 straight-直的 和 strait-海峡 联系在一起\n图中箭头所示即为一个 n.海峡,箭头本身是笔直的,由此记住自创短语 straight strait“笔直的海峡”,进而记住 strait 表示 n.海峡\n由 n.海峡的含义稍作延伸:生活中遇到的许多“困难”像海峡一样难以跨越,故 strait 还可以表示 n.困境,窘境;",
  rehearsal:
    "针对第1个元素采用词根词缀分析:re 作前缀表示一再、多次、又\n针对第2个元素采用含义联想法:hear 为已经记忆过的熟悉单词,表示 v.听,听见\n针对第3个元素采用词根词缀分析:-sal 为名词后缀,表示名词含义\n综合考虑 re(一再、多次)+hear(听,听见)+sal(名词含义)——>真正的演出开始之前,人们反复演练倾听,寻找问题并进行调整,这种行为就是 n.排练,彩排;",
  tack:
    "通过整个单词的字形和发音联想到已经记忆过的单词 tackle vt.对付,处理;由此将 tack 理解为与 tackle 含义相关的名词含义,表示 n.行动方向,方针\n切换思路对单词进行划分:ta | ck。ta 在单词里的发音类似中文“沓”,联想到一沓文件;ck 在单词里的发音类似中文“咔”,拟声词\n综合考虑 ta(一沓文件)+ck(咔)——>使用钉子将一沓文件“咔”一声钉在一起,即 v.用平头钉钉;由动词延伸为名词表示 n.平头钉,大头钉;进一步延伸为 n.附加,增补;"
  ,
  equate:
    "equal 为已经记忆过的单词,表示 adj.平等的,相等的;末尾去掉 -al 形容词后缀,加上 -ate 动词后缀,得到核心含义相同的动词含义\n综合考虑 equal(平等的,相等的)+ate(动词含义)——>以平等或相等的方式看待,即 v.同等看待;等同;"
};

const manualRelatedWords: Record<string, string[]> = {
  scrub: ["rub"],
  mortal: [],
  orientation: ["orient"],
  thrifty: ["thrift"],
  turnover: ["turn", "over"],
  yearning: ["yearn"],
  treasurer: ["treasure"],
  metaphorical: ["metaphor"],
  extravagance: ["extravagant"],
  subtraction: ["subtract"],
  tighten: ["tight"],
  strait: ["straight"],
  rehearsal: ["hear"],
  tack: ["tackle"]
  ,
  equate: ["equal"]
};

const manualExamples: Record<string, { sentence: string; translation: string }> = {
  endow: { sentence: "The scholarship was endowed by a local family.", translation: "这项奖学金由当地一个家庭捐资设立。" },
  equate: { sentence: "You should not equate wealth with happiness.", translation: "你不应该把财富等同于幸福。" },
  evasive: { sentence: "His evasive reply prompted me to ask another question.", translation: "他闪烁其词的回答促使我又问了一个问题。" },
  flattery: { sentence: "She dismissed his flattery with a smile.", translation: "她微笑着没有理会他的奉承。" },
  gossip: { sentence: "It's common gossip that they're having an affair.", translation: "大家都在传他们关系暧昧。" },
  inversion: { sentence: "This sentence is an example of inversion.", translation: "这个句子是倒装的例子。" },
  jerk: { sentence: "He jerked the rope to stop the boat.", translation: "他猛拉绳子让船停下。" },
  magnetic: { sentence: "The magnetic field affects the compass.", translation: "磁场会影响指南针。" },
  metaphorical: { sentence: "He used a metaphorical expression to describe the crisis.", translation: "他用一个隐喻性的表达来描述这场危机。" },
  murmur: { sentence: "The child murmured something in his sleep.", translation: "那孩子在睡梦中喃喃地说了些什么。" },
  naive: { sentence: "It was naive to trust him so quickly.", translation: "这么快就相信他是很天真的。" },
  orientation: { sentence: "New employees attend an orientation on their first day.", translation: "新员工第一天要参加入职培训。" },
  probability: { sentence: "There is a high probability of rain tomorrow.", translation: "明天下雨的可能性很大。" },
  rehearsal: { sentence: "The actors stayed late for rehearsal.", translation: "演员们为了排练待到很晚。" },
  retort: { sentence: "She made a sharp retort to the criticism.", translation: "她对批评作出了尖锐的反驳。" },
  scorn: { sentence: "He treated the warning with scorn.", translation: "他轻蔑地对待这个警告。" },
  scornful: { sentence: "She gave him a scornful look.", translation: "她轻蔑地看了他一眼。" },
  spotlight: { sentence: "The singer stepped into the spotlight.", translation: "歌手走进了聚光灯下。" },
  stagger: { sentence: "He began to stagger after the long climb.", translation: "长时间攀爬后他开始踉跄。" },
  stipulate: { sentence: "The contract stipulates that payment must be made within 30 days.", translation: "合同规定必须在30天内付款。" },
  strait: { sentence: "Crossing the strait alone is dangerous.", translation: "独自穿越海峡很危险。" },
  tack: { sentence: "I usually tack a note onto the end of the report.", translation: "我通常在报告末尾附上一条备注。" },
  thrifty: { sentence: "A thrifty family saves money whenever possible.", translation: "节俭的家庭会尽可能省钱。" },
  trademark: { sentence: "Attention to detail is the director's trademark.", translation: "注重细节是这位导演的标志。" },
  treasurer: { sentence: "The treasurer prepared the annual report.", translation: "司库准备了年度报告。" },
  turnover: { sentence: "The store has a high turnover of seasonal goods.", translation: "这家商店季节性商品的周转率很高。" },
  verse: { sentence: "Learn the first two verses of the poem by heart.", translation: "背会这首诗的前两节。" },
  yearning: { sentence: "He felt a deep yearning for home.", translation: "他深深地思念家乡。" }
};

async function main() {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });

  const actor = await resolveActor();
  const sourceIndex = loadSourceIndex();
  const dictionary = await loadDictionary();
  const wordSet = await loadWordSet();
  const entries = await prisma.mnemonicEntry.findMany({
    where: {
      sourceType: MnemonicSourceType.OFFICIAL,
      status: { not: MnemonicStatus.ARCHIVED },
      editorNote: { contains: marker }
    },
    select: {
      id: true,
      title: true,
      splitText: true,
      contentMarkdown: true,
      editorNote: true,
      targetWord: {
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
          exampleTranslation: true
        }
      }
    },
    orderBy: [{ targetWord: { word: "asc" } }]
  });

  const plans = entries.map((entry) => buildPlan(entry, sourceIndex.get(entry.targetWord.word.toLowerCase()), dictionary.get(entry.targetWord.word.toLowerCase()), wordSet));
  const changedPlans = plans.filter((plan) => plan.changed);
  const backupPath = await writeBackup(entries);
  const reportPath = writeReport(plans, backupPath);
  printSummary(plans, backupPath, reportPath, actor.email ?? actor.username);

  if (!apply) return;

  for (const plan of changedPlans) {
    const contentHtml = await renderMnemonicMarkdown(plan.nextContentMarkdown);
    const plainText = markdownToPlainText([plan.nextSplitText ? `划分：${plan.nextSplitText}` : "", plan.nextContentMarkdown].filter(Boolean).join("\n\n"));
    await prisma.$transaction(async (tx) => {
      await tx.mnemonicEntryVersion.create({
        data: {
          mnemonicEntryId: plan.entry.id,
          contentMarkdown: plan.entry.contentMarkdown,
          splitText: plan.entry.splitText,
          title: plan.entry.title,
          editorId: actor.id
        }
      });
      await tx.mnemonicEntry.update({
        where: { id: plan.entry.id },
        data: {
          splitText: plan.nextSplitText,
          contentMarkdown: plan.nextContentMarkdown,
          contentHtml,
          plainText,
          editorNote: appendEditorNote(plan.entry.editorNote, qualityMarker)
        }
      });
      await tx.word.update({
        where: { id: plan.entry.targetWord.id },
        data: {
          phoneticUk: plan.nextPhoneticUk,
          phoneticUs: plan.nextPhoneticUs,
          partOfSpeech: plan.nextPartOfSpeech,
          meaningCn: plan.nextMeaningCn,
          shortMeaningCn: plan.nextShortMeaningCn,
          exampleSentence: plan.nextExampleSentence,
          exampleTranslation: plan.nextExampleTranslation
        }
      });
      await syncEntryWikiLinks(plan.entry.id, actor.id, tx);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "CODEX_P0_QUALITY_CLEAN",
          entityType: "MnemonicEntry",
          entityId: plan.entry.id,
          metadataJson: {
            marker,
            qualityMarker,
            word: plan.entry.targetWord.word,
            source: plan.source?.source ?? null,
            relatedWords: plan.relatedWords,
            issuesBefore: plan.issuesBefore,
            issuesAfter: plan.issuesAfter,
            backupPath,
            reportPath
          } satisfies Prisma.InputJsonObject
        }
      });
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        targetEntries: entries.length,
        changedEntries: changedPlans.length,
        remainingIssues: plans.reduce((sum, plan) => sum + plan.issuesAfter.length, 0),
        backupPath,
        reportPath
      },
      null,
      2
    )
  );
}

async function resolveActor() {
  const actor =
    (await prisma.user.findFirst({
      where: { email: adminEmail, status: "ACTIVE" },
      select: { id: true, email: true, username: true }
    })) ??
    (await prisma.user.findFirst({
      where: { OR: [{ role: UserRole.ADMIN }, { role: UserRole.EDITOR }], status: "ACTIVE" },
      orderBy: [{ createdAt: "asc" }],
      select: { id: true, email: true, username: true }
    }));
  if (!actor) throw new Error("找不到可用于批量更新的管理员/编辑账号。");
  return actor;
}

function buildPlan(entry: Entry, source: SourceBlock | undefined, dictionary: DictionaryEntry | undefined, wordSet: Set<string>): Plan {
  const sourceBody = source ? stripExamples(source.body) : stripRelatedWordBlock(entry.contentMarkdown).replace(/^带你背[:：]\s*/u, "");
  const currentRelated = extractRelatedWords(entry.contentMarkdown, entry.targetWord.word, wordSet);
  const word = entry.targetWord.word.toLowerCase();
  const body = manualBodies[word] ?? cleanMnemonicBody(sourceBody, entry.targetWord.word);
  const contextualRelated = extractContextualRelatedWords(body, entry.targetWord.word, wordSet);
  const rawRelated = manualRelatedWords[word] ?? contextualRelated.map((relatedWord) => normalizeRelatedWord(relatedWord));
  const relatedWords = uniqueStrings(rawRelated)
    .filter((word) => wordSet.has(word))
    .filter((word) => word !== entry.targetWord.word.toLowerCase());
  const nextContentMarkdown = sanitizeFinalContent(withRelatedWordBlock(`带你背：\n${formatBody(body)}`, relatedWords));
  const nextSplitText = cleanSplitText(source?.splitText || entry.splitText || "", entry.targetWord.word);
  const wordFields = chooseWordFields(entry, source, dictionary);
  const exampleOverride = manualExamples[word];
  if (exampleOverride) {
    wordFields.exampleSentence = exampleOverride.sentence;
    wordFields.exampleTranslation = exampleOverride.translation;
  }
  const issuesBefore = auditEntry({
    word: entry.targetWord.word,
    splitText: entry.splitText,
    contentMarkdown: entry.contentMarkdown,
    phoneticUk: entry.targetWord.phoneticUk,
    phoneticUs: entry.targetWord.phoneticUs,
    relatedWords: currentRelated
  });
  const issuesAfter = auditEntry({
    word: entry.targetWord.word,
    splitText: nextSplitText,
    contentMarkdown: nextContentMarkdown,
    phoneticUk: wordFields.phoneticUk,
    phoneticUs: wordFields.phoneticUs,
    relatedWords
  });
  const changed =
    nextSplitText !== entry.splitText ||
    nextContentMarkdown !== entry.contentMarkdown ||
    wordFields.phoneticUk !== entry.targetWord.phoneticUk ||
    wordFields.phoneticUs !== entry.targetWord.phoneticUs ||
    wordFields.partOfSpeech !== entry.targetWord.partOfSpeech ||
    wordFields.meaningCn !== entry.targetWord.meaningCn ||
    wordFields.shortMeaningCn !== entry.targetWord.shortMeaningCn ||
    wordFields.exampleSentence !== entry.targetWord.exampleSentence ||
    wordFields.exampleTranslation !== entry.targetWord.exampleTranslation;

  return {
    entry,
    source,
    nextSplitText,
    nextContentMarkdown,
    nextPhoneticUk: wordFields.phoneticUk,
    nextPhoneticUs: wordFields.phoneticUs,
    nextPartOfSpeech: wordFields.partOfSpeech,
    nextMeaningCn: wordFields.meaningCn,
    nextShortMeaningCn: wordFields.shortMeaningCn,
    nextExampleSentence: wordFields.exampleSentence,
    nextExampleTranslation: wordFields.exampleTranslation,
    relatedWords,
    issuesBefore,
    issuesAfter,
    changed
  };
}

function loadSourceIndex() {
  const blocks = new Map<string, SourceBlock>();
  for (const sourceFile of sourceFiles) {
    if (!fs.existsSync(sourceFile.path)) continue;
    const lines = fs.readFileSync(sourceFile.path, "utf8").split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const word = lines[index]?.trim();
      if (!word || !/^[a-z][a-z-]{1,38}$/i.test(word)) continue;
      const lookahead = lines.slice(index + 1, index + 8).join("\n");
      if (!/(?:音标|#\S*)[:：]/u.test(lookahead) || !/释义[:：]/u.test(lookahead) || !/(?:老王带你背|带你背)[:：]?/u.test(lookahead)) continue;
      const end = findSourceBlockEnd(lines, index + 1);
      const block = parseLineBlock(sourceFile.label, word.toLowerCase(), lines.slice(index, end).join("\n"));
      if (!block) continue;
      const current = blocks.get(block.word);
      if (!current || sourcePriority(block.source) < sourcePriority(current.source)) {
        blocks.set(block.word, block);
      }
    }
  }
  return blocks;
}

function findSourceBlockEnd(lines: string[], start: number) {
  for (let index = start + 1; index < lines.length - 1; index += 1) {
    const line = lines[index]?.trim();
    if (!line || !/^[a-z][a-z-]{1,38}$/i.test(line)) continue;
    const next = lines.slice(index + 1, index + 5).join("\n");
    if (/(?:音标|#\S*)[:：]/u.test(next) && /释义[:：]/u.test(next)) return index;
  }
  return lines.length;
}

function parseLineBlock(source: string, word: string, raw: string): SourceBlock | null {
  const phonetic = raw.match(/(?:音标|#\S*)[:：]\s*([^\n]+)/u)?.[1]?.trim() ?? "";
  const meaning = raw.match(/释义[:：]\s*([^\n]+)/u)?.[1]?.trim() ?? "";
  const bodyStart = raw.search(/(?:老王带你背|带你背)[:：]?/u);
  if (bodyStart === -1) return null;
  let body = raw.slice(bodyStart).replace(/^(?:老王带你背|带你背)[:：]?\s*/u, "").trim();
  let splitText = "";
  const splitMatch = body.match(/^划分[:：]\s*([^\n]+)/u);
  if (splitMatch) {
    splitText = splitMatch[1]?.trim() ?? "";
    body = body.slice(splitMatch[0].length).trim();
  }
  return { source, word, phonetic, meaning, splitText, body };
}

function sourcePriority(source: string) {
  if (source.includes("4500")) return 0;
  if (source.includes("上册")) return 1;
  if (source.includes("Day")) return 2;
  return 3;
}

async function loadWordSet() {
  const words = await prisma.word.findMany({ select: { word: true } });
  return new Set(words.map((word) => word.word.toLowerCase()));
}

async function loadDictionary() {
  const filePath = fs.existsSync(path.join(process.cwd(), "data/ecdict.full.csv"))
    ? path.join(process.cwd(), "data/ecdict.full.csv")
    : path.join(process.cwd(), "data/ecdict.csv");
  const dictionary = new Map<string, DictionaryEntry>();
  if (!fs.existsSync(filePath)) return dictionary;
  const rows = fs.readFileSync(filePath, "utf8").split(/\r?\n/u);
  for (const row of rows) {
    if (!row || row.startsWith("word,")) continue;
    const cells = parseCsvLine(row);
    const word = cells[0]?.trim().toLowerCase();
    if (!word || !/^[a-z][a-z-]{1,38}$/.test(word)) continue;
    const phonetic = normalizePhonetic(cells[1] ?? "");
    const translation = cleanDictionaryTranslation(cells[3] ?? "");
    const partOfSpeech = dictionaryPos([cells[4] ?? "", translation, cells[2] ?? ""].join("\n"));
    if (!phonetic && !translation) continue;
    const meaningCn = compactDictionaryMeaning(translation);
    dictionary.set(word, {
      phonetic,
      partOfSpeech,
      meaningCn,
      shortMeaningCn: shortMeaning(meaningCn)
    });
  }
  return dictionary;
}

function chooseWordFields(entry: Entry, source: SourceBlock | undefined, dictionary: DictionaryEntry | undefined) {
  const sourceFields = parseSourceMeaning(source?.meaning ?? "", entry.targetWord);
  const phonetic = dictionary?.phonetic || cleanPhonetic(source?.phonetic) || cleanPhonetic(entry.targetWord.phoneticUk) || null;
  const example = cleanFixedExample(entry.targetWord.exampleSentence, entry.targetWord.exampleTranslation);
  return {
    phoneticUk: phonetic,
    phoneticUs: phonetic,
    partOfSpeech: sourceFields.partOfSpeech || dictionary?.partOfSpeech || entry.targetWord.partOfSpeech || "n.",
    meaningCn: sourceFields.meaningCn || entry.targetWord.meaningCn || dictionary?.meaningCn || "",
    shortMeaningCn: shortMeaning(sourceFields.meaningCn || entry.targetWord.meaningCn || dictionary?.shortMeaningCn || ""),
    exampleSentence: example.sentence,
    exampleTranslation: example.translation
  };
}

function parseSourceMeaning(meaning: string, fallback: Entry["targetWord"]) {
  const cleaned = cleanOCR(meaning)
    .replace(/^(?:释义)?[:：]/u, "")
    .replace(/^(n|v|vt|vi|adj|adv|pron|prep|conj)(?=[\u4e00-\u9fff])/iu, "$1.")
    .replace(/\bvt\./giu, "v.")
    .replace(/\bvi\./giu, "v.")
    .replace(/adj[，,]/giu, "adj.")
    .replace(/\s+/gu, " ")
    .trim();
  const match = cleaned.match(/^([a-z./]+)\s*(.+)$/iu);
  if (match?.[1] && /[\u3400-\u9fff]/u.test(match[2] ?? "")) {
    return {
      partOfSpeech: match[1].trim(),
      meaningCn: cleanChineseText(match[2] ?? "")
    };
  }
  return { partOfSpeech: fallback.partOfSpeech, meaningCn: fallback.meaningCn };
}

function stripExamples(value: string) {
  let body = value
    .replace(/===\s*(?:PAGE|LOWER PAGE)\s+\d+(?:\s+(?:LEFT|RIGHT))?\s*===/giu, " ")
    .replace(/学海学院店铺|修订完整|单词突围第\d+天/gu, " ")
    .trim();
  const indexes = [
    indexOfRegex(body, /(?:^|\n|\s)例句[:：]/u),
    indexOfRegex(body, /(?:^|[\s;；。])(?:[0-9]{1,4}(?:\/[0-9A-Za-z])?|\/[0-9A-Za-z])[:：]\s*(?=[A-Z])/u),
    indexOfRegex(
      body,
      /(?:^|[\s;；。])(?:[0-9]{1,4}\s*)?(?:B[fJ&5]*|BJ[&5J]*|M\|5|ĐJT|够句|例句|销句|[*/]{0,2}[A-Za-z0-9()|&]{1,8}\]?|[A-Za-z][A-Za-z0-9&|/*()]{0,8}|[向狗够]\s*)[:：]\s*(?=[A-Z])/u
    ),
    indexOfRegex(body, /(?:^|[\s;；。])(?:[0-9]{1,4}\s*)?(?:S[0-9]+)?(?:The|He|She|I|It|They|John|Steven|Researchers|His|Her|If)\b/u)
  ].filter((index) => index >= 0);
  if (indexes.length) body = body.slice(0, Math.min(...indexes));
  return body.trim();
}

function cleanMnemonicBody(value: string, word: string) {
  let body = cleanOCR(value)
    .replace(/^带你背[:：]\s*/u, "")
    .replace(/^\s*划分[:：][^\n]+/u, "")
    .replace(/\[\[\s*word\s*:\s*([^|\]\s]+)(?:\|([^\]]+))?\]\]/giu, (_match, target: string, alias: string | undefined) => String(alias || target).trim())
    .trim();
  if (word === "discern") {
    body = body
      .replace(/\bdis\s*[I|｜]\s*cem\b/giu, "dis | cern")
      .replace(/\bcem\b/giu, "cern")
      .replace(/dis\(加强\)\+cem/giu, "dis(加强)+cern");
  }
  if (word === "dome") {
    body = body.replace(/^针对第\s*2\s*个元素采用含义联想法[:：]\s*/u, "");
  }
  if (word === "dosage") {
    body = body.replace(/-a8e/giu, "-age");
  }
  if (word === "logical") {
    body = body.replace(/形容词贴。后缀/gu, "形容词后缀").replace(/贴。后缀/gu, "后缀");
  }
  if (word === "scrub") {
    body = body
      .replace(/1\s*划分[:：]\s*sc\s*lnub\s*/giu, "")
      .replace(/\bnub(?=\s*为)/giu, "rub")
      .replace(/\blnub\b/giu, "rub")
      .replace(/\bslcrub\b/giu, "s | crub")
      .replace(/\bcnub\b/giu, "crub")
      .replace(/\bscnub\b/giu, "scrub");
  }
  return body;
}

function cleanOCR(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\u00a0/gu, " ")
    .replace(/⾳/gu, "音")
    .replace(/\boricnt\b/giu, "orient")
    .replace(/\boricnl\b/giu, "orient")
    .replace(/\boriont(?:ution|atioo|lation)\b/giu, "orientation")
    .replace(/cmincnt/giu, "eminent")
    .replace(/\bcmin\b/giu, "emin")
    .replace(/\bcnactment\b/giu, "enactment")
    .replace(/\bcnact\b/giu, "enact")
    .replace(/\bcndow\b/giu, "endow")
    .replace(/\bcn(?=\s*(?:作|表示|\(|\.|,|，|;|；))/giu, "en")
    .replace(/\bcqua/giu, "equa")
    .replace(/\bcq/giu, "eq")
    .replace(/\blogie\b/giu, "logic")
    .replace(/\bpobable\b/giu, "probable")
    .replace(/\ba8e\b/giu, "age")
    .replace(/\badi\./giu, "adj.")
    .replace(/\bady\./giu, "adv.")
    .replace(/\badj[，,]/giu, "adj.")
    .replace(/\bad有/giu, "adj.有")
    .replace(/\bn(?=[\u4e00-\u9fff])/giu, "n.")
    .replace(/\bv(?=[\u4e00-\u9fff])/giu, "v.")
    .replace(/\bvt(?=[\u4e00-\u9fff])/giu, "vt.")
    .replace(/\bvi(?=[\u4e00-\u9fff])/giu, "vi.")
    .replace(/\bn\.\/i?w\./giu, "n./v.")
    .replace(/\bn\.\/w\./giu, "n./v.")
    .replace(/\bn\/w\b/giu, "n./v.")
    .replace(/\bv\.[Jj]n\./gu, "v./n.")
    .replace(/\bv\.hn\./giu, "v./n.")
    .replace(/\bvh(?=[\u4e00-\u9fff])/giu, "v./n.")
    .replace(/\bw\.(?=[\u4e00-\u9fff])/giu, "v.")
    .replace(/\bw(?=[\u4e00-\u9fff])/giu, "v.")
    .replace(/\bgose\b/giu, "goes")
    .replace(/\brail(?=[-)])/giu, "raid")
    .replace(/\bqcstion\b/giu, "question")
    .replace(/\bqucst\b/giu, "quest")
    .replace(/\bgril\b/giu, "girl")
    .replace(/\bmcdium\b/giu, "medium")
    .replace(/\bmummur\b|\bmumur\b/giu, "murmur")
    .replace(/\bshcep\b/giu, "sheep")
    .replace(/\bstirch\b/giu, "stitch")
    .replace(/\bspaghctti\b/giu, "spaghetti")
    .replace(/\bspaghctti\b/giu, "spaghetti")
    .replace(/\bidca\b/giu, "idea")
    .replace(/\blitle\b/giu, "little")
    .replace(/\bycars\b/giu, "years")
    .replace(/\blcam\b/giu, "learn")
    .replace(/\btcll\b/giu, "tell")
    .replace(/\bbecn\b/giu, "been")
    .replace(/\bperspcctive\b/giu, "perspective")
    .replace(/\bcrieria\b/giu, "criteria")
    .replace(/\bpuppel\b/giu, "puppet")
    .replace(/\bcxtravagant\b/giu, "extravagant")
    .replace(/\bmeiaphor\b/giu, "metaphor")
    .replace(/\bsubract\b/giu, "subtract")
    .replace(/\byeam\b/giu, "yearn")
    .replace(/\bcreasure\b/giu, "treasure")
    .replace(/\bthria\b/giu, "thrift")
    .replace(/\btumover\b|\bnumover\b/giu, "turnover")
    .replace(/\btum\b/giu, "turn")
    .replace(/\bthom\b|\brhom\b/giu, "thorn")
    .replace(/\bstrail\b|\bsrtrait\b/giu, "strait")
    .replace(/\bstraighl\b/giu, "straight")
    .replace(/综台考虑/gu, "综合考虑")
    .replace(/问汇扩充/g, "词汇扩充")
    .replace(/未尾/g, "末尾")
    .replace(/末尾去掉[-\s]*[{\uFF5B｛]/g, "末尾去掉 -t")
    .replace(/-Ie/g, "-le")
    .replace(/-1为动词后缀/g, "-t 为动词后缀")
    .replace(/词缀贴。后缀/g, "词缀后缀")
    .replace(/形容词贴。后缀/g, "形容词后缀")
    .replace(/贴。后缀/g, "后缀")
    .replace(/ロ\./gu, "n.")
    .replace(/口\./gu, "n.")
    .replace(/义馈|义偾/gu, "义愤")
    .replace(/骇人听间/gu, "骇人听闻")
    .replace(/诸音记忆法/g, "谐音记忆法")
    .replace(/剥分|刻分|椒分/g, "划分")
    .replace(/协第/g, "针对第")
    .replace(/廓擦/g, "摩擦")
    .replace(/骑牵托/g, "骑摩托")
    .replace(/朕想/g, "联想")
    .replace(/節头/g, "箭头")
    .replace(/進以/g, "难以")
    .replace(/遇应/g, "适应")
    .replace(/想助/g, "帮助")
    .replace(/介络/g, "介绍")
    .replace(/培迸/g, "培训")
    .replace(/貶低/gu, "贬低")
    .replace(/熟恶/gu, "熟悉")
    .replace(/濯木|湛木|灌木必/gu, "灌木")
    .replace(/([A-Za-z])\s+([.,;:!?])/gu, "$1$2");
}

function formatBody(value: string) {
  let text = value
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]*\n+[ \t]*/gu, " ")
    .replace(/形容词贴。后缀/gu, "形容词后缀")
    .replace(/贴。后缀/gu, "后缀")
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/gu, "$1$2")
    .replace(/\s+([，。；：、])/gu, "$1")
    .replace(/([，。；：、])\s+/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
  text = text
    .replace(/\s*(针对第\s*\d+\s*个元素)/gu, "\n$1")
    .replace(/\s*(针对整个单词)/gu, "\n$1")
    .replace(/\s*(综合考虑)/gu, "\n$1")
    .replace(/\s*(当\s+[a-z][a-z-]*\s+表示)/giu, "\n$1")
    .replace(/\s*(切换思路)/gu, "\n$1")
    .replace(/\s*(图中箭头)/gu, "\n$1")
    .replace(/\s*(联系\s+n\.)/gu, "\n$1")
    .replace(/\s*(由\s+n\.)/gu, "\n$1")
    .replace(/(?:^|[;；]\s*)(针对第\s*\d+\s*个元素)/gu, "\n$1")
    .replace(/(?:^|[;；]\s*)(针对整个单词)/gu, "\n$1")
    .replace(/(?:^|[;；]\s*)(综合考虑)/gu, "\n$1")
    .replace(/(?:^|[;；]\s*)(词根词缀(?:分析|积累)[:：])/gu, "\n$1")
    .replace(/(?:^|[;；]\s*)(巧记[:：])/gu, "\n$1")
    .replace(/(?:^|[;；]\s*)(常见搭配[:：])/gu, "\n$1")
    .replace(/(?:^|[;；]\s*)(词汇扩充[:：])/gu, "\n$1")
    .replace(/^\n/u, "")
    .replace(/\n{2,}/gu, "\n")
    .trim();
  return text;
}

function sanitizeFinalContent(value: string) {
  return value
    .replace(/形容词贴。后缀/gu, "形容词后缀")
    .replace(/贴。后缀/gu, "后缀")
    .replace(/adj;(?=[\u4e00-\u9fff])/giu, "adj.")
    .replace(/\bse(?=在单词里的发音类似中文”使”)/giu, "sc")
    .replace(/诸音记忆法/gu, "谐音记忆法")
    .replace(/廓擦/gu, "摩擦")
    .replace(/灌木必/gu, "灌木")
    .replace(/介络/gu, "介绍")
    .replace(/\borionlation\b|\boriontation\b|\boriontatioo\b/giu, "orientation")
    .replace(/表示\.(?=[（(])/gu, "表示")
    .replace(/第\s+(\d+)个/gu, "第$1个")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function cleanSplitText(value: string, word: string) {
  if (word === "scrub") return "sc | rub";
  let split = cleanOCR(value)
    .replace(/针对第[\s\S]*$/u, "")
    .replace(/yesterday rubbish.*$/iu, "")
    .replace(/\d+$/u, "")
    .replace(/[｜/]/gu, "|")
    .replace(/\s+[Iil]\s+/gu, " | ")
    .replace(/\s*\|\s*/gu, " | ")
    .trim();
  split = split.replace(/([a-z])l(?=[a-z])/giu, "$1 | ");
  if (word === "discern") split = split.replace(/\bcem\b/iu, "cern");
  split = split
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" | ");
  const compact = split.toLowerCase().replace(/[^a-z]/gu, "");
  const target = word.toLowerCase().replace(/[^a-z]/gu, "");
  if (!split || compact !== target) return null;
  return split;
}

function extractRelatedWords(markdown: string, currentWord: string, wordSet: Set<string>) {
  return uniqueStrings(
    parseWikiLinks(markdown)
      .filter((link) => link.nodeType === "WORD" || link.namespace === "word")
      .map((link) => normalizeRelatedWord(link.target))
      .filter((word) => word && word !== currentWord.toLowerCase() && wordSet.has(word))
  );
}

function extractContextualRelatedWords(body: string, currentWord: string, wordSet: Set<string>) {
  const current = currentWord.toLowerCase();
  const candidates: string[] = [];
  const text = body.replace(/\n/g, " ");
  const patterns = [
    /\b([a-z][a-z-]{1,38})\b\s*(?:为|是)(?:前面)?(?:已经)?(?:记忆过的)?(?:熟悉的?)?单词/giu,
    /(?:记忆单词|熟悉单词|熟悉的单词|记忆过的单词)\s*([a-z][a-z-]{1,38})/giu,
    /联想到(?:一个)?(?:已经记忆过的|记忆过的|熟悉的|以及记忆过的)?(?:熟悉)?单词\s*([a-z][a-z-]{1,38})/giu,
    /\b([a-z][a-z-]{1,38})\b\s*(?:n|v|vt|vi|adj|adv|pron|prep|conj)\.?(?=[\u4e00-\u9fff])/giu,
    /词汇扩充[:：]\s*([a-z][a-z-]{1,38})/giu,
    /常见搭配[:：]\s*([a-z][a-z-]{1,38})/giu
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const word = normalizeRelatedWord(match[1] ?? "");
      if (word && word !== current && wordSet.has(word)) candidates.push(word);
    }
  }
  return uniqueStrings(candidates);
}

function normalizeRelatedWord(value: string) {
  const cleaned = cleanOCR(value).toLowerCase().replace(/[^a-z-]/gu, "");
  const aliases: Record<string, string> = {
    logie: "logic",
    cmincnt: "eminent",
    cndow: "endow",
    cnact: "enact",
    gose: "goes",
    mcdium: "medium",
    shcep: "sheep"
  };
  return aliases[cleaned] ?? cleaned;
}

function withRelatedWordBlock(body: string, relatedWords: string[]) {
  const cleanBody = stripRelatedWordBlock(body).trim();
  if (!relatedWords.length) return cleanBody;
  return `${cleanBody}\n\n相关单词：\n${relatedWords.map((word) => `[[word:${word}]]`).join("\n")}`;
}

function stripRelatedWordBlock(markdown: string) {
  return markdown.replace(/\n*相关单词[:：][\s\S]*$/u, "").trimEnd();
}

function cleanPhonetic(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^[A-Za-z0-9「#]/u.test(raw)) return "";
  if (/[{}]|===|PAGE/u.test(raw)) return "";
  const cleaned = raw.replace(/^音标[:：]\s*/u, "").replace(/^\/?|\/?$/gu, "");
  if (!cleaned || /[0-9]/u.test(cleaned)) return "";
  return `/${cleaned}/`;
}

function normalizePhonetic(value: string) {
  const text = value.trim();
  if (!text) return "";
  return text.startsWith("/") && text.endsWith("/") ? text : `/${text.replace(/^\/|\/$/gu, "")}/`;
}

function cleanFixedExample(sentence: string | null | undefined, translation: string | null | undefined) {
  const cleanSentence = String(sentence ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .replace(/^Ihave\b/u, "I have")
    .replace(/([.?!])\s+[a-z][a-z-]{1,38}$/u, "$1")
    .trim();
  const cleanTranslation = String(translation ?? "")
    .normalize("NFKC")
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/gu, "$1$2")
    .replace(/\s+/gu, " ")
    .replace(/([。！？])\s+[A-Za-z][A-Za-z-]{1,38}$/u, "$1")
    .trim();
  return {
    sentence: cleanSentence || null,
    translation: cleanTranslation || null
  };
}

function auditEntry(input: {
  word: string;
  splitText: string | null;
  contentMarkdown: string;
  phoneticUk: string | null;
  phoneticUs: string | null;
  relatedWords: string[];
}) {
  const issues: string[] = [];
  const word = input.word.toLowerCase().replace(/[^a-z]/gu, "");
  const split = input.splitText ?? "";
  const compactSplit = split.toLowerCase().replace(/[^a-z]/gu, "");
  if (split && compactSplit !== word) issues.push(`bad-split:${split}`);
  if (split && /[\u3400-\u9fff]/u.test(split)) issues.push(`split-has-cjk:${split}`);
  const body = stripRelatedWordBlock(input.contentMarkdown);
  if (/\[\[word:/iu.test(body)) issues.push("inline-link-in-body");
  if (/例句[:：]/u.test(body)) issues.push("example-in-body");
  const badTerms = [
    "discem",
    "dolme",
    "cem 作词根",
    "-a8e",
    "-Ie",
    "Pdosidz",
    "cmin",
    "cnact",
    "cndow",
    "logie",
    "pobable",
    "ady.",
    "gose",
    "Ihave",
    "mcdium",
    "mummur",
    "stirch",
    "shcep",
    "词缀贴",
    "贴。后缀",
    "v.Jn",
    "v.hn",
    "n./iw.",
    "n./w.",
    "qcstion",
    "qucst",
    "oricnt",
    "oriont",
    "sc lnub",
    "cnub",
    "slcrub",
    "义馈",
    "熟恶",
    "问汇",
    "综台",
    "*/E]",
    "Mie):",
    "灌木必",
    "orion",
    "诸音",
    "廓擦",
    "介络",
    "骑牵托",
    "朕想",
    "srtrait",
    "strail",
    "straighl",
    "tumover",
    "numover",
    "yeam",
    "creasure",
    "meiaphor",
    "cxtravagant",
    "subract"
  ];
  for (const term of badTerms) {
    if (input.contentMarkdown.toLowerCase().includes(term.toLowerCase())) {
      issues.push(`bad-term:${term}`);
      break;
    }
  }
  if (/^[A-Za-z0-9「#]/u.test(input.phoneticUk ?? "") || /^[A-Za-z0-9「#]/u.test(input.phoneticUs ?? "")) issues.push("bad-phonetic");
  if ((input.phoneticUk ?? "").includes("PAGE") || (input.phoneticUs ?? "").includes("PAGE")) issues.push("bad-phonetic-page");
  return issues;
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

function cleanDictionaryTranslation(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes("[网络]"))
    .filter((line) => !/^\s*\[(计|地名|医|化|经|法|生|军|矿|植|动|航|天|数)\]/u.test(line))
    .map((line) => line.replace(/\[(?:古|俚|口|美|英|罕|废|诗|方|贬|褒|正式|非正式|音|语法|亦作|常用)\]/gu, "").trim())
    .join("\n")
    .trim();
}

function dictionaryPos(value: string) {
  const normalized = value.replace(/\bvt\./giu, "v.").replace(/\bvi\./giu, "v.");
  const matches = Array.from(normalized.matchAll(/\b(n|v|adj|adv|prep|conj|pron|abbr|int)\./giu)).map((match) => match[0].toLowerCase());
  return Array.from(new Set(matches)).join("/") || "n.";
}

function compactDictionaryMeaning(value: string) {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "";
  return lines
    .flatMap((line) => line.split(/[；;，,、]/u))
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part.length <= 24)
    .slice(0, 8)
    .join("；");
}

function cleanChineseText(value: string) {
  return value
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/gu, "$1$2")
    .replace(/\s+/gu, " ")
    .trim();
}

function shortMeaning(value: string) {
  const cleaned = cleanChineseText(value).replace(/^(n|v|adj|adv|prep|conj|pron|abbr|int)\.\s*/iu, "");
  return cleaned.split(/[；;，,。]/u).map((part) => part.trim()).filter(Boolean).slice(0, 2).join("；") || cleaned.slice(0, 16);
}

function indexOfRegex(value: string, pattern: RegExp) {
  const match = pattern.exec(value);
  return match?.index ?? -1;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function writeBackup(entries: Entry[]) {
  const wordIds = entries.map((entry) => entry.targetWord.id);
  const snapshot = await prisma.word.findMany({
    where: { id: { in: wordIds } },
    include: {
      mnemonicEntries: {
        where: { sourceType: MnemonicSourceType.OFFICIAL },
        include: { versions: true, links: true, userCardOrders: true }
      }
    },
    orderBy: { word: "asc" }
  });
  const backupPath = path.join(backupDir, `mnemonic-before-p0-quality-clean-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ marker, qualityMarker, createdAt: new Date().toISOString(), words: snapshot }, null, 2));
  return backupPath;
}

function writeReport(plans: Plan[], backupPath: string) {
  const reportPath = path.join(reportDir, `quality-clean-${apply ? "apply" : "dry-run"}-${Date.now()}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        marker,
        qualityMarker,
        backupPath,
        total: plans.length,
        changed: plans.filter((plan) => plan.changed).length,
        issuesBefore: plans.reduce((sum, plan) => sum + plan.issuesBefore.length, 0),
        issuesAfter: plans.reduce((sum, plan) => sum + plan.issuesAfter.length, 0),
        remainingIssueWords: plans.filter((plan) => plan.issuesAfter.length).map((plan) => ({ word: plan.entry.targetWord.word, issues: plan.issuesAfter })),
        entries: plans.map((plan) => ({
          word: plan.entry.targetWord.word,
          source: plan.source?.source ?? null,
          changed: plan.changed,
          issuesBefore: plan.issuesBefore,
          issuesAfter: plan.issuesAfter,
          splitBefore: plan.entry.splitText,
          splitAfter: plan.nextSplitText,
          phoneticBefore: plan.entry.targetWord.phoneticUk,
          phoneticAfter: plan.nextPhoneticUk,
          relatedWords: plan.relatedWords,
          before: plan.entry.contentMarkdown,
          after: plan.nextContentMarkdown
        }))
      },
      null,
      2
    )
  );
  return reportPath;
}

function printSummary(plans: Plan[], backupPath: string, reportPath: string, actor: string) {
  const sample = new Set(["discern", "dome", "dosage", "supportive", "supporter", "logical"]);
  console.log(`模式：${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor}`);
  console.log(`目标 Codex P0：${plans.length}`);
  console.log(`将修改：${plans.filter((plan) => plan.changed).length}`);
  console.log(`问题数：${plans.reduce((sum, plan) => sum + plan.issuesBefore.length, 0)} -> ${plans.reduce((sum, plan) => sum + plan.issuesAfter.length, 0)}`);
  console.log(`备份：${backupPath}`);
  console.log(`报告：${reportPath}`);
  for (const plan of plans.filter((item) => sample.has(item.entry.targetWord.word.toLowerCase()))) {
    console.log(`\n--- ${plan.entry.targetWord.word}`);
    console.log(`source=${plan.source?.source ?? "(none)"} issues ${plan.issuesBefore.join(",") || "(none)"} -> ${plan.issuesAfter.join(",") || "(none)"}`);
    console.log(`split: ${plan.entry.splitText ?? "(empty)"} => ${plan.nextSplitText ?? "(empty)"}`);
    console.log(`phonetic: ${plan.entry.targetWord.phoneticUk ?? ""} => ${plan.nextPhoneticUk ?? ""}`);
    console.log(plan.nextContentMarkdown.slice(0, 900));
  }
}

function appendEditorNote(current: string | null, note: string) {
  const parts = current
    ?.split("\n")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts?.includes(note)) return current ?? note;
  return [...(parts ?? []), note].join("\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
