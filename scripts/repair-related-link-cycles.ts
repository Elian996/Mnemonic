import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LevelTag, MemoryNodeType, MnemonicSourceType, MnemonicStatus, RelationType, UserRole } from "@prisma/client";

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

const APPLY = process.argv.includes("--apply");
const reportDir = path.join(process.cwd(), "tmp", "related-link-cycle-repair");
const backupDir = path.join(process.cwd(), "backups");
const adminEmail = process.env.MNEMONIC_REPAIR_ACTOR_EMAIL ?? process.env.MNEMONIC_BACKFILL_ACTOR_EMAIL;

type WordRecord = {
  id: string;
  word: string;
  slug: string;
  frequencyRank: number | null;
  levelTags: LevelTag[];
};

type EntryRecord = {
  id: string;
  title: string;
  splitText: string | null;
  contentMarkdown: string;
  contentHtml: string;
  plainText: string;
  editorNote: string | null;
  sortOrder: number;
  createdAt: Date;
  targetWord: WordRecord;
  links: Array<{ targetNode: { slug: string; displayName: string } }>;
};

type EdgeClassification = {
  sourceSlug: string;
  targetSlug: string;
  decision: "keep" | "archive_source" | "remove_link" | "review";
  reason: string;
  confidence: number;
};

const wordLinkPattern = /\[\[\s*word\s*:\s*([^|\]\s]+)(?:\|[^\]]+)?\]\]/giu;
const relatedMarkerPattern = /\n*相关单词[:：]/u;
const bodyStopPattern = /\n*(?:相关单词|词汇扩充|问汇扩充)[:：]/u;

const suffixes = [
  "ability",
  "ibility",
  "ation",
  "ition",
  "tion",
  "sion",
  "ness",
  "less",
  "ment",
  "ship",
  "hood",
  "ance",
  "ence",
  "ancy",
  "ency",
  "ious",
  "ous",
  "ical",
  "ic",
  "ial",
  "al",
  "ive",
  "ative",
  "able",
  "ible",
  "ful",
  "ize",
  "ise",
  "en",
  "er",
  "or",
  "ist",
  "ian",
  "ant",
  "ent",
  "ary",
  "ery",
  "ly",
  "ing",
  "ed",
  "ate",
  "y",
  "s"
].sort((left, right) => right.length - left.length);

const prefixes = ["anti", "counter", "inter", "trans", "under", "over", "super", "sub", "post", "pre", "pro", "non", "dis", "mis", "un", "in", "im", "ir", "il", "re", "co", "com", "con", "bi", "al"];
const hardCycleArchives = new Map([
  ["able->ability", "able 当前卡明确从 ability 反推，保留 ability -> able，归档 able 的反向卡。"],
  ["local->location", "local 当前卡依赖更复杂的 location，保留 locate/location 后续方向，归档 local 的反向卡。"]
]);
const hardCycleLinkRemovals = new Map([
  ["minister->ministry", "minister 只是同族对照，ministry 才应基于 minister，移除 minister -> ministry。"],
  ["neither->nor", "neither/nor 是固定搭配对照，不应互相作为可点击记忆基础。"],
  ["nor->neither", "neither/nor 是固定搭配对照，不应互相作为可点击记忆基础。"],
  ["nobody->somebody", "nobody/somebody/someone 是对照词，不应互相形成记忆依赖闭环。"],
  ["somebody->someone", "nobody/somebody/someone 是对照词，不应互相形成记忆依赖闭环。"],
  ["someone->somebody", "nobody/somebody/someone 是对照词，不应互相形成记忆依赖闭环。"],
  ["someone->nobody", "nobody/somebody/someone 是对照词，不应互相形成记忆依赖闭环。"],
  ["predict->dictate", "predict 卡只是举 dict 词根例词，dictate 可基于 predict，反向链接移除。"],
  ["predict->dictation", "predict 卡只是举 dict 词根例词，dictation 可基于 predict，反向链接移除。"]
]);

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { markdownToPlainText, renderMnemonicMarkdown } = await import("../src/lib/wiki-links/renderer");
  const { syncEntryWikiLinks } = await import("../src/lib/wiki-links/resolve");

  try {
    await fs.mkdir(reportDir, { recursive: true });

    const entries = await prisma.mnemonicEntry.findMany({
      where: {
        sourceType: MnemonicSourceType.OFFICIAL,
        status: { not: MnemonicStatus.ARCHIVED }
      },
      select: {
        id: true,
        title: true,
        splitText: true,
        contentMarkdown: true,
        contentHtml: true,
        plainText: true,
        editorNote: true,
        sortOrder: true,
        createdAt: true,
        targetWord: {
          select: {
            id: true,
            word: true,
            slug: true,
            frequencyRank: true,
            levelTags: true
          }
        },
        links: {
          where: {
            relationType: RelationType.WIKI_LINK,
            targetNode: { type: MemoryNodeType.WORD }
          },
          select: {
            targetNode: {
              select: {
                slug: true,
                displayName: true
              }
            }
          }
        }
      },
      orderBy: [{ targetWord: { word: "asc" } }, { sortOrder: "asc" }, { createdAt: "asc" }]
    });

    const entryBySlug = new Map(entries.map((entry) => [entry.targetWord.slug, entry]));
    const graph = buildGraph(entries, entryBySlug);
    const cyclicComponentsBefore = findCyclicComponents(graph);
    const classifications = classifyCycleEdges(cyclicComponentsBefore, graph, entryBySlug);
    const archiveSlugs = new Set(
      classifications.filter((item) => item.decision === "archive_source").map((item) => item.sourceSlug)
    );
    const removeLinkPlans = classifications
      .filter((item) => item.decision === "remove_link" && !archiveSlugs.has(item.sourceSlug))
      .map((item) => item);
    const reviewItems = classifications.filter((item) => item.decision === "review");

    const runId = timestamp();
    const reportPath = path.join(reportDir, `${runId}-${APPLY ? "apply" : "dry-run"}.json`);
    let backupPath: string | null = null;

    if (APPLY && (archiveSlugs.size || removeLinkPlans.length)) {
      const actor =
        (adminEmail
          ? await prisma.user.findFirst({
              where: { email: adminEmail, status: "ACTIVE" },
              select: { id: true, email: true, username: true }
            })
          : null) ??
        (await prisma.user.findFirst({
          where: { OR: [{ role: UserRole.ADMIN }, { role: UserRole.EDITOR }], status: "ACTIVE" },
          orderBy: [{ createdAt: "asc" }],
          select: { id: true, email: true, username: true }
        }));
      if (!actor) throw new Error("找不到可用于批量修复的管理员/编辑账号。");

      const touchedSlugs = new Set([...archiveSlugs, ...removeLinkPlans.map((plan) => plan.sourceSlug)]);
      const touchedEntries = [...touchedSlugs].map((slug) => entryBySlug.get(slug)).filter((entry): entry is EntryRecord => Boolean(entry));
      await fs.mkdir(backupDir, { recursive: true });
      backupPath = path.join(backupDir, `related-link-cycles-${runId}.json`);
      await fs.writeFile(
        backupPath,
        `${JSON.stringify(
          {
            createdAt: new Date().toISOString(),
            rule: "Break mnemonic related-word dependency cycles while preserving the base-word direction.",
            entries: touchedEntries.map((entry) => ({
              entryId: entry.id,
              word: entry.targetWord.word,
              slug: entry.targetWord.slug,
              title: entry.title,
              splitText: entry.splitText,
              editorNote: entry.editorNote,
              sortOrder: entry.sortOrder,
              contentMarkdown: entry.contentMarkdown,
              contentHtml: entry.contentHtml,
              plainText: entry.plainText
            })),
            classifications: classifications.filter((item) => touchedSlugs.has(item.sourceSlug))
          },
          null,
          2
        )}\n`
      );

      const removeTargetsBySource = groupBy(removeLinkPlans, (plan) => plan.sourceSlug);

      for (const slug of archiveSlugs) {
        const entry = entryBySlug.get(slug);
        if (!entry) continue;
        await prisma.$transaction(async (tx) => {
          await tx.mnemonicEntryVersion.create({
            data: {
              mnemonicEntryId: entry.id,
              contentMarkdown: entry.contentMarkdown,
              splitText: entry.splitText,
              title: entry.title,
              editorId: actor.id
            }
          });
          await tx.mnemonicEntry.update({
            where: { id: entry.id },
            data: {
              status: MnemonicStatus.ARCHIVED,
              isOfficialRecommended: false,
              isPublic: false
            }
          });
          await tx.memoryLink.deleteMany({
            where: { sourceMnemonicEntryId: entry.id, relationType: RelationType.WIKI_LINK }
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              action: "MNEMONIC_RELATED_CYCLE_ARCHIVE",
              entityType: "MnemonicEntry",
              entityId: entry.id,
              metadataJson: {
                word: entry.targetWord.word,
                slug,
                reason: classifications.filter((item) => item.sourceSlug === slug && item.decision === "archive_source")
              }
            }
          });
        });
      }

      for (const [slug, plans] of removeTargetsBySource) {
        if (archiveSlugs.has(slug)) continue;
        const entry = entryBySlug.get(slug);
        if (!entry) continue;
        const targets = new Set(plans.map((plan) => plan.targetSlug));
        const relatedWords = extractRelatedWords(entry.contentMarkdown).filter((word) => !targets.has(word));
        const contentMarkdown = withRelatedWordBlock(entry.contentMarkdown, relatedWords);
        const contentHtml = await renderMnemonicMarkdown(contentMarkdown);
        const plainText = markdownToPlainText(contentMarkdown);

        await prisma.$transaction(async (tx) => {
          await tx.mnemonicEntryVersion.create({
            data: {
              mnemonicEntryId: entry.id,
              contentMarkdown: entry.contentMarkdown,
              splitText: entry.splitText,
              title: entry.title,
              editorId: actor.id
            }
          });
          await tx.mnemonicEntry.update({
            where: { id: entry.id },
            data: { contentMarkdown, contentHtml, plainText }
          });
          await syncEntryWikiLinks(entry.id, actor.id, tx);
          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              action: "MNEMONIC_RELATED_CYCLE_LINK_CLEANUP",
              entityType: "MnemonicEntry",
              entityId: entry.id,
              metadataJson: {
                word: entry.targetWord.word,
                slug,
                removedRelatedWords: [...targets],
                reason: plans
              }
            }
          });
        });
      }
    }

    const simulatedGraph = simulateGraph(graph, archiveSlugs, removeLinkPlans);
    const cyclicComponentsAfter = findCyclicComponents(simulatedGraph);
    const report = {
      runId,
      mode: APPLY ? "apply" : "dry-run",
      generatedAt: new Date().toISOString(),
      scannedEntries: entries.length,
      cyclicComponentsBefore: cyclicComponentsBefore.length,
      cyclicComponentsAfter: cyclicComponentsAfter.length,
      archiveEntryCount: archiveSlugs.size,
      removeLinkEntryCount: new Set(removeLinkPlans.map((plan) => plan.sourceSlug)).size,
      removeLinkCount: removeLinkPlans.length,
      reviewCount: reviewItems.length,
      backupPath,
      archiveEntries: [...archiveSlugs].map((slug) => entrySummary(entryBySlug.get(slug), classifications)),
      removeLinks: removeLinkPlans.map((plan) => ({ ...plan, word: entryBySlug.get(plan.sourceSlug)?.targetWord.word ?? plan.sourceSlug })),
      reviewItems,
      remainingCyclicComponents: cyclicComponentsAfter.map((component) => component.sort())
    };

    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await fs.writeFile(path.join(reportDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);

    console.log(
      JSON.stringify(
        {
          mode: report.mode,
          scannedEntries: report.scannedEntries,
          cyclicComponentsBefore: report.cyclicComponentsBefore,
          cyclicComponentsAfter: report.cyclicComponentsAfter,
          archiveEntryCount: report.archiveEntryCount,
          removeLinkEntryCount: report.removeLinkEntryCount,
          removeLinkCount: report.removeLinkCount,
          reviewCount: report.reviewCount,
          reportPath,
          backupPath,
          archiveSample: report.archiveEntries.slice(0, 20).map((item) => ({
            word: item?.word,
            slug: item?.slug,
            reasons: item?.reasons.slice(0, 2)
          })),
          removeLinkSample: report.removeLinks.slice(0, 20),
          remainingSample: report.remainingCyclicComponents.slice(0, 20)
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

function buildGraph(entries: EntryRecord[], entryBySlug: Map<string, EntryRecord>) {
  const graph = new Map<string, Set<string>>();
  for (const entry of entries) {
    const source = entry.targetWord.slug;
    const targets = new Set<string>();
    for (const link of entry.links) {
      const target = link.targetNode.slug;
      if (target !== source && entryBySlug.has(target)) targets.add(target);
    }
    graph.set(source, targets);
  }
  return graph;
}

function classifyCycleEdges(
  components: string[][],
  graph: Map<string, Set<string>>,
  entryBySlug: Map<string, EntryRecord>
) {
  const results: EdgeClassification[] = [];
  for (const component of components) {
    const componentSet = new Set(component);
    for (const sourceSlug of component) {
      const source = entryBySlug.get(sourceSlug);
      if (!source) continue;
      for (const targetSlug of graph.get(sourceSlug) ?? []) {
        if (!componentSet.has(targetSlug)) continue;
        const target = entryBySlug.get(targetSlug);
        if (!target) continue;
        results.push(classifyEdge(source, target, graph));
      }
    }
  }
  return results;
}

function classifyEdge(source: EntryRecord, target: EntryRecord, graph: Map<string, Set<string>>): EdgeClassification {
  const sourceWord = normalizeWord(source.targetWord.word);
  const targetWord = normalizeWord(target.targetWord.word);
  const sourceSlug = source.targetWord.slug;
  const targetSlug = target.targetWord.slug;
  const sourceDerivedFromTarget = isLikelyDerivedFrom(sourceWord, targetWord);
  const targetDerivedFromSource = isLikelyDerivedFrom(targetWord, sourceWord);
  const targetIsMoreBasic = basicnessScore(target.targetWord) + 1.8 < basicnessScore(source.targetWord);
  const sourceClearlyUsesTarget = hasMemoryDependencyCue(source.contentMarkdown, targetWord);
  const sourceReverseCue = hasReverseRememberingCue(source.contentMarkdown, targetWord);
  const bodyMentionsTarget = memoryBody(source.contentMarkdown).includes(targetWord);
  const isDirectMutual = graph.get(targetSlug)?.has(sourceSlug) ?? false;
  const edgeKey = `${sourceSlug}->${targetSlug}`;

  if (hardCycleArchives.has(edgeKey)) {
    return {
      sourceSlug,
      targetSlug,
      decision: "archive_source",
      reason: hardCycleArchives.get(edgeKey) ?? "人工确认的闭环反向卡，归档当前卡。",
      confidence: 0.96
    };
  }

  if (hardCycleLinkRemovals.has(edgeKey)) {
    return {
      sourceSlug,
      targetSlug,
      decision: "remove_link",
      reason: hardCycleLinkRemovals.get(edgeKey) ?? "人工确认的闭环反向链接，移除该链接。",
      confidence: 0.93
    };
  }

  if (sourceDerivedFromTarget || (targetIsMoreBasic && sourceClearlyUsesTarget && !targetDerivedFromSource)) {
    return {
      sourceSlug,
      targetSlug,
      decision: "keep",
      reason: "当前词自然基于更基础/更熟悉的目标词记忆，方向保留。",
      confidence: sourceDerivedFromTarget ? 0.95 : 0.78
    };
  }

  if (targetDerivedFromSource) {
    return {
      sourceSlug,
      targetSlug,
      decision: sourceClearlyUsesTarget ? "archive_source" : "remove_link",
      reason: sourceClearlyUsesTarget
        ? "目标词看起来是当前词的派生/扩展词，但当前卡正文反向依赖它，归档当前反向卡。"
        : "目标词看起来是当前词的派生/扩展词，且只在相关链接中形成闭环，移除该链接。",
      confidence: sourceClearlyUsesTarget ? 0.94 : 0.86
    };
  }

  if (isDirectMutual && sourceReverseCue) {
    return {
      sourceSlug,
      targetSlug,
      decision: "archive_source",
      reason: "当前卡明确写了在记忆目标词时接触过当前词/目标词已记忆，形成直接互相依赖，归档当前反向卡。",
      confidence: 0.88
    };
  }

  if (isDirectMutual && !bodyMentionsTarget) {
    return {
      sourceSlug,
      targetSlug,
      decision: "remove_link",
      reason: "正文不依赖目标词，只有相关链接形成直接互链，移除该链接。",
      confidence: 0.82
    };
  }

  return {
    sourceSlug,
    targetSlug,
    decision: "review",
    reason: "闭环方向不够确定，保留待人工复核。",
    confidence: 0.5
  };
}

function isLikelyDerivedFrom(word: string, base: string) {
  if (!word || !base || word === base) return false;
  if (base.length >= 4 && word.includes(base) && word.length > base.length) return true;
  if (word === "ability" && base === "able") return true;

  for (const prefix of prefixes) {
    if (word === `${prefix}${base}`) return true;
    if (word.startsWith(prefix) && word.slice(prefix.length) === base) return true;
  }

  for (const suffix of suffixes) {
    if (!word.endsWith(suffix) || word.length <= suffix.length + 1) continue;
    const stem = word.slice(0, -suffix.length);
    const variants = new Set([stem, `${stem}e`, `${stem}y`, stem.replace(/i$/u, "y")]);
    if (stem.length > 1 && stem.at(-1) === stem.at(-2)) variants.add(stem.slice(0, -1));
    if (suffix === "ation" || suffix === "ition" || suffix === "tion" || suffix === "sion") {
      variants.add(`${stem}e`);
      variants.add(`${stem}ate`);
      variants.add(stem.replace(/icat$/u, "ic"));
    }
    if (suffix === "ability") variants.add(`${stem}able`);
    if (suffix === "ibility") variants.add(`${stem}ible`);
    if (suffix === "ily") variants.add(`${stem}y`);
    if (variants.has(base)) return true;
  }

  const irregularPairs = new Set(["bent<-bend", "built<-build", "went<-go", "gone<-go"]);
  return irregularPairs.has(`${word}<-${base}`);
}

function hasMemoryDependencyCue(markdown: string, targetWord: string) {
  const body = memoryBody(markdown);
  const target = escapeRegExp(targetWord);
  const nearTargetPatterns = [
    String.raw`${target}[^。；;\n]{0,60}(?:已经记忆|记忆过|熟悉|接触过|联想到|想到|反推|去掉|来自|同族|交叉记忆)`,
    String.raw`(?:已经记忆|记忆过|熟悉|接触过|联想到|想到|反推|去掉|来自|同族|交叉记忆)[^。；;\n]{0,60}${target}`,
    String.raw`在记忆(?:单词)?\s*${target}[^。；;\n]{0,60}(?:时)?`
  ];
  return nearTargetPatterns.some((pattern) => new RegExp(pattern, "iu").test(body));
}

function hasReverseRememberingCue(markdown: string, targetWord: string) {
  const body = memoryBody(markdown);
  const target = escapeRegExp(targetWord);
  const patterns = [
    String.raw`在记忆(?:单词)?\s*${target}[^。；;\n]{0,80}(?:时)?`,
    String.raw`记忆(?:单词)?\s*${target}[^。；;\n]{0,80}(?:时|采用|提及|接触)`,
    String.raw`${target}[^。；;\n]{0,30}(?:为|是)?(?:已经)?记忆过`,
    String.raw`(?:已经记忆过|记忆过)的?单词\s*${target}`
  ];
  return patterns.some((pattern) => new RegExp(pattern, "iu").test(body));
}

function memoryBody(markdown: string) {
  const marker = markdown.search(bodyStopPattern);
  return (marker === -1 ? markdown : markdown.slice(0, marker))
    .replace(/\[\[[^\]\n]+?\]\]/gu, " ")
    .replace(/\s+/gu, " ")
    .toLowerCase()
    .trim();
}

function basicnessScore(word: WordRecord) {
  const rankScore = word.frequencyRank ? Math.min(word.frequencyRank, 25000) / 2500 : 12;
  const lengthScore = normalizeWord(word.word).length / 3;
  const levelScore = word.levelTags.some((tag) => tag === "LEVEL_2" || tag === "COMPULSORY_EDUCATION")
    ? -2
    : word.levelTags.some((tag) => tag === "LEVEL_3" || tag === "HIGH_SCHOOL")
      ? -1
      : 0;
  return rankScore + lengthScore + levelScore;
}

function findCyclicComponents(graph: Map<string, Set<string>>) {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indexes = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const components: string[][] = [];

  function visit(node: string) {
    indexes.set(node, index);
    lowlinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of graph.get(node) ?? []) {
      if (!indexes.has(next)) {
        visit(next);
        lowlinks.set(node, Math.min(lowlinks.get(node) ?? 0, lowlinks.get(next) ?? 0));
      } else if (onStack.has(next)) {
        lowlinks.set(node, Math.min(lowlinks.get(node) ?? 0, indexes.get(next) ?? 0));
      }
    }

    if (lowlinks.get(node) === indexes.get(node)) {
      const component: string[] = [];
      let current = "";
      do {
        current = stack.pop() ?? "";
        onStack.delete(current);
        if (current) component.push(current);
      } while (current && current !== node);
      if (component.length > 1) components.push(component);
    }
  }

  for (const node of graph.keys()) {
    if (!indexes.has(node)) visit(node);
  }

  return components.sort((left, right) => right.length - left.length || left[0].localeCompare(right[0]));
}

function simulateGraph(graph: Map<string, Set<string>>, archivedSlugs: Set<string>, removeLinkPlans: EdgeClassification[]) {
  const removeKeys = new Set(removeLinkPlans.map((plan) => `${plan.sourceSlug}->${plan.targetSlug}`));
  const nextGraph = new Map<string, Set<string>>();
  for (const [source, targets] of graph) {
    if (archivedSlugs.has(source)) continue;
    const nextTargets = new Set<string>();
    for (const target of targets) {
      if (archivedSlugs.has(target)) continue;
      if (removeKeys.has(`${source}->${target}`)) continue;
      nextTargets.add(target);
    }
    nextGraph.set(source, nextTargets);
  }
  return nextGraph;
}

function extractRelatedWords(markdown: string) {
  const marker = markdown.search(relatedMarkerPattern);
  if (marker === -1) return [];
  return unique(
    Array.from(markdown.slice(marker).matchAll(wordLinkPattern))
      .map((match) => normalizeWord(match[1] ?? ""))
      .filter(Boolean)
  );
}

function withRelatedWordBlock(markdown: string, relatedWords: string[]) {
  const body = stripRelatedWordBlock(markdown).trimEnd();
  const uniqueRelatedWords = unique(relatedWords.map(normalizeWord).filter(Boolean));
  if (!uniqueRelatedWords.length) return body.trim();
  return [body, "相关单词：", ...uniqueRelatedWords.map((word) => `[[word:${word}]]`)].join("\n").trim();
}

function stripRelatedWordBlock(markdown: string) {
  const marker = markdown.search(relatedMarkerPattern);
  if (marker === -1) return markdown;
  return markdown.slice(0, marker);
}

function normalizeWord(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z]+$/gu, "")
    .replace(/[^a-z-]/gu, "");
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function entrySummary(entry: EntryRecord | undefined, classifications: EdgeClassification[]) {
  if (!entry) return null;
  return {
    entryId: entry.id,
    word: entry.targetWord.word,
    slug: entry.targetWord.slug,
    editorNote: entry.editorNote,
    reasons: classifications.filter((item) => item.sourceSlug === entry.targetWord.slug && item.decision === "archive_source")
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    if (process.env[key]) continue;
    process.env[key] = unquote(trimmed.slice(equalsIndex + 1).trim());
  }
}

function unquote(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
