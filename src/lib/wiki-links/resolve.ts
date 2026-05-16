import { MemoryNodeType, Prisma, RelationType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { nodeSlug, slugify } from "@/lib/slug";
import { parseWikiLinks, ParsedWikiLink } from "./parser";

export type ResolvedWikiLink = ParsedWikiLink & {
  nodeId: string;
  nodeType: MemoryNodeType;
  href: string;
  isNew: boolean;
};

type Tx = Prisma.TransactionClient;

export async function ensureWordNode(wordId: string, tx: Tx = prisma) {
  const word = await tx.word.findUniqueOrThrow({ where: { id: wordId } });
  return tx.memoryNode.upsert({
    where: { type_slug: { type: MemoryNodeType.WORD, slug: word.slug } },
    create: {
      type: MemoryNodeType.WORD,
      value: word.word,
      slug: word.slug,
      displayName: word.word,
      meaningCn: word.shortMeaningCn
    },
    update: {
      value: word.word,
      displayName: word.word,
      meaningCn: word.shortMeaningCn
    }
  });
}

export async function resolveWikiLink(link: ParsedWikiLink, tx: Tx = prisma): Promise<ResolvedWikiLink> {
  let nodeType = link.nodeType;
  let slug = nodeSlug(link.target);
  let displayName = link.target;
  let meaningCn: string | undefined;

  if (!nodeType) {
    const word = await tx.word.findUnique({ where: { slug: slugify(link.target) } });
    if (word) {
      nodeType = MemoryNodeType.WORD;
      slug = word.slug;
      displayName = word.word;
      meaningCn = word.shortMeaningCn;
    } else {
      nodeType = MemoryNodeType.BRIDGE;
    }
  }

  if (nodeType === MemoryNodeType.WORD) {
    const word = await tx.word.findUnique({ where: { slug: slugify(link.target) } });
    if (word) {
      slug = word.slug;
      displayName = word.word;
      meaningCn = word.shortMeaningCn;
    }
  }

  const existing = await tx.memoryNode.findUnique({ where: { type_slug: { type: nodeType, slug } } });
  const node = await tx.memoryNode.upsert({
    where: { type_slug: { type: nodeType, slug } },
    create: {
      type: nodeType,
      value: link.target,
      slug,
      displayName,
      meaningCn
    },
    update: {
      displayName,
      meaningCn
    }
  });

  return {
    ...link,
    nodeId: node.id,
    nodeType,
    href: nodeType === MemoryNodeType.WORD ? `/word/${node.slug}` : `/node/${nodeType.toLowerCase()}/${node.slug}`,
    isNew: !existing
  };
}

export async function syncEntryWikiLinks(entryId: string, actorId: string, tx: Tx = prisma) {
  const entry = await tx.mnemonicEntry.findUniqueOrThrow({
    where: { id: entryId },
    select: { contentMarkdown: true, targetWordId: true }
  });
  const sourceNode = await ensureWordNode(entry.targetWordId, tx);
  const links = parseWikiLinks(entry.contentMarkdown);
  const resolved: ResolvedWikiLink[] = [];

  await tx.memoryLink.deleteMany({ where: { sourceMnemonicEntryId: entryId, relationType: RelationType.WIKI_LINK } });

  for (const link of links) {
    const target = await resolveWikiLink(link, tx);
    if (resolved.some((item) => item.nodeId === target.nodeId && item.label === target.label)) continue;
    resolved.push(target);
    await tx.memoryLink.create({
      data: {
        sourceNodeId: sourceNode.id,
        targetNodeId: target.nodeId,
        sourceMnemonicEntryId: entryId,
        relationType: RelationType.WIKI_LINK,
        anchorText: link.label,
        createdById: actorId
      }
    });
  }

  return resolved;
}

export async function previewResolvedLinks(markdown: string) {
  const parsed = parseWikiLinks(markdown);
  const result: ResolvedWikiLink[] = [];
  for (const link of parsed) result.push(await resolveWikiLink(link));
  return result;
}
