import { describe, expect, it } from "vitest";
import { getMnemonicEntryContaminationSignals } from "@/lib/mnemonic-contamination-audit";

const knownWords = new Set(["coexist", "coexistence", "crate", "exist"]);

describe("mnemonic contamination audit", () => {
  it("flags cards made by stitching neighboring OCR entries together", () => {
    const signals = getMnemonicEntryContaminationSignals(
      {
        splitText: "co |cxist",
        targetWord: { word: "coexist" },
        contentMarkdown: [
          "带你背：",
          "针对整个单词采用字形联想法：由 crate 的字形我们可以联想到熟悉单",
          "带你背：",
          "针对第1个元素采用词根词缀分析：co作前缀，表示共同；",
          "综合考虑 co（共同）+exist（存在）—>共同存在，即 coexist 表示 vi.共存；",
          "词汇扩充：coexistence n.共存；",
          "coexistence",
          "大学生们充分发挥自己的动手能力和创造力，用纸箱纸盒（crate）创造",
          "#: /koig'zistans/",
          "带你背：",
          "词延伸为动词，可以得到 crate 表示 vt.把⋯装入大木箱；",
          "常见搭配：a bcer crate 啤酒箱；",
          "",
          "例句：",
          "Diffcrent traditions coexist successfully sidc by side.",
          "不同的传统和谐地共存着。 You kncw when ence 名词后缀，得到核心含义相同的名词含义，表示n.共存；并立； it was \"milk time\" because you could hear the crate rattling with its The coexistence does create some confusion. 但不同时间系统共存 load oftiny botles.",
          "相关单词：",
          "[[word:exist]]"
        ].join("\n")
      },
      knownWords
    );

    expect(signals.embeddedCard.join("\n")).toContain("crate");
    expect(signals.embeddedCard.join("\n")).toContain("coexistence");
    expect(signals.longExample.join("\n")).toContain("例句区");
    expect(signals.ocrNoise.join("\n")).toContain("bcer");
    expect(signals.splitTextMismatch.join("\n")).toContain("cocxist");
  });

  it("keeps a normal derivative card quiet", () => {
    const signals = getMnemonicEntryContaminationSignals(
      {
        splitText: "co | exist",
        targetWord: { word: "coexist" },
        contentMarkdown: [
          "带你背：",
          "co 表示共同；exist 表示存在。共同存在，就是 coexist，即 vi.共存，和平共处。",
          "",
          "例句：",
          "Different species can coexist in the same habitat.",
          "不同物种可以在同一栖息地共存。",
          "",
          "相关单词：",
          "[[word:exist]]"
        ].join("\n")
      },
      knownWords
    );

    expect(signals.embeddedCard).toEqual([]);
    expect(signals.longExample).toEqual([]);
    expect(signals.ocrNoise).toEqual([]);
    expect(signals.splitTextMismatch).toEqual([]);
  });
});
