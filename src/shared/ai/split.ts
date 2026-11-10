import {
  CARD_H,
  CARD_W,
  boundsOf,
  cardBox,
  closeUp,
  freeSpot,
  seatSplit,
  GAP,
  HEAD,
  SPLIT_INSET,
  SPLIT_LIP,
  SPLIT_ROW_BELOW,
  SPLIT_ROW_EXTRA,
  SPLIT_SIDE,
  SPLIT_TOP_EXTRA,
  PAD,
  type Box,
  type CanvasCard,
  type CanvasState
} from './canvas'

/**
 * Split view on the canvas board. The board is a view onto the real tabs: the tabs shown side by side (the layout's
 * leaves) sit on the board as one joined "split" group, loose, side by side in their order. Pure; board units.
 */

/** The gap between the members of a split, and the room its container takes around them. */
export const SPLIT_GAP = 10
// loose on the board it looks as it does in a section: the same padding, and the same lip for its label
export const SPLIT_PAD = SPLIT_INSET
export const SPLIT_HEAD = SPLIT_LIP
export const SPLIT_MAX = 4

/** The cards of a split, in the split's order: tabs on the board (not private), at least two, else none. */
export function splitMembers(leaves: number[], s: CanvasState): number[] {
  const on = new Map(s.cards.map((c) => [c.id, c]))
  const ids = leaves.filter(
    (id, i) => leaves.indexOf(id) === i && on.has(id) && !on.get(id)!.private
  )
  return ids.length >= 2 ? ids : []
}

export { SPLIT_INSET }

/**
 * The container drawn around a split's cards. Loose on the board it has room for its label on top; inside a section
 * (`inFrame`) it is a tight outline in the grid's gaps with a lip on top for the label (the layout leaves room for it).
 */
export function splitBox(s: CanvasState, ids: number[]): (Box & { inFrame: boolean }) | null {
  const cs = s.cards.filter((c) => ids.includes(c.id))
  const b = boundsOf(cs.map(cardBox))
  if (!b || ids.length < 2) return null
  const inFrame = cs.length > 0 && cs[0].frame !== null && cs.every((c) => c.frame === cs[0].frame)
  if (inFrame)
    return {
      x: b.x - SPLIT_INSET,
      y: b.y - SPLIT_LIP,
      w: b.w + SPLIT_INSET * 2,
      h: b.h + SPLIT_LIP + SPLIT_INSET,
      inFrame
    }
  return {
    x: b.x - SPLIT_PAD,
    y: b.y - SPLIT_HEAD,
    w: b.w + SPLIT_PAD * 2,
    h: b.h + SPLIT_HEAD + SPLIT_PAD,
    inFrame
  }
}

// a card's own size: a resized card keeps it in a split, and its neighbours make room
const wOf = (c: CanvasCard): number => c.w ?? CARD_W
const hOf = (c: CanvasCard): number => c.h ?? CARD_H

/** Where each member starts along the row, from the first: their own widths and the gap between them. */
function offsets(s: CanvasState, ids: number[]): number[] {
  const out: number[] = []
  let x = 0
  for (const id of ids) {
    out.push(x)
    const c = s.cards.find((k) => k.id === id)
    x += (c ? wOf(c) : CARD_W) + SPLIT_GAP
  }
  return out
}

/** Whether a split's cards already sit side by side, in order, in one row of the same section, with room for its lip. */
const together = (s: CanvasState, ids: number[]): boolean => {
  const cs = ids.map((id) => s.cards.find((c) => c.id === id))
  const first = cs[0]
  if (
    !first ||
    !cs.every(
      (c, i) =>
        !!c &&
        c.frame === first.frame &&
        Math.abs(c.y - first.y) < 0.5 &&
        (i === 0 || c.x > cs[i - 1]!.x)
    )
  )
    return false
  // the card above it (or the section's title) is a lip's height away
  const home = s.frames.find((f) => f.id === first.frame)
  const above = s.cards
    .filter((c) => c.frame === first.frame && !ids.includes(c.id) && c.y + hOf(c) <= first.y + 0.5)
    .map((c) => c.y + hOf(c))
  const top = above.length ? Math.max(...above) + GAP : home ? home.y + HEAD : first.y
  if (first.y - top < (above.length ? SPLIT_ROW_EXTRA : SPLIT_TOP_EXTRA) - 0.5) return false
  // the section is widened round it
  if (home && Math.min(...cs.map((c) => c!.x)) - home.x < PAD + SPLIT_SIDE - 0.5) return false
  // nothing else in its row, and the row below clear of its outline
  const last = cs[cs.length - 1]!
  const others = s.cards.filter((c) => c.frame === first.frame && !ids.includes(c.id))
  if (others.some((c) => Math.abs(c.y - first.y) < 0.5 && c.x > last.x)) return false
  const bottom = first.y + Math.max(...cs.map((c) => hOf(c!)))
  // nothing reaches into its row (a member grown taller than the row was laid out for)
  if (others.some((c) => c.y < bottom - 0.5 && c.y + hOf(c) > first.y + 0.5)) return false
  const below = others.filter((c) => c.y >= bottom - 0.5).map((c) => c.y)
  return !below.length || Math.min(...below) - bottom >= GAP + SPLIT_ROW_BELOW - 0.5
}

const placed = (s: CanvasState, ids: number[], at: { x: number; y: number }): boolean => {
  const xs = offsets(s, ids)
  return ids.every((id, i) => {
    const c = s.cards.find((x) => x.id === id)
    return (
      !!c && c.frame === null && Math.abs(c.x - (at.x + xs[i])) < 0.5 && Math.abs(c.y - at.y) < 0.5
    )
  })
}

/**
 * Lay a split's cards side by side, loose on the board, starting where its first card is (`at` to start elsewhere),
 * moved clear of sections, loose notes and other loose cards. Sections they left close up. The same state when
 * they already sit that way.
 */
export function arrangeSplit(
  s: CanvasState,
  ids: number[],
  at?: { x: number; y: number }
): CanvasState {
  if (ids.length < 2) return s
  const first = s.cards.find((c) => c.id === ids[0])
  if (!first) return s
  // in a section: it stays there, and the section lays itself out with the split as one unit
  const home = !at && first.frame ? s.frames.find((f) => f.id === first.frame) : undefined
  if (home && home.kind !== 'private') {
    const same = s.split?.length === ids.length && s.split.every((id, i) => id === ids[i])
    if (same && together(s, ids)) return s
    return seatSplit(s, ids, home.id)
  }
  const want = at ?? { x: first.x, y: first.y }
  if (placed(s, ids, want))
    return s.split?.length === ids.length && s.split.every((id, i) => id === ids[i])
      ? s
      : { ...s, split: ids }
  const members = ids.map((id) => s.cards.find((c) => c.id === id))
  const xs = offsets(s, ids)
  const size = {
    w:
      members.reduce((a, c) => a + (c ? wOf(c) : CARD_W), 0) +
      (ids.length - 1) * SPLIT_GAP +
      SPLIT_PAD * 2,
    h: Math.max(...members.map((c) => (c ? hOf(c) : CARD_H))) + SPLIT_HEAD + SPLIT_PAD
  }
  const set = new Set(ids)
  const obstacles: Box[] = [
    ...s.frames,
    ...s.notes.filter((n) => !n.frame),
    ...s.cards.filter((c) => c.frame === null && !set.has(c.id)).map(cardBox)
  ]
  const spot = freeSpot(size, obstacles, { x: want.x - SPLIT_PAD, y: want.y - SPLIT_HEAD }, GAP)
  const origin = { x: spot.x + SPLIT_PAD, y: spot.y + SPLIT_HEAD }
  const from = new Set(s.cards.filter((c) => set.has(c.id) && c.frame).map((c) => c.frame))
  let next: CanvasState = {
    ...s,
    split: ids,
    cards: s.cards.map((c): CanvasCard => {
      const i = ids.indexOf(c.id)
      return i < 0 ? c : { ...c, frame: null, manual: true, x: origin.x + xs[i], y: origin.y }
    })
  }
  for (const f of from) next = closeUp(next, f)
  return next
}

/** The cards picked for "Open side by side": two to four distinct cards that are on the board. */
export function splitPick(ids: number[], s: CanvasState): number[] | null {
  const uniq = ids.filter((id, i) => ids.indexOf(id) === i)
  if (uniq.length < 2 || uniq.length > SPLIT_MAX) return null
  const on = new Map(s.cards.map((c) => [c.id, c]))
  if (uniq.some((id) => !on.has(id) || on.get(id)!.private)) return null
  // in reading order: left to right, then top to bottom
  return uniq.sort((a, b) => {
    const ca = on.get(a)!
    const cb = on.get(b)!
    return Math.abs(ca.y - cb.y) > CARD_H / 2 ? ca.y - cb.y : ca.x - cb.x || a - b
  })
}

/** Whether a point over a card is near its left or right edge (a drop there opens the two side by side). */
export function splitEdge(
  card: { x: number; y: number },
  p: { x: number; y: number }
): 'left' | null {
  const b = cardBox(card)
  if (p.y < b.y || p.y > b.y + b.h || p.x < b.x || p.x > b.x + b.w) return null
  // anywhere on the card joins them; the dropped page always goes on the left
  return 'left'
}
