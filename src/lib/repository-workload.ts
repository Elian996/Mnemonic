export const repairProgressWorkloadAuditAction = "MNEMONIC_LOGIC_REPAIR_PROGRESS_SAVE";
export const repositoryWorkloadRefreshEvent = "repository-workload:refresh";

export type RepositoryWorkloadRefreshDetail = {
  changedWordIds?: string[];
  source?: "repair-progress" | "word-card";
};

export function dispatchRepositoryWorkloadRefresh(detail: RepositoryWorkloadRefreshDetail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(repositoryWorkloadRefreshEvent, { detail }));
}
