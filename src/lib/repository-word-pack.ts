export const labelArtifactCleanupScope = "labelArtifactCleanup";
export const labelArtifactCleanupAuditAction = "MNEMONIC_LABEL_ARTIFACT_CLEANUP";
export const labelArtifactCleanupPackExcludeAction = "REPOSITORY_LABEL_ARTIFACT_CLEANUP_PACK_EXCLUDE";

export const scannedAiRepairPack002Scope = "wordPack002";
export const scannedAiRepairPack002AuditAction = "MNEMONIC_DUPLICATE_TAKE_YOU_BACK_BATCH_CLEANUP";
export const scannedAiRepairPack002PackExcludeAction = "REPOSITORY_WORD_PACK_002_EXCLUDE";

export const glareLikeLogicReviewWords = [
  "glare",
  "glaring",
  "rail",
  "prone",
  "naturalist",
  "naturalness",
  "supernatural",
  "evenly",
  "thinly",
  "thinned",
  "thinning",
  "gland",
  "tan",
  "overflow",
  "antenna",
  "abide",
  "engender",
  "nonjudgmental"
];

export const scannedAiRepairPack002ExtraWords = ["salmon", "sodium"];

const repositoryWordPackExcludeActions: Record<string, string> = {
  [labelArtifactCleanupScope]: labelArtifactCleanupPackExcludeAction,
  [scannedAiRepairPack002Scope]: scannedAiRepairPack002PackExcludeAction
};

export function repositoryWordPackExcludeActionForScope(scope: string) {
  return repositoryWordPackExcludeActions[scope] ?? null;
}

export function isRepositoryWordPackScope(scope: string) {
  return Boolean(repositoryWordPackExcludeActionForScope(scope));
}
