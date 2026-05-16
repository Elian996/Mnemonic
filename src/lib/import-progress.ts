export type ImportProgressKind = "markdown" | "image-single" | "image-batch";

export type ImportProgressEstimate = {
  seconds: number;
  units: number;
  label: string;
};

type StoredDuration = {
  secondsPerUnit: number;
  samples: number;
};

const STORAGE_PREFIX = "mnemonic:import-duration:";

export function estimateMarkdownImport(markdown: string): ImportProgressEstimate {
  const cardCount = estimateMarkdownCardCount(markdown);
  const defaultSeconds = clampSeconds(18 + cardCount * 10);
  return {
    seconds: estimateFromHistory("markdown", cardCount, defaultSeconds),
    units: cardCount,
    label: `约 ${cardCount} 张卡`
  };
}

export function estimateImageImport(file: File, mode: "single" | "batch"): ImportProgressEstimate {
  const sizeMb = Math.max(0.2, file.size / 1024 / 1024);
  const kind = mode === "batch" ? "image-batch" : "image-single";
  const units = mode === "batch" ? Math.max(1, sizeMb * 1.6) : Math.max(1, sizeMb);
  const defaultSeconds = mode === "batch" ? 55 + sizeMb * 24 : 30 + sizeMb * 12;
  return {
    seconds: estimateFromHistory(kind, units, clampSeconds(defaultSeconds)),
    units,
    label: `${formatFileSize(file.size)}`
  };
}

export function rememberImportDuration(kind: ImportProgressKind, units: number, elapsedSeconds: number) {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(units) || units <= 0 || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return;
  const key = `${STORAGE_PREFIX}${kind}`;
  const current = readStoredDuration(kind);
  const secondsPerUnit = elapsedSeconds / units;
  const next: StoredDuration = current
    ? {
        secondsPerUnit: current.secondsPerUnit * 0.65 + secondsPerUnit * 0.35,
        samples: Math.min(current.samples + 1, 20)
      }
    : { secondsPerUnit, samples: 1 };
  window.localStorage.setItem(key, JSON.stringify(next));
}

export function progressFromElapsed(elapsedSeconds: number, estimatedSeconds: number, done = false) {
  if (done) return 100;
  if (!Number.isFinite(estimatedSeconds) || estimatedSeconds <= 0) return 8;
  const ratio = elapsedSeconds / estimatedSeconds;
  if (ratio < 0.72) return Math.max(8, Math.round(ratio * 82));
  if (ratio < 1) return Math.round(59 + (ratio - 0.72) * 118);
  return Math.min(96, Math.round(91 + Math.log2(ratio) * 4));
}

export function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes <= 0) return `${rest} 秒`;
  if (rest === 0) return `${minutes} 分钟`;
  return `${minutes} 分 ${rest} 秒`;
}

function estimateFromHistory(kind: ImportProgressKind, units: number, defaultSeconds: number) {
  const stored = readStoredDuration(kind);
  if (!stored) return defaultSeconds;
  const historicalSeconds = clampSeconds(stored.secondsPerUnit * Math.max(1, units));
  const historyWeight = Math.min(0.72, 0.24 + stored.samples * 0.08);
  return Math.round(defaultSeconds * (1 - historyWeight) + historicalSeconds * historyWeight);
}

function readStoredDuration(kind: ImportProgressKind): StoredDuration | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}${kind}`) || "null") as StoredDuration | null;
    if (!parsed || !Number.isFinite(parsed.secondsPerUnit) || !Number.isFinite(parsed.samples)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function estimateMarkdownCardCount(markdown: string) {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = lines.filter((line) => /^[a-z][a-z'-]{1,28}$/i.test(line)).length;
  const phoneticMarkers = (markdown.match(/音标\s*[:：]/gu) ?? []).length;
  const meaningMarkers = (markdown.match(/释义\s*[:：]/gu) ?? []).length;
  return Math.max(1, Math.max(candidates, phoneticMarkers, meaningMarkers));
}

function clampSeconds(value: number) {
  if (!Number.isFinite(value)) return 30;
  return Math.max(8, Math.min(900, Math.round(value)));
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
