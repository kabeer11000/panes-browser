import { cardBox, HEAD, type Box, type CanvasFrame, type CanvasState } from './canvas'

/**
 * Connectors on the canvas board (FigJam-like arrows). Pure and deterministic like the rest of the board: a
 * connector stores only what it is tied to (a card, a note, a frame, or a free point on the board) and its style;
 * where it is drawn is worked out from the boxes every time, so it follows its objects wherever they go (a drag, a
 * tidy up, a frame moving with its cards). Coordinates are board units.
 */

export type ConnectorShape = 'straight' | 'curved' | 'elbow'
export type ConnectorHeads = 'end' | 'both' | 'none'
export type End =
  | { kind: 'card'; id: number }
  | { kind: 'note'; id: string }
  | { kind: 'frame'; id: string }
  /** A shape, text or block drawn on the board (canvasMarks.ts); never a pen line. */
  | { kind: 'mark'; id: string }
  | { kind: 'point'; x: number; y: number }
export interface CanvasConnector {
  id: string
  from: End
  to: End
  shape: ConnectorShape
  heads: ConnectorHeads
  /** A short text at the middle of the line ('' for none). */
  label: string
}
export type Side = 'top' | 'right' | 'bottom' | 'left'
export interface Pt {
  x: number
  y: number
}
/** Moves not yet in the state (a drag in progress), keyed like `endKey`. */
export type Offsets = ReadonlyMap<string, Pt>

export const LABEL_MAX = 60
export const CONNECTORS_MAX = 2000
/** How far from an object's edge a line starts, so its end is never under the object's border or shadow. */
export const EDGE_GAP = 6
export const HEAD_LEN = 12
export const HEAD_W = 11
const COORD_MAX = 1e7
const SHAPES: ConnectorShape[] = ['straight', 'curved', 'elbow']
const HEADS: ConnectorHeads[] = ['end', 'both', 'none']

export const connectorsOf = (s: CanvasState): CanvasConnector[] => s.connectors ?? []

/** The key of the object an end is tied to, as the renderer names dragged elements (`c12`, `nn3`, `ff2`). */
export const endKey = (e: End): string | null =>
  e.kind === 'card'
    ? `c${e.id}`
    : e.kind === 'note'
      ? `n${e.id}`
      : e.kind === 'frame'
        ? `f${e.id}`
        : e.kind === 'mark'
          ? `m${e.id}`
          : null

export const sameObject = (a: End, b: End): boolean => {
  const ka = endKey(a)
  return ka !== null && ka === endKey(b)
}

/** The box of the object an end is tied to (moved by `off` while dragged), or null for a free point or a lost one. */
export function endBox(s: CanvasState, e: End, off?: Offsets): Box | null {
  let b: Box | null = null
  if (e.kind === 'card') {
    const c = s.cards.find((x) => x.id === e.id)
    if (c) b = cardBox(c)
  } else if (e.kind === 'note') {
    const n = s.notes.find((x) => x.id === e.id)
    if (n) b = { x: n.x, y: n.y, w: n.w, h: n.h }
  } else if (e.kind === 'frame') {
    const f = s.frames.find((x) => x.id === e.id)
    if (f) b = { x: f.x, y: f.y, w: f.w, h: f.h }
  } else if (e.kind === 'mark') {
    const m = s.marks?.find((x) => x.id === e.id && !x.pts)
    if (m) b = { x: m.x, y: m.y, w: m.w, h: m.h }
  }
  const d = b && off ? off.get(endKey(e) ?? '') : undefined
  return b && d ? { ...b, x: b.x + d.x, y: b.y + d.y } : b
}

const exists = (s: CanvasState, e: End): boolean => e.kind === 'point' || endBox(s, e) !== null

// ---- geometry ----

const NORMAL: Record<Side, Pt> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
}
const center = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k })
const len = (a: Pt): number => Math.hypot(a.x, a.y)
const unit = (a: Pt, fallback: Pt = { x: 1, y: 0 }): Pt => {
  const l = len(a)
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : fallback
}
const r1 = (v: number): number => Math.round(v * 10) / 10
const fmt = (p: Pt): string => `${r1(p.x)} ${r1(p.y)}`

/** The side of a box that faces a point (measured against the box's own proportions, so a tall card still opens sideways to its neighbour). */
export function sideFacing(b: Box, p: Pt): Side {
  const c = center(b)
  const dx = (p.x - c.x) / (b.w / 2 || 1)
  const dy = (p.y - c.y) / (b.h / 2 || 1)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

/** The middle of a side, pushed out by `gap`. */
export function anchorOn(b: Box, side: Side, gap = EDGE_GAP): Pt {
  const n = NORMAL[side]
  const c = center(b)
  return { x: c.x + n.x * (b.w / 2 + gap), y: c.y + n.y * (b.h / 2 + gap) }
}

/** Where an end attaches: the point, the direction the line leaves in, and the side (null for a free point). */
export interface Attach {
  p: Pt
  n: Pt
  side: Side | null
}

/** Slide a point along the side it sits on (lines that share a side are spread out). */
const slide = (p: Pt, side: Side, by: number): Pt =>
  side === 'left' || side === 'right' ? { x: p.x, y: p.y + by } : { x: p.x + by, y: p.y }

/**
 * Both ends of a line between two boxes or points: each box opens the side that faces the other end. `shiftA` and
 * `shiftB` slide an end along its side (several lines meeting on one side fan out instead of piling up).
 */
export function attachEnds(a: Box | Pt, b: Box | Pt, shiftA = 0, shiftB = 0): [Attach, Attach] {
  const isBox = (v: Box | Pt): v is Box => 'w' in v
  const ref = (v: Box | Pt): Pt => (isBox(v) ? center(v) : v)
  const sa = isBox(a) ? sideFacing(a, ref(b)) : null
  const sb = isBox(b) ? sideFacing(b, ref(a)) : null
  const pa = isBox(a) ? slide(anchorOn(a, sa!), sa!, shiftA) : a
  const pb = isBox(b) ? slide(anchorOn(b, sb!), sb!, shiftB) : b
  const along = unit(sub(pb, pa))
  return [
    { p: pa, n: sa ? NORMAL[sa] : along, side: sa },
    { p: pb, n: sb ? NORMAL[sb] : { x: -along.x, y: -along.y }, side: sb }
  ]
}

/** Control points of the curve: each leaves its end straight out of the side, further for longer lines. */
export function curveControls(a: Attach, b: Attach): [Pt, Pt] {
  let d = Math.min(220, Math.max(36, len(sub(b.p, a.p)) * 0.42))
  // two ends facing each other across a small gap: the bend stays inside the gap, or the line overshoots and loops
  const gap = (b.p.x - a.p.x) * a.n.x + (b.p.y - a.p.y) * a.n.y
  const facing = a.n.x * b.n.x + a.n.y * b.n.y < -0.5
  if (facing && gap > 0) d = Math.min(d, gap / 2)
  return [add(a.p, a.n, d), add(b.p, b.n, d)]
}

const horizontal = (e: Attach, other: Attach): boolean =>
  e.side
    ? e.side === 'left' || e.side === 'right'
    : other.side
      ? other.side === 'left' || other.side === 'right'
      : Math.abs(other.p.x - e.p.x) >= Math.abs(other.p.y - e.p.y)

/** How far from a box the middle run of an elbow line goes when it passes beside one. */
const LANE = 10
/** Whether an axis-aligned run goes through a box or brushes against it (within half a lane of its edge). */
const through = (p: Pt, q: Pt, bx: Box): boolean =>
  Math.max(p.x, q.x) > bx.x - LANE / 2 &&
  Math.min(p.x, q.x) < bx.x + bx.w + LANE / 2 &&
  Math.max(p.y, q.y) > bx.y - LANE / 2 &&
  Math.min(p.y, q.y) < bx.y + bx.h + LANE / 2
/**
 * Where the middle run of an elbow line goes (an x for two sideways ends, a y for two vertical ones): halfway, unless
 * that runs through something, then the nearest gap beside a box that does not.
 */
function lane(a: Pt, b: Pt, across: boolean, avoid: Box[]): number {
  const [p, q] = across ? [a.x, b.x] : [a.y, b.y]
  const mid = (p + q) / 2
  const lo = Math.min(p, q)
  const hi = Math.max(p, q)
  const cands = [mid]
  for (const bx of avoid) {
    const edges = across ? [bx.x - LANE, bx.x + bx.w + LANE] : [bx.y - LANE, bx.y + bx.h + LANE]
    for (const v of edges) if (v > lo && v < hi) cands.push(v)
  }
  const run = (v: number): Pt[] =>
    across ? [a, { x: v, y: a.y }, { x: v, y: b.y }, b] : [a, { x: a.x, y: v }, { x: b.x, y: v }, b]
  const cost = (v: number): number => {
    const w = run(v)
    let hits = 0
    for (let i = 1; i < w.length; i++)
      for (const bx of avoid) if (through(w[i - 1], w[i], bx)) hits++
    return hits * 1e6 + Math.abs(v - mid)
  }
  return cands.reduce((best, v) => (cost(v) < cost(best) ? v : best), mid)
}

/** The corners of an elbow line (right angles only), from end a to end b; `avoid` are boxes to keep clear of. */
export function elbowPoints(a: Attach, b: Attach, avoid: Box[] = []): Pt[] {
  const ha = horizontal(a, b)
  const hb = horizontal(b, a)
  let pts: Pt[]
  if (ha && hb) {
    const mx = lane(a.p, b.p, true, avoid)
    pts = [a.p, { x: mx, y: a.p.y }, { x: mx, y: b.p.y }, b.p]
  } else if (!ha && !hb) {
    const my = lane(a.p, b.p, false, avoid)
    pts = [a.p, { x: a.p.x, y: my }, { x: b.p.x, y: my }, b.p]
  } else if (ha) pts = [a.p, { x: b.p.x, y: a.p.y }, b.p]
  else pts = [a.p, { x: a.p.x, y: b.p.y }, b.p]
  // corners that are not corners (a straight run) go
  const out: Pt[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue
    out.push(p)
  }
  // nor are corners on a straight line
  for (let i = out.length - 2; i >= 1; i--) {
    const p = out[i - 1]
    const q = out[i]
    const r = out[i + 1]
    if (Math.abs((q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x)) < 0.01) out.splice(i, 1)
  }
  return out
}

/** The point halfway along a polyline. */
export function polylineMid(pts: Pt[]): Pt {
  if (pts.length === 0) return { x: 0, y: 0 }
  let total = 0
  for (let i = 1; i < pts.length; i++) total += len(sub(pts[i], pts[i - 1]))
  let left = total / 2
  for (let i = 1; i < pts.length; i++) {
    const seg = len(sub(pts[i], pts[i - 1]))
    if (seg >= left && seg > 0) return add(pts[i - 1], sub(pts[i], pts[i - 1]), left / seg)
    left -= seg
  }
  return pts[pts.length - 1]
}

/** A point on a cubic Bezier curve. */
export function bezierAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
  }
}

/** An arrowhead with its tip at `tip`, pointing along `dir`. */
export function headPath(tip: Pt, dir: Pt, l = HEAD_LEN, w = HEAD_W): string {
  const t = unit(dir)
  const base = add(tip, t, -l)
  const perp = { x: -t.y, y: t.x }
  return `M${fmt(tip)}L${fmt(add(base, perp, w / 2))}L${fmt(add(base, perp, -w / 2))}Z`
}

/** Everything needed to draw a connector. */
export interface Route {
  /** The line itself (stopping short of an arrowhead's tip, so the line never pokes through it). */
  d: string
  /** Arrowheads, at the start and the end. */
  heads: string[]
  /** Where the label sits. */
  mid: Pt
  a: Pt
  b: Pt
  bounds: Box
}

/** Draw a connector between two attachments, in a shape, with arrowheads. */
export function routeBetween(
  a: Attach,
  b: Attach,
  shape: ConnectorShape,
  heads: ConnectorHeads,
  avoid: Box[] = []
): Route {
  const atStart = heads === 'both'
  const atEnd = heads !== 'none'
  const trim = HEAD_LEN * 0.7
  const out: string[] = []
  let d: string
  let mid: Pt
  let ta: Pt // direction the line arrives at a (pointing into a)
  let tb: Pt
  let pts: Pt[]
  if (shape === 'curved') {
    const [c1, c2] = curveControls(a, b)
    ta = unit(sub(a.p, c1), { x: -a.n.x, y: -a.n.y })
    tb = unit(sub(b.p, c2), { x: -b.n.x, y: -b.n.y })
    const s0 = atStart ? add(a.p, ta, -trim) : a.p
    const s1 = atEnd ? add(b.p, tb, -trim) : b.p
    d = `M${fmt(s0)}C${fmt(c1)} ${fmt(c2)} ${fmt(s1)}`
    mid = bezierAt(a.p, c1, c2, b.p, 0.5)
    pts = [a.p, c1, c2, b.p]
  } else {
    pts = shape === 'elbow' ? elbowPoints(a, b, avoid) : [a.p, b.p]
    if (pts.length < 2) pts = [a.p, b.p]
    ta = unit(sub(pts[0], pts[1]), { x: -1, y: 0 })
    tb = unit(sub(pts[pts.length - 1], pts[pts.length - 2]), { x: 1, y: 0 })
    mid = polylineMid(pts)
    const line = pts.map((p) => ({ ...p }))
    const segA = len(sub(line[1], line[0]))
    const segB = len(sub(line[line.length - 1], line[line.length - 2]))
    if (atStart && segA > trim) line[0] = add(line[0], ta, -trim)
    if (atEnd && segB > trim) line[line.length - 1] = add(line[line.length - 1], tb, -trim)
    d = roundedPolyline(line, 14)
  }
  if (atStart) out.push(headPath(a.p, ta))
  if (atEnd) out.push(headPath(b.p, tb))
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return { d, heads: out, mid, a: a.p, b: b.p, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } }
}

/** A polyline with its corners rounded off by up to `r`. */
export function roundedPolyline(pts: Pt[], r: number): string {
  if (pts.length === 0) return ''
  let d = `M${fmt(pts[0])}`
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]
    const inn = sub(p, pts[i - 1])
    const outt = sub(pts[i + 1], p)
    const rr = Math.min(r, len(inn) / 2, len(outt) / 2)
    if (rr < 0.5) {
      d += `L${fmt(p)}`
      continue
    }
    d += `L${fmt(add(p, unit(inn), -rr))}Q${fmt(p)} ${fmt(add(p, unit(outt), rr))}`
  }
  return d + `L${fmt(pts[pts.length - 1])}`
}

/** Where a connector of the board is drawn now (null while one of its objects is missing). */
export function routeConnector(s: CanvasState, c: CanvasConnector, off?: Offsets): Route | null {
  const ra = c.from.kind === 'point' ? { x: c.from.x, y: c.from.y } : endBox(s, c.from, off)
  const rb = c.to.kind === 'point' ? { x: c.to.x, y: c.to.y } : endBox(s, c.to, off)
  if (!ra || !rb) return null
  const [a, b] = attachEnds(ra, rb)
  return routeBetween(a, b, c.shape, c.heads)
}

/** Boards with more connectors than this are drawn without spreading or steering them (it costs a pass over all). */
const TIDY_MAX = 300
/** How far apart lines meeting on one side are spread. */
export const FAN_STEP = 18

/**
 * Every connector's route, laid out together so they sit well: lines meeting on one side of an object fan out along it
 * (in the order of where they go, so they do not cross), and an elbow line keeps out of the cards and notes between its
 * ends where there is a way round. Same order as `list`.
 */
export function routeAll(
  s: CanvasState,
  list: CanvasConnector[],
  off?: Offsets
): Array<Route | null> {
  const isBox = (v: Box | Pt): v is Box => 'w' in v
  const end = (e: End): Box | Pt | null =>
    e.kind === 'point' ? { x: e.x, y: e.y } : endBox(s, e, off)
  if (!list.length) return []
  const ends = list.map((c) => [end(c.from), end(c.to)] as const)
  const tidy = list.length <= TIDY_MAX
  const shift = new Map<string, number>()
  const obstacles: Array<{ key: string; box: Box }> = []
  if (tidy) {
    const groups = new Map<string, Array<{ at: string; t: number; len: number }>>()
    list.forEach((c, i) => {
      const [ra, rb] = ends[i]
      if (!ra || !rb) return
      for (const n of [0, 1] as const) {
        const me = n === 0 ? ra : rb
        const other = n === 0 ? rb : ra
        const key = endKey(n === 0 ? c.from : c.to)
        if (!isBox(me) || !key) continue
        const o = isBox(other) ? center(other) : other
        const side = sideFacing(me, o)
        const k = `${key}|${side}`
        const row = groups.get(k) ?? []
        const sideways = side === 'left' || side === 'right'
        row.push({ at: `${i}|${n}`, t: sideways ? o.y : o.x, len: sideways ? me.h : me.w })
        groups.set(k, row)
      }
    })
    for (const row of groups.values()) {
      if (row.length < 2) continue
      row.sort((p, q) => p.t - q.t)
      const step = Math.min(FAN_STEP, (row[0].len * 0.8) / (row.length - 1))
      row.forEach((r, j) => shift.set(r.at, (j - (row.length - 1) / 2) * step))
    }
  }
  // only elbows go around things: without one, the boxes of every card and note are not needed
  if (tidy && list.some((c) => c.shape === 'elbow')) {
    for (const c of s.cards) {
      const box = endBox(s, { kind: 'card', id: c.id }, off)
      if (box) obstacles.push({ key: `c${c.id}`, box })
    }
    for (const n of s.notes) {
      const box = endBox(s, { kind: 'note', id: n.id }, off)
      if (box) obstacles.push({ key: `n${n.id}`, box })
    }
  }
  return list.map((c, i) => {
    const [ra, rb] = ends[i]
    if (!ra || !rb) return null
    const [a, b] = attachEnds(ra, rb, shift.get(`${i}|0`) ?? 0, shift.get(`${i}|1`) ?? 0)
    const mine = new Set([endKey(c.from), endKey(c.to)])
    const avoid =
      tidy && c.shape === 'elbow' ? obstacles.filter((o) => !mine.has(o.key)).map((o) => o.box) : []
    return routeBetween(a, b, c.shape, c.heads, avoid)
  })
}

/** A line being drawn: from an end of the board to the pointer (or to the object under it). */
export function routeDraft(
  s: CanvasState,
  from: End,
  to: End,
  shape: ConnectorShape,
  heads: ConnectorHeads
): Route | null {
  return routeConnector(s, { id: '', from, to, shape, heads, label: '' })
}

// ---- what is under the pointer ----

const inBox = (b: Box, p: Pt, pad = 0): boolean =>
  p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad

/**
 * The object a connector would attach to at `p`: a card, else a note, else the smallest frame around it. With
 * `edgeOnly`, a frame counts only by its header or near its border (its middle is just board, for hovering).
 * `pad` widens cards and notes (a hover that reaches their handles); `skip` is an object to look past.
 */
export function objectAt(
  s: CanvasState,
  p: Pt,
  o: { pad?: number; edgeOnly?: boolean; skip?: string | null } = {}
): End | null {
  const pad = o.pad ?? 0
  // drawings sit above cards and notes: a shape, text or block wins (a pen line is too thin to aim at)
  const marks = s.marks ?? []
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i]
    if (m.pts || o.skip === `m${m.id}`) continue
    if (inBox(m, p, pad)) return { kind: 'mark', id: m.id }
  }
  for (let i = s.cards.length - 1; i >= 0; i--) {
    const c = s.cards[i]
    if (o.skip === `c${c.id}`) continue
    if (inBox(cardBox(c), p, pad)) return { kind: 'card', id: c.id }
  }
  for (let i = s.notes.length - 1; i >= 0; i--) {
    const n = s.notes[i]
    if (o.skip === `n${n.id}`) continue
    if (inBox(n, p, pad)) return { kind: 'note', id: n.id }
  }
  let best: CanvasFrame | null = null
  for (const f of s.frames) {
    if (o.skip === `f${f.id}` || !inBox(f, p, o.edgeOnly ? pad : 0)) continue
    if (o.edgeOnly) {
      const head = p.y <= f.y + HEAD
      const edge =
        p.x <= f.x + pad || p.x >= f.x + f.w - pad || p.y <= f.y + pad || p.y >= f.y + f.h - pad
      if (!head && !edge) continue
    }
    if (!best || f.w * f.h < best.w * best.h) best = f
  }
  return best ? { kind: 'frame', id: best.id } : null
}

// ---- editing ----

export function addConnector(
  s: CanvasState,
  from: End,
  to: End,
  style: { shape?: ConnectorShape; heads?: ConnectorHeads } = {}
): { state: CanvasState; id: string } | null {
  if (sameObject(from, to) || !exists(s, from) || !exists(s, to)) return null
  if (from.kind === 'point' && to.kind === 'point' && Math.hypot(to.x - from.x, to.y - from.y) < 8)
    return null
  if (connectorsOf(s).length >= CONNECTORS_MAX) return null
  const id = `k${s.seq + 1}`
  const c: CanvasConnector = {
    id,
    from: { ...from },
    to: { ...to },
    shape: style.shape ?? 'curved',
    heads: style.heads ?? 'end',
    label: ''
  }
  return { state: { ...s, seq: s.seq + 1, connectors: [...connectorsOf(s), c] }, id }
}

export function patchConnector(
  s: CanvasState,
  id: string,
  patch: Partial<Pick<CanvasConnector, 'shape' | 'heads' | 'label'>>
): CanvasState {
  const c = connectorsOf(s).find((x) => x.id === id)
  if (!c) return s
  const next = { ...c, ...patch }
  if (patch.label !== undefined) next.label = cleanLabel(patch.label)
  if (next.shape === c.shape && next.heads === c.heads && next.label === c.label) return s
  return { ...s, connectors: connectorsOf(s).map((x) => (x.id === id ? next : x)) }
}

/** Tie one end of a connector somewhere else (to an object or a point); not to the object at its other end. */
export function setConnectorEnd(
  s: CanvasState,
  id: string,
  which: 'from' | 'to',
  end: End
): CanvasState {
  const c = connectorsOf(s).find((x) => x.id === id)
  if (!c || !exists(s, end) || sameObject(end, which === 'from' ? c.to : c.from)) return s
  return {
    ...s,
    connectors: connectorsOf(s).map((x) => (x.id === id ? { ...x, [which]: { ...end } } : x))
  }
}

export function deleteConnectors(s: CanvasState, ids: string[]): CanvasState {
  const set = new Set(ids)
  const list = connectorsOf(s)
  const next = list.filter((c) => !set.has(c.id))
  return next.length === list.length ? s : { ...s, connectors: next }
}

/** The connectors attached to an object (by its `endKey`). */
export const connectorsOn = (s: CanvasState, key: string): CanvasConnector[] =>
  connectorsOf(s).filter((c) => endKey(c.from) === key || endKey(c.to) === key)

/** Connectors whose object is gone go too (a closed tab, a deleted note or frame). Same state if none. */
export function pruneConnectors(s: CanvasState): CanvasState {
  const list = s.connectors
  if (!list || list.length === 0) return s
  const keep = list.filter((c) => exists(s, c.from) && exists(s, c.to) && !sameObject(c.from, c.to))
  return keep.length === list.length ? s : { ...s, connectors: keep }
}

/**
 * Card ends follow cards whose ids changed (a later run of the app gives the tabs new ids). A card end not in `ids`
 * is dropped with its connector: its old id may now belong to another tab.
 */
export function remapCards(
  list: CanvasConnector[],
  ids: ReadonlyMap<number, number>
): CanvasConnector[] {
  const map = (e: End): End | null =>
    e.kind !== 'card' ? e : ids.has(e.id) ? { kind: 'card', id: ids.get(e.id)! } : null
  return list.flatMap((c) => {
    const from = map(c.from)
    const to = map(c.to)
    return from && to ? [{ ...c, from, to }] : []
  })
}

export const cleanLabel = (v: string): string => v.replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX)

// ---- saving and loading ----

const num = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < COORD_MAX
const str = (v: unknown, max = 40): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max

function cleanEnd(v: unknown): End | null {
  const e = v as Record<string, unknown> | null
  if (!e || typeof e !== 'object') return null
  if (e.kind === 'card' && num(e.id) && Number.isInteger(e.id)) return { kind: 'card', id: e.id }
  if ((e.kind === 'note' || e.kind === 'frame' || e.kind === 'mark') && str(e.id))
    return { kind: e.kind, id: e.id }
  if (e.kind === 'point' && num(e.x) && num(e.y)) return { kind: 'point', x: e.x, y: e.y }
  return null
}

/** Connectors from disk (or from the renderer): only well-formed ones, each id once, at most CONNECTORS_MAX. */
export function sanitizeConnectors(v: unknown): CanvasConnector[] {
  if (!Array.isArray(v)) return []
  const out: CanvasConnector[] = []
  const seen = new Set<string>()
  for (const raw of v) {
    if (out.length >= CONNECTORS_MAX) break
    const c = raw as Record<string, unknown> | null
    if (!c || typeof c !== 'object' || !str(c.id) || seen.has(c.id)) continue
    const from = cleanEnd(c.from)
    const to = cleanEnd(c.to)
    if (!from || !to || sameObject(from, to)) continue
    seen.add(c.id)
    out.push({
      id: c.id,
      from,
      to,
      shape: SHAPES.includes(c.shape as ConnectorShape) ? (c.shape as ConnectorShape) : 'curved',
      heads: HEADS.includes(c.heads as ConnectorHeads) ? (c.heads as ConnectorHeads) : 'end',
      label: typeof c.label === 'string' ? cleanLabel(c.label) : ''
    })
  }
  return out
}
