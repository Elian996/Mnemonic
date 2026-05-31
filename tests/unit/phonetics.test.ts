import { describe, expect, it } from "vitest";
import { hasPhoneticEncodingArtifact, normalizePhonetic } from "@/lib/phonetics";

describe("phonetics", () => {
  it("removes ECDICT question-marker pronunciation artifacts", () => {
    expect(normalizePhonetic("/saiki'ætrik; (?@) si-/")).toBe("/saikiˈætrik/");
  });

  it("converts visible ECDICT encoding leftovers to IPA symbols", () => {
    expect(normalizePhonetic("/ˈb\\\\ːdə(r)/")).toBe("/ˈbɜːdə(r)/");
    expect(normalizePhonetic("/ˈeəbæ^/")).toBe("/ˈeəbæɡ/");
  });

  it("detects only visible encoding artifacts", () => {
    expect(hasPhoneticEncodingArtifact("/ˈbɜːdə(r)/")).toBe(false);
    expect(hasPhoneticEncodingArtifact("/ˈb\\\\ːdə(r)/")).toBe(true);
  });
});
