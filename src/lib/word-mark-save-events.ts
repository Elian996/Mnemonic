export const WORD_MARK_SAVE_REQUEST_EVENT = "mnemonic:word-mark-save-request";
export const WORD_MARK_SAVE_STATE_EVENT = "mnemonic:word-mark-save-state";

export type WordMarkSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export type WordMarkSaveStateDetail = {
  pendingCount: number;
  status: WordMarkSaveStatus;
  message?: string;
};
