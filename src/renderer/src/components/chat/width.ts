export const CHAT_MIN = 300
export const CHAT_MAX = 640
export const GAP = 8 // between the page and the panel (the stage's own edge)
export const clampW = (w: number): number => Math.min(CHAT_MAX, Math.max(CHAT_MIN, Math.round(w)))
export const loadChatWidth = (): number => {
  try {
    return clampW(Number(localStorage.getItem('panes:chat-w')) || 380)
  } catch {
    return 380
  }
}
