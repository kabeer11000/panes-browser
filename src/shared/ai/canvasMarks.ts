import { boundsOf, cardBox, freeSpot, type Box, type CanvasState } from './canvas'

/**
 * Freehand marks, shapes and blocks drawn on the board: a pen line, a highlighter stroke, a shape (rectangle, rounded
 * rectangle, ellipse, diamond, triangle, arrow, star, speech bubble), a text label, or a block (table, checklist,
 * code). Pure and bounded, so what is saved is always something that can be drawn. Layer order is the order of the
 * list: later is in front.
 */
export type ShapeKind =
  'rect' | 'rounded' | 'ellipse' | 'diamond' | 'triangle' | 'arrow' | 'star' | 'bubble'
/** Blocks hold structured text: a table (rows of tab-separated cells), a checklist ("[x] " marks a done line), code. */
export type BlockKind = 'table' | 'checklist' | 'code'
export type MarkKind = 'pen' | 'marker' | 'text' | ShapeKind | BlockKind

export const SHAPE_KINDS: readonly ShapeKind[] = [
  'rect',
  'rounded',
  'ellipse',
  'diamond',
  'triangle',
  'arrow',
  'star',
  'bubble'
]
export const BLOCK_KINDS: readonly BlockKind[] = ['table', 'checklist', 'code']

export interface CanvasMark {
  id: string
  kind: MarkKind
  /** Pen and marker: the line's points, flat [x0, y0, x1, y1, ...], in board coordinates. */
  pts?: number[]
  x: number
  y: number
  w: number
  h: number
  /** Degrees, shapes and text only. */
  rot?: number
  text?: string
  /** Index into the mark colours (stroke for lines, outline and text for shapes). */
  color: number
  /** Fill of a shape: an index into the mark colours, or -1 for none. */
  fill?: number
  /** A shape has an outline (default true). */
  stroke?: boolean
  /** Text size in board units. */
  size?: number
  locked?: boolean
  /** Marks grouped together (Ctrl+G) share this id: they select and move as one. */
  group?: string
  /** A text label the person resized: it wraps at its width (else it is as wide as its longest line). */
  wrap?: boolean
}

export const MARK_COLORS = 8
export const MARKS_MAX = 600
export const PEN_POINTS_MAX = 1200
export const MARK_TEXT_MAX = 4000
export const MIN_SHAPE = 12

export const marksOf = (s: CanvasState): CanvasMark[] => s.marks ?? []

export const isShape = (k: MarkKind): k is ShapeKind =>
  (SHAPE_KINDS as readonly string[]).includes(k)
export const isBlock = (k: MarkKind): k is BlockKind =>
  (BLOCK_KINDS as readonly string[]).includes(k)

/** Text sizes offered for text and shapes: body, then heading. */
export const TEXT_SIZES = { body: 16, heading: 28 } as const
export const HEADING_MIN = 24

/** Fewer points for the same line: points closer than `eps` to the line between their neighbours go (Douglas-Peucker). */
export function simplifyPath(pts: number[], eps = 1.5): number[] {
  const n = pts.length / 2
  if (n <= 2) return pts.slice()
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = pts[a * 2]
    const ay = pts[a * 2 + 1]
    const dx = pts[b * 2] - ax
    const dy = pts[b * 2 + 1] - ay
    const len = Math.hypot(dx, dy)
    let far = -1
    let best = eps
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2] - ax
      const py = pts[i * 2 + 1] - ay
      const d = len === 0 ? Math.hypot(px, py) : Math.abs(px * dy - py * dx) / len
      if (d > best) {
        best = d
        far = i
      }
    }
    if (far >= 0) {
      keep[far] = 1
      stack.push([a, far], [far, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1])
  return out
}

export function pointsBounds(pts: number[]): Box {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = 0; i + 1 < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i])
    x1 = Math.max(x1, pts[i])
    y0 = Math.min(y0, pts[i + 1])
    y1 = Math.max(y1, pts[i + 1])
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 }
}

const colorOf = (c: number, none = false): number =>
  Number.isInteger(c) ? (none && c < 0 ? -1 : ((c % MARK_COLORS) + MARK_COLORS) % MARK_COLORS) : 0

/** A stroke from the points of a drag; null when it is too short to be a mark. */
export function addStroke(
  s: CanvasState,
  kind: 'pen' | 'marker',
  raw: number[],
  col = 0
): { state: CanvasState; id: string } | null {
  if (marksOf(s).length >= MARKS_MAX) return null
  const pts = simplifyPath(raw.slice(0, PEN_POINTS_MAX * 2))
  const b = pointsBounds(pts)
  if (pts.length < 4 || Math.hypot(b.w, b.h) < 6) return null
  const id = `m${s.seq + 1}`
  const mark: CanvasMark = { id, kind, pts, ...b, color: colorOf(col) }
  return { state: { ...s, seq: s.seq + 1, marks: [...marksOf(s), mark] }, id }
}

/** A shape from two corners (`square`: keep it as wide as it is tall), or a text label at a point. */
export function addShape(
  s: CanvasState,
  kind: ShapeKind | 'text',
  a: { x: number; y: number },
  b: { x: number; y: number },
  o: { color?: number; fill?: number; text?: string; square?: boolean } = {}
): { state: CanvasState; id: string } | null {
  if (marksOf(s).length >= MARKS_MAX) return null
  let w = Math.abs(b.x - a.x)
  let h = Math.abs(b.y - a.y)
  if (o.square) w = h = Math.max(w, h)
  const x = b.x < a.x ? a.x - w : a.x
  const y = b.y < a.y ? a.y - h : a.y
  const box = kind === 'text' ? { x: a.x, y: a.y, w: 200, h: 36 } : { x, y, w, h }
  if (kind !== 'text' && (box.w < MIN_SHAPE || box.h < MIN_SHAPE)) return null
  const id = `m${s.seq + 1}`
  const mark: CanvasMark =
    kind === 'text'
      ? {
          id,
          kind,
          ...box,
          color: colorOf(o.color ?? 0),
          text: (o.text ?? '').slice(0, MARK_TEXT_MAX),
          size: 20
        }
      : {
          id,
          kind,
          ...box,
          color: colorOf(o.color ?? 0),
          // filled with a light wash of its own colour unless asked otherwise (-1: no fill)
          fill: colorOf(o.fill ?? o.color ?? 0, true),
          stroke: true,
          text: (o.text ?? '').slice(0, MARK_TEXT_MAX) || undefined
        }
  return { state: { ...s, seq: s.seq + 1, marks: [...marksOf(s), mark] }, id }
}

export type MarkPatch = Partial<
  Pick<
    CanvasMark,
    | 'text'
    | 'color'
    | 'fill'
    | 'stroke'
    | 'size'
    | 'rot'
    | 'x'
    | 'y'
    | 'w'
    | 'h'
    | 'locked'
    | 'wrap'
  >
>

export function patchMark(s: CanvasState, id: string, patch: MarkPatch): CanvasState {
  const cur = marksOf(s).find((m) => m.id === id)
  if (!cur) return s
  const next: CanvasMark = { ...cur, ...patch }
  if (patch.text !== undefined) next.text = patch.text.slice(0, MARK_TEXT_MAX)
  if (patch.color !== undefined) next.color = colorOf(patch.color)
  if (patch.fill !== undefined) next.fill = colorOf(patch.fill, true)
  if (patch.size !== undefined) next.size = Math.max(8, Math.min(120, patch.size))
  if (patch.rot !== undefined) next.rot = ((patch.rot % 360) + 360) % 360
  if (patch.w !== undefined) next.w = Math.max(MIN_SHAPE, patch.w)
  if (patch.h !== undefined) next.h = Math.max(MIN_SHAPE, patch.h)
  // a block is as tall as its text needs
  if (isBlock(next.kind)) next.h = blockHeight(next.kind, next.text ?? '', next.size)
  // a moved line carries its points
  if (cur.pts && (patch.x !== undefined || patch.y !== undefined)) {
    const dx = (patch.x ?? cur.x) - cur.x
    const dy = (patch.y ?? cur.y) - cur.y
    next.pts = cur.pts.map((v, i) => v + (i % 2 === 0 ? dx : dy))
  }
  return { ...s, marks: marksOf(s).map((m) => (m.id === id ? next : m)) }
}

export function deleteMarks(s: CanvasState, ids: string[]): CanvasState {
  const set = new Set(ids)
  const have = marksOf(s)
  if (!have.some((m) => set.has(m.id))) return s
  return { ...s, marks: have.filter((m) => !set.has(m.id)) }
}

/** Layer order: bring the marks to the front, or send them to the back. */
export function reorderMarks(s: CanvasState, ids: string[], to: 'front' | 'back'): CanvasState {
  const set = new Set(ids)
  const have = marksOf(s)
  const picked = have.filter((m) => set.has(m.id))
  if (picked.length === 0) return s
  const rest = have.filter((m) => !set.has(m.id))
  return { ...s, marks: to === 'front' ? [...rest, ...picked] : [...picked, ...rest] }
}

/** A copy of marks, nudged, as new marks in front (duplicate). Copied groups become new groups of the copies. */
export function duplicateMarks(
  s: CanvasState,
  ids: string[],
  d = 24
): { state: CanvasState; ids: string[] } {
  const src = marksOf(s).filter((m) => ids.includes(m.id))
  let seq = s.seq
  const groups = new Map<string, string>()
  const made = src.slice(0, Math.max(0, MARKS_MAX - marksOf(s).length)).map((m) => {
    const id = `m${++seq}`
    let group: string | undefined
    if (m.group) {
      if (!groups.has(m.group)) groups.set(m.group, `g${++seq}`)
      group = groups.get(m.group)
    }
    return {
      ...m,
      id,
      x: m.x + d,
      y: m.y + d,
      pts: m.pts?.map((v) => v + d),
      locked: undefined,
      group
    }
  })
  return { state: { ...s, seq, marks: [...marksOf(s), ...made] }, ids: made.map((m) => m.id) }
}

// ---- blocks ----

const BLOCK_NEW: Record<BlockKind, { w: number; text: string }> = {
  table: { w: 360, text: 'Item\tNotes\n\t\n\t' },
  checklist: { w: 260, text: '[ ] First thing\n[ ] Next thing' },
  code: { w: 380, text: '' }
}
/** Line heights (board units) the renderer draws blocks with; heights follow from them. */
export const BLOCK_ROW = { table: 34, checklist: 28, code: 20 } as const
const BLOCK_PAD = 16

/** The height a block needs for its text (its lines never wrap: long ones are cut on screen). */
export function blockHeight(kind: BlockKind, text: string, size?: number): number {
  const k = (size ?? 14) / 14
  if (kind === 'table') return parseTable(text).length * BLOCK_ROW.table * k + 2
  const lines = Math.max(1, text.split('\n').length)
  return Math.round(lines * BLOCK_ROW[kind] * k + BLOCK_PAD * 2)
}

/** A table, checklist or code block with its top-left at `at`. */
export function addBlock(
  s: CanvasState,
  kind: BlockKind,
  at: { x: number; y: number },
  text?: string
): { state: CanvasState; id: string } | null {
  if (marksOf(s).length >= MARKS_MAX) return null
  const id = `m${s.seq + 1}`
  const t = (text ?? BLOCK_NEW[kind].text).slice(0, MARK_TEXT_MAX)
  const mark: CanvasMark = {
    id,
    kind,
    x: at.x,
    y: at.y,
    w: BLOCK_NEW[kind].w,
    h: blockHeight(kind, t),
    color: 0,
    text: t
  }
  return { state: { ...s, seq: s.seq + 1, marks: [...marksOf(s), mark] }, id }
}

/** The rows of a table block, every row as long as the longest (at least one row of one cell). */
export function parseTable(text: string): string[][] {
  const rows = text.split('\n').map((r) => r.split('\t'))
  const cols = Math.max(1, ...rows.map((r) => r.length))
  return rows.map((r) => [...r, ...Array<string>(cols - r.length).fill('')])
}
export const tableText = (rows: string[][]): string =>
  rows.map((r) => r.map((c) => c.replace(/[\t\n]/g, ' ')).join('\t')).join('\n')

export interface CheckLine {
  done: boolean
  text: string
}
export const checkLines = (text: string): CheckLine[] =>
  text.split('\n').map((l) => {
    const m = /^\[( |x)\] ?(.*)$/i.exec(l)
    return m ? { done: m[1].toLowerCase() === 'x', text: m[2] } : { done: false, text: l }
  })
export const checkText = (lines: CheckLine[]): string =>
  lines.map((l) => `[${l.done ? 'x' : ' '}] ${l.text}`).join('\n')
/** The checklist's text with line `i` ticked or unticked. */
export const toggleCheck = (text: string, i: number): string =>
  checkText(checkLines(text).map((l, k) => (k === i ? { ...l, done: !l.done } : l)))

// ---- many at once: groups, moving, aligning ----

/** The ids plus every mark grouped with one of them, in board order. */
export function withGroups(s: CanvasState, ids: readonly string[]): string[] {
  const all = marksOf(s)
  const groups = new Set(all.filter((m) => ids.includes(m.id) && m.group).map((m) => m.group))
  return all.filter((m) => ids.includes(m.id) || (m.group && groups.has(m.group))).map((m) => m.id)
}

/** Group two or more marks (any groups they were in merge into the new one). */
export function groupMarks(
  s: CanvasState,
  ids: readonly string[]
): { state: CanvasState; id: string } | null {
  const pick = new Set(withGroups(s, ids))
  if (pick.size < 2) return null
  const id = `g${s.seq + 1}`
  return {
    state: {
      ...s,
      seq: s.seq + 1,
      marks: marksOf(s).map((m) => (pick.has(m.id) ? { ...m, group: id } : m))
    },
    id
  }
}

export function ungroupMarks(s: CanvasState, ids: readonly string[]): CanvasState {
  const pick = new Set(withGroups(s, ids))
  if (!marksOf(s).some((m) => pick.has(m.id) && m.group)) return s
  return {
    ...s,
    marks: marksOf(s).map((m) => (pick.has(m.id) && m.group ? { ...m, group: undefined } : m))
  }
}

/** Move marks by (dx, dy); locked ones stay. */
export function moveMarks(
  s: CanvasState,
  ids: readonly string[],
  dx: number,
  dy: number
): CanvasState {
  if (dx === 0 && dy === 0) return s
  let n = s
  for (const m of marksOf(s))
    if (ids.includes(m.id) && !m.locked) n = patchMark(n, m.id, { x: m.x + dx, y: m.y + dy })
  return n
}

export const markBox = (m: CanvasMark): Box => ({ x: m.x, y: m.y, w: m.w, h: m.h })

/** The marks as units that move together: a group is one unit, a loose mark another. Locked marks are left out. */
function units(s: CanvasState, ids: readonly string[]): Array<{ ids: string[]; box: Box }> {
  const by = new Map<string, CanvasMark[]>()
  for (const m of marksOf(s)) {
    if (!ids.includes(m.id) || m.locked) continue
    const k = m.group ?? `#${m.id}`
    by.set(k, [...(by.get(k) ?? []), m])
  }
  return [...by.values()].map((ms) => ({
    ids: ms.map((m) => m.id),
    box: boundsOf(ms.map(markBox))!
  }))
}

export type Align = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

/** Line marks up on an edge or the middle of the box around them all (a group moves as one). */
export function alignMarks(s: CanvasState, ids: readonly string[], how: Align): CanvasState {
  const us = units(s, ids)
  if (us.length < 2) return s
  const all = boundsOf(us.map((u) => u.box))!
  let n = s
  for (const u of us) {
    const b = u.box
    const dx =
      how === 'left'
        ? all.x - b.x
        : how === 'right'
          ? all.x + all.w - (b.x + b.w)
          : how === 'center'
            ? all.x + all.w / 2 - (b.x + b.w / 2)
            : 0
    const dy =
      how === 'top'
        ? all.y - b.y
        : how === 'bottom'
          ? all.y + all.h - (b.y + b.h)
          : how === 'middle'
            ? all.y + all.h / 2 - (b.y + b.h / 2)
            : 0
    n = moveMarks(n, u.ids, dx, dy)
  }
  return n
}

/** Even gaps between three or more marks along an axis; the first and last stay where they are. */
export function distributeMarks(
  s: CanvasState,
  ids: readonly string[],
  axis: 'x' | 'y'
): CanvasState {
  const us = units(s, ids)
  if (us.length < 3) return s
  const lo = (b: Box): number => (axis === 'x' ? b.x : b.y)
  const len = (b: Box): number => (axis === 'x' ? b.w : b.h)
  us.sort((a, b) => lo(a.box) + len(a.box) / 2 - (lo(b.box) + len(b.box) / 2))
  const first = us[0].box
  const last = us[us.length - 1].box
  const span = lo(last) + len(last) - lo(first)
  const gap = (span - us.reduce((t, u) => t + len(u.box), 0)) / (us.length - 1)
  let at = lo(first) + len(first) + gap
  let n = s
  for (const u of us.slice(1, -1)) {
    const d = at - lo(u.box)
    n = moveMarks(n, u.ids, axis === 'x' ? d : 0, axis === 'y' ? d : 0)
    at += len(u.box) + gap
  }
  return n
}

/** Everything on the board as boxes (frames, notes, cards outside frames, drawings): what "fit" shows. */
/** A section's title sits above its top edge, this tall: fitting the board to the screen keeps it in view. */
export const FRAME_TITLE = 36

export const contentBoxes = (s: CanvasState): Box[] => [
  ...s.frames.map((f) => ({ x: f.x, y: f.y - FRAME_TITLE, w: f.w, h: f.h + FRAME_TITLE })),
  ...s.notes,
  ...s.cards.filter((c) => !c.frame).map(cardBox),
  ...marksOf(s).map(markBox)
]

const distToSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number => {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** The topmost mark under a point, within `tol` board units of its line or inside its shape. */
export function markAt(s: CanvasState, px: number, py: number, tol = 6): CanvasMark | null {
  const list = marksOf(s)
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    if (m.pts) {
      for (let k = 0; k + 3 < m.pts.length; k += 2) {
        if (distToSegment(px, py, m.pts[k], m.pts[k + 1], m.pts[k + 2], m.pts[k + 3]) <= tol)
          return m
      }
      continue
    }
    // undo the rotation about the centre, then test against the unrotated shape
    const cx = m.x + m.w / 2
    const cy = m.y + m.h / 2
    const r = ((m.rot ?? 0) * Math.PI) / 180
    const dx = px - cx
    const dy = py - cy
    const qx = cx + dx * Math.cos(-r) - dy * Math.sin(-r)
    const qy = cy + dx * Math.sin(-r) + dy * Math.cos(-r)
    if (m.kind === 'ellipse') {
      const nx = (qx - cx) / (m.w / 2 + tol)
      const ny = (qy - cy) / (m.h / 2 + tol)
      if (nx * nx + ny * ny <= 1) return m
    } else if (qx >= m.x - tol && qx <= m.x + m.w + tol && qy >= m.y - tol && qy <= m.y + m.h + tol)
      return m
  }
  return null
}

/** The SVG path (in the mark's own 0..w, 0..h box) of a shape that is not a plain rectangle or ellipse. */
export function shapePath(kind: ShapeKind, w: number, h: number): string {
  const f = (n: number): string => (Math.round(n * 100) / 100).toString()
  switch (kind) {
    case 'diamond':
      return `M${f(w / 2)} 0L${f(w)} ${f(h / 2)}L${f(w / 2)} ${f(h)}L0 ${f(h / 2)}Z`
    case 'triangle':
      return `M${f(w / 2)} 0L${f(w)} ${f(h)}L0 ${f(h)}Z`
    case 'arrow': {
      // a block arrow pointing right: the head is at most as long as the arrow is tall
      const hx = w - Math.min(w * 0.45, h * 0.9)
      return `M0 ${f(h * 0.3)}H${f(hx)}V0L${f(w)} ${f(h / 2)}L${f(hx)} ${f(h)}V${f(h * 0.7)}H0Z`
    }
    case 'star': {
      const pts: string[] = []
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 1 : 0.42
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        pts.push(`${f(w / 2 + (Math.cos(a) * r * w) / 2)} ${f(h / 2 + (Math.sin(a) * r * h) / 2)}`)
      }
      return `M${pts.join('L')}Z`
    }
    case 'bubble': {
      const b = h * 0.8
      const r = Math.min(14, b / 3)
      return `M${f(r)} 0H${f(w - r)}Q${f(w)} 0 ${f(w)} ${f(r)}V${f(b - r)}Q${f(w)} ${f(b)} ${f(w - r)} ${f(b)}H${f(w * 0.45)}L${f(w * 0.25)} ${f(h)}L${f(w * 0.3)} ${f(b)}H${f(r)}Q0 ${f(b)} 0 ${f(b - r)}V${f(r)}Q0 0 ${f(r)} 0Z`
    }
    default:
      return ''
  }
}

/** What was read back from disk: only well-formed marks, bounded in number and size. */
export function sanitizeMarks(v: unknown): CanvasMark[] {
  if (!Array.isArray(v)) return []
  const out: CanvasMark[] = []
  const num = (x: unknown): number | null =>
    typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e7 ? x : null
  for (const r of v.slice(0, MARKS_MAX)) {
    const o = (r ?? {}) as Record<string, unknown>
    const kind = o.kind as MarkKind
    if (kind !== 'pen' && kind !== 'marker' && kind !== 'text' && !isShape(kind) && !isBlock(kind))
      continue
    const x = num(o.x)
    const y = num(o.y)
    const w = num(o.w)
    const h = num(o.h)
    if (typeof o.id !== 'string' || x === null || y === null || w === null || h === null) continue
    const mark: CanvasMark = {
      id: o.id.slice(0, 20),
      kind,
      x,
      y,
      w,
      h,
      color: colorOf(Number(o.color))
    }
    if (kind === 'pen' || kind === 'marker') {
      if (!Array.isArray(o.pts)) continue
      const pts = o.pts.slice(0, PEN_POINTS_MAX * 2).filter((n): n is number => num(n) !== null)
      if (pts.length < 4 || pts.length % 2) continue
      mark.pts = pts
    } else {
      if (typeof o.text === 'string') mark.text = o.text.slice(0, MARK_TEXT_MAX)
      if (num(o.rot) !== null) mark.rot = (((o.rot as number) % 360) + 360) % 360
      if (num(o.size) !== null) mark.size = Math.max(8, Math.min(120, o.size as number))
      if (isShape(kind)) {
        mark.fill = colorOf(Number(o.fill ?? -1), true)
        mark.stroke = o.stroke !== false
      }
      if (isBlock(kind)) mark.h = blockHeight(kind, mark.text ?? '', mark.size)
    }
    if (o.locked === true) mark.locked = true
    if (o.wrap === true && kind === 'text') mark.wrap = true
    if (typeof o.group === 'string' && o.group.length > 0 && o.group.length <= 20)
      mark.group = o.group
    out.push(mark)
  }
  return out
}

// ---- flowcharts ----

export const FLOW_MAX = 16
const FLOW = { w: 200, h: 84, gap: 64 }

/**
 * Lay out a flowchart: one shape per step, top to bottom (or left to right), in free space near `near`. A step that
 * asks something ("Paid?") is a diamond, the first and last are rounded, the rest rectangles. Returns the new
 * state and the shape ids in order; the caller draws the arrows (connectors.ts) so this file stays free of them.
 */
export function layFlow(
  s: CanvasState,
  steps: readonly string[],
  near: { x: number; y: number },
  dir: 'down' | 'right' = 'down'
): { state: CanvasState; ids: string[] } | null {
  const list = steps
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, FLOW_MAX)
  if (list.length === 0 || marksOf(s).length + list.length > MARKS_MAX) return null
  const n = list.length
  const size =
    dir === 'down'
      ? { w: FLOW.w, h: n * FLOW.h + (n - 1) * FLOW.gap }
      : { w: n * FLOW.w + (n - 1) * FLOW.gap, h: FLOW.h }
  const spot = freeSpot(size, contentBoxes(s), near, 40)
  let st = s
  const ids: string[] = []
  list.forEach((t, i) => {
    const kind: ShapeKind = /\?$/.test(t) ? 'diamond' : i === 0 || i === n - 1 ? 'rounded' : 'rect'
    const x = spot.x + (dir === 'right' ? i * (FLOW.w + FLOW.gap) : 0)
    const y = spot.y + (dir === 'down' ? i * (FLOW.h + FLOW.gap) : 0)
    const made = addShape(
      st,
      kind,
      { x, y },
      { x: x + FLOW.w, y: y + FLOW.h },
      {
        text: t,
        color: 0,
        fill: kind === 'diamond' ? 3 : 1
      }
    )!
    st = made.state
    ids.push(made.id)
  })
  return { state: st, ids }
}
