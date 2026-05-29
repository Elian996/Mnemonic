import fs from "node:fs/promises";
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
const batchId = "cet6-scene-cards-20260528-batch2";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(process.cwd(), "tmp", "ai-generated-word-cards");

type CardSeed = {
  word: string;
  splitText: string;
  methodLabel: string;
  routeSummary: string;
  confidence: number;
  imageUrl?: string;
  imagePrompt?: string;
  contentMarkdown: string;
};

const cards: CardSeed[] = [
  {
    word: "antenna",
    splitText: "ant | en | na",
    methodLabel: "熟词场景",
    routeSummary: "ant=蚂蚁；蚂蚁头上的触须像两根接收信号的小天线。",
    confidence: 0.91,
    contentMarkdown: `带你背：

针对第1个元素采用熟词联想法：ant 表示“蚂蚁”。

针对后面的 en、na 采用画面补充法：不要硬解释成词义，只把它们想成蚂蚁头顶两根细细的触须，像两根向外伸出的接收线。

综合考虑：想象一只蚂蚁站在收音机上，头顶两根触须突然变得又长又亮，像小天线一样一左一右竖起来，正在接收空中的信号。

蚂蚁的触须像天线。由此记住 antenna 表示“天线；触须；触角”。

相关单词：
[[word:ant]]`
  },
  {
    word: "beak",
    splitText: "beak",
    methodLabel: "部位场景",
    routeSummary: "把 beak 记成 bird 的硬嘴；先从 bird/mouth 过渡到鸟特有的尖硬喙。",
    confidence: 0.84,
    contentMarkdown: `带你背：

采用部位场景法：bird 是“鸟”，mouth 是“嘴”。但鸟的嘴不是软软的人嘴，而是尖尖硬硬、会啄东西的喙。

综合考虑：想象一只鸟低头猛啄木桌，尖硬的嘴一下一下敲出清脆的声音。你看不到普通嘴唇，只看到一个像小钩子一样突出的硬嘴。

这个“鸟专用的尖硬嘴”就是 beak。由此记住 beak 表示“鸟嘴；喙；嘴”。

相关单词：
[[word:bird]]
[[word:mouth]]`
  },
  {
    word: "bouquet",
    splitText: "bou | quet",
    methodLabel: "谐音场景",
    routeSummary: "bou 借作“不”的 bu 音，quet 借作“可”的 ke 音；不可以只送一朵，要送一束花。",
    confidence: 0.78,
    contentMarkdown: `带你背：

采用近音场景法：bou 可以借作“不”的 bu 音，quet 里的 ke 音可以提示“可”。

连起来就是“不可以”：表白或祝贺时，不可以只拿一朵花草草应付，要捧来一大束 flower，花瓣很新鲜，香味扑到脸上。

综合考虑：想象朋友把你拦住，说“不可以只送一朵！”于是你赶紧抱来一大束花，双手都快抱不住。

这束花就是 bouquet。由此记住 bouquet 表示“花束；一束花”，也可以引申到酒的“香气”。

相关单词：
[[word:flower]]`
  },
  {
    word: "cavity",
    splitText: "cav | ity",
    methodLabel: "熟词场景",
    routeSummary: "cav 像 cave 去掉 e；把物体内部的小洞想成缩小版洞穴。",
    confidence: 0.9,
    contentMarkdown: `带你背：

采用熟词联想法：cav 这一段很像 cave 去掉最后的 e，而 cave 表示“洞穴”。

后面的 ity 不需要硬讲成词义，只把它当成结尾，把 cave 的“洞穴感”带到整个单词里。

综合考虑：想象牙医拿着小镜子照你的牙，突然发现牙面上有一个小小的黑洞，里面像缩小版 cave 一样空空的。风一吹进去，你立刻觉得酸疼。

一个物体内部出现像洞穴一样的空洞，就是 cavity。由此记住 cavity 表示“洞；空穴；腔”。

相关单词：
[[word:cave]]`
  },
  {
    word: "deadlock",
    splitText: "dead | lock",
    methodLabel: "熟词组合",
    routeSummary: "dead=死的，lock=锁；两边都被死死锁住，形成僵局。",
    confidence: 0.96,
    contentMarkdown: `带你背：

针对第1个元素采用熟词联想法：dead 表示“死的；不动的”。

针对第2个元素采用熟词联想法：lock 表示“锁”。

综合考虑：想象两队人拉着同一扇门，一边往左拉，一边往右拉。门中间还挂着一把死死卡住的锁，谁也推不开，谁也退不了。

dead + lock，就是“死锁”。由此记住 deadlock 表示“僵局；停顿”，作动词也可表示“相持不下”。

相关单词：
[[word:dead]]
[[word:lock]]`
  },
  {
    word: "embargo",
    splitText: "em | bar | go",
    methodLabel: "熟词组合",
    routeSummary: "bar=横杆、阻拦，go=走；港口横杆拦住货船不许走，就是禁运、封港令。",
    confidence: 0.93,
    contentMarkdown: `带你背：

针对中间元素采用熟词联想法：bar 可以表示“条；棒”，也能联想到横在路上的阻拦杆。

针对最后元素采用熟词联想法：go 表示“去；走”。

综合考虑：想象港口出口处突然落下一根巨大的 bar，挡在货船前面。船长想 go，却被士兵拦住，所有货物都不能出港，也不能交易。

bar 住，不让 go，就是 embargo。由此记住 embargo 表示“封港令；禁运”，作动词表示“禁止出入港口”。

相关单词：
[[word:bar]]
[[word:go]]`
  },
  {
    word: "overflow",
    splitText: "over | flow",
    methodLabel: "熟词组合",
    routeSummary: "over=越过，flow=流动；水流越过容器边缘，就是溢出、泛滥。",
    confidence: 0.97,
    contentMarkdown: `带你背：

针对第1个元素采用熟词联想法：over 表示“越过；超过”。

针对第2个元素采用熟词联想法：flow 表示“流动”。

综合考虑：想象水龙头忘了关，水在杯子里越积越高，最后水流 flow 越过 over 杯沿，哗啦一下流到桌面和地板上。

over + flow，就是“流过边界”。由此记住 overflow 表示“溢出；充溢；泛滥”，也可作名词表示“溢出量”。

相关单词：
[[word:over]]
[[word:flow]]`
  },
  {
    word: "flap",
    splitText: "flap",
    methodLabel: "拟声动作",
    routeSummary: "flap 的发音短促，像薄片或翅膀啪地拍动；落到飘摆、拍打。",
    confidence: 0.85,
    contentMarkdown: `带你背：

采用拟声动作法：flap 读起来短促有力，末尾的 p 像“啪”一下收住，可以联想到薄片或翅膀拍过去的声音。

综合考虑：想象大风吹开窗户，窗帘、纸片和鸟的翅膀都在空气里一下一下拍打。每一次拍动都带着“flap、flap”的声音，东西被风吹得来回飘摆。

这个“啪地拍动、来回飘摆”的动作，就是 flap。由此记住 flap 表示“飘；摆动；拍打”，也可作名词表示“拍打声；片状垂悬物”。`
  },
  {
    word: "harass",
    splitText: "",
    methodLabel: "暂不生成",
    routeSummary: "原谐音路线跳跃且不自然，不能作为可发布记忆卡；等待人工重写。",
    confidence: 0.05,
    contentMarkdown: ""
  },
  {
    word: "hose",
    splitText: "hose",
    methodLabel: "谐音场景",
    routeSummary: "把 hose 拟人化成会“吼”出水的软管；先解释谐音，再用夸张画面落到水管。",
    confidence: 0.86,
    imageUrl: "/uploads/generated-mnemonic-images/ai-generated-hose-20260528.png",
    imagePrompt:
      "A green garden hose personified with an open shouting mouth blasting a powerful stream of water, surprised person holding it, vivid exaggerated mnemonic scene, no text.",
    contentMarkdown: `带你背：

采用谐音场景法：hose 读起来可以借成“吼水”。

这里不要直接把 hose 等于“吼水”，而是先把水管拟人化：想象院子里一根绿色软管接上水龙头后，前端突然张开大嘴，像在“吼”一样喷出一大股水。

综合考虑：你抓着这根软管浇花，它却越吼越大声，水柱冲得花瓣乱晃，连你衣服都被喷湿了。这个会“吼”出水来的软管，就是 hose。

由此记住 hose 表示“水管；橡皮软管”，作动词可表示“用水管浇”。

![hose 助记图](/uploads/generated-mnemonic-images/ai-generated-hose-20260528.png)

相关单词：
[[word:pipe]]
[[word:water]]`
  },
  {
    word: "hostage",
    splitText: "",
    methodLabel: "暂不生成",
    routeSummary: "原熟词拆分路线牵强，不适合做正式记忆卡；等待人工重写。",
    confidence: 0.05,
    contentMarkdown: ""
  },
  {
    word: "knob",
    splitText: "kno | b",
    methodLabel: "发音形状",
    routeSummary: "k 不发音；kno 中 no 对应“捏”的近音提示，b 对应“把”的首字母，捏住把手旋转。",
    confidence: 0.86,
    contentMarkdown: `带你背：

采用发音形状法：knob 里的 k 不发音，后面 kno 读起来接近 no，可以提示“捏”的动作；最后的 b 可以看成“把”的拼音首字母。

也就是：捏（no）+ 把（b）。

综合考虑：想象门上有一个圆圆鼓出来的小把手。你伸手去捏住这个“把”，轻轻一转，门就开了。再想象音响上也有一个圆旋钮，手指捏住它往右转，声音慢慢变大。

这个被手捏住来开门或调节的圆形小把手，就是 knob。由此记住 knob 表示“把手；旋钮；球形突出物”。`
  },
  {
    word: "meadow",
    splitText: "mea | dow",
    methodLabel: "谐音场景",
    routeSummary: "meadow 读音接近“咩都”；一片草地上到处都是羊在咩咩叫。",
    confidence: 0.9,
    contentMarkdown: `带你背：

采用整体谐音记忆法：meadow 读起来可以联想到“咩都”。

其中 mea 可以抓住“咩”的声音，dow 可以借成“都”：很多羊都（dow）在草地上咩咩（mea）叫。

综合考虑：想象一片开阔的青草地，风吹过草尖，一群羊散在草地上。左边“咩”，右边也“咩”，远处还是“咩”，到处都在咩咩叫，声音一层一层铺满整片草地。

“咩都”在草地上叫。由此记住 meadow 表示“草地；牧场”。`
  },
  {
    word: "meticulous",
    splitText: "me | ti | cu | lous",
    methodLabel: "谐音场景",
    routeSummary: "meticulous 联想到“每题扣”；批改每一道题都抠细节，就是一丝不苟。",
    confidence: 0.86,
    imageUrl: "/uploads/generated-mnemonic-images/ai-generated-meticulous-20260528.png",
    imagePrompt:
      "A strict teacher grading exam papers with magnifying glass, red pen, ruler, and tiny circled details, meticulous attention, warm classroom desk, no readable text.",
    contentMarkdown: `带你背：

采用谐音场景法：meticulous 可以联想到“每题扣”。

综合考虑：想象一位老师批改试卷，每一道题都拿放大镜看。标点错了要圈出来，单位漏了要扣分，图上的小线歪了一点也要标注。他不是随便看一眼，而是每题都抠到细节。

“每题扣”得这么细，就是 meticulous。由此记住 meticulous 表示“一丝不苟的；精确的；过细的”。

![meticulous 助记图](/uploads/generated-mnemonic-images/ai-generated-meticulous-20260528.png)`
  },
  {
    word: "mingle",
    splitText: "",
    methodLabel: "暂不生成",
    routeSummary: "原谐音路线跳跃且不自然，不能作为可发布记忆卡；等待人工重写。",
    confidence: 0.05,
    contentMarkdown: ""
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

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const [words, existingDrafts, activeAdmin] = await Promise.all([
    prisma.word.findMany({
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
    }),
    prisma.importDraft.findMany({
      where: {
        source: aiGeneratedWordCardSource,
        word: { in: selectedCards.map((card) => card.word) }
      },
      orderBy: { createdAt: "asc" }
    }),
    prisma.user.findFirst({
      where: { role: UserRole.ADMIN, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true }
    })
  ]);
  if (apply && !activeAdmin) throw new Error("找不到 active admin，不能写入审计日志。");

  const wordByText = new Map(words.map((word) => [word.word, word]));
  const existingDraftByWord = new Map(existingDrafts.map((draft) => [draft.word, draft]));
  const beforeSnapshotPath = path.join(outputDir, `batch2-existing-drafts-before-${timestamp}.json`);
  await fs.writeFile(beforeSnapshotPath, JSON.stringify(existingDrafts, null, 2));

  const plan = selectedCards.map((card) => {
    const word = wordByText.get(card.word);
    const existingDraft = existingDraftByWord.get(card.word);
    const exists = Boolean(word);
    const isCet6 = Boolean(word?.levelTags.includes(LevelTag.CET6));
    const hasActiveCard = Boolean(word?.mnemonicEntries.length);
    const canUpdateDraft = !existingDraft || existingDraft.status === ImportDraftStatus.DRAFT;
    return {
      ...card,
      wordId: word?.id ?? null,
      slug: word?.slug ?? null,
      partOfSpeech: word?.partOfSpeech ?? null,
      meaningCn: word?.meaningCn ?? null,
      shortMeaningCn: word?.shortMeaningCn ?? null,
      exists,
      isCet6,
      hasActiveCard,
      existingDraftId: existingDraft?.id ?? null,
      existingDraftStatus: existingDraft?.status ?? null,
      willWrite: exists && isCet6 && !hasActiveCard && canUpdateDraft
    };
  });
  const unresolved = plan.filter((item) => !item.willWrite);
  const planPath = path.join(outputDir, `batch2-plan-${apply ? "apply" : "dry-run"}-${timestamp}.json`);
  await fs.writeFile(planPath, JSON.stringify({ createdAt: new Date().toISOString(), apply, batchId, plan }, null, 2));
  if (unresolved.length) {
    console.log(`有 ${unresolved.length} 条不能写入，详见 ${planPath}`);
    for (const item of unresolved) {
      console.log(
        `- ${item.word}: exists=${item.exists}, cet6=${item.isCet6}, active=${item.hasActiveCard}, existingDraftStatus=${item.existingDraftStatus}`
      );
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
          imagePrompt: item.imagePrompt ?? ""
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
          originalImageUrl: item.imageUrl ?? null,
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
              imageUrl: item.imageUrl ?? null
            } satisfies Prisma.InputJsonObject
          }
        });
      }
    });
  }

  console.log(`模式：${apply ? "apply" : "dry-run"}`);
  console.log(`批次：${batchId}`);
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
