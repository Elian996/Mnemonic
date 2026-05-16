import type { Prisma } from "@prisma/client";

export const codexP0RepairMarker = "codex-p0-source-repair-2026-05-15";
export const codexP0RepairHref = "/repository/codex-p0-repair";
export const codexP0ManualRestoreAction = "CODEX_RESTORE_MANUAL_P0_BEFORE_SOURCE_REPAIR";
export const codexP0ReviewAuditAction = "CODEX_P0_HUMAN_REVIEW";

export function parseCodexP0RepairEditorNote(note: string | null | undefined) {
  const source = note?.match(/(?:^|;\s*)source=([^;\n]+)/)?.[1]?.trim() ?? "来源记录";
  const score = note?.match(/(?:^|;\s*)score=([^;\n]+)/)?.[1]?.trim() ?? "";

  return { source, score };
}

export function metadataHasCodexP0RepairMarker(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as Record<string, Prisma.JsonValue>).marker === codexP0RepairMarker;
}
