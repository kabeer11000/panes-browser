// Map-like labels for a board zoomed far out: one per section, and one per group of loose cards lying together.
// Pure so it can be tested; the board (Canvas.tsx) draws them.

import { displayHost } from '../url'
import { CARD_H, CARD_W, type CanvasCard, type CanvasFrame } from './canvas'

export interface BoardLabel {
  key: string
  /** What it names, in board coordinates: the label sits above its middle, and a click glides there. */
  x: number
  y: number
  w: number
  h: number
  title: string
  count: number
  /** The section it names, if it names one (clicking it selects the section). */
  frame?: string
}

/** Loose cards closer than this (board px) count as lying together. */
const GAP = 140
/** Fewer loose cards than this together get no label: a pair or a stray card is read off its own picture. */
const MIN_GROUP = 3

type Card = Pick<CanvasCard, 'id' | 'x' | 'y' | 'w' | 'h' | 'frame' | 'url'>

/** What a group of pages is about, by site: the one most of them are on, else the two most common and how many more. */
export function groupTitle(urls: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const u of urls) {
    const h = u ? displayHost(u) : ''
    if (h) counts.set(h, (counts.get(h) ?? 0) + 1)
  }
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (top.length === 0) return 'Cards'
  if (top[0][1] * 2 >= urls.length || top.length === 1) return top[0][0]
  const rest = top.length - 2
  return `${top[0][0]}, ${top[1][0]}` + (rest > 0 ? ` +${rest}` : '')
}

/**
 * The labels: every section (named, at its centre, with how many cards it holds) and every group of at least
 * MIN_GROUP loose cards whose boxes lie within GAP of one another (named by site, at the group's centre).
 * ponytail: pairwise O(n^2) over loose cards, fine for a few hundred; a grid bucket if boards get into thousands.
 */
export function boardLabels(
  frames: readonly Pick<CanvasFrame, 'id' | 'name' | 'x' | 'y' | 'w' | 'h'>[],
  cards: readonly Card[],
  counts: ReadonlyMap<string, number>
): BoardLabel[] {
  const out: BoardLabel[] = frames.map((f) => ({
    key: `f:${f.id}`,
    x: f.x,
    y: f.y,
    w: f.w,
    h: f.h,
    title: f.name || 'Section',
    count: counts.get(f.id) ?? 0,
    frame: f.id
  }))
  const known = new Set(frames.map((f) => f.id))
  const loose = cards.filter((c) => c.frame === null || !known.has(c.frame))
  const box = (c: Card): { l: number; t: number; r: number; b: number } => ({
    l: c.x,
    t: c.y,
    r: c.x + (c.w ?? CARD_W),
    b: c.y + (c.h ?? CARD_H)
  })
  const boxes = loose.map(box)
  // union-find over cards close enough to touch
  const parent = loose.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < loose.length; i++) {
    for (let j = i + 1; j < loose.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      const dx = Math.max(0, a.l - b.r, b.l - a.r)
      const dy = Math.max(0, a.t - b.b, b.t - a.b)
      if (dx <= GAP && dy <= GAP) parent[find(i)] = find(j)
    }
  }
  const groups = new Map<number, number[]>()
  loose.forEach((_, i) => {
    const r = find(i)
    groups.set(r, [...(groups.get(r) ?? []), i])
  })
  for (const members of groups.values()) {
    if (members.length < MIN_GROUP) continue
    const l = Math.min(...members.map((i) => boxes[i].l))
    const t = Math.min(...members.map((i) => boxes[i].t))
    const r = Math.max(...members.map((i) => boxes[i].r))
    const b = Math.max(...members.map((i) => boxes[i].b))
    out.push({
      key: `g:${Math.min(...members.map((i) => loose[i].id))}`,
      x: l,
      y: t,
      w: r - l,
      h: b - t,
      title: groupTitle(members.map((i) => loose[i].url)),
      count: members.length
    })
  }
  return out
}
