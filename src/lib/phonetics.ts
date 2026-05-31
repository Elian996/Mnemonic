export const phoneticEncodingArtifactPattern = /(?:\(\?@\)|\?|\\|\^)/u;

export function hasPhoneticEncodingArtifact(value: string | null | undefined) {
  return phoneticEncodingArtifactPattern.test(String(value ?? ""));
}

export function normalizePhonetic(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return "";

  const normalized = text
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\s*;\s*\(\?@\)\s*[^;]+/gu, "")
    .replace(/\(\?@\)\s*/gu, "")
    .replace(/\\+/gu, "ɜ")
    .replace(/\^/gu, "ɡ")
    .replace(/ә/gu, "ə")
    .replace(/:/gu, "ː")
    .replace(/'/gu, "ˈ")
    .replace(/,/gu, "ˌ")
    .replace(/\?/gu, "")
    .replace(/\s*;\s*/gu, "; ")
    .replace(/\s+/gu, " ")
    .replace(/;\s*$/gu, "")
    .trim();

  return normalized ? `/${normalized}/` : "";
}
