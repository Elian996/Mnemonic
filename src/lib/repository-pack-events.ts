export const REPOSITORY_PACK_REMOVE_EVENT = "mnemonic:repository-pack-remove";

export type RepositoryPackRemoveEventDetail = {
  status?: "pending" | "done" | "error";
  count?: number;
  packScope: string;
  word?: string;
  message?: string;
};

export function dispatchRepositoryPackRemoveEvent(detail: RepositoryPackRemoveEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REPOSITORY_PACK_REMOVE_EVENT, { detail }));
}
