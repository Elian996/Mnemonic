import { describe, expect, it } from "vitest";
import { MemoryNodeType } from "@prisma/client";
import { parseWikiLinks, nodeTypeFromNamespace } from "@/lib/wiki-links/parser";

describe("wiki-link parser", () => {
  it("parses namespaced links and aliases", () => {
    const links = parseWikiLinks("[[word:philosophy|哲学]] -> [[root:soph]] -> [[prefix:dis-]]");
    expect(links).toHaveLength(3);
    expect(links[0]).toMatchObject({
      namespace: "word",
      nodeType: MemoryNodeType.WORD,
      target: "philosophy",
      alias: "哲学",
      label: "哲学"
    });
    expect(links[1].nodeType).toBe(MemoryNodeType.ROOT);
    expect(links[2].target).toBe("dis-");
  });

  it("leaves non-namespaced links for resolver decisions", () => {
    const [link] = parseWikiLinks("先记 [[philosophy]]");
    expect(link.namespace).toBeUndefined();
    expect(link.nodeType).toBeUndefined();
    expect(link.target).toBe("philosophy");
  });

  it("maps all supported namespaces", () => {
    expect(nodeTypeFromNamespace("scene")).toBe(MemoryNodeType.SCENE);
    expect(nodeTypeFromNamespace("block")).toBe(MemoryNodeType.BLOCK);
    expect(nodeTypeFromNamespace("unknown")).toBeUndefined();
  });
});
