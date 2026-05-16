import { describe, expect, it } from "vitest";
import { mnemonicScore, sortPublicMnemonics } from "@/lib/ranking";

describe("ranking", () => {
  it("calculates weighted mnemonic score", () => {
    expect(
      mnemonicScore({ likeCount: 2, bookmarkCount: 1, editorScore: 5, effectivenessScore: 0.5, reportCount: 1 })
    ).toBe(30);
  });

  it("sorts by score descending", () => {
    const sorted = sortPublicMnemonics([
      { id: "a", likeCount: 0, bookmarkCount: 0, editorScore: 1, effectivenessScore: 0, reportCount: 0 },
      { id: "b", likeCount: 5, bookmarkCount: 0, editorScore: 0, effectivenessScore: 0, reportCount: 0 }
    ]);
    expect(sorted[0].id).toBe("b");
  });
});
