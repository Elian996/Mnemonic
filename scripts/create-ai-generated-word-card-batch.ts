import fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { ImportDraftStatus, LevelTag, MnemonicStatus, Prisma, UserRole } from "@prisma/client";
import { aiGeneratedWordCardSource, type AiGeneratedWordCardPayload } from "../src/lib/ai-generated-word-cards";
import { prisma } from "../src/lib/db";

try {
  loadEnvFile(".env");
} catch {}
try {
  loadEnvFile(".env.local");
} catch {}

const apply = process.argv.includes("--apply");
const batchId = "cet6-scene-cards-20260528";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(process.cwd(), "tmp", "ai-generated-word-cards");

type CardSeed = {
  word: string;
  splitText: string;
  methodLabel: string;
  routeSummary: string;
  confidence: number;
  imageUrl: string;
  imagePrompt: string;
  contentMarkdown: string;
};

const cards: CardSeed[] = [
  {
    word: "abide",
    splitText: "a | bide",
    methodLabel: "谐音场景",
    routeSummary: "a=一个，bide 谐音“拜的”；一个朝拜者遵守朝拜规矩、忍受艰辛，也让旁观者停留。",
    confidence: 0.9,
    imageUrl: "/uploads/generated-mnemonic-images/ai-generated-abide-20260528.png",
    imagePrompt: "One Tibetan pilgrim prostrating step by step on a cold road to Lhasa, enduring hardship; cinematic, no text.",
    contentMarkdown: `带你背：

针对第1个元素采用含义联想法：a 表示“一个”。

针对第2个元素采用谐音记忆法：bide 读起来可以联想到“拜的”。

综合考虑：想象一个（a）正在西藏一路朝拜（bide，拜的）的苦行僧，正在去拉萨的路上。高原寒风吹得脸发红，路上全是碎石和尘土，他走几步就跪下磕一次长头，手掌磨破了，膝盖也磕疼了，但还是继续往前拜。

他遵守朝拜的规矩，一步一步磕下去，所以可以记住 abide by the rules 表示“遵守规则”。他不断忍受、容忍一路上的千辛万苦，最终抵达拉萨。由此记住 abide 表示“忍受；容忍”。

你看到这一幕之后非常感慨，不禁在原地停留了很久。由此再记住 abide 还可以表示“停留”。

![abide 助记图](/uploads/generated-mnemonic-images/ai-generated-abide-20260528.png)

常见搭配：

abide by the rules 遵守规则`
  },
  {
    word: "abreast",
    splitText: "a | breast",
    methodLabel: "熟词场景",
    routeSummary: "a 从“一个”引申为“一条”；breast=胸部；胸部连成一条线就是并排。",
    confidence: 0.93,
    imageUrl: "/uploads/generated-mnemonic-images/ai-generated-abreast-20260528.png",
    imagePrompt: "Military training line with everyone's chests aligned into one straight line; cinematic, no text.",
    contentMarkdown: `带你背：

针对第1个元素采用含义联想法：a 表示“一个”，也可以引申成“一条”。

针对第2个元素采用熟词联想法：breast 为熟悉单词，表示“胸部”。

综合考虑：想象军训时，教官正在训队列。他大声要求所有人必须站整齐，不能有人往前凸，也不能有人落后。于是整排同学都挺直身体、并肩站好，所有人的胸部（breast）刚好连成一条（a）直线。

胸部连成一条直线，就是“并排、并肩”的状态。由此记住 abreast 表示“并排地；并肩地”。

常见搭配：

keep abreast of... 和新信息保持并排，不落后，即“跟上；了解最新情况”。

相关单词：
[[word:breast]]`
  },
  {
    word: "baffle",
    splitText: "baffle",
    methodLabel: "谐音场景",
    routeSummary: "baffle 整体读音联想到“把佛”；搬佛像被挡板卡住，整个人困惑为难。",
    confidence: 0.72,
    imageUrl: "/uploads/generated-mnemonic-images/ai-generated-baffle-20260528.png",
    imagePrompt: "A worker puzzled while trying to move a huge stone statue through a narrow blocked doorway; cinematic, no text.",
    contentMarkdown: `带你背：

采用整体谐音记忆法：baffle 读起来可以联想到“把佛”。

想象一个工人接到任务，要把一尊很重的佛像搬进仓库，也就是“把佛”。可门特别窄，旁边又有一块块挡板拦着，他左转不行，右转也不行，佛像卡在门口怎么都进不去。

他急得抓头，脸上全是“这到底该怎么办”的表情。这个被难住、被弄糊涂的状态，就是 baffle 的感觉。

由此记住 baffle 表示“使困惑；使为难”。`
  },
  {
    word: "bleak",
    splitText: "b | leak",
    methodLabel: "熟词场景",
    routeSummary: "b 联想到 black 的黑；leak=漏；黑冷破屋漏风漏雨，荒凉萧瑟。",
    confidence: 0.84,
    imageUrl: "/uploads/generated-mnemonic-images/ai-generated-bleak-20260528.png",
    imagePrompt: "A dark, cold, empty winter wasteland with a lone person; bleak and desolate; cinematic, no text.",
    contentMarkdown: `带你背：

针对第1个元素采用熟词首字母联想：b 可以联想到 black，表示“黑的”。

针对第2个元素采用熟词联想法：leak 表示“漏”。

综合考虑：想象一间废弃小屋立在寒风里，四周黑沉沉的（b-black），屋顶还在漏风漏雨（leak）。屋外没有人声，树枝光秃秃地晃着，冷得让人心里发空。

这种又冷、又空、又荒凉的画面，就是 bleak 的感觉。由此记住 bleak 表示“萧瑟的；荒凉的；阴冷的”。

相关单词：
[[word:leak]]
[[word:black]]`
  },
  {
    word: "clench",
    splitText: "clen | ch",
    methodLabel: "谐音动作",
    routeSummary: "clen 联想到“冷”，ch 是“齿”的拼音首字母；冷到攥拳、咬齿。",
    confidence: 0.8,
    imageUrl: "/uploads/generated-mnemonic-images/ai-generated-clench-20260528.png",
    imagePrompt: "Close-up of clenched fists and clenched teeth in freezing wind; cinematic, no text.",
    contentMarkdown: `带你背：

针对第1个元素采用谐音联想：clen 这一段可以联想到“冷”。

针对第2个元素采用拼音联想：ch 可以看成“齿”的拼音首字母。

综合考虑：想象一个人在冰冷的寒风里站着，冷得手指发僵。他为了忍住寒意，把拳头攥得特别紧，指关节都发白了；牙齿（ch）也咬紧，脸上的肌肉绷住。

这个“因为冷而紧紧攥住、咬紧”的动作，就是 clench。由此记住 clench 表示“紧握；咬紧；捏紧”。`
  },
  {
    word: "clog",
    splitText: "c | log",
    methodLabel: "字形熟词",
    routeSummary: "c 像弯管，log=圆木；圆木卡在弯管里造成阻塞。",
    confidence: 0.92,
    imageUrl: "/uploads/generated-mnemonic-images/ai-generated-clog-20260528.png",
    imagePrompt: "A C-shaped pipe clogged by a wooden log, dirty water backing up; cinematic, no text.",
    contentMarkdown: `带你背：

针对第1个元素采用字形联想：c 像一个弯弯的管道。

针对第2个元素采用熟词联想法：log 表示“圆木”。

综合考虑：想象水槽下面有一截 C 形弯管（c），里面竟然卡进了一根圆木（log）。水流冲不过去，脏水越积越多，管道完全被堵住。

c 形管道里卡着 log 圆木，就是 clog。

由此记住 clog 表示“阻塞；堵塞”，也可作名词表示“障碍”。

相关单词：
[[word:log]]`
  },
  {
    word: "crumble",
    splitText: "",
    methodLabel: "暂不生成",
    routeSummary: "crumb 没有正式记忆卡，不能作为熟词基础；暂不生成，等待人工重写。",
    confidence: 0.05,
    imageUrl: "/uploads/generated-mnemonic-images/ai-generated-crumble-20260528.png",
    imagePrompt: "Old brick wall and dry bread breaking apart into crumbs and fragments; cinematic, no text.",
    contentMarkdown: ""
  },
  {
    word: "eclipse",
    splitText: "",
    methodLabel: "暂不生成",
    routeSummary: "clip 等拆分牵强，暂不生成；等待人工重写。",
    confidence: 0.05,
    imageUrl: "/uploads/generated-mnemonic-images/ai-generated-eclipse-20260528.png",
    imagePrompt: "A giant black clip-like shadow covering the sun, people look up in awe; cinematic, no text.",
    contentMarkdown: ""
  },
  {
    word: "fling",
    splitText: "f | ling",
    methodLabel: "谐音动作",
    routeSummary: "f 联想到 fly/飞，ling 谐音“铃”；把响铃猛地飞扔出去。",
    confidence: 0.83,
    imageUrl: "/uploads/generated-mnemonic-images/ai-generated-fling-20260528.png",
    imagePrompt: "A frustrated student forcefully throws a ringing metal bell across a room; cinematic, no text.",
    contentMarkdown: `带你背：

针对第1个元素采用熟词首字母联想：f 可以联想到 fly，表示“飞”。

针对第2个元素采用谐音记忆法：ling 可以联想到“铃”。

综合考虑：想象自习室里，一个金属铃一直响个不停，吵得人心烦。一个同学终于忍不住，抓起这个铃（ling），猛地一甩，铃直接飞（f-fly）了出去。

这个用力一扔、猛地抛出去的动作，就是 fling。

由此记住 fling 表示“投掷；猛扔”。如果一个人像被扔出去一样突然冲出门，也可以用 fling 的“急冲”感觉来记。`
  },
  {
    word: "gasp",
    splitText: "gas | p",
    methodLabel: "熟词拼音",
    routeSummary: "gas=气体，p=喷；气体从嘴里喷出，就是喘气、喘息、气喘吁吁地说。",
    confidence: 0.94,
    imageUrl: "/uploads/generated-mnemonic-images/ai-generated-gasp-20260528.png",
    imagePrompt: "A person opens a door into a room filled with gas or smoke and gasps for air; cinematic, no text.",
    contentMarkdown: `带你背：

针对第1个元素采用熟词联想法：gas 表示“气体”。

针对第2个元素采用中文拼音联想：p 可以看成“喷”的拼音首字母。

综合考虑：想象一个人刚跑完冲刺，胸口剧烈起伏，嘴巴张得很大，里面的气体（gas）一口一口往外喷（p）。他说话也说不完整，只能一边喘一边断断续续地说。

gas + p，就是“气体从嘴里喷出来”。由此记住 gasp 作名词表示“喘气”，作动词表示“喘息；气喘吁吁地说”。

当人快喘不上气时，会 gasp for air，也就是“渴望空气”。由此再记住 gasp 还可以表示“渴望”。

相关单词：
[[word:gas]]`
  }
];

const onlyArg = process.argv.find((arg) => arg.startsWith("--only=") || arg.startsWith("--word="));
const onlyWords = onlyArg
  ? new Set(
      onlyArg
        .split("=")[1]
        .split(",")
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean)
    )
  : null;
const selectedCards = onlyWords ? cards.filter((card) => onlyWords.has(card.word.toLowerCase())) : cards;

if (onlyWords && selectedCards.length === 0) {
  throw new Error(`未找到 --only 指定的单词：${[...onlyWords].join(", ")}`);
}

function withOptionalImage(contentMarkdown: string, word: string, imageUrl: string) {
  const content = contentMarkdown.trim();
  if (!content || !imageUrl || content.includes(imageUrl)) return content;

  const imageMarkdown = `![${word} 助记图](${imageUrl})`;
  const tailMarkers = ["\n\n常见搭配：", "\n\n相关单词："];
  const tailIndex = tailMarkers
    .map((marker) => content.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (tailIndex === undefined) return `${content}\n\n${imageMarkdown}`;
  return `${content.slice(0, tailIndex)}\n\n${imageMarkdown}${content.slice(tailIndex)}`;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const words = await prisma.word.findMany({
    where: { word: { in: selectedCards.map((card) => card.word) } },
    select: {
      id: true,
      word: true,
      slug: true,
      levelTags: true,
      partOfSpeech: true,
      meaningCn: true,
      shortMeaningCn: true,
      mnemonicEntries: {
        where: { status: { not: MnemonicStatus.ARCHIVED } },
        select: { id: true },
        take: 1
      }
    }
  });
  const wordByText = new Map(words.map((word) => [word.word, word]));
  const existingDrafts = await prisma.importDraft.findMany({
    where: {
      source: aiGeneratedWordCardSource,
      word: { in: selectedCards.map((card) => card.word) },
      status: ImportDraftStatus.DRAFT
    },
    orderBy: { createdAt: "asc" }
  });
  const existingDraftByWord = new Map(existingDrafts.map((draft) => [draft.word, draft]));
  const activeAdmin = await prisma.user.findFirst({
    where: { role: UserRole.ADMIN, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true }
  });
  if (apply && !activeAdmin) throw new Error("找不到 active admin，不能写入审计日志。");

  const beforeSnapshotPath = path.join(outputDir, `existing-drafts-before-${timestamp}.json`);
  await fs.writeFile(beforeSnapshotPath, JSON.stringify(existingDrafts, null, 2));

  const plan = selectedCards.map((card) => {
    const word = wordByText.get(card.word);
    const contentMarkdown = withOptionalImage(card.contentMarkdown, card.word, card.imageUrl);
    const exists = Boolean(word);
    const isCet6 = Boolean(word?.levelTags.includes(LevelTag.CET6));
    const hasActiveCard = Boolean(word?.mnemonicEntries.length);
    const imageExists = !card.imageUrl || fsSync.existsSync(path.join(process.cwd(), "public", card.imageUrl.replace(/^\//u, "")));
    return {
      ...card,
      contentMarkdown,
      wordId: word?.id ?? null,
      slug: word?.slug ?? null,
      partOfSpeech: word?.partOfSpeech ?? null,
      meaningCn: word?.meaningCn ?? null,
      shortMeaningCn: word?.shortMeaningCn ?? null,
      exists,
      isCet6,
      hasActiveCard,
      imageExists,
      existingDraftId: existingDraftByWord.get(card.word)?.id ?? null,
      willWrite: exists && isCet6 && !hasActiveCard && imageExists
    };
  });
  const unresolved = plan.filter((item) => !item.willWrite);
  const planPath = path.join(outputDir, `plan-${apply ? "apply" : "dry-run"}-${timestamp}.json`);
  await fs.writeFile(planPath, JSON.stringify({ createdAt: new Date().toISOString(), apply, batchId, plan }, null, 2));
  if (unresolved.length) {
    console.log(`有 ${unresolved.length} 条不能写入，详见 ${planPath}`);
    for (const item of unresolved) {
      console.log(`- ${item.word}: exists=${item.exists}, cet6=${item.isCet6}, active=${item.hasActiveCard}, image=${item.imageExists}`);
    }
    if (apply) throw new Error("存在不能写入的卡，已停止。");
  }

  let created = 0;
  let updated = 0;
  if (apply) {
    const adminId = activeAdmin?.id;
    if (!adminId) throw new Error("找不到 active admin，不能写入审计日志。");
    await prisma.$transaction(async (tx) => {
      for (const item of plan.filter((entry) => entry.willWrite)) {
        const wordId = item.wordId;
        const slug = item.slug;
        if (!wordId || !slug) continue;
        const payload = {
          type: aiGeneratedWordCardSource,
          batchId,
          targetWordId: wordId,
          targetWord: item.word,
          targetSlug: slug,
          methodLabel: item.methodLabel,
          routeSummary: item.routeSummary,
          confidence: item.confidence,
          imagePrompt: item.imagePrompt
        } satisfies AiGeneratedWordCardPayload;
        const data = {
          source: aiGeneratedWordCardSource,
          status: ImportDraftStatus.DRAFT,
          word: item.word,
          partOfSpeech: item.partOfSpeech,
          meaningCn: item.meaningCn,
          shortMeaningCn: item.shortMeaningCn,
          splitText: item.splitText,
          title: `${item.word} AI生成单词卡`,
          contentMarkdown: item.contentMarkdown,
          rawText: item.routeSummary,
          originalImageUrl: item.imageUrl || null,
          extractedImageUrls: item.imageUrl ? [item.imageUrl] : [],
          agentPayload: payload satisfies Prisma.InputJsonValue
        };
        const existing = existingDraftByWord.get(item.word);
        if (existing) {
          await tx.importDraft.update({
            where: { id: existing.id },
            data
          });
          updated += 1;
        } else {
          await tx.importDraft.create({ data });
          created += 1;
        }
        await tx.auditLog.create({
          data: {
            actorId: adminId,
            action: existing ? "AI_GENERATED_WORD_CARD_DRAFT_UPDATE" : "AI_GENERATED_WORD_CARD_DRAFT_CREATE",
            entityType: "Word",
            entityId: wordId,
            metadataJson: {
              batchId,
              targetWord: item.word,
              methodLabel: item.methodLabel,
              confidence: item.confidence,
              imageUrl: item.imageUrl || null
            } satisfies Prisma.InputJsonObject
          }
        });
      }
    });
  }

  console.log(`模式：${apply ? "apply" : "dry-run"}`);
  console.log(`计划文件：${planPath}`);
  console.log(`写入：created=${created}, updated=${updated}`);
  console.log(`写入前快照：${beforeSnapshotPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
