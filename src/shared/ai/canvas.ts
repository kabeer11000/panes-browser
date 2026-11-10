import { cosine, GROUP_THRESHOLD } from './cluster'
import { fallbackName } from './grouping'
import { keepItem, type CanvasItem } from './canvasItems'
import { sanitizeMarks, type CanvasMark } from './canvasMarks'
import { pruneConnectors, remapCards, sanitizeConnectors, type CanvasConnector } from './connectors'

/**
 * Canvas mode layout: every function here is pure (no Electron, no DOM) and deterministic, so the same tabs and
 * the same saved board always give the same board. Coordinates are board units; the renderer scales them.
 * Private and Tor tabs are never part of what is clustered (see `clusterable`) and live in their own frame.
 */

export const CARD_W = 240
export const CARD_H = 300
export const CARD_MIN_W = 160
export const CARD_MAX_W = 960
export const CARD_MIN_H = 110
export const CARD_MAX_H = 900
export const GAP = 16
export const PAD = 24
/** The room a section keeps above its cards. Its title sits outside, above its top edge, so this is the padding. */
export const HEAD = PAD
/** The room above a section's cards in boards laid out before the title moved outside (see `liftSections`). */
const OLD_HEAD = 44
export const FRAME_GAP = 56
/**
 * A split view inside a section has a lip on top of it for its label. The row it sits in is set this much lower
 * (and each row below with it) so the lip has room and never runs over the card above.
 */
export const SPLIT_LIP = 32
/**
 * How far the outline of a split inside a section sits out from its cards (its padding), and the clear space kept
 * between that outline and anything else (other cards, the section's edges). Together they are the section's own
 * padding, so a section looks the same with a split in it as without: only the split's lip adds height.
 */
export const SPLIT_INSET = 12
export const SPLIT_CLEAR = PAD - SPLIT_INSET
/** The extra room above a split's row (its lip and the clear space), and below it (its padding and clear space). */
export const SPLIT_ROW_EXTRA = SPLIT_LIP + SPLIT_CLEAR - GAP
export const SPLIT_ROW_BELOW = SPLIT_INSET + SPLIT_CLEAR - GAP
/** The same above a split in a section's first row, which has the section's padding above it instead of a gap. */
export const SPLIT_TOP_EXTRA = SPLIT_LIP + SPLIT_CLEAR - HEAD
/** How much wider a section holding a split is on each side (and lower, when the split is its last row): none. */
export const SPLIT_SIDE = SPLIT_INSET + SPLIT_CLEAR - PAD
export const NOTE_W = 240
export const NOTE_H = 120
export const NOTE_MIN_W = 160
export const NOTE_MAX_W = 520
export const NOTE_MIN_H = 72
export const NOTE_MAX_H = 900
export const NOTE_COLORS = 4
export const OTHER_ID = 'other'
export const PRIVATE_ID = 'private'
export const MAX_COLS = 6
// A board wants looser groups than the suggestion row: measured with EmbeddingGemma, tabs on one topic average
// 0.4 to 0.75 against each other (short pages like "Mars" sit at the low end), so 0.4 keeps topics together.
export const CANVAS_THRESHOLD = GROUP_THRESHOLD - 0.1
export const NAME_MAX = 40
export const FRAME_COLORS = 7
const VIEWS_MAX = 600

export interface Box {
  x: number
  y: number
  w: number
  h: number
}
/** `result`: made by the prompt (found pages, an answer); it holds cards that are not tabs. */
export type FrameKind = 'topic' | 'other' | 'private' | 'user' | 'result'
export interface CanvasFrame extends Box {
  id: string
  name: string
  kind: FrameKind
  /** The person named, moved or made it: Tidy up leaves its place alone. */
  pinned: boolean
  /** Folded into a stack: the size it has when open (its own w and h are the pile's). */
  stack?: { w: number; h: number }
  /** The person opened this results frame: it is not folded up again by itself. */
  fan?: boolean
  /** A colour the person picked (0 .. FRAME_COLORS - 1); none: the space's own. */
  color?: number
  /** The person resized it: it no longer hugs its contents, it only grows to keep them inside. */
  sized?: boolean
}
export interface CanvasCard {
  id: number
  url: string
  /** Top-left corner on the board. */
  x: number
  y: number
  /** Size when resized by hand (defaults to CARD_W by CARD_H). */
  w?: number
  h?: number
  frame: string | null
  /** The person put it here by hand: Tidy up leaves it in its frame. */
  manual: boolean
  private: boolean
}
export interface CanvasNote extends Box {
  id: string
  text: string
  color: number
  /** The section it belongs to (moves with it, counts in its size); none or missing: loose on the board. */
  frame?: string | null
  /** A height the person dragged it to: the note grows past it for its text, never shrinks below it. */
  minH?: number
}
export interface Viewport {
  x: number
  y: number
  k: number
}
export interface CanvasState {
  v: 1
  /** 2: sections keep their title outside (above them). Missing in boards laid out before that (see `liftSections`). */
  lay?: 2
  /** Which run of the app the tab ids belong to: ids of an earlier run only match by address. */
  boot: string
  seq: number
  frames: CanvasFrame[]
  cards: CanvasCard[]
  notes: CanvasNote[]
  /** What the cards that are not tabs (negative ids) hold. Keyed by the card id. */
  items: Record<string, CanvasItem>
  /** Arrows between cards, notes, frames and points (see connectors.ts). Missing in boards saved before them. */
  connectors?: CanvasConnector[]
  /** Freehand lines, shapes and labels (see canvasMarks.ts). */
  marks?: CanvasMark[]
  /** How a page card shows, as the person chose it (by address): its words, or the picture of the page. */
  views?: Record<string, CardView>
  /** Pages last looked at live when opened from their card (by address): they open live again. */
  previews?: Record<string, 'live'>
  view: Viewport | null
  /** When it was last saved (ms); set by main, missing in boards saved before it. */
  usedAt?: number
  /**
   * The cards shown side by side in split view, in the split's order (kept in step with the tabs by the board).
   * A section lays them out as one unit: next to each other in one row, never wrapped apart.
   */
  split?: number[]
}
export type CardView = 'reader' | 'snapshot'
export interface TabLite {
  id: number
  url: string
  /** Private or Tor. */
  private: boolean
}
export interface Group {
  name: string
  ids: number[]
}

export const emptyState = (boot = ''): CanvasState => ({
  v: 1,
  lay: 2,
  boot,
  seq: 0,
  frames: [],
  cards: [],
  notes: [],
  items: {},
  connectors: [],
  view: null
})

/**
 * A board laid out while sections kept their title inside, on a 44px row above the cards: what is in each section
 * moves up into the room the title left, and the section is that much shorter. The same state for a current board.
 */
export function liftSections(s: CanvasState): CanvasState {
  if (s.lay === 2) return s
  const d = OLD_HEAD - HEAD
  return {
    ...s,
    lay: 2,
    frames: s.frames.map((f) => ({ ...f, h: Math.max(FRAME_MIN.h, f.h - d) })),
    cards: s.cards.map((c) => (c.frame ? { ...c, y: c.y - d } : c)),
    notes: s.notes.map((n) => (n.frame ? { ...n, y: n.y - d } : n))
  }
}

// ---- geometry ----

export const intersects = (a: Box, b: Box, gap = 0): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap

export const cardBox = (c: { x: number; y: number; w?: number; h?: number }): Box => ({
  x: c.x,
  y: c.y,
  w: c.w ?? CARD_W,
  h: c.h ?? CARD_H
})

const contains = (b: Box, px: number, py: number): boolean =>
  px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h

export const boundsOf = (boxes: Box[]): Box | null => {
  if (boxes.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const b of boxes) {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** The view that shows `box` inside a window of vw by vh with `pad` around it, never zoomed in past `maxK`. */
export function fitView(box: Box | null, vw: number, vh: number, pad = 64, maxK = 1): Viewport {
  if (!box || vw <= 0 || vh <= 0) return { x: vw / 2, y: vh / 2, k: 1 }
  const k = Math.min(maxK, Math.max(0.05, Math.min((vw - pad * 2) / box.w, (vh - pad * 2) / box.h)))
  return { k, x: vw / 2 - (box.x + box.w / 2) * k, y: vh / 2 - (box.y + box.h / 2) * k }
}

export const gridCols = (n: number): number =>
  Math.min(MAX_COLS, Math.max(1, Math.ceil(Math.sqrt(0.9 * n))))

export function frameBox(n: number, cols = gridCols(n)): { w: number; h: number } {
  const rows = Math.max(1, Math.ceil(n / cols))
  return {
    w: PAD * 2 + cols * CARD_W + (cols - 1) * GAP,
    h: HEAD + rows * CARD_H + (rows - 1) * GAP + PAD
  }
}

export const colsOf = (f: Box): number =>
  Math.max(1, Math.floor((f.w - PAD * 2 + GAP) / (CARD_W + GAP)))

/** Top-left of the i-th card slot of a frame. */
export function slotAt(f: Box, i: number): { x: number; y: number } {
  const cols = colsOf(f)
  return {
    x: f.x + PAD + (i % cols) * (CARD_W + GAP),
    y: f.y + HEAD + Math.floor(i / cols) * (CARD_H + GAP)
  }
}

const rowsHeight = (rows: number): number => HEAD + rows * CARD_H + (rows - 1) * GAP + PAD

/**
 * A spot for a box of `size` near `near` where it touches none of `obstacles` (with `gap` between). Looks outward
 * in steps; the order of candidates is fixed, so the answer is too.
 */
export function freeSpot(
  size: { w: number; h: number },
  obstacles: Box[],
  near: { x: number; y: number },
  gap = FRAME_GAP / 2
): { x: number; y: number } {
  const free = (x: number, y: number): boolean =>
    !obstacles.some((o) => intersects({ x, y, w: size.w, h: size.h }, o, gap))
  if (free(near.x, near.y)) return { x: near.x, y: near.y }
  const step = 48
  for (let r = 1; r <= 60; r++) {
    const ring: Array<{ x: number; y: number; d: number }> = []
    for (let i = -r; i <= r; i++) {
      for (const [dx, dy] of [
        [i, -r],
        [i, r],
        [-r, i],
        [r, i]
      ]) {
        ring.push({ x: near.x + dx * step, y: near.y + dy * step, d: dx * dx + dy * dy })
      }
    }
    ring.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x)
    const hit = ring.find((p) => free(p.x, p.y))
    if (hit) return { x: hit.x, y: hit.y }
  }
  const b = boundsOf(obstacles)
  return { x: near.x, y: b ? b.y + b.h + gap : near.y }
}

/**
 * Boxes in rows, left to right, wrapping at `rowWidth`, stepping round `obstacles`. Nothing overlaps anything.
 * Returns the top-left of each item by id.
 */
export function packShelves(
  items: Array<{ id: string; w: number; h: number }>,
  obstacles: Box[],
  origin: { x: number; y: number },
  rowWidth: number
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  const placed: Box[] = [...obstacles]
  let x = origin.x
  let y = origin.y
  let rowH = 0
  for (const it of items) {
    for (let guard = 0; guard < 5000; guard++) {
      if (x > origin.x && x + it.w > origin.x + rowWidth) {
        x = origin.x
        y += Math.max(rowH, 8) + FRAME_GAP
        rowH = 0
      }
      const hit = placed.find((p) => intersects({ x, y, w: it.w, h: it.h }, p, FRAME_GAP / 2))
      if (!hit) break
      x = hit.x + hit.w + FRAME_GAP
    }
    out.set(it.id, { x, y })
    placed.push({ x, y, w: it.w, h: it.h })
    x += it.w + FRAME_GAP
    rowH = Math.max(rowH, it.h)
  }
  return out
}

// ---- what may be clustered ----

/** The tabs that may be sent to the embedding index and clustering: never private or Tor, only web pages. */
export const clusterable = (tabs: TabLite[]): TabLite[] =>
  tabs.filter((t) => !t.private && /^https?:/i.test(t.url))

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Without a model: tabs on the same site together (two or more), named after it. */
export function hostClusters(tabs: TabLite[], minSize = 2): Group[] {
  const byHost = new Map<string, number[]>()
  for (const t of clusterable(tabs)) {
    const h = hostOf(t.url)
    if (h) byHost.set(h, [...(byHost.get(h) ?? []), t.id])
  }
  return [...byHost]
    .filter(([, ids]) => ids.length >= minSize)
    .map(([h, ids]) => ({ name: fallbackName([`https://${h}`]), ids }))
    .sort((a, b) => b.ids.length - a.ids.length || a.ids[0] - b.ids[0])
}

/** The unit-length average of some unit vectors (null for none). */
export function centroid(vecs: ArrayLike<number>[]): Float32Array | null {
  if (vecs.length === 0) return null
  const out = new Float32Array(vecs[0].length)
  for (const v of vecs) for (let i = 0; i < out.length; i++) out[i] += v[i]
  let n = 0
  for (const x of out) n += x * x
  n = Math.sqrt(n)
  if (n > 0) for (let i = 0; i < out.length; i++) out[i] /= n
  return out
}

/** The frame whose centre of meaning is closest to `vec`, if close enough; otherwise null (it goes to Other). */
export function assignByCentroid(
  vec: ArrayLike<number>,
  frames: Array<{ id: string; vectors: ArrayLike<number>[] }>,
  threshold = CANVAS_THRESHOLD
): string | null {
  let best: string | null = null
  let bestScore = -Infinity
  for (const f of frames) {
    const c = centroid(f.vectors)
    if (!c) continue
    const s = cosine(vec, c)
    if (s >= threshold && s > bestScore) {
      best = f.id
      bestScore = s
    }
  }
  return best
}

// ---- state helpers ----

const members = (s: CanvasState, frameId: string): CanvasCard[] =>
  s.cards.filter((c) => c.frame === frameId)

const memberNotes = (s: CanvasState, frameId: string): CanvasNote[] =>
  s.notes.filter((n) => n.frame === frameId)

/** Notes that sit on the board, not in a section. */
const looseNotes = (s: CanvasState): CanvasNote[] => s.notes.filter((n) => !n.frame)

/** Drawings (shapes, text, blocks, lines) as boxes: new frames, notes and cards keep clear of them. */
const markBoxes = (s: CanvasState): Box[] =>
  (s.marks ?? []).map((m) => ({ x: m.x, y: m.y, w: m.w, h: m.h }))
const frameObstacles = (s: CanvasState, except?: string): Box[] => [
  ...s.frames.filter((f) => f.id !== except),
  ...looseNotes(s),
  ...markBoxes(s)
]

function withFrame(s: CanvasState, f: CanvasFrame): CanvasState {
  return { ...s, frames: s.frames.map((x) => (x.id === f.id ? f : x)) }
}

function translateFrame(s: CanvasState, id: string, dx: number, dy: number): CanvasState {
  if (dx === 0 && dy === 0) return s
  return {
    ...s,
    frames: s.frames.map((f) => (f.id === id ? { ...f, x: f.x + dx, y: f.y + dy } : f)),
    cards: s.cards.map((c) => (c.frame === id ? { ...c, x: c.x + dx, y: c.y + dy } : c)),
    notes: s.notes.map((n) => (n.frame === id ? { ...n, x: n.x + dx, y: n.y + dy } : n))
  }
}

/** If a frame overlaps another frame or a note, move it (with its cards) to the nearest free place. */
function settleFrame(s: CanvasState, id: string): CanvasState {
  const f = s.frames.find((x) => x.id === id)
  if (!f) return s
  const others = frameObstacles(s, id)
  if (!others.some((o) => intersects(f, o, FRAME_GAP / 4))) return s
  const spot = freeSpot(f, others, f)
  return translateFrame(s, id, spot.x - f.x, spot.y - f.y)
}

/** Shrink a frame's height to its last row of cards (never below one row). */
function shrinkFrame(s: CanvasState, id: string): CanvasState {
  const f = s.frames.find((x) => x.id === id)
  if (!f) return s
  // down to what is in it, plus its padding (a split view's outline needs more room when it is the last row)
  const cs = members(s, id)
  const ns = memberNotes(s, id)
  const bottoms = [...cs.map((c) => c.y + (c.h ?? CARD_H)), ...ns.map((n) => n.y + n.h)]
  if (!bottoms.length) return s
  const low = Math.max(...bottoms)
  const split = new Set(s.split ?? [])
  const splitLast =
    cs.some((c) => split.has(c.id) && c.y + (c.h ?? CARD_H) >= low - 0.5) && split.size >= 2
  const h = Math.max(rowsHeight(1), low - f.y + PAD + (splitLast ? SPLIT_SIDE : 0))
  return h < f.h ? withFrame(s, { ...f, h }) : s
}

const dropIfEmpty = (s: CanvasState, id: string | null): CanvasState => {
  if (!id) return s
  const f = s.frames.find((x) => x.id === id)
  if (!f) return s
  const count = members(s, id).length + memberNotes(s, id).length
  if (count === 0 && !f.pinned && f.kind !== 'user') {
    return { ...s, frames: s.frames.filter((x) => x.id !== id) }
  }
  // what is left closes up into a tidy grid, in reading order (a section sized by hand keeps its shape)
  if (count > 0 && !f.sized) return regridFrame(s, id)
  return shrinkFrame(s, id)
}

/** A section lost a member: it closes up (or goes, if it was made by tidy and is now empty). */
export const closeUp = (s: CanvasState, id: string | null): CanvasState => dropIfEmpty(s, id)

/** The first slot of a frame no card (other than `skip`) sits on, growing the frame when it is full. */
function freeSlot(
  s: CanvasState,
  f: CanvasFrame,
  skip: Set<number>,
  near?: { x: number; y: number },
  skipNote: Set<string> = new Set()
): { frame: CanvasFrame; x: number; y: number } {
  const others = members(s, f.id).filter((c) => !skip.has(c.id))
  const notesIn = memberNotes(s, f.id).filter((n) => !skipNote.has(n.id))
  const item = skip.size === 1 ? s.cards.find((c) => skip.has(c.id)) : undefined
  const iw = item?.w ?? CARD_W
  const ih = item?.h ?? CARD_H
  const taken = (p: { x: number; y: number }): boolean =>
    others.some((c) => intersects(cardBox(c), { x: p.x, y: p.y, w: iw, h: ih }, -GAP / 2)) ||
    notesIn.some((n) => intersects(n, { x: p.x, y: p.y, w: iw, h: ih }, -GAP / 2))
  const cols = colsOf(f)
  const cap = Math.max(1, Math.round((f.h - HEAD - PAD + GAP) / (CARD_H + GAP))) * cols
  const total = Math.max(cap, others.length + notesIn.length + 1) + cols
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < total; i++) {
    const p = slotAt(f, i)
    if (taken(p)) continue
    const d = near ? (p.x - near.x) ** 2 + (p.y - near.y) ** 2 : i
    if (d < bestD) {
      best = i
      bestD = d
    }
  }
  const p = slotAt(f, best)
  const rows = Math.floor(best / cols) + 1
  const needW = Math.max(f.w, p.x - f.x + iw + PAD)
  const needH = Math.max(rowsHeight(rows), p.y - f.y + ih + PAD)
  const nextFrame =
    needW > f.w || needH > f.h ? { ...f, w: Math.max(f.w, needW), h: Math.max(f.h, needH) } : f
  return { frame: nextFrame, x: p.x, y: p.y }
}

function ensureFrame(s: CanvasState, kind: 'other' | 'private'): CanvasState {
  const id = kind === 'other' ? OTHER_ID : PRIVATE_ID
  if (s.frames.some((f) => f.id === id)) return s
  const { w, h } = frameBox(0)
  const b = boundsOf(s.frames)
  const spot = freeSpot({ w, h }, frameObstacles(s), {
    x: b ? b.x : 0,
    y: b ? b.y + b.h + FRAME_GAP : 0
  })
  const frame: CanvasFrame = {
    id,
    name: kind === 'other' ? 'Other' : 'Private',
    kind,
    x: spot.x,
    y: spot.y,
    w,
    h,
    pinned: false
  }
  return { ...s, frames: [...s.frames, frame] }
}

/**
 * Lay a frame's cards out again in reading order, in the grid its card count calls for. A split view in it is one
 * unit: its cards side by side in their split order, starting a new row rather than wrapping apart (the grid is
 * made wide enough for it). `keepCols`: keep the frame's own width (a section sized by hand) where it fits.
 */
export function regridFrame(s: CanvasState, id: string, keepCols = false): CanvasState {
  const f = s.frames.find((x) => x.id === id)
  if (!f) return s
  const cs = members(s, id).sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id)
  const ns = memberNotes(s, id).sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
  const inHere = new Set(cs.map((c) => c.id))
  const pair = (s.split ?? []).filter((c) => inHere.has(c))
  const units: number[][] = []
  const done = new Set<number>()
  for (const c of cs) {
    if (done.has(c.id)) continue
    const unit = pair.length >= 2 && pair.includes(c.id) ? pair : [c.id]
    for (const u of unit) done.add(u)
    units.push(unit)
  }
  const n = cs.length + ns.length
  const widest = Math.max(1, ...units.map((u) => u.length))
  const cols = Math.min(MAX_COLS, Math.max(widest, keepCols ? colsOf(f) : gridCols(n)))
  const side = pair.length >= 2 ? SPLIT_SIDE : 0
  const cellOf = new Map<number, number>()
  const splitRows = new Set<number>()
  let cell = 0
  for (const u of units) {
    // a split view has a row to itself (its lip needs room above it, its outline room around it)
    if (u.length > 1 && cell % cols !== 0) cell = Math.ceil(cell / cols) * cols
    if (u.length > 1) splitRows.add(Math.floor(cell / cols))
    u.forEach((cid, k) => cellOf.set(cid, cell + k))
    cell += u.length
    if (u.length > 1) cell = Math.ceil(cell / cols) * cols
  }
  const totalCells = cell + ns.length
  const rows = Math.max(1, Math.ceil(totalCells / cols))
  const colW = Array.from({ length: cols }, () => CARD_W)
  const rowH = Array.from({ length: rows }, () => CARD_H)
  const byId = new Map(cs.map((c) => [c.id, c]))
  for (const [cid, i] of cellOf) {
    const c = byId.get(cid)
    if (!c) continue
    const col = i % cols
    const row = Math.floor(i / cols)
    if ((c.w ?? CARD_W) > colW[col]) colW[col] = c.w ?? CARD_W
    if ((c.h ?? CARD_H) > rowH[row]) rowH[row] = c.h ?? CARD_H
  }
  ns.forEach((note, j) => {
    const i = cell + j
    const col = i % cols
    const row = Math.floor(i / cols)
    if (note.w > colW[col]) colW[col] = note.w
    if (note.h > rowH[row]) rowH[row] = note.h
  })
  const colX: number[] = []
  let cx = PAD
  for (let c = 0; c < cols; c++) {
    colX.push(cx)
    cx += colW[c] + GAP
  }
  const rowY: number[] = []
  let ry = HEAD
  for (let r = 0; r < rows; r++) {
    rowY.push(ry)
    ry += rowH[r] + GAP
  }
  // each row with a split in it is set lower, and every row below follows (lower again past the split's outline)
  const lower = (row: number): number =>
    [...splitRows].reduce(
      (a, r) =>
        a +
        (r <= row ? (r === 0 ? SPLIT_TOP_EXTRA : SPLIT_ROW_EXTRA) : 0) +
        (r < row ? SPLIT_ROW_BELOW : 0),
      0
    )
  const place = (i: number): { x: number; y: number } => {
    const col = i % cols
    const row = Math.floor(i / cols)
    return { x: f.x + colX[col] + side, y: f.y + rowY[row] + lower(row) }
  }
  const at = new Map([...cellOf].map(([cid, i]) => [cid, place(i)]))
  const nat = new Map(ns.map((note, i) => [note.id, place(cell + i)]))
  const grown = {
    ...f,
    w: PAD * 2 + colW.reduce((a, b) => a + b, 0) + (cols - 1) * GAP + side * 2,
    h:
      HEAD +
      rowH.reduce((a, b) => a + b, 0) +
      (rows - 1) * GAP +
      PAD +
      lower(rows - 1) +
      (splitRows.has(rows - 1) ? SPLIT_SIDE : 0)
  }
  return {
    ...withFrame(s, grown),
    cards: s.cards.map((c) => (at.has(c.id) ? { ...c, ...at.get(c.id)! } : c)),
    notes: s.notes.map((note) => (nat.has(note.id) ? { ...note, ...nat.get(note.id)! } : note))
  }
}

/**
 * Put a split view's cards into a section, together: they go in where they were dropped (`dx`, `dy` from where they
 * are), the section lays itself out again around them, and the sections they left close up.
 */
export function seatSplit(
  s: CanvasState,
  ids: number[],
  frameId: string,
  dx = 0,
  dy = 0
): CanvasState {
  const f = s.frames.find((x) => x.id === frameId)
  if (!f || f.kind === 'private' || ids.length < 2) return s
  const set = new Set(ids)
  const from = new Set(
    s.cards.filter((c) => set.has(c.id) && c.frame !== frameId).map((c) => c.frame)
  )
  let next: CanvasState = {
    ...s,
    split: ids,
    cards: s.cards.map((c) =>
      set.has(c.id) ? { ...c, x: c.x + dx, y: c.y + dy, frame: frameId, manual: true } : c
    )
  }
  next = regridFrame(next, frameId, !!f.sized)
  next = settleFrame(next, frameId)
  for (const id of from) next = dropIfEmpty(next, id)
  return next
}

/** Put a card (already in `cards`) into a frame's first free slot. */
function seat(
  s: CanvasState,
  cardId: number,
  frameId: string,
  near?: { x: number; y: number },
  manual?: boolean
): CanvasState {
  const f = s.frames.find((x) => x.id === frameId)
  const card = s.cards.find((c) => c.id === cardId)
  if (!f || !card) return s
  const slot = freeSlot(s, f, new Set([cardId]), near)
  let next: CanvasState = {
    ...withFrame(s, slot.frame),
    cards: s.cards.map((c) =>
      c.id === cardId
        ? {
            ...c,
            x: slot.x,
            y: slot.y,
            frame: frameId,
            manual: manual ?? (f.kind === 'user' ? true : c.manual)
          }
        : c
    )
  }
  // a frame that keeps taking cards in one column of rows is made wider instead
  const grown = next.frames.find((x) => x.id === frameId)
  const n = members(next, frameId).length
  if (grown && n > 4 && gridCols(n) > colsOf(grown)) next = regridFrame(next, frameId)
  next = settleFrame(next, frameId)
  return next
}

// ---- syncing with the open tabs ----

/**
 * Bring a board in line with the tabs: cards of closed tabs go, a tab whose address changed keeps its card, and a
 * new tab gets a card in Other (a private one in Private) for now. `added` lists the new tab ids so the caller can
 * ask where AI would put them.
 */
export function syncTabs(
  prev: CanvasState,
  tabs: TabLite[]
): { state: CanvasState; added: number[] } {
  const ids = new Set(tabs.map((t) => t.id))
  const byId = new Map(prev.cards.map((c) => [c.id, c]))
  let s: CanvasState = {
    ...prev,
    cards: prev.cards
      .filter((c) => c.id < 0 || ids.has(c.id))
      .map((c) => {
        const t = tabs.find((x) => x.id === c.id)
        return t && !t.private && t.url !== c.url ? { ...c, url: t.url } : c
      })
  }
  const gone = new Set(prev.cards.filter((c) => c.id >= 0 && !ids.has(c.id)).map((c) => c.frame))
  for (const fid of gone) s = dropIfEmpty(s, fid)
  const added: number[] = []
  for (const t of tabs) {
    if (byId.has(t.id)) continue
    added.push(t.id)
    const kind = t.private ? 'private' : 'other'
    s = ensureFrame(s, kind)
    const card: CanvasCard = {
      id: t.id,
      url: t.private ? '' : t.url,
      x: 0,
      y: 0,
      frame: null,
      manual: false,
      private: t.private
    }
    s = { ...s, cards: [...s.cards, card] }
    s = seat(s, t.id, kind === 'other' ? OTHER_ID : PRIVATE_ID)
  }
  return { state: s, added }
}

/** Move a tab's card into a frame (its first free slot). */
export function moveToFrame(
  s: CanvasState,
  cardId: number,
  frameId: string,
  manual = false
): CanvasState {
  const card = s.cards.find((c) => c.id === cardId)
  const target = s.frames.find((f) => f.id === frameId)
  if (!card || !target || card.private || target.kind === 'private' || card.frame === frameId)
    return s
  const from = card.frame
  return dropIfEmpty(seat(s, cardId, frameId, undefined, manual), from)
}

// ---- tidy up ----

const overlapCount = (a: number[], b: Set<number>): number => a.filter((i) => b.has(i)).length

/**
 * Lay the board out again from `groups` (what AI found, over `clusterable` tabs only).
 * Frames keep their id, name and place when their cards are the same; a frame the person named or moved stays where
 * it is when its cards change; cards the person placed by hand or grouped into a user section stay in their frames.
 * `rearrange` resets AI topic frames and loose placements while keeping user-created sections, results and notes.
 * Nothing overlaps afterwards.
 */
export function tidy(
  prev: CanvasState,
  tabs: TabLite[],
  groups: Group[],
  rearrange = false
): CanvasState {
  const order = new Map(tabs.map((t, i) => [t.id, i]))
  const byOrder = (a: number, b: number): number => (order.get(a) ?? 0) - (order.get(b) ?? 0)
  const userFrameIds = new Set(prev.frames.filter((f) => f.kind === 'user').map((f) => f.id))
  const sizeById = new Map(
    prev.cards
      .filter((c) => c.w !== undefined || c.h !== undefined)
      .map((c) => [c.id, { w: c.w, h: c.h }])
  )
  const base: CanvasState = rearrange
    ? {
        ...prev,
        frames: prev.frames.filter((f) => f.kind === 'result' || f.kind === 'user'),
        cards: prev.cards.filter(
          (c) => c.id < 0 || (c.frame !== null && userFrameIds.has(c.frame) && order.has(c.id))
        )
      }
    : { ...prev, cards: prev.cards.filter((c) => c.id < 0 || order.has(c.id)) }
  const old = new Map(base.cards.map((c) => [c.id, c]))
  const inUserFrame = (id: number): boolean => {
    const f = old.get(id)?.frame
    return !!f && userFrameIds.has(f)
  }
  const fixed = (id: number): boolean =>
    !old.get(id)?.private && (!!old.get(id)?.manual || inUserFrame(id))
  const lite = new Map(tabs.map((t) => [t.id, t]))
  const freeIds = new Set(
    clusterable(tabs)
      .filter((t) => !fixed(t.id))
      .map((t) => t.id)
  )
  const gs = groups
    .map((g) => ({ name: g.name, ids: g.ids.filter((i) => freeIds.has(i)).sort(byOrder) }))
    .filter((g) => g.ids.length > 0)
  const grouped = new Set(gs.flatMap((g) => g.ids))
  const rest = tabs.filter((t) => !t.private && !fixed(t.id) && !grouped.has(t.id)).map((t) => t.id)
  const priv = tabs
    .filter((t) => t.private)
    .sort((a, b) => hostOf(a.url).localeCompare(hostOf(b.url)) || byOrder(a.id, b.id))
    .map((t) => t.id)

  // which existing frame each group continues
  const prevMembers = (fid: string): number[] =>
    base.cards.filter((c) => c.frame === fid && !fixed(c.id) && !c.private).map((c) => c.id)
  const allPrevIn = (fid: string): number[] =>
    prev.cards.filter((c) => c.frame === fid).map((c) => c.id)
  const candidates = base.frames.filter((f) => f.kind === 'topic' || f.kind === 'user')
  const pairs: Array<{ g: number; f: number; n: number }> = []
  gs.forEach((g, gi) =>
    candidates.forEach((f, fi) => {
      const mem = prevMembers(f.id)
      const n = overlapCount(mem, new Set(g.ids))
      if (n > 0 && n * 2 >= Math.min(g.ids.length, mem.length)) pairs.push({ g: gi, f: fi, n })
    })
  )
  pairs.sort((a, b) => b.n - a.n || a.g - b.g || a.f - b.f)
  const frameOfGroup = new Map<number, CanvasFrame>()
  const usedFrames = new Set<string>()
  for (const p of pairs) {
    if (frameOfGroup.has(p.g) || usedFrames.has(candidates[p.f].id)) continue
    frameOfGroup.set(p.g, candidates[p.f])
    usedFrames.add(candidates[p.f].id)
  }

  interface Plan {
    frame: CanvasFrame
    ids: number[]
    keep: boolean
  }
  const plans: Plan[] = []
  let seq = base.seq
  const sameSet = (a: number[], b: number[]): boolean =>
    a.length === b.length && a.every((x) => b.includes(x))
  const fixedIn = (fid: string): number[] =>
    base.cards
      .filter((c) => c.frame === fid && fixed(c.id))
      .map((c) => c.id)
      .sort(byOrder)
  gs.forEach((g, gi) => {
    const f = frameOfGroup.get(gi)
    if (f) {
      const ids = [...g.ids, ...fixedIn(f.id)].sort(byOrder)
      const keep = sameSet(prevMembers(f.id), g.ids) && sameSet(allPrevIn(f.id), ids)
      plans.push({ frame: f, ids, keep })
    } else {
      const frame: CanvasFrame = {
        id: `f${++seq}`,
        name: g.name,
        kind: 'topic',
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        pinned: false
      }
      plans.push({ frame, ids: g.ids, keep: false })
    }
  })
  // frames no group continues: they stay while they hold hand-placed cards or were made by hand
  for (const f of candidates) {
    if (usedFrames.has(f.id)) continue
    const fx = fixedIn(f.id)
    if (fx.length > 0 || f.pinned || f.kind === 'user')
      plans.push({
        frame: f,
        ids: fx,
        keep: prevMembers(f.id).length === 0 && sameSet(allPrevIn(f.id), fx)
      })
  }
  const other = base.frames.find((f) => f.id === OTHER_ID)
  if (rest.length > 0 || (other && fixedIn(OTHER_ID).length > 0)) {
    const frame: CanvasFrame = other ?? {
      id: OTHER_ID,
      name: 'Other',
      kind: 'other',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      pinned: false
    }
    const ids = [...rest, ...fixedIn(OTHER_ID)].sort(byOrder)
    plans.push({
      frame,
      ids,
      keep: !!other && sameSet(prevMembers(OTHER_ID), rest) && sameSet(allPrevIn(OTHER_ID), ids)
    })
  }
  const pf = base.frames.find((f) => f.id === PRIVATE_ID)
  if (priv.length > 0) {
    const frame: CanvasFrame = pf ?? {
      id: PRIVATE_ID,
      name: 'Private',
      kind: 'private',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      pinned: false
    }
    const was = base.cards.filter((c) => c.frame === PRIVATE_ID).map((c) => c.id)
    plans.push({ frame, ids: priv, keep: !!pf && sameSet(was, priv) })
  }

  // sizes; frames that keep their cards keep their box; a pinned one keeps its corner
  const notesOf = new Map<string, CanvasNote[]>()
  for (const n of base.notes)
    if (n.frame) notesOf.set(n.frame, [...(notesOf.get(n.frame) ?? []), n])
  const movedNotes = new Map<string, CanvasNote>()
  const settled: Box[] = [
    ...looseNotes(base),
    ...markBoxes(base),
    ...base.cards.filter((c) => c.frame === null && fixed(c.id)).map(cardBox)
  ]
  const frames: CanvasFrame[] = []
  const cards = new Map<number, CanvasCard>()
  // what the prompt made (result frames and their cards) is the person's: tidy up never moves it
  for (const f of base.frames) {
    if (f.kind !== 'result') continue
    frames.push(f)
    settled.push(f)
  }
  for (const c of base.cards) if (c.id < 0) cards.set(c.id, c)
  const gridFor = (
    plan: Plan
  ): { w: number; h: number; cols: number; colX: number[]; rowY: number[] } => {
    const notes = notesOf.get(plan.frame.id) ?? []
    const total = plan.ids.length + notes.length
    const cols = gridCols(total)
    const rows = Math.max(1, Math.ceil(total / cols))
    const colW = Array.from({ length: cols }, () => CARD_W)
    const rowH = Array.from({ length: rows }, () => CARD_H)
    plan.ids.forEach((id, i) => {
      const sz = sizeById.get(id)
      const w = sz?.w ?? CARD_W
      const h = sz?.h ?? CARD_H
      const col = i % cols
      const row = Math.floor(i / cols)
      if (w > colW[col]) colW[col] = w
      if (h > rowH[row]) rowH[row] = h
    })
    notes.forEach((n, j) => {
      const i = plan.ids.length + j
      const col = i % cols
      const row = Math.floor(i / cols)
      if (n.w > colW[col]) colW[col] = n.w
      if (n.h > rowH[row]) rowH[row] = n.h
    })
    const colX: number[] = []
    let cx = PAD
    for (let c = 0; c < cols; c++) {
      colX.push(cx)
      cx += colW[c] + GAP
    }
    const rowY: number[] = []
    let ry = HEAD
    for (let r = 0; r < rows; r++) {
      rowY.push(ry)
      ry += rowH[r] + GAP
    }
    return {
      w: PAD * 2 + colW.reduce((a, b) => a + b, 0) + (cols - 1) * GAP,
      h: HEAD + rowH.reduce((a, b) => a + b, 0) + (rows - 1) * GAP + PAD,
      cols,
      colX,
      rowY
    }
  }
  const sizeOf = (plan: Plan): { w: number; h: number } => {
    const g = gridFor(plan)
    return { w: g.w, h: g.h }
  }
  const put = (plan: Plan, x: number, y: number): void => {
    const g = gridFor(plan)
    const frame = { ...plan.frame, x, y, w: g.w, h: g.h }
    frames.push(frame)
    settled.push(frame)
    const at = (i: number): { x: number; y: number } => ({
      x: frame.x + g.colX[i % g.cols],
      y: frame.y + g.rowY[Math.floor(i / g.cols)]
    })
    ;(notesOf.get(frame.id) ?? []).forEach((n, i) =>
      movedNotes.set(n.id, { ...n, ...at(plan.ids.length + i) })
    )
    plan.ids.forEach((id, i) => {
      const p = at(i)
      const t = lite.get(id)
      const c = old.get(id)
      const sz = sizeById.get(id)
      const card: CanvasCard = {
        id,
        url: t ? (t.private ? '' : t.url) : (c?.url ?? ''),
        x: p.x,
        y: p.y,
        frame: frame.id,
        manual: c?.manual ?? false,
        private: !!t?.private
      }
      if (sz?.w !== undefined) card.w = sz.w
      if (sz?.h !== undefined) card.h = sz.h
      cards.set(id, card)
    })
  }
  const kept = plans.filter((p) => p.keep && p.frame.w > 0)
  for (const plan of kept) {
    frames.push(plan.frame)
    settled.push(plan.frame)
    for (const c of base.cards) if (c.frame === plan.frame.id) cards.set(c.id, c)
  }
  const placed = new Set(kept.map((p) => p.frame.id))
  // changed frames the person pinned keep their corner (moved clear of anything in the way)
  for (const plan of plans) {
    if (placed.has(plan.frame.id) || !plan.frame.pinned || plan.frame.w === 0) continue
    const size = sizeOf(plan)
    const spot = freeSpot(size, settled, plan.frame)
    put(plan, spot.x, spot.y)
    placed.add(plan.frame.id)
  }
  const flow = plans.filter((p) => !placed.has(p.frame.id))
  const rank = (p: Plan): number =>
    p.frame.kind === 'private' ? 2 : p.frame.kind === 'other' ? 1 : 0
  flow.sort((a, b) => rank(a) - rank(b) || b.ids.length - a.ids.length)
  const sizes = flow.map((p) => ({ id: p.frame.id, ...sizeOf(p) }))
  const area = sizes.reduce((a, z) => a + (z.w + FRAME_GAP) * (z.h + FRAME_GAP), 0)
  const rowWidth = Math.max(1500, ...sizes.map((z) => z.w), Math.round(Math.sqrt(area * 1.9)))
  const origin =
    rearrange || frames.length === 0
      ? { x: 0, y: 0 }
      : { x: boundsOf(settled)?.x ?? 0, y: boundsOf(settled)?.y ?? 0 }
  const spots = packShelves(sizes, settled, origin, rowWidth)
  for (const plan of flow) {
    const p = spots.get(plan.frame.id) ?? { x: 0, y: 0 }
    put(plan, p.x, p.y)
  }
  // loose hand-placed cards stay where they are
  for (const c of base.cards) if (!cards.has(c.id)) cards.set(c.id, c)
  const orderedCards = [
    ...tabs.flatMap((t) => (cards.has(t.id) ? [cards.get(t.id)!] : [])),
    ...[...cards.values()].filter((c) => c.id < 0)
  ]
  // notes of a section that is gone stay where they are, loose
  const alive = new Set(frames.map((f) => f.id))
  const notes = base.notes.map(
    (n) => movedNotes.get(n.id) ?? (n.frame && !alive.has(n.frame) ? { ...n, frame: null } : n)
  )
  return { ...base, seq, frames, cards: orderedCards, notes }
}

// ---- editing ----

/** The frame under a point (the smallest, if they nest). */
export function frameAt(s: CanvasState, px: number, py: number): CanvasFrame | null {
  let best: CanvasFrame | null = null
  for (const f of s.frames) {
    if (contains(f, px, py) && (!best || f.w * f.h < best.w * best.h)) best = f
  }
  return best
}

/**
 * Drop cards moved by (dx, dy) with the pointer at `at`. In a frame they snap to its nearest free slots (and the frame
 * grows if it must); elsewhere they stay loose where dropped, nudged clear of whatever is there. A private tab only
 * goes to the Private frame, and nothing else goes into it.
 */
export function dropCards(
  prev: CanvasState,
  ids: number[],
  dx: number,
  dy: number,
  at: { x: number; y: number }
): CanvasState {
  const pending = new Set(ids) // moving cards not yet seated: they do not count as occupying a slot
  let s = prev
  const target = frameAt(prev, at.x, at.y)
  const from = new Set<string | null>()
  const sorted = [...ids].sort((a, b) => {
    const ca = prev.cards.find((c) => c.id === a)
    const cb = prev.cards.find((c) => c.id === b)
    return (ca?.y ?? 0) - (cb?.y ?? 0) || (ca?.x ?? 0) - (cb?.x ?? 0) || a - b
  })
  for (const id of sorted) {
    const c = s.cards.find((x) => x.id === id)
    pending.delete(id)
    if (!c) continue
    const to = { x: c.x + dx, y: c.y + dy }
    if (c.private) {
      // stays in Private, snaps to the slot nearest the drop
      if (target?.id === PRIVATE_ID) {
        from.add(c.frame)
        s = seatAt(s, id, PRIVATE_ID, to, pending)
      }
      continue
    }
    if (target && target.kind !== 'private') {
      from.add(c.frame)
      s = seatAt(s, id, target.id, to, pending)
    } else if (!target) {
      from.add(c.frame)
      const others = [
        ...s.frames,
        ...looseNotes(s),
        ...s.cards.filter((o) => o.id !== id && o.frame === null).map(cardBox)
      ]
      const spot = freeSpot({ w: c.w ?? CARD_W, h: c.h ?? CARD_H }, others, to, GAP)
      s = {
        ...s,
        cards: s.cards.map((x) => (x.id === id ? { ...x, ...spot, frame: null, manual: true } : x))
      }
    }
  }
  for (const f of from) s = dropIfEmpty(s, f)
  return s
}

function seatAt(
  s: CanvasState,
  id: number,
  frameId: string,
  near: { x: number; y: number },
  skip: Set<number>
): CanvasState {
  const f = s.frames.find((x) => x.id === frameId)
  if (!f) return s
  const slot = freeSlot(s, f, new Set([...skip, id]), near)
  let next: CanvasState = {
    ...withFrame(s, slot.frame),
    cards: s.cards.map((c) =>
      c.id === id ? { ...c, x: slot.x, y: slot.y, frame: frameId, manual: true } : c
    )
  }
  next = settleFrame(next, frameId)
  return next
}

/** Move a frame and its cards by (dx, dy); it is pinned from then on. */
export function moveFrame(s: CanvasState, id: string, dx: number, dy: number): CanvasState {
  const f = s.frames.find((x) => x.id === id)
  if (!f) return s
  let next = translateFrame(s, id, dx, dy)
  next = withFrame(next, { ...next.frames.find((x) => x.id === id)!, pinned: true })
  return settleFrame(next, id)
}

export function setFrameColor(s: CanvasState, id: string, color: number | null): CanvasState {
  const f = s.frames.find((x) => x.id === id)
  const c = color === null ? undefined : Math.max(0, Math.min(FRAME_COLORS - 1, Math.round(color)))
  if (!f || f.color === c) return s
  const next: CanvasFrame = { ...f, pinned: true }
  if (c === undefined) delete next.color
  else next.color = c
  return withFrame(s, next)
}

/** The smallest a frame may be drawn or resized to. */
export const FRAME_MIN = { w: 200, h: HEAD + 76 }

/**
 * Give a frame a new box (a resize by its handles). Cards whose middle is left outside fall out of it (loose, where
 * they are); loose cards whose middle is now inside join it. A private card never joins a frame that is not Private.
 */
export function resizeFrame(s: CanvasState, id: string, box: Box): CanvasState {
  const f = s.frames.find((x) => x.id === id)
  if (!f) return s
  const b = {
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.round(Math.max(FRAME_MIN.w, box.w)),
    h: Math.round(Math.max(FRAME_MIN.h, box.h))
  }
  if (b.x === f.x && b.y === f.y && b.w === f.w && b.h === f.h) return s
  const frame: CanvasFrame = { ...f, ...b, pinned: true, sized: true }
  const mid = (c: CanvasCard): boolean =>
    contains(frame, c.x + (c.w ?? CARD_W) / 2, c.y + (c.h ?? CARD_H) / 2)
  const nmid = (n: CanvasNote): boolean => contains(frame, n.x + n.w / 2, n.y + n.h / 2)
  return {
    ...withFrame(s, frame),
    cards: s.cards.map((c) => {
      if (c.frame === id && !mid(c)) return { ...c, frame: null, manual: true }
      if (c.frame === null && mid(c) && c.private === (f.kind === 'private'))
        return { ...c, frame: id, manual: true }
      return c
    }),
    notes: s.notes.map((n) => {
      if (n.frame === id && !nmid(n)) return { ...n, frame: null }
      if (!n.frame && nmid(n) && f.kind !== 'private') return { ...n, frame: id }
      return n
    })
  }
}

/** Resize a card by its handles; its section grows around it via `fitFrames`. */
export function resizeCard(s: CanvasState, id: number, box: Box): CanvasState {
  const c = s.cards.find((x) => x.id === id)
  if (!c) return s
  const x = Math.round(box.x)
  const y = Math.round(box.y)
  const w = Math.round(Math.min(CARD_MAX_W, Math.max(CARD_MIN_W, box.w)))
  const h = Math.round(Math.min(CARD_MAX_H, Math.max(CARD_MIN_H, box.h)))
  const cw = c.w ?? CARD_W
  const ch = c.h ?? CARD_H
  if (x === c.x && y === c.y && w === cw && h === ch) return s
  return fitFrames({
    ...s,
    cards: s.cards.map((item) => {
      if (item.id !== id) return item
      const next: CanvasCard = { ...item, x, y, w, h, manual: true }
      if (w === CARD_W && h === CARD_H) {
        delete next.w
        delete next.h
      }
      return next
    })
  })
}

/** Reset a card's size to default `CARD_W x CARD_H` (or to `size`, such as 16:9 for a video card). */
export function resetCardSize(
  s: CanvasState,
  id: number,
  size?: { w: number; h: number }
): CanvasState {
  const c = s.cards.find((x) => x.id === id)
  if (!c) return s
  const w = size ? size.w : CARD_W
  const h = size ? size.h : CARD_H
  return resizeCard(s, id, { x: c.x, y: c.y, w, h })
}

/** Remember how a page card shows (by its address). */
export function setCardView(s: CanvasState, url: string, view: CardView | null): CanvasState {
  if (!url) return s
  const cur = s.views ?? {}
  if ((cur[url] ?? null) === view) return s
  const next = { ...cur }
  delete next[url]
  if (view) next[url] = view
  const keys = Object.keys(next)
  for (const k of keys.slice(0, Math.max(0, keys.length - VIEWS_MAX))) delete next[k]
  return { ...s, views: next }
}

/** Remember whether a page was last looked at live (or as words) when opened from its card. */
export function setPreview(s: CanvasState, url: string, live: boolean): CanvasState {
  if (!url || !!s.previews?.[url] === live) return s
  const next = { ...(s.previews ?? {}) }
  delete next[url]
  if (live) next[url] = 'live'
  const keys = Object.keys(next)
  for (const k of keys.slice(0, Math.max(0, keys.length - VIEWS_MAX))) delete next[k]
  return { ...s, previews: next }
}

/** Put a card loose with its middle at a point (or into the frame there), as if dropped there. */
export function placeCard(s: CanvasState, id: number, at: { x: number; y: number }): CanvasState {
  const c = s.cards.find((x) => x.id === id)
  if (!c) return s
  return dropCards(
    s,
    [id],
    at.x - (c.w ?? CARD_W) / 2 - c.x,
    at.y - (c.h ?? CARD_H) / 2 - c.y,
    at
  )
}

export function renameFrame(s: CanvasState, id: string, name: string): CanvasState {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)
  const f = s.frames.find((x) => x.id === id)
  if (!f || !clean || clean === f.name) return s
  return withFrame(s, { ...f, name: clean, pinned: true })
}

/** A frame the person drew: it takes the loose cards inside it, and never sits on another frame. */
export function addFrame(
  s: CanvasState,
  box: Box,
  name = 'Frame'
): { state: CanvasState; id: string } {
  const min = frameBox(1)
  const size = { w: Math.max(box.w, min.w), h: Math.max(box.h, min.h) }
  const spot = freeSpot(size, frameObstacles(s), { x: box.x, y: box.y })
  const id = `f${s.seq + 1}`
  const frame: CanvasFrame = { id, name, kind: 'user', ...spot, ...size, pinned: true }
  let next: CanvasState = { ...s, seq: s.seq + 1, frames: [...s.frames, frame] }
  const inside = next.cards.filter(
    (c) =>
      c.frame === null &&
      !c.private &&
      contains(frame, c.x + (c.w ?? CARD_W) / 2, c.y + (c.h ?? CARD_H) / 2)
  )
  for (const c of inside) next = seat(next, c.id, id, c, true)
  for (const n of next.notes.filter(
    (x) => !x.frame && contains(frame, x.x + x.w / 2, x.y + x.h / 2)
  ))
    next = seatNote(next, n.id, id, n)
  return { state: next, id }
}

/** Remove a frame; its cards stay on the board, free of it, and are sorted again by the next tidy up. */
export function deleteFrame(s: CanvasState, id: string): CanvasState {
  return {
    ...s,
    frames: s.frames.filter((f) => f.id !== id),
    cards: s.cards.map((c) => (c.frame === id ? { ...c, frame: null, manual: false } : c)),
    notes: s.notes.map((n) => (n.frame === id ? { ...n, frame: null } : n))
  }
}

export function addNote(
  s: CanvasState,
  at: { x: number; y: number },
  color = 0
): { state: CanvasState; id: string } {
  const id = `n${s.seq + 1}`
  const size = { w: NOTE_W, h: NOTE_H }
  const inside = frameAt(s, at.x + NOTE_W / 2, at.y + NOTE_H / 2)
  if (inside && inside.kind !== 'private') {
    const made: CanvasState = {
      ...s,
      seq: s.seq + 1,
      notes: [...s.notes, { id, text: '', color: color % NOTE_COLORS, ...at, ...size, frame: null }]
    }
    return { state: seatNote(made, id, inside.id, at), id }
  }
  const spot = freeSpot(
    size,
    [...s.frames, ...s.notes, ...s.cards.map(cardBox), ...markBoxes(s)],
    at,
    GAP
  )
  return {
    state: {
      ...s,
      seq: s.seq + 1,
      notes: [
        ...s.notes,
        { id, text: '', color: color % NOTE_COLORS, ...spot, ...size, frame: null }
      ]
    },
    id
  }
}

/** Put a note into a section's free slot nearest `near` (the section grows if it must). */
function seatNote(
  s: CanvasState,
  id: string,
  frameId: string,
  near?: { x: number; y: number }
): CanvasState {
  const f = s.frames.find((x) => x.id === frameId)
  if (!f) return s
  const slot = freeSlot(s, f, new Set(), near, new Set([id]))
  const next: CanvasState = {
    ...withFrame(s, slot.frame),
    notes: s.notes.map((n) => (n.id === id ? { ...n, x: slot.x, y: slot.y, frame: frameId } : n))
  }
  return settleFrame(next, frameId)
}

/**
 * Drop a note moved by (dx, dy): its middle inside a section makes it one of that section's (in the nearest free
 * slot); anywhere else it is loose where it was let go. The section it left closes up.
 */
export function dropNote(s: CanvasState, id: string, dx: number, dy: number): CanvasState {
  const n = s.notes.find((x) => x.id === id)
  if (!n) return s
  const to = { x: n.x + dx, y: n.y + dy }
  const target = frameAt(
    { ...s, frames: s.frames.filter((f) => f.kind !== 'private') },
    to.x + n.w / 2,
    to.y + n.h / 2
  )
  const from = n.frame ?? null
  let next: CanvasState = {
    ...s,
    notes: s.notes.map((x) => (x.id === id ? { ...x, ...to, frame: null } : x))
  }
  if (target) next = seatNote(next, id, target.id, to)
  if (from && from !== target?.id) next = dropIfEmpty(next, from)
  return next
}

/** A note's height for its text: the measured text plus padding, never below its own minimum, within bounds. */
export function noteHeight(textH: number, minH?: number): number {
  const want = Math.ceil(textH + 24)
  return Math.round(Math.min(NOTE_MAX_H, Math.max(minH ?? NOTE_MIN_H, NOTE_MIN_H, want)))
}

/** Resize a note by hand: the width reflows its text; a height dragged to becomes its minimum. */
export function resizeNote(
  s: CanvasState,
  id: string,
  size: { w?: number; h?: number }
): CanvasState {
  const n = s.notes.find((x) => x.id === id)
  if (!n) return s
  const w =
    size.w === undefined ? n.w : Math.round(Math.min(NOTE_MAX_W, Math.max(NOTE_MIN_W, size.w)))
  const minH =
    size.h === undefined ? n.minH : Math.round(Math.min(NOTE_MAX_H, Math.max(NOTE_MIN_H, size.h)))
  const h = Math.max(n.h, minH ?? 0)
  if (w === n.w && h === n.h && minH === n.minH) return s
  const next: Partial<CanvasNote> = { w, h }
  if (minH !== undefined) next.minH = minH
  return patchNote(s, id, next)
}

/** The box a section takes to hug what is in it: even padding, and the title row on top. */
export function hugBox(s: CanvasState, frameId: string): Box | null {
  const cs = members(s, frameId)
  const b = boundsOf([...cs.map(cardBox), ...memberNotes(s, frameId)])
  if (!b) return null
  // A split view in it keeps the room `regridFrame` gives it (the two must agree, or each change undoes the other):
  // the whole section wider by SPLIT_SIDE each side, the lip's room above the split when it is the top row, and
  // more below it when it is the last.
  const split = new Set(s.split ?? [])
  const sc = cs.filter((c) => split.has(c.id))
  if (split.size < 2 || sc.length < 2)
    return { x: b.x - PAD, y: b.y - HEAD, w: b.w + PAD * 2, h: b.h + HEAD + PAD }
  const sb = boundsOf(sc.map(cardBox))!
  const top = b.y - HEAD - (sb.y <= b.y + 0.5 ? SPLIT_TOP_EXTRA : 0)
  const bottom = b.y + b.h + PAD + (sb.y + sb.h >= b.y + b.h - 0.5 ? SPLIT_SIDE : 0)
  return { x: b.x - PAD - SPLIT_SIDE, y: top, w: b.w + (PAD + SPLIT_SIDE) * 2, h: bottom - top }
}

/**
 * Every section takes the size of what is in it (a section resized by hand only grows to keep its contents
 * inside), and a section that grew onto another pushes that one aside. The same state when nothing changes.
 */
export function fitFrames(s: CanvasState): CanvasState {
  let next = s
  const grew: string[] = []
  for (const f of s.frames) {
    const hug = hugBox(next, f.id)
    if (!hug) {
      // an empty section the person keeps: down to its smallest, unless they sized it
      if (!f.sized && (f.w > FRAME_MIN.w || f.h > FRAME_MIN.h)) {
        next = withFrame(next, { ...f, w: FRAME_MIN.w, h: FRAME_MIN.h })
      }
      continue
    }
    const box = f.sized
      ? (boundsOf([f, hug]) as Box)
      : { ...hug, w: Math.max(hug.w, FRAME_MIN.w), h: Math.max(hug.h, FRAME_MIN.h) }
    const cur = next.frames.find((x) => x.id === f.id)!
    if (
      Math.abs(box.x - cur.x) < 0.5 &&
      Math.abs(box.y - cur.y) < 0.5 &&
      Math.abs(box.w - cur.w) < 0.5 &&
      Math.abs(box.h - cur.h) < 0.5
    )
      continue
    next = withFrame(next, { ...cur, ...box })
    grew.push(f.id)
  }
  // a section that grew onto its neighbours moves them (and theirs) out of the way
  for (const id of grew) {
    const me = next.frames.find((x) => x.id === id)
    if (!me) continue
    for (const o of next.frames) {
      if (o.id === id || !intersects(me, o, FRAME_GAP / 4)) continue
      next = settleFrame(next, o.id)
    }
  }
  return next
}

/** Back to hugging its contents (a double-click on a resize handle). */
export function unsizeFrame(s: CanvasState, id: string): CanvasState {
  const f = s.frames.find((x) => x.id === id)
  if (!f || !f.sized) return s
  const next: CanvasFrame = { ...f }
  delete next.sized
  return fitFrames(withFrame(s, next))
}

export const patchNote = (
  s: CanvasState,
  id: string,
  patch: Partial<Omit<CanvasNote, 'id'>>
): CanvasState => ({
  ...s,
  notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n))
})

export const deleteNote = (s: CanvasState, id: string): CanvasState => ({
  ...s,
  notes: s.notes.filter((n) => n.id !== id)
})

/** The card nearest to `from` in a direction (the one most in line with it wins ties), or null. */
export function nearestCard(
  boxes: Array<{ id: number } & Box>,
  from: number,
  dir: 'left' | 'right' | 'up' | 'down'
): number | null {
  const a = boxes.find((b) => b.id === from)
  if (!a) return boxes[0]?.id ?? null
  const ax = a.x + a.w / 2
  const ay = a.y + a.h / 2
  let best: number | null = null
  let bestScore = Infinity
  for (const b of boxes) {
    if (b.id === from) continue
    const dx = b.x + b.w / 2 - ax
    const dy = b.y + b.h / 2 - ay
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy
    const across = dir === 'left' || dir === 'right' ? dy : dx
    if (along <= 4) continue
    const score = along + Math.abs(across) * 2.2
    if (score < bestScore || (score === bestScore && best !== null && b.id < best)) {
      best = b.id
      bestScore = score
    }
  }
  return best
}

// ---- saving and loading ----

/** The board as saved: nothing of a private tab is written (not its card, address or the Private frame's cards). */
export function forDisk(s: CanvasState): CanvasState {
  // connectors to what is not written (a private card, the Private frame) are not written either
  return pruneConnectors({
    ...s,
    cards: s.cards.filter((c) => !c.private && (c.url || c.id < 0)).map((c) => ({ ...c })),
    frames: s.frames.filter((f) => f.kind !== 'private'),
    items: Object.fromEntries(Object.entries(s.items ?? {}).map(([k, v]) => [k, keepItem(v)])),
    connectors: sanitizeConnectors(s.connectors),
    marks: sanitizeMarks(s.marks),
    views: cleanViews(s.views),
    previews: cleanPreviews(s.previews),
    notes: notesIn(
      s.notes,
      s.frames.filter((f) => f.kind !== 'private')
    )
  })
}

/** Notes whose section is not among `frames` become loose (old boards have no `frame` on notes at all). */
const notesIn = (notes: CanvasNote[], frames: CanvasFrame[]): CanvasNote[] => {
  const ids = new Set(frames.map((f) => f.id))
  return notes.map((n) => ({ ...n, frame: n.frame && ids.has(n.frame) ? n.frame : null }))
}

function cleanPreviews(v: unknown): Record<string, 'live'> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, 'live'> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(-VIEWS_MAX))
    if (/^(https?|file):/i.test(k) && k.length < 2000 && x === 'live') out[k] = x
  return out
}

function cleanViews(v: unknown): Record<string, CardView> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, CardView> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(-VIEWS_MAX)) {
    if (/^(https?|file):/i.test(k) && k.length < 2000 && (x === 'reader' || x === 'snapshot'))
      out[k] = x
  }
  return out
}

/**
 * A saved board matched to the tabs now open. In the same run of the app the tab ids still mean the same tabs; in a
 * later one only the address says which card is which (the first unclaimed card with that address).
 */
export function reconcileSaved(saved: CanvasState, tabs: TabLite[], boot: string): CanvasState {
  const sameRun = saved.boot === boot
  const claimed = new Set<number>()
  const out: CanvasCard[] = []
  // old card id -> the id it has now (connectors follow their cards)
  const moved = new Map<number, number>()
  const byId = new Map(saved.cards.map((c) => [c.id, c]))
  for (const t of tabs) {
    if (t.private) continue
    const c = sameRun ? byId.get(t.id) : undefined
    if (c) {
      claimed.add(c.id)
      moved.set(c.id, c.id)
      out.push({ ...c, url: t.url })
    }
  }
  const have = new Set(out.map((c) => c.id))
  for (const t of tabs) {
    if (t.private || have.has(t.id) || !t.url) continue
    const c = saved.cards.find((x) => !claimed.has(x.id) && x.url === t.url)
    if (c) {
      claimed.add(c.id)
      moved.set(c.id, t.id)
      out.push({ ...c, id: t.id })
    }
  }
  out.push(...saved.cards.filter((c) => c.id < 0))
  for (const c of saved.cards) if (c.id < 0) moved.set(c.id, c.id)
  const used = new Set([...out.map((c) => c.frame), ...saved.notes.map((n) => n.frame ?? null)])
  const frames = saved.frames.filter((f) => f.pinned || f.kind === 'user' || used.has(f.id))
  return pruneConnectors({
    ...saved,
    boot,
    items: saved.items ?? {},
    cards: out,
    frames,
    notes: notesIn(saved.notes, frames),
    connectors: remapCards(sanitizeConnectors(saved.connectors), moved),
    views: cleanViews(saved.views),
    previews: cleanPreviews(saved.previews)
  })
}

// ---- cards that are not tabs: what the prompt finds and answers ----

/** Whether a card is one the prompt made (it has no tab): the ids of these are negative. */
export const isVirtual = (id: number): boolean => id < 0

/** The most cards one results frame holds. */
export const RESULT_MAX = 12

const ids = (s: CanvasState, frameId: string): number[] =>
  members(s, frameId)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((c) => c.id)

/**
 * A new labelled frame with `n` empty cards (placeholders) near a point, clear of everything. The cards wait for
 * `setItem`; `finishFrame` takes away those nothing came for.
 */
export function addResultFrame(
  s: CanvasState,
  name: string,
  n: number,
  near: { x: number; y: number }
): { state: CanvasState; frameId: string; ids: number[] } {
  const count = Math.max(1, Math.min(RESULT_MAX, n))
  const size = frameBox(count)
  const spot = freeSpot(size, frameObstacles(s), near)
  const frameId = `f${s.seq + 1}`
  const frame: CanvasFrame = {
    id: frameId,
    name: name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || 'Results',
    kind: 'result',
    ...spot,
    ...size,
    pinned: true
  }
  const made: CanvasCard[] = Array.from({ length: count }, (_, i) => ({
    id: -(s.seq + 2 + i),
    url: '',
    ...slotAt(frame, i),
    frame: frameId,
    manual: true,
    private: false
  }))
  return {
    state: {
      ...s,
      seq: s.seq + 1 + count,
      frames: [...s.frames, frame],
      cards: [...s.cards, ...made]
    },
    frameId,
    ids: made.map((c) => c.id)
  }
}

/** Fill a card of the prompt with what was found. */
export function setItem(s: CanvasState, id: number, item: CanvasItem): CanvasState {
  if (!isVirtual(id) || !s.cards.some((c) => c.id === id)) return s
  return {
    ...s,
    items: { ...s.items, [String(id)]: keepItem(item) },
    cards: s.cards.map((c) => (c.id === id ? { ...c, url: item.url } : c))
  }
}

/** The empty cards of a frame, in reading order. */
export const emptyCards = (s: CanvasState, frameId: string): number[] =>
  ids(s, frameId).filter((id) => isVirtual(id) && !s.items[String(id)])

/**
 * The frame's work is over: cards still empty go, the frame takes the shape its cards need, or goes if none came.
 */
export function finishFrame(s: CanvasState, frameId: string): CanvasState {
  const gone = new Set(emptyCards(s, frameId))
  let next: CanvasState = { ...s, cards: s.cards.filter((c) => !gone.has(c.id)) }
  if (members(next, frameId).length === 0) {
    return { ...next, frames: next.frames.filter((f) => f.id !== frameId) }
  }
  next = regridFrame(next, frameId)
  return settleFrame(next, frameId)
}

/** Take cards that are not tabs off the board (and what they held); a result frame left empty goes too. */
export function removeVirtual(s: CanvasState, drop: number[]): CanvasState {
  const set = new Set(drop.filter(isVirtual))
  if (set.size === 0) return s
  const from = new Set(s.cards.filter((c) => set.has(c.id)).map((c) => c.frame))
  const items = { ...s.items }
  for (const id of set) delete items[String(id)]
  let next: CanvasState = { ...s, items, cards: s.cards.filter((c) => !set.has(c.id)) }
  for (const f of from) {
    if (!f) continue
    const fr = next.frames.find((x) => x.id === f)
    if (fr?.kind === 'result' && members(next, f).length === 0) {
      next = { ...next, frames: next.frames.filter((x) => x.id !== f) }
    }
  }
  return next
}

/** Add one more card (of an answer, a link in it) to a result frame, in its first free slot. */
export function addVirtual(
  s: CanvasState,
  frameId: string,
  item: CanvasItem
): { state: CanvasState; id: number } {
  const id = -(s.seq + 2)
  const card: CanvasCard = {
    id,
    url: item.url,
    x: 0,
    y: 0,
    frame: null,
    manual: true,
    private: false
  }
  let next: CanvasState = {
    ...s,
    seq: s.seq + 1,
    cards: [...s.cards, card],
    items: { ...s.items, [String(id)]: keepItem(item) }
  }
  next = seat(next, id, frameId)
  return { state: next, id }
}

// ---- stacks: older results fold into a pile ----

/** The size of a folded frame: one card with a header. */
export const STACK_W = CARD_W + PAD * 2
export const STACK_H = CARD_H + HEAD + PAD

export const isStack = (f: CanvasFrame): boolean => !!f.stack

const frameNo = (f: CanvasFrame): number => Number(f.id.replace(/^\D+/, '')) || 0

/** Fold a results frame into a stack. Its cards stay where they are, out of sight, and come back when it is opened. */
export function collapseFrame(s: CanvasState, id: string): CanvasState {
  const f = s.frames.find((x) => x.id === id)
  if (!f || f.kind !== 'result' || f.stack || members(s, id).length === 0) return s
  return withFrame(s, { ...f, stack: { w: f.w, h: f.h }, fan: false, w: STACK_W, h: STACK_H })
}

/** Open a stack back into its frame (it stays open: the next fold-up leaves it alone). */
export function expandFrame(s: CanvasState, id: string): CanvasState {
  const f = s.frames.find((x) => x.id === id)
  if (!f?.stack) return s
  const { stack, ...rest } = f
  const next = withFrame(s, { ...rest, w: stack.w, h: stack.h, fan: true })
  return settleFrame(next, id)
}

/** Fold every results frame but the latest `keep` (and any the person opened) into stacks. */
export function collapseOld(s: CanvasState, keep = 2): CanvasState {
  const results = s.frames
    .filter((f) => f.kind === 'result')
    .sort((a, b) => frameNo(b) - frameNo(a))
  let next = s
  for (const f of results.slice(keep)) if (!f.fan) next = collapseFrame(next, f.id)
  return next
}

/** The cards that are on show: those in a folded frame are not. */
export const shownCards = (s: CanvasState): CanvasCard[] => {
  const folded = new Set(s.frames.filter((f) => f.stack).map((f) => f.id))
  return folded.size ? s.cards.filter((c) => !c.frame || !folded.has(c.frame)) : s.cards
}

// ---- new things in free space ----

/**
 * A card that is not a tab, put loose on the board next to the cards it came from (right of them, else below), clear
 * of everything. Nothing here makes a tab.
 */
export function addLoose(
  s: CanvasState,
  item: CanvasItem,
  near: { cards?: number[]; point?: { x: number; y: number } } = {}
): { state: CanvasState; id: number } {
  const id = -(s.seq + 2)
  const src = (near.cards ?? [])
    .map((i) => s.cards.find((c) => c.id === i))
    .filter((c): c is CanvasCard => !!c)
  const b = boundsOf(src.map(cardBox))
  const at = b ? { x: b.x + b.w + GAP * 2, y: b.y } : (near.point ?? { x: 0, y: 0 })
  const spot = freeSpot(
    { w: CARD_W, h: CARD_H },
    [...s.frames, ...s.notes, ...s.cards.map(cardBox), ...markBoxes(s)],
    at,
    GAP
  )
  const card: CanvasCard = {
    id,
    url: item.url,
    x: spot.x,
    y: spot.y,
    frame: null,
    manual: true,
    private: false
  }
  return {
    state: {
      ...s,
      seq: s.seq + 1,
      cards: [...s.cards, card],
      items: { ...s.items, [String(id)]: keepItem(item) }
    },
    id
  }
}

/** A named frame holding these cards (private ones and unknown ids are left out); null when nothing is left to hold. */
export function groupInto(
  s: CanvasState,
  name: string,
  ids: number[]
): { state: CanvasState; frameId: string } | null {
  const cards = ids
    .map((i) => s.cards.find((c) => c.id === i))
    .filter((c): c is CanvasCard => !!c && !c.private)
  if (cards.length === 0) return null
  const b = boundsOf(cards.map(cardBox))!
  const made = addFrame(
    s,
    { x: b.x, y: b.y, w: 0, h: 0 },
    name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || 'Group'
  )
  let next = made.state
  for (const c of cards) next = moveToFrame(next, c.id, made.id, true)
  return { state: next, frameId: made.id }
}
