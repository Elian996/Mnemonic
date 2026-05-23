export const mobileModeMaxWidthPx = 767;
export const desktopModeMinWidthPx = mobileModeMaxWidthPx + 1;

export const mobileModeMediaQuery = `(max-width: ${mobileModeMaxWidthPx}px)`;
export const desktopModeMediaQuery = `(min-width: ${desktopModeMinWidthPx}px)`;
export const touchLikeMediaQuery = "(pointer: coarse)";

export type DeviceMode = "desktop" | "mobile";

