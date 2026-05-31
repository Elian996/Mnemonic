import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareMnemonicHtmlForDisplay, renderMnemonicMarkdown } from "@/lib/wiki-links/renderer";

const rendererUploadTestDir = path.join(process.cwd(), "public", "uploads", "renderer-test");

describe("wiki-link renderer", () => {
  afterEach(async () => {
    await fs.rm(rendererUploadTestDir, { recursive: true, force: true });
  });

  it("renders safe clickable word and node links", async () => {
    const html = await renderMnemonicMarkdown("[[word:philosophy|哲学]] 与 [[root:soph]] <script>alert(1)</script>");
    expect(html).toContain('href="/word/philosophy"');
    expect(html).toContain(">哲学</a>");
    expect(html).toContain('href="/node/root/soph"');
    expect(html).not.toContain("<script>");
  });

  it("rewrites stored upload image html to display variants", async () => {
    await fs.mkdir(rendererUploadTestDir, { recursive: true });
    await fs.writeFile(path.join(rendererUploadTestDir, "poke.display.webp"), "display image");

    const html = await prepareMnemonicHtmlForDisplay(
      '<p><img src="/uploads/renderer-test/poke.png" alt="poke 助记图"></p>'
    );

    expect(html).toContain('src="/uploads/renderer-test/poke.display.webp"');
    expect(html).toContain('data-original-src="/uploads/renderer-test/poke.png"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });
});
