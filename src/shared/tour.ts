// The guided tour: a few steps over the real window, each pointing at the part it is about (or centred when that part
// is not on screen in this layout, or lives outside the window's own interface).

export interface TourStep {
  id: string
  title: string
  body: string
  /** CSS selectors for what to point at, tried in order; none found (or hidden): the step sits in the middle. */
  target?: string[]
  keys?: string
  /** A short nudge shown while the step waits for the person to try the shortcut ("Press it to go on"). */
  cue?: string
}

/** A key event boiled down to what a shortcut cares about, so the matcher is pure and testable. */
export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Whether a key event is the shortcut written as `combo` ("Ctrl+Shift+K", "Ctrl+\\", "Ctrl+Tab"). Ctrl matches the
 * platform's command key (Cmd on a Mac), so the tour's prompts work on either. Case and the physical key, not the
 * character a modifier would produce, so Shift combos still match.
 */
export function matchCombo(combo: string, e: KeyLike, isMac = false): boolean {
  const parts = combo.split('+').map((p) => p.trim().toLowerCase())
  const key = parts[parts.length - 1]
  const wantCtrl = parts.includes('ctrl') || parts.includes('cmd')
  const wantShift = parts.includes('shift')
  const wantAlt = parts.includes('alt')
  const cmd = isMac ? e.metaKey : e.ctrlKey
  if (cmd !== wantCtrl || e.shiftKey !== wantShift || e.altKey !== wantAlt) return false
  return e.key.toLowerCase() === key
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'hello',
    title: 'A quick tour of Panes',
    body: 'Six short stops, and you do each one yourself. Press the key it shows and the tour moves on; Esc ends it any time.'
  },
  {
    id: 'address',
    title: 'Search or type an address',
    body: 'Start typing and Panes finishes the site name, then suggests searches, open tabs and your history.',
    target: ['.address'],
    keys: 'Ctrl+L',
    cue: 'Press it to open the address bar'
  },
  {
    id: 'tabs',
    title: 'Your tabs',
    body: 'Drag to reorder, drop a tab on the page to put two side by side, and Ctrl+Tab flies through them.',
    target: ['.tab-list', '.htab-list'],
    keys: 'Ctrl+Tab',
    cue: 'Press it to flick through your tabs'
  },
  {
    id: 'split',
    title: 'Two pages at once',
    body: 'Split view shows tabs side by side. Drag the divider to resize; Ctrl+\\ splits or unsplits.',
    target: ['button[title^="Split view"]'],
    keys: 'Ctrl+\\',
    cue: 'Press it to split the page'
  },
  {
    id: 'canvas',
    title: 'The canvas board',
    body: 'Every tab becomes a card on one board, grouped by topic. Press Ctrl+F there to find a card as you type, and open any card to read it or use it live.',
    target: ['button[aria-label="Canvas"]'],
    keys: 'Ctrl+Shift+K',
    cue: 'Press it to open the board'
  },
  {
    id: 'chat',
    title: 'Ask about your pages',
    body: 'The assistant reads the page you are on, opens and finds things for you, and can tidy a page to what you asked for. It runs on this computer if you like.',
    target: ['button[aria-label="Chat"]'],
    keys: 'Ctrl+Shift+L',
    cue: 'Press it to open the assistant'
  },
  {
    id: 'done',
    title: 'That is it',
    body: 'Downloads land in the bin at the bottom right. Find this tour again by typing "tour" in the address bar.'
  }
]

/** Where the tour card goes for a target box in a window: below it if there is room, else above, kept inside. */
export function cardSpot(
  target: { x: number; y: number; w: number; h: number } | null,
  card: { w: number; h: number },
  win: { w: number; h: number },
  gap = 12
): { x: number; y: number } {
  const clampX = (x: number): number => Math.max(gap, Math.min(win.w - card.w - gap, x))
  if (!target) return { x: clampX((win.w - card.w) / 2), y: Math.max(gap, (win.h - card.h) / 2) }
  const x = clampX(target.x + target.w / 2 - card.w / 2)
  const below = target.y + target.h + gap
  if (below + card.h <= win.h - gap) return { x, y: below }
  const above = target.y - gap - card.h
  if (above >= gap) return { x, y: above }
  // tall target (the tab list down the side): beside it
  const right = target.x + target.w + gap
  return {
    x: right + card.w <= win.w - gap ? right : clampX(target.x - gap - card.w),
    y: Math.max(gap, Math.min(win.h - card.h - gap, target.y))
  }
}
