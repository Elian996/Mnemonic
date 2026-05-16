import { marked } from "marked";
import { JSDOM } from "jsdom";
import DOMPurify from "dompurify";
import { MemoryNodeType } from "@prisma/client";
import { nodeSlug, slugify } from "@/lib/slug";
import { ParsedWikiLink, replaceWikiLinks } from "./parser";

const window = new JSDOM("").window;
const purify = DOMPurify(window);

export function wikiLinkHref(link: Pick<ParsedWikiLink, "nodeType" | "target">) {
  const type = link.nodeType ?? MemoryNodeType.BRIDGE;
  if (type === MemoryNodeType.WORD) return `/word/${slugify(link.target)}`;
  return `/node/${type.toLowerCase()}/${nodeSlug(link.target)}`;
}

export function renderWikiLink(link: ParsedWikiLink) {
  const type = link.nodeType ?? MemoryNodeType.BRIDGE;
  const className =
    type === MemoryNodeType.WORD
      ? "wiki-link wiki-link-word"
      : `wiki-link wiki-link-node wiki-link-${type.toLowerCase()}`;
  return `<a href="${escapeHtml(wikiLinkHref(link))}" class="${className}" data-node-type="${type}" data-target="${escapeHtml(
    link.target
  )}">${escapeHtml(link.label)}</a>`;
}

export async function renderMnemonicMarkdown(markdown: string) {
  const withLinks = replaceWikiLinks(markdown, renderWikiLink);
  const html = await marked.parse(withLinks, { async: false, breaks: true, gfm: true });
  return purify.sanitize(html, {
    ADD_ATTR: ["data-node-type", "data-target", "src", "alt", "title"],
    ADD_TAGS: ["img"]
  });
}

export function markdownToPlainText(markdown: string) {
  return replaceWikiLinks(markdown, (link) => link.label)
    .replace(/[#>*_`~\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
