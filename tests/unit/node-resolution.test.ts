import { describe, expect, it } from "vitest";
import { MemoryNodeType } from "@prisma/client";
import { nodeSlug, slugify } from "@/lib/slug";
import { nodeTypeFromNamespace } from "@/lib/wiki-links/parser";
import { wikiLinkHref } from "@/lib/wiki-links/renderer";

describe("node resolution helpers", () => {
  it("normalizes word and node slugs", () => {
    expect(slugify("Sophisticated")).toBe("sophisticated");
    expect(nodeSlug("dis-")).toBe("dis-dash");
  });

  it("builds the right frontend target URLs", () => {
    expect(wikiLinkHref({ nodeType: MemoryNodeType.WORD, target: "philosophy" })).toBe("/word/philosophy");
    expect(wikiLinkHref({ nodeType: MemoryNodeType.PREFIX, target: "dis-" })).toBe("/node/prefix/dis-dash");
  });

  it("maps root namespace to root node type", () => {
    expect(nodeTypeFromNamespace("root")).toBe(MemoryNodeType.ROOT);
  });
});
