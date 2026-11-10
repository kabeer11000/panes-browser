import type { BrowseWith } from './types'

export const isBrowseWith = (v: unknown): v is BrowseWith => v === 'tabs' || v === 'canvas'

/** How a space is browsed: its own choice, else the global one. */
export function browseWith(
  global: BrowseWith,
  space?: { browseWith?: BrowseWith | null } | null
): BrowseWith {
  return space?.browseWith ?? global
}

export interface BrowseSeen {
  space: number
  browse: BrowseWith
}

/**
 * What the board does when the space on screen, or how it is browsed, changes. Only a change acts: a card popped
 * out to tabs in a canvas space stays out until the space is left and entered again (or set to canvas again), and
 * a board opened by hand in a tabs space is left alone.
 */
export function boardStep(prev: BrowseSeen | null, next: BrowseSeen): 'open' | 'close' | null {
  if (next.browse === 'canvas') {
    return prev?.browse === 'canvas' && prev.space === next.space ? null : 'open'
  }
  return prev?.browse === 'canvas' ? 'close' : null
}
