export const REPOSITORY_PACK_REMOVE_EVENT = "mnemonic:repository-pack-remove";

export type RepositoryPackRemoveEventDetail = {
  count: number;
  packScope: string;
};
