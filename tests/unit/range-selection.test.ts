import { describe, expect, it } from "vitest";
import { toggleRangeSelection } from "@/lib/range-selection";

describe("toggleRangeSelection", () => {
  const orderedIds = ["alpha", "bravo", "charlie", "delta", "echo"];

  it("selects every item between the anchor and target", () => {
    const selected = toggleRangeSelection({
      selectedIds: new Set(["alpha"]),
      orderedIds,
      targetId: "delta",
      anchorId: "alpha"
    });

    expect([...selected]).toEqual(["alpha", "bravo", "charlie", "delta"]);
  });

  it("can clear an already selected range", () => {
    const selected = toggleRangeSelection({
      selectedIds: new Set(["alpha", "bravo", "charlie", "delta"]),
      orderedIds,
      targetId: "delta",
      anchorId: "alpha"
    });

    expect([...selected]).toEqual([]);
  });

  it("falls back to single-item toggle without a valid anchor", () => {
    const selected = toggleRangeSelection({
      selectedIds: new Set(["alpha"]),
      orderedIds,
      targetId: "bravo",
      anchorId: "missing"
    });

    expect([...selected]).toEqual(["alpha", "bravo"]);
  });
});
