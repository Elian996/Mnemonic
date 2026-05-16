import { PrismaClient, LevelTag, MemoryNodeType, MnemonicSourceType, MnemonicStatus, UserRole, WordStatus } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { renderMnemonicMarkdown, markdownToPlainText } from "../src/lib/wiki-links/renderer";
import { syncEntryWikiLinks, ensureWordNode } from "../src/lib/wiki-links/resolve";
import { nodeSlug, slugify } from "../src/lib/slug";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword("password123");
  const users = await Promise.all(
    [
      ["admin@example.com", "admin", "管理员", UserRole.ADMIN],
      ["editor@example.com", "editor", "内容编辑", UserRole.EDITOR],
      ["reviewer@example.com", "reviewer", "审核员", UserRole.REVIEWER],
      ["user@example.com", "learner", "学习者", UserRole.USER]
    ].map(([email, username, displayName, role]) =>
      prisma.user.upsert({
        where: { email: email as string },
        update: { passwordHash, role: role as UserRole },
        create: { email: email as string, username: username as string, displayName: displayName as string, passwordHash, role: role as UserRole }
      })
    )
  );
  const [admin, editor, reviewer, learner] = users;

  const wordRows = [
    ["sophisticated", "adj.", "老于世故的；精密的；复杂的；高级的；高雅的", "复杂的；老练的；高级的", ["CET6", "TOEFL"], 1200, 5],
    ["philosophy", "n.", "哲学；人生观", "哲学", ["CET4", "CET6"], 1600, 4],
    ["sophistry", "n.", "诡辩；似是而非的推理", "诡辩", ["TOEFL"], 6800, 5],
    ["philosopher", "n.", "哲学家", "哲学家", ["CET4"], 2400, 3],
    ["dispute", "v./n.", "争论，争执；对……表示异议", "争论；异议", ["CET4", "CET6"], 1450, 4],
    ["put", "v.", "放；摆；使处于", "放；摆", ["PRIMARY", "MIDDLE_SCHOOL"], 90, 1],
    ["compute", "v.", "计算；估算", "计算", ["CET4"], 2200, 3],
    ["reputation", "n.", "名声；声誉", "声誉", ["CET4", "CET6"], 1800, 3],
    ["repute", "n./v.", "名声；认为", "名声；认为", ["CET6"], 6200, 4],
    ["act", "v./n.", "行动；表演；行为", "行动；行为", ["PRIMARY"], 180, 1],
    ["active", "adj.", "积极的；活跃的", "积极的", ["MIDDLE_SCHOOL"], 360, 2],
    ["action", "n.", "行动；动作", "行动", ["MIDDLE_SCHOOL"], 420, 2],
    ["react", "v.", "反应；回应", "反应", ["HIGH_SCHOOL"], 1500, 3],
    ["interaction", "n.", "互动；相互作用", "互动", ["CET4"], 2100, 3],
    ["transport", "v./n.", "运输；交通", "运输", ["HIGH_SCHOOL"], 1200, 3],
    ["import", "v./n.", "进口；导入", "进口；导入", ["CET4"], 1500, 3],
    ["export", "v./n.", "出口；导出", "出口；导出", ["CET4"], 1550, 3],
    ["portable", "adj.", "便携的", "便携的", ["CET4"], 2800, 3],
    ["inspect", "v.", "检查；视察", "检查", ["CET4"], 2400, 3],
    ["respect", "v./n.", "尊重；方面", "尊重", ["MIDDLE_SCHOOL"], 600, 2],
    ["suspect", "v./n.", "怀疑；嫌疑人", "怀疑；嫌疑人", ["CET4"], 1900, 3],
    ["expect", "v.", "期待；预计", "期待；预计", ["MIDDLE_SCHOOL"], 520, 2],
    ["prospect", "n.", "前景；可能性", "前景", ["CET6"], 2600, 4]
  ] as const;

  const words = new Map<string, Awaited<ReturnType<typeof prisma.word.upsert>>>();
  for (const [word, partOfSpeech, meaningCn, shortMeaningCn, levels, rank, difficulty] of wordRows) {
    const saved = await prisma.word.upsert({
      where: { word },
      update: {
        slug: slugify(word),
        partOfSpeech,
        meaningCn,
        meaningEn: "",
        shortMeaningCn,
        levelTags: Array.from(levels) as LevelTag[],
        frequencyRank: rank,
        difficulty,
        status: ["sophisticated", "philosophy", "dispute"].includes(word) ? WordStatus.PUBLISHED : WordStatus.EMPTY
      },
      create: {
        word,
        slug: slugify(word),
        phoneticUk: "",
        phoneticUs: "",
        partOfSpeech,
        meaningCn,
        meaningEn: "",
        shortMeaningCn,
        levelTags: Array.from(levels) as LevelTag[],
        frequencyRank: rank,
        difficulty,
        status: ["sophisticated", "philosophy", "dispute"].includes(word) ? WordStatus.PUBLISHED : WordStatus.EMPTY
      }
    });
    words.set(word, saved);
    await ensureWordNode(saved.id);
  }

  const seedNodes = [
    [MemoryNodeType.ROOT, "soph", "智慧，聪明"],
    [MemoryNodeType.PREFIX, "dis-", "否定、相反、不同"],
    [MemoryNodeType.BLOCK, "put", "放、摆"],
    [MemoryNodeType.BLOCK, "pute", "思考、计算的记忆块"],
    [MemoryNodeType.ROOT, "act", "行动、做"],
    [MemoryNodeType.ROOT, "port", "携带、运输"],
    [MemoryNodeType.ROOT, "spect", "看"]
  ] as const;
  for (const [type, value, meaningCn] of seedNodes) {
    await prisma.memoryNode.upsert({
      where: { type_slug: { type, slug: nodeSlug(value) } },
      update: { displayName: value, meaningCn },
      create: { type, value, slug: nodeSlug(value), displayName: value, meaningCn }
    });
  }

  await official("philosophy", "philosophy 官方助记", "phil | soph | y", `划分：phil | soph | y

philo 可以联想到“爱”，[[root:soph]] 可以联想到“智慧、聪明”。

所以 [[word:philosophy]] 可以理解为“爱智慧”，也就是哲学。

记住 philosophy 后，可以向后连接：
[[root:soph]]
[[word:sophisticated]]
[[word:sophistry]]
[[word:philosopher]]`);

  await official("sophisticated", "sophisticated 官方助记", "soph | istic | ate | ed", `划分：soph | istic | ate | ed

先通过 [[word:philosophy]] 记住 [[root:soph]] 这个记忆块。

[[word:philosophy]] 可以理解为“爱智慧”，因此 [[root:soph]] 可以联想到“智慧、聪明”。

[[word:sophisticated]] 可以理解为需要智慧、经验和见识才能处理的状态：

1. 复杂的、精密的；
2. 老练的、世故的；
3. 高级的、高雅的。

所以 sophisticated 可以用于描述：
复杂精密的系统；
见过世面的人；
高级讲究的场合。

记忆链：
[[word:philosophy]] → [[root:soph]] → [[word:sophisticated]]

Example sentence:
USPS has sophisticated emergency plans for natural disasters.
美国邮政署有应对自然灾害的复杂应急预案。`);

  await official("dispute", "dispute 官方助记", "dis | put | e", `划分：dis | put | e

先用已经熟悉的 [[word:put]] 做锚点。put 可以联想到“放、摆”。

[[prefix:dis-]] 可以表示否定、相反、不同。

dis + put 可以联想为“把不同意见摆出来”。

两个人把不同意见摆到桌面上，就是争论、争执、提出异议。

所以：
dispute = v. 争论，争执；对……表示异议
dispute = n. 争论

记住 dispute 后，可以顺带强化：
[[prefix:dis-]]
[[block:put]]
[[block:pute]]

后续可以继续带：
[[word:compute]]
[[word:reputation]]
[[word:repute]]`);

  await userSubmission("dispute", learner.id, "把观点摆出来", `我把 [[prefix:dis-]] 理解成“分开”，把 [[block:put]] 理解成“摆”。

dispute 就是把不同观点分开摆出来，于是开始争论。`);

  await chain("soph 记忆链", "soph-memory-chain", "从 philosophy 锚定 soph，再连接高阶词。", ["philosophy", "soph", "sophisticated", "sophistry"], [MemoryNodeType.WORD, MemoryNodeType.ROOT, MemoryNodeType.WORD, MemoryNodeType.WORD]);
  await chain("dis/put 记忆链", "dis-put-memory-chain", "围绕 put / pute 展开争论、计算、声誉。", ["put", "dispute", "compute", "reputation"], [MemoryNodeType.WORD, MemoryNodeType.WORD, MemoryNodeType.WORD, MemoryNodeType.WORD]);
  await chain("act 记忆链", "act-memory-chain", "act 到 interaction 的行动扩展。", ["act", "active", "action", "react", "interaction"], [MemoryNodeType.WORD, MemoryNodeType.WORD, MemoryNodeType.WORD, MemoryNodeType.WORD, MemoryNodeType.WORD]);
  await chain("spect 记忆链", "spect-memory-chain", "围绕 spect 的“看”。", ["inspect", "respect", "suspect", "expect", "prospect"], [MemoryNodeType.WORD, MemoryNodeType.WORD, MemoryNodeType.WORD, MemoryNodeType.WORD, MemoryNodeType.WORD]);

  const reviewWord = words.get("sophisticated")!;
  const existingCard = await prisma.reviewCard.findFirst({
    where: { userId: learner.id, wordId: reviewWord.id, mnemonicEntryId: null }
  });
  if (existingCard) {
    await prisma.reviewCard.update({ where: { id: existingCard.id }, data: { dueAt: new Date() } });
  } else {
    await prisma.reviewCard.create({ data: { userId: learner.id, wordId: reviewWord.id, dueAt: new Date() } });
  }

  console.log("Seed complete");

  async function official(wordKey: string, title: string, splitText: string, contentMarkdown: string) {
    const word = words.get(wordKey)!;
    const contentHtml = await renderMnemonicMarkdown(contentMarkdown);
    const entry = await prisma.mnemonicEntry.upsert({
      where: { id: `${wordKey}-official` },
      update: {
        title,
        splitText,
        contentMarkdown,
        contentHtml,
        plainText: markdownToPlainText(contentMarkdown),
        status: MnemonicStatus.APPROVED,
        isPublic: true,
        isOfficialRecommended: true,
        editorScore: 9
      },
      create: {
        id: `${wordKey}-official`,
        targetWordId: word.id,
        authorId: editor.id,
        sourceType: MnemonicSourceType.OFFICIAL,
        status: MnemonicStatus.APPROVED,
        title,
        splitText,
        contentMarkdown,
        contentHtml,
        plainText: markdownToPlainText(contentMarkdown),
        isPublic: true,
        isOfficialRecommended: true,
        editorScore: 9
      }
    });
    await syncEntryWikiLinks(entry.id, editor.id);
  }

  async function userSubmission(wordKey: string, authorId: string, title: string, contentMarkdown: string) {
    const word = words.get(wordKey)!;
    const contentHtml = await renderMnemonicMarkdown(contentMarkdown);
    const entry = await prisma.mnemonicEntry.upsert({
      where: { id: `${wordKey}-user-public` },
      update: {
        title,
        contentMarkdown,
        contentHtml,
        plainText: markdownToPlainText(contentMarkdown),
        status: MnemonicStatus.APPROVED,
        isPublic: true,
        reviewerId: reviewer.id,
        reviewedAt: new Date(),
        likeCount: 3,
        bookmarkCount: 1,
        editorScore: 7,
        effectivenessScore: 0.8
      },
      create: {
        id: `${wordKey}-user-public`,
        targetWordId: word.id,
        authorId,
        sourceType: MnemonicSourceType.USER_PUBLIC,
        status: MnemonicStatus.APPROVED,
        title,
        contentMarkdown,
        contentHtml,
        plainText: markdownToPlainText(contentMarkdown),
        isPublic: true,
        reviewerId: reviewer.id,
        reviewedAt: new Date(),
        likeCount: 3,
        bookmarkCount: 1,
        editorScore: 7,
        effectivenessScore: 0.8
      }
    });
    await syncEntryWikiLinks(entry.id, authorId);
  }

  async function chain(title: string, slug: string, description: string, values: string[], types: MemoryNodeType[]) {
    const saved = await prisma.memoryChain.upsert({
      where: { slug },
      update: { title, description, status: "PUBLISHED" },
      create: { title, slug, description, status: "PUBLISHED", createdById: admin.id }
    });
    await prisma.memoryChainItem.deleteMany({ where: { chainId: saved.id } });
    for (const [index, value] of values.entries()) {
      const type = types[index];
      const node = await prisma.memoryNode.findUniqueOrThrow({
        where: { type_slug: { type, slug: type === MemoryNodeType.WORD ? slugify(value) : nodeSlug(value) } }
      });
      await prisma.memoryChainItem.create({
        data: { chainId: saved.id, nodeId: node.id, orderIndex: index, note: `${value} 是这条词链的第 ${index + 1} 个记忆点。` }
      });
      if (index > 0) {
        const prev = await prisma.memoryNode.findUniqueOrThrow({
          where: { type_slug: { type: types[index - 1], slug: types[index - 1] === MemoryNodeType.WORD ? slugify(values[index - 1]) : nodeSlug(values[index - 1]) } }
        });
        await prisma.memoryLink.create({
          data: {
            sourceNodeId: prev.id,
            targetNodeId: node.id,
            relationType: "CHAIN",
            anchorText: title,
            description,
            createdById: admin.id
          }
        });
      }
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
