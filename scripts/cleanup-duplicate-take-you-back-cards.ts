import fs from "node:fs/promises";
import path from "node:path";
import { MnemonicStatus, type Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { markdownToPlainText, renderMnemonicMarkdown } from "../src/lib/wiki-links/renderer";
import { syncEntryWikiLinks } from "../src/lib/wiki-links/resolve";

const APPLY = process.argv.includes("--apply");
const ADMIN_EMAIL = process.env.MNEMONIC_CLEANUP_ACTOR_EMAIL ?? "maoshangjian2021@163.com";
const DUPLICATE_TAKE_YOU_BACK = /(?:^|\n)\s*[带帶帯]你背[：:；;]?\s*(?:\n\s*)+(?:[带帶帯]你背[：:；;]?)/u;

type Entry = {
  id: string;
  title: string;
  splitText: string | null;
  contentMarkdown: string;
  targetWord: {
    word: string;
    shortMeaningCn: string | null;
  };
};

type Repair = {
  body: string;
  splitText?: string | null;
  related?: string[];
};

type Plan = {
  entry: Entry;
  nextSplitText: string | null;
  nextContentMarkdown: string;
};

const REPAIRS: Record<string, Repair> = {
  acidity: {
    splitText: "acid | -ity",
    body:
      "acid 为已经记忆过的单词，表示 adj.酸的；-ity 是名词后缀，表示性质或状态。由此记住 acidity 表示 n.酸性；酸度。",
    related: ["acid"]
  },
  alternate: {
    splitText: "alter | -ate",
    body:
      "alter 表示改变；alternate 保留 alter 的“改变”核心义。两种状态来回改变，就是 adj.交替的、轮流的；作动词时表示轮流、交替。",
    related: ["alter"]
  },
  amend: {
    splitText: "a- | mend",
    body:
      "mend 表示修理、修补；a- 可作加强理解。把错误或不足“修补好”，就是 amend，即 v.修改；改善。",
    related: ["mend"]
  },
  amiable: {
    splitText: "ami | -able",
    body:
      "ami 可联想到 amicable 中“友好”的核心义；-able 表示具有……性质的。一个容易让人亲近、愿意相处的人，就是 amiable，即 adj.亲切的；和蔼可亲的。",
    related: ["amicable"]
  },
  aristocratic: {
    splitText: "aristocrat | -ic",
    body:
      "aristocrat 表示 n.贵族；-ic 是形容词后缀。属于贵族或带有贵族气质的，就是 aristocratic，即 adj.贵族的；贵族气派的。",
    related: ["aristocrat"]
  },
  bloc: {
    splitText: "block (-k)",
    body:
      "block 表示一大块、街区，也可理解为被划分出来的一块区域。bloc 去掉末尾 k，保留“一整块阵营”的感觉，表示政治或利益一致的 n.集团；阵营。",
    related: ["block"]
  },
  blunt: {
    splitText: null,
    body:
      "blunt 先记“刀口不锋利”的画面：刀变钝就不好切东西。由“没有锋利边缘”引申到说话不拐弯，直接、坦率，故 blunt 表示 adj.钝的；坦率的。",
  },
  cape: {
    splitText: "cap | e",
    body:
      "cap 表示帽子；cape 可以想成披在肩上的“加长帽饰/披风”。地理上向海里伸出去的一角也像披出去的一块布，由此记住 cape 表示 n.岬；海角；披肩。",
    related: ["cap"]
  },
  chronicle: {
    splitText: "chron | -icle",
    body:
      "chron 表示时间；chronicle 把事件按时间顺序记录下来，就是 n.年代记；编年史；也可作动词表示把事件记录下来。",
    related: ["chronic"]
  },
  complement: {
    splitText: "com- | ple | -ment",
    body:
      "complete 表示完成；complement 和 complete 同源，都带有“补足、使完整”的感觉。能让整体变完整的部分就是 complement，即 n.补足物；补语。",
    related: ["complete"]
  },
  conceive: {
    splitText: "con- | ceive",
    body:
      "conceive 可以和 receive 一起记：receive 是“接收”，conceive 是在头脑里“接住一个想法”。由此记住 conceive 表示 v.构思；设想；认为。",
    related: ["receive"]
  },
  conception: {
    splitText: "conceive | -ion",
    body:
      "conceive 表示构思、设想；去掉末尾 -ve，加上 -ion 名词后缀，就得到 conception，表示 n.观念；概念；构想。",
    related: ["conceive"]
  },
  cuisine: {
    splitText: null,
    body:
      "cuisine 可以谐音联想到“亏损”：餐馆做不同风格的菜肴和烹调，经营不好就容易亏损。抓住“菜肴/烹调风格”这个场景，记住 cuisine 表示 n.烹调风格；烹调法。",
  },
  downgrading: {
    splitText: "down | grade | -ing",
    body:
      "down 表示向下；grade 表示等级；-ing 表示动作或过程。等级往下调的过程就是 downgrading，即 n.降级。",
    related: ["down", "grade"]
  },
  dubious: {
    splitText: "doubt | -ious",
    body:
      "dubious 可以和 doubt 一起记：doubt 是怀疑，dubious 形容让人产生怀疑、拿不准的状态，表示 adj.可疑的；不确定的。",
    related: ["doubt"]
  },
  duplicate: {
    splitText: "du | plicate",
    body:
      "du/duo 表示二、双；plicate 可联想到 fold“折叠”。把同一份内容折出第二份，就是 duplicate，表示 n.副本；复本，也可作动词表示复制。",
    related: ["double"]
  },
  enlightening: {
    splitText: "enlighten | -ing",
    body:
      "light 表示光；enlighten 是“给头脑照进光”，即启发、开导。加 -ing 后，enlightening 表示 adj.有启发作用的；使人领悟的。",
    related: ["light", "enlighten"]
  },
  enlistment: {
    splitText: "enlist | -ment",
    body:
      "enlist 表示征募、入伍；-ment 是名词后缀。enlistment 就是征募或服役这件事本身，表示 n.征募；服役期限。",
    related: ["enlist"]
  },
  evoke: {
    splitText: "e- | voke",
    body:
      "voke 作词根可理解为“呼喊”；e-/ex- 表示向外。把情绪、记忆从心里“呼喊出来”，就是 evoke，即 v.唤起；引起。",
    related: ["provoke"]
  },
  grip: {
    splitText: null,
    body:
      "grip 可谐音联想到 grape“葡萄”：一只手紧紧攥住葡萄，汁液被挤出来。抓住“紧紧攥住”的画面，记住 grip 表示 n.紧握；柄；v.紧握。",
  },
  haven: {
    splitText: "have | n",
    body:
      "have 表示拥有；n 可谐音为“你”。“有你”的地方让人安心，像能躲风避险的港湾，由此记住 haven 表示 n.港；避难所。",
    related: ["have"]
  },
  humbly: {
    splitText: "humble | -ly",
    body:
      "humble 表示谦逊的、地位低下的；-ly 是副词后缀。humbly 就表示以谦逊的方式，即 adv.谦逊地；卑贱地。",
    related: ["humble"]
  },
  illuminate: {
    splitText: "lumin | -ate",
    body:
      "lumin 表示光；-ate 可作动词后缀。让光照到某处就是 illuminate 的本义“照明”，引申为把道理讲清楚、使人明白，即 v.照明；阐明。",
    related: ["light", "illumination"]
  },
  improvement: {
    splitText: "improve | -ment",
    body:
      "improve 表示改进、改善；-ment 是名词后缀。improvement 就是改善这件事或改善后的结果，表示 n.进步；改善。",
    related: ["improve"]
  },
  indignation: {
    splitText: "indignant | -ion",
    body:
      "indignant 表示愤怒的、愤慨的；去掉 -ant，加上 -ion 名词后缀，得到 indignation，表示 n.愤怒；愤慨。",
    related: ["indignant"]
  },
  intensify: {
    splitText: "intense | -ify",
    body:
      "intense 表示强烈的；去掉末尾 -e，加上 -ify 动词后缀，表示“使变得……”。因此 intensify 表示 v.加强；强化；加剧。",
    related: ["intense"]
  },
  malice: {
    splitText: null,
    body:
      "mal- 常带有“坏、恶”的感觉；malice 就是心里带着坏意、想伤害别人的念头。由此记住 malice 表示 n.恶意；蓄意害人。",
    related: ["malicious"]
  },
  monarch: {
    splitText: "monarchy | -y",
    body:
      "monarchy 表示君主制；去掉末尾 -y，monarch 指君主制中的核心人物，即 n.帝王；君主；统治者。",
    related: ["monarchy"]
  },
  nitiate: {
    splitText: null,
    body:
      "这条先按当前词库释义来记：把 nitiate 和“躲避、回避”的场景绑定，遇到压力或危险时往后退、绕开问题，由此记住 n.逃避。",
  },
  occasionally: {
    splitText: "occasion | -al | -ly",
    body:
      "occasion 表示场合、时刻；-al 构成形容词，-ly 构成副词。不是经常发生，只是在某些时刻发生，就是 occasionally，即 adv.有时候；偶尔。",
    related: ["occasion"]
  },
  petitioner: {
    splitText: "petition | -er",
    body:
      "petition 表示请愿、正式请求；-er 表示人。发起请愿或提出正式请求的人就是 petitioner，即 n.请愿人；诉愿人。",
    related: ["petition"]
  },
  resultant: {
    splitText: "result | -ant",
    body:
      "result 表示结果；-ant 可构成形容词或名词。由某事产生出来的、作为结果存在的，就是 resultant，表示 adj.结果的；合成的。",
    related: ["result"]
  },
  sadness: {
    splitText: "sad | -ness",
    body:
      "sad 表示悲伤的；-ness 是名词后缀，表示状态或性质。sadness 就是悲伤这种状态，即 n.悲哀；悲伤。",
    related: ["sad"]
  },
  sniff: {
    splitText: null,
    body:
      "sniff 的发音像用鼻子短促吸气的声音。想象为了闻清气味，靠近物体用鼻子“吸、嗅”一下，由此记住 sniff 表示 v.以鼻吸气；嗅。",
  },
  statute: {
    splitText: "stat | -ute",
    body:
      "statute 可以和 state“国家、政府”一起记：由国家机关正式立下来的规则就是法令、成文法。由此记住 statute 表示 n.法令；成文法律。",
    related: ["state"]
  },
  sturdy: {
    splitText: "sturd | -y",
    body:
      "sturdy 可以谐音联想到“石墩”：石墩厚实、结实、不容易倒。抓住这个画面，记住 sturdy 表示 adj.强健的；坚固的。",
  },
  trader: {
    splitText: "trade | -er",
    body:
      "trade 表示贸易、交易；-er 表示人。做交易、经商的人就是 trader，即 n.商人；商船。",
    related: ["trade"]
  },
  tread: {
    splitText: null,
    body:
      "tread 可谐音联想到“踹的”：脚踩到地面或物体上，就是 tread 的核心动作。由此记住 tread 表示 v.踏；踩；n.步态。",
  },
  trustfully: {
    splitText: "trustful | -ly",
    body:
      "trust 表示信任；trustful 表示充满信任的；-ly 是副词后缀。trustfully 就是以信任的方式，表示 adv.充满信任地。",
    related: ["trust"]
  },
  uphold: {
    splitText: "up | hold",
    body:
      "up 表示向上；hold 表示托住、保持。向上托住不让它倒下，就是 uphold 的本义“支撑”；引申为支持、维护，表示 v.支撑；赞成。",
    related: ["up", "hold"]
  },
  wildlife: {
    splitText: "wild | life",
    body:
      "wild 表示野生的；life 表示生命。生活在野外、未被驯养的生命合在一起，就是 wildlife，即 n.野生动植物。",
    related: ["wild", "life"]
  }
};

async function main() {
  const actor =
    (await prisma.user.findFirst({
      where: { email: ADMIN_EMAIL, status: "ACTIVE" },
      select: { id: true, email: true, username: true }
    })) ??
    (await prisma.user.findFirst({
      where: { status: "ACTIVE" },
      orderBy: [{ createdAt: "asc" }],
      select: { id: true, email: true, username: true }
    }));
  if (!actor) throw new Error("找不到可用于批量更新的账号。");

  const entries = await prisma.mnemonicEntry.findMany({
    where: { status: { not: MnemonicStatus.ARCHIVED } },
    select: {
      id: true,
      title: true,
      splitText: true,
      contentMarkdown: true,
      targetWord: { select: { word: true, shortMeaningCn: true } }
    },
    orderBy: [{ targetWord: { word: "asc" } }]
  });

  const plans = entries
    .filter((entry) => DUPLICATE_TAKE_YOU_BACK.test(entry.contentMarkdown))
    .map((entry) => buildPlan(entry))
    .filter((plan): plan is Plan => Boolean(plan));

  const missingRepairs = entries
    .filter((entry) => DUPLICATE_TAKE_YOU_BACK.test(entry.contentMarkdown))
    .map((entry) => entry.targetWord.word.toLowerCase())
    .filter((word) => !REPAIRS[word]);

  console.log(`模式：${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor.username} <${actor.email}>`);
  console.log(`重复“带你背”候选：${plans.length} 张`);
  if (missingRepairs.length) console.log(`缺少手工修复模板：${missingRepairs.join(", ")}`);
  for (const plan of plans) {
    console.log(`- ${plan.entry.targetWord.word}: split "${plan.entry.splitText ?? ""}" -> "${plan.nextSplitText ?? ""}"`);
    console.log(indentPreview(plan.nextContentMarkdown));
  }

  if (!APPLY) return;

  const backupPath = await writeBackup(plans);
  console.log(`\n备份：${backupPath}`);

  let updated = 0;
  for (const plan of plans) {
    const contentHtml = await renderMnemonicMarkdown(plan.nextContentMarkdown);
    const plainText = markdownToPlainText(
      [plan.nextSplitText ? `划分：${plan.nextSplitText}` : "", plan.nextContentMarkdown].filter(Boolean).join("\n\n")
    );

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
          plainText
        }
      });
      await syncEntryWikiLinks(plan.entry.id, actor.id, tx as Prisma.TransactionClient);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "MNEMONIC_DUPLICATE_TAKE_YOU_BACK_BATCH_CLEANUP",
          entityType: "MnemonicEntry",
          entityId: plan.entry.id,
          metadataJson: {
            word: plan.entry.targetWord.word,
            previousSplitText: plan.entry.splitText,
            nextSplitText: plan.nextSplitText,
            previousPreview: preview(plan.entry.contentMarkdown),
            nextPreview: preview(plan.nextContentMarkdown)
          }
        }
      });
    });
    updated += 1;
  }

  console.log(`\n已完成：批量清理 ${updated} 张重复“带你背”记忆卡。`);
}

function buildPlan(entry: Entry): Plan | null {
  const repair = REPAIRS[entry.targetWord.word.toLowerCase()];
  if (!repair) return null;
  const nextContentMarkdown = buildCard(repair);
  const nextSplitText = repair.splitText?.trim() || null;

  if (nextContentMarkdown === entry.contentMarkdown && nextSplitText === (entry.splitText?.trim() || null)) return null;
  return { entry, nextSplitText, nextContentMarkdown };
}

function buildCard(repair: Repair) {
  return normalizeBlankLines(
    [
      "带你背：",
      repair.body.trim(),
      repair.related?.length ? ["", "相关单词：", ...repair.related.map((word) => `[[word:${word}]]`)].join("\n") : ""
    ]
      .filter(Boolean)
      .join("\n")
  );
}

function normalizeBlankLines(value: string) {
  return value.replace(/[ \t]+\n/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
}

function indentPreview(markdown: string) {
  return markdown
    .split("\n")
    .slice(0, 8)
    .map((line) => `  ${line}`)
    .join("\n");
}

function preview(markdown: string) {
  return markdown.replace(/\s+/gu, " ").slice(0, 240);
}

async function writeBackup(plans: Plan[]) {
  const backupDir = path.join(process.cwd(), "tmp", "backups");
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const backupPath = path.join(backupDir, `mnemonic-duplicate-take-you-back-${stamp}.json`);
  await fs.writeFile(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        count: plans.length,
        entries: plans.map((plan) => ({
          id: plan.entry.id,
          word: plan.entry.targetWord.word,
          title: plan.entry.title,
          splitText: plan.entry.splitText,
          contentMarkdown: plan.entry.contentMarkdown,
          nextSplitText: plan.nextSplitText,
          nextContentMarkdown: plan.nextContentMarkdown
        }))
      },
      null,
      2
    )
  );
  return backupPath;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
