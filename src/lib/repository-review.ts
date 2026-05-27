export const repositoryReviewPassActions = {
  linkCycleRescue: "REPOSITORY_REVIEW_PASS_LINK_CYCLE_RESCUE",
  linkCycleRestored: "REPOSITORY_REVIEW_PASS_LINK_CYCLE_RESTORED",
  pdfManual: "REPOSITORY_REVIEW_PASS_PDF_MANUAL"
} as const;

export type RepositoryReviewScope = keyof typeof repositoryReviewPassActions;

export function repositoryReviewPassActionForScope(scope: string) {
  return repositoryReviewPassActions[scope as RepositoryReviewScope] ?? null;
}
