import { MemoryNodeType } from "@prisma/client";

export type WikiLinkNamespace =
  | "word"
  | "root"
  | "prefix"
  | "suffix"
  | "block"
  | "sound"
  | "scene"
  | "bridge"
  | "topic";

export type ParsedWikiLink = {
  raw: string;
  namespace?: WikiLinkNamespace;
  nodeType?: MemoryNodeType;
  target: string;
  alias?: string;
  label: string;
  start: number;
  end: number;
};

const namespaceToNodeType: Record<WikiLinkNamespace, MemoryNodeType> = {
  word: MemoryNodeType.WORD,
  root: MemoryNodeType.ROOT,
  prefix: MemoryNodeType.PREFIX,
  suffix: MemoryNodeType.SUFFIX,
  block: MemoryNodeType.BLOCK,
  sound: MemoryNodeType.SOUND,
  scene: MemoryNodeType.SCENE,
  bridge: MemoryNodeType.BRIDGE,
  topic: MemoryNodeType.TOPIC
};

export function nodeTypeFromNamespace(namespace: string): MemoryNodeType | undefined {
  return namespaceToNodeType[namespace.toLowerCase() as WikiLinkNamespace];
}

export function parseWikiLinks(markdown: string): ParsedWikiLink[] {
  const links: ParsedWikiLink[] = [];
  const regex = /\[\[([^[\]\n]+?)\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    const raw = match[0];
    const body = match[1]?.trim();
    if (!body || body.includes("[[")) continue;

    const [targetPart, aliasPart] = splitOnce(body, "|");
    const [maybeNamespace, maybeTarget] = splitOnce(targetPart.trim(), ":");
    const explicitType = maybeTarget ? nodeTypeFromNamespace(maybeNamespace.trim()) : undefined;
    const target = (explicitType && maybeTarget ? maybeTarget : targetPart).trim();
    if (!target) continue;

    const alias = aliasPart?.trim();
    links.push({
      raw,
      namespace: explicitType ? (maybeNamespace.trim().toLowerCase() as WikiLinkNamespace) : undefined,
      nodeType: explicitType,
      target,
      alias: alias || undefined,
      label: alias || target,
      start: match.index,
      end: match.index + raw.length
    });
  }

  return links;
}

export function replaceWikiLinks(
  markdown: string,
  replacer: (link: ParsedWikiLink, index: number) => string
) {
  const links = parseWikiLinks(markdown);
  let output = "";
  let cursor = 0;

  links.forEach((link, index) => {
    output += markdown.slice(cursor, link.start);
    output += replacer(link, index);
    cursor = link.end;
  });

  output += markdown.slice(cursor);
  return output;
}

function splitOnce(value: string, separator: string): [string, string?] {
  const index = value.indexOf(separator);
  if (index === -1) return [value];
  return [value.slice(0, index), value.slice(index + separator.length)];
}
