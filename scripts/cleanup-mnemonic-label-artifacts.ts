import fs from "node:fs/promises";
import path from "node:path";
import { MnemonicStatus } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { markdownToPlainText, renderMnemonicMarkdown } from "../src/lib/wiki-links/renderer";
import { syncEntryWikiLinks } from "../src/lib/wiki-links/resolve";

const APPLY = process.argv.includes("--apply");
const LABEL_LINE = /^\s*(?:音标|释义|样义|原义)[:：]/u;
const TAKE_YOU_BACK = /^\s*[带帶帯]你背[：:；;]?\s*/u;
const EXAMPLE_HEADING = /^例句[:：]\s*$/u;
const INLINE_EXAMPLE = /^例句[:：]/u;
const RELATED_HEADING = /^相关单词[:：]\s*$/u;
const WIKI_WORD = /\[\[word:([^\]|]+)(?:\|[^\]]+)?\]\]/giu;

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

type Plan = {
  entry: Entry;
  nextContentMarkdown: string;
  reason: string;
};

const MANUAL_REPAIRS: Record<string, { body: string; related?: string[] }> = {
  cemetery: {
    body:
      "cemetery 的核心义是「墓地；公墓」。可以把它和“集中安放逝者的地方”绑定记忆，重点抓住 n.墓地；公墓 这个含义。"
  },
  counselor: {
    body:
      "counsel 表示劝告、建议；-or 表示人。能够给人建议、提供劝告的人就是 counselor，即 n.顾问；参事。",
    related: ["counsel"]
  },
  desolation: {
    body:
      "desolate 表示荒凉的、荒废的；去掉末尾 -e，加上 -ion 名词后缀，就得到表示状态的 desolation，即 n.荒芜；荒废；孤寂。",
    related: ["desolate"]
  },
  flask: {
    body:
      "flask 可以和实验室里细颈、可加热的瓶状容器绑定记忆。看到 flask，联想到能盛放液体并用于实验的瓶子，即 n.细颈瓶；烧瓶。"
  },
  folio: {
    body:
      "folio 和书页、对开本绑定记忆。把它想成一本能合拢、能翻开的书册或纸页，由此记住 n.对开纸；页码。",
    related: ["fold"]
  },
  gland: {
    body:
      "gland 指身体里负责分泌的组织。把它和汗腺、唾液腺这类“会分泌东西的部位”绑定，记住 n.腺。",
  },
  glare: {
    body:
      "glare 可以和刺眼强光绑定：强光照过来，人会本能地眯眼甚至瞪眼。由此记住 glare 表示 n.刺眼光；v.发强光；怒目而视。"
  },
  illumination: {
    body:
      "illuminate 表示照亮、阐明；去掉末尾 -e，加上 -ion 名词后缀，illumination 表示 n.照明；阐明；启发。",
    related: ["illuminate"]
  },
  jargon: {
    body:
      "jargon 可谐音联想到“扎根”：只有在某个行业里扎根很久，才会熟悉这个行业的专门说法。故 jargon 表示 n.专门术语；行话。"
  },
  lofty: {
    body:
      "loft 表示阁楼，通常在高处；加上 -y 形容词后缀，lofty 先记作 adj.高耸的，再引申为崇高的、高傲的。",
    related: ["loft"]
  },
  mediation: {
    body:
      "mediate 表示调解、调停；加上 -ion 名词后缀，mediation 就是调解这件事本身，即 n.调停；调解。",
    related: ["mediate"]
  },
  midst: {
    body:
      "mid 表示中间；midst 保留“在中间”的核心义，用来表示 n.中部，中间，当中。"
  },
  naivety: {
    body:
      "naive 表示天真的、幼稚的；加上 -ty 名词后缀，naivety 表示这种状态或表现，即 n.天真；幼稚。",
    related: ["naive"]
  },
  nickname: {
    body:
      "name 是名字；nickname 可以理解为正式名字之外额外贴上的称呼。由此记住 n.绰号；昵称，也可作动词表示给……起绰号。",
    related: ["name"]
  },
  orchestra: {
    body:
      "orchestra 和“很多乐器一起演奏”的场景绑定：弦乐、管乐、打击乐组合成一个整体，就是 n.管弦乐队。"
  },
  pact: {
    body:
      "pact 中的 act 可联想到行动；p(a) 可谐音为“怕”。因为怕别人乱行动，所以要签订协议来约束行动。故 pact 表示 n.契约；条约；协定。",
    related: ["act"]
  },
  revival: {
    body:
      "revive 表示复活、复兴；加上 -al 名词后缀，revival 表示复兴、复活这件事，即 n.复兴；复活。",
    related: ["revive"]
  },
  rotation: {
    body:
      "rotate 表示旋转；加上 -ion 名词后缀，rotation 表示旋转、循环或轮流，即 n.旋转；循环。",
    related: ["rotate"]
  },
  tan: {
    body:
      "tan 和太阳晒后的黄褐色皮肤绑定记忆。它可作名词表示黄褐色，也可作动词表示晒成棕褐色。"
  },
  tempo: {
    body:
      "tem 可联想到 time 时间，po 可谐音为“跑”。时间跑动、流动的快慢就是节奏和速度，故 tempo 表示 n.速度；节奏。",
    related: ["time"]
  },
  tile: {
    body:
      "tile 和地面、墙面上一块块铺好的瓷砖绑定记忆。作名词表示砖瓦、瓷砖；作动词表示铺砖。"
  },
  tranquil: {
    body:
      "tran 可联想到 trans，表示转变；quil 可联想到 quiet 安静的。转入安静状态，由此记住 tranquil 表示 adj.安静的，平静的。",
    related: ["quiet"]
  },
  unsinkable: {
    body:
      "un- 表示不；sink 表示下沉；-able 表示能够……的。三部分合起来，unsinkable 就是 adj.不会下沉的。",
    related: ["sink"]
  },
  veil: {
    body:
      "veil 和遮住脸的面纱绑定记忆。由“面纱遮住脸”延伸到抽象的遮盖、掩饰，记住 n.面纱；遮盖物；v.遮盖；掩饰。"
  },
  worse: {
    body:
      "worse 是 bad/badly 的比较级之一，核心就是“比原来更坏、更糟”。先抓住比较含义，再根据句子判断是 adj.更坏的 还是 adv.更糟地。",
    related: ["bad"]
  }
};

async function main() {
  const actor =
    (await prisma.user.findFirst({
      where: { email: "maoshangjian2021@163.com", status: "ACTIVE" },
      select: { id: true, username: true, email: true }
    })) ??
    (await prisma.user.findFirst({
      where: { role: "ADMIN", status: "ACTIVE" },
      select: { id: true, username: true, email: true }
    }));
  if (!actor) throw new Error("找不到管理员账号。");

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
    .map((entry) => planCleanup(entry))
    .filter((plan): plan is Plan => plan !== null && plan.nextContentMarkdown !== plan.entry.contentMarkdown);

  console.log(`模式：${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`执行账号：${actor.username} <${actor.email}>`);
  console.log(`将清理音标/释义残留记忆卡：${plans.length} 张`);
  for (const plan of plans) {
    console.log(`- ${plan.entry.targetWord.word}: ${plan.reason}`);
    console.log(indentPreview(plan.nextContentMarkdown));
  }

  if (!APPLY) return;

  const backupPath = await writeBackup(plans);
  console.log(`\n备份：${backupPath}`);

  let updated = 0;
  for (const plan of plans) {
    const contentHtml = await renderMnemonicMarkdown(plan.nextContentMarkdown);
    const plainText = markdownToPlainText(
      [plan.entry.splitText ? `划分：${plan.entry.splitText}` : "", plan.nextContentMarkdown].filter(Boolean).join("\n\n")
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
          contentMarkdown: plan.nextContentMarkdown,
          contentHtml,
          plainText
        }
      });
      await syncEntryWikiLinks(plan.entry.id, actor.id, tx);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "MNEMONIC_LABEL_ARTIFACT_CLEANUP",
          entityType: "MnemonicEntry",
          entityId: plan.entry.id,
          metadataJson: {
            word: plan.entry.targetWord.word,
            reason: plan.reason
          }
        }
      });
    });
    updated += 1;
  }

  console.log(`\n已完成：清理 ${updated} 张记忆卡。`);
}

function planCleanup(entry: Entry): Plan | null {
  const repair = MANUAL_REPAIRS[entry.targetWord.word.toLowerCase()];
  const lines = entry.contentMarkdown.replace(/\r\n?/gu, "\n").split("\n");
  const foreignPlan = stripEmbeddedForeignCards(lines, entry.targetWord.word);
  const withoutForeign = foreignPlan.lines;
  const hasLabel = withoutForeign.some((line) => LABEL_LINE.test(line));

  if (!hasLabel && foreignPlan.removed) {
    const foreignCleaned = normalizeAndStripLinks(withoutForeign.join("\n"));
    return {
      entry,
      nextContentMarkdown: foreignCleaned,
      reason: "删除混入的其他单词卡片"
    };
  }

  if (!hasLabel) return null;

  if (!repair) return null;

  const nextContentMarkdown = repair
    ? buildManualCard(repair)
    : buildManualCard({ body: `${entry.targetWord.word} 的核心义是「${entry.targetWord.shortMeaningCn ?? "释义待补"}」。` });

  return {
    entry,
    nextContentMarkdown,
    reason: repair ? "重写被 OCR 音标/释义污染的卡片" : "替换为干净基础卡片"
  };
}

function stripEmbeddedForeignCards(lines: string[], targetWord: string) {
  const kept: string[] = [];
  let cursor = 0;
  let removed = false;
  while (cursor < lines.length) {
    if (isForeignWordHeader(lines, cursor, targetWord)) {
      const end = findNextStandaloneExample(lines, cursor + 1);
      cursor = end >= 0 ? end : cursor + 1;
      removed = true;
      continue;
    }
    kept.push(lines[cursor]);
    cursor += 1;
  }
  return { lines: kept, removed };
}

function isForeignWordHeader(lines: string[], index: number, targetWord: string) {
  const value = lines[index].trim();
  if (!/^[A-Za-z][A-Za-z()' -]{0,32}$/u.test(value)) return false;
  if (value.toLowerCase() === targetWord.toLowerCase()) return false;

  const lookahead = lines.slice(index + 1, index + 4).join("\n");
  return LABEL_LINE.test(lookahead);
}

function findNextStandaloneExample(lines: string[], start: number) {
  for (let index = start; index < lines.length; index += 1) {
    if (EXAMPLE_HEADING.test(lines[index].trim())) return index;
  }
  return -1;
}

function normalizeAndStripLinks(markdown: string) {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const relatedIndex = lines.findIndex((line) => RELATED_HEADING.test(line.trim()));
  if (relatedIndex < 0) return normalizeBlankLines(lines.join("\n"));

  const body = lines.slice(0, relatedIndex).join("\n");
  const bodyText = body.toLowerCase();
  const links = lines
    .slice(relatedIndex + 1)
    .map((line) => {
      WIKI_WORD.lastIndex = 0;
      const match = WIKI_WORD.exec(line);
      return match?.[1]?.trim();
    })
    .filter((word): word is string => Boolean(word))
    .filter((word, index, words) => words.indexOf(word) === index)
    .filter((word) => bodyText.includes(word.toLowerCase()));

  if (!links.length) return normalizeBlankLines(body);
  return normalizeBlankLines(`${body}\n\n相关单词：\n${links.map((word) => `[[word:${word}]]`).join("\n")}`);
}

function buildManualCard(repair: { body: string; related?: string[] }) {
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
  return value
    .split("\n")
    .map((line) => (INLINE_EXAMPLE.test(line.trim()) ? "" : line))
    .join("\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function indentPreview(markdown: string) {
  return markdown
    .split("\n")
    .slice(0, 8)
    .map((line) => `  ${line}`)
    .join("\n");
}

async function writeBackup(plans: Plan[]) {
  const backupDir = path.join(process.cwd(), "tmp", "backups");
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const backupPath = path.join(backupDir, `mnemonic-label-artifacts-${stamp}.json`);
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
          reason: plan.reason
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
