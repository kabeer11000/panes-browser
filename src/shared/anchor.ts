import type { PromptAnchor } from './types'

/** The save-password card's width in its popover view. */
export const PROMPT_CARD_WIDTH = 296

/**
 * Room around the card inside its popover view, so the view never clips the card's shadow (popover.css:
 * `0 12px 28px`, which reaches 16px above the card, 28px to the sides and 40px below). The top is kept small: the
 * view sits just under the address bar, and its transparent margin still takes clicks.
 */
export const PROMPT_PAD = { top: 16, side: 28, bottom: 40 } as const

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * What the save-password card hangs under: the first candidate that is on screen (the top bar's address field, or
 * the header of a page open on the canvas), else the top centre of the window. The canvas has no top bar or sidebar,
 * so without the fallback the card had nothing to hang from and never showed.
 */
export function promptBox(candidates: Array<Box | null | undefined>, windowWidth: number): Box {
  const on = candidates.find((b): b is Box => !!b && b.width > 0 && b.height > 0)
  if (on) return { x: on.x, y: on.y, width: on.width, height: on.height }
  return {
    x: Math.max(0, (windowWidth - PROMPT_CARD_WIDTH) / 2),
    y: 8,
    width: PROMPT_CARD_WIDTH,
    height: 0
  }
}

const COLOUR = /^#[0-9a-f]{3,8}$/i
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** The anchor comes from IPC, so check its shape before it reaches layout or becomes CSS. */
export function parseAnchor(raw: unknown): PromptAnchor | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Partial<PromptAnchor>
  const t = a.theme
  if (!finite(a.x) || !finite(a.y) || !finite(a.width) || !finite(a.height) || !t) return null
  if (t.scheme !== 'dark' && t.scheme !== 'light') return null
  if (!COLOUR.test(t.color) || !COLOUR.test(t.color2)) return null
  return { x: a.x, y: a.y, width: a.width, height: a.height, theme: t }
}
