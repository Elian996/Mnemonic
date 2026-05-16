import { describe, expect, it } from "vitest";
import { renderMnemonicMarkdown } from "@/lib/wiki-links/renderer";

describe("wiki-link renderer", () => {
  it("renders safe clickable word and node links", async () => {
    const html = await renderMnemonicMarkdown("[[word:philosophy|哲学]] 与 [[root:soph]] <script>alert(1)</script>");
    expect(html).toContain('href="/word/philosophy"');
    expect(html).toContain(">哲学</a>");
    expect(html).toContain('href="/node/root/soph"');
    expect(html).not.toContain("<script>");
  });
});
