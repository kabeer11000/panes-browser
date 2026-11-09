import {
  addLoose,
  collapseFrame,
  deleteFrame,
  deleteNote,
  expandFrame,
  freeSpot,
  groupInto,
  isVirtual,
  moveToFrame,
  removeVirtual,
  renameFrame,
  setItem,
  type CanvasState
} from './canvas'
import { addConnector, connectorsOf, patchConnector, type End } from './connectors'
import {
  addShape,
  contentBoxes,
  deleteMarks,
  FLOW_MAX,
  layFlow,
  marksOf,
  patchMark,
  SHAPE_KINDS,
  type ShapeKind
} from './canvasMarks'
import { itemFor, kindOf, type CanvasItem, type Placement } from './canvasItems'
import { placeItem } from './canvasPlace'

/**
 * What the canvas assistant may do to the board. Arguments come from a model, so each is checked here, once, and the
 * error text goes back to the model so it can try again. Objects are named by short tokens ("c12" a card, "f3" a
 * frame, "n2" a note, "m5" a mark); the model is told to talk about titles, never about these.
 */
export type BoardToolName =
  | 'get_board'
  | 'tidy_up'
  | 'arrange'
  | 'create_frame'
  | 'rename_frame'
  | 'move_cards'
  | 'stack'
  | 'delete_items'
  | 'add_note'
  | 'add_card'
  | 'connect'
  | 'set_kind'
  | 'focus'
  | 'select'
  | 'add_shape'
  | 'flowchart'
  | 'style'

export interface BoardToolSpec {
  name: BoardToolName
  description: string
  /** Offered to the small local model (few, tightly described). */
  local: boolean
  /** Waits for the person's Confirm. */
  confirm: boolean
  schema: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
    additionalProperties: false
  }
}

const obj = (properties: Record<string, unknown>, required: string[]): BoardToolSpec['schema'] => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
})
const IDS = {
  type: 'array',
  items: { type: 'string' },
  description: 'Object ids from get_board (like c12 or n3)'
}
const ID = { type: 'string', description: 'An object id from get_board' }

export const BOARD_TOOLS: readonly BoardToolSpec[] = [
  {
    name: 'get_board',
    description:
      'See what is on the board: frames, cards (with id, kind, title), notes, arrows and what is selected.',
    local: true,
    confirm: false,
    schema: obj({}, [])
  },
  {
    name: 'tidy_up',
    description:
      'Tidy the board: sort the tabs into frames by topic. scope "all" rearranges everything, "keep" leaves frames the person made.',
    local: true,
    confirm: false,
    schema: obj({ scope: { type: 'string', enum: ['keep', 'all'] } }, [])
  },
  {
    name: 'arrange',
    description:
      'Group cards into frames: by "topic" (meaning), "site" (same website) or "kind" (PDFs, pictures, pages, notes), or by "custom" groups you choose.',
    local: true,
    confirm: false,
    schema: obj(
      {
        by: { type: 'string', enum: ['topic', 'site', 'kind', 'custom'] },
        groups: {
          type: 'array',
          description: 'For custom: the groups to make',
          items: obj({ name: { type: 'string' }, cardIds: IDS }, ['name', 'cardIds'])
        }
      },
      ['by']
    )
  },
  {
    name: 'create_frame',
    description: 'Make a named frame and put these cards in it.',
    local: true,
    confirm: false,
    schema: obj({ name: { type: 'string' }, cardIds: IDS }, ['name', 'cardIds'])
  },
  {
    name: 'rename_frame',
    description: 'Rename a frame.',
    local: false,
    confirm: false,
    schema: obj({ frameId: ID, name: { type: 'string' } }, ['frameId', 'name'])
  },
  {
    name: 'move_cards',
    description: 'Move cards into a frame.',
    local: false,
    confirm: false,
    schema: obj({ cardIds: IDS, toFrame: ID }, ['cardIds', 'toFrame'])
  },
  {
    name: 'stack',
    description: 'Fold a frame of results into a pile, or open the pile again.',
    local: false,
    confirm: false,
    schema: obj({ frameId: ID, open: { type: 'boolean' } }, ['frameId'])
  },
  {
    name: 'delete_items',
    description:
      'Take cards, notes, frames or marks off the board. Cards of open tabs are not closed. The person is asked first.',
    local: false,
    confirm: true,
    schema: obj({ ids: IDS }, ['ids'])
  },
  {
    name: 'add_note',
    description:
      'Put a note on the board: a short text (Markdown allowed), next to an object if you name one.',
    local: true,
    confirm: false,
    schema: obj({ text: { type: 'string' }, near: ID }, ['text'])
  },
  {
    name: 'add_card',
    description:
      'Put a web page, PDF or picture on the board as a card. It opens as a document there; no tab is made.',
    local: false,
    confirm: false,
    schema: obj({ url: { type: 'string' }, near: ID }, ['url'])
  },
  {
    name: 'connect',
    description: 'Draw an arrow from one object to another, with an optional short label.',
    local: false,
    confirm: false,
    schema: obj({ fromId: ID, toId: ID, label: { type: 'string' } }, ['fromId', 'toId'])
  },
  {
    name: 'set_kind',
    description:
      'Show a card as a "note" (text with key points), a "document" (its content) or a "live" page.',
    local: false,
    confirm: false,
    schema: obj({ cardId: ID, kind: { type: 'string', enum: ['note', 'document', 'live'] } }, [
      'cardId',
      'kind'
    ])
  },
  {
    name: 'focus',
    description: 'Move the view to show these objects.',
    local: true,
    confirm: false,
    schema: obj({ ids: IDS }, ['ids'])
  },
  {
    name: 'select',
    description: 'Select these objects on the board.',
    local: true,
    confirm: false,
    schema: obj({ ids: IDS }, ['ids'])
  },
  {
    name: 'add_shape',
    description:
      'Draw a shape (rect, rounded, ellipse, diamond, triangle, arrow, star, bubble) with optional text and a colour from 0 to 7, next to an object if you name one. Shapes can be joined with connect.',
    local: false,
    confirm: false,
    schema: obj(
      {
        kind: { type: 'string', enum: [...SHAPE_KINDS] },
        text: { type: 'string' },
        color: { type: 'integer' },
        near: ID
      },
      ['kind']
    )
  },
  {
    name: 'flowchart',
    description:
      'Draw a flowchart: one shape per step in order, joined by arrows. End a step with "?" for a decision. Use this, not add_shape, when asked for a flowchart, a process or steps.',
    local: false,
    confirm: false,
    schema: obj(
      {
        steps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Short step texts, in order'
        },
        direction: { type: 'string', enum: ['down', 'right'] },
        near: ID
      },
      ['steps']
    )
  },
  {
    name: 'style',
    description: 'Change how shapes look: color 0 to 7, fill 0 to 7 or -1 for none, text.',
    local: false,
    confirm: false,
    schema: obj(
      { ids: IDS, color: { type: 'integer' }, fill: { type: 'integer' }, text: { type: 'string' } },
      ['ids']
    )
  }
]

export const boardToolsFor = (weak: boolean): BoardToolSpec[] =>
  BOARD_TOOLS.filter((t) => !weak || t.local)

// ---- ids ----

export type Ref = { kind: 'card'; id: number } | { kind: 'frame' | 'note' | 'mark'; id: string }

/** "c12" a tab's card, "v3" a card the prompt made, "f2" a frame, "n1" a note, "m4" a mark. */
export function refToken(r: Ref): string {
  if (r.kind === 'card') return r.id < 0 ? `v${-r.id}` : `c${r.id}`
  return String(r.id)
}

export function parseRef(t: unknown): Ref | null {
  if (typeof t !== 'string') return null
  const m = /^([cvfnm])(\d+)$/.exec(t.trim())
  if (!m) return null
  const n = Number(m[2])
  if (m[1] === 'c') return { kind: 'card', id: n }
  if (m[1] === 'v') return { kind: 'card', id: -n }
  return { kind: m[1] === 'f' ? 'frame' : m[1] === 'n' ? 'note' : 'mark', id: `${m[1]}${n}` }
}

// ---- reading the board ----

export interface BoardTab {
  id: number
  url: string
  title: string
  private: boolean
}

const q = (s: string, n = 70): string =>
  `"${s.replace(/\s+/g, ' ').replace(/"/g, "'").slice(0, n)}"`

/** The board as compact text for the model: frames with their cards, loose cards, notes, arrows, the selection. */
export function boardSummary(
  s: CanvasState,
  tabs: readonly BoardTab[],
  selected: readonly string[] = [],
  max = 6000
): string {
  const tab = new Map(tabs.map((t) => [t.id, t]))
  const cardLine = (id: number): string => {
    const c = s.cards.find((x) => x.id === id)
    if (!c) return ''
    const t = tab.get(id)
    if (c.private || t?.private) return `${refToken({ kind: 'card', id })} (a private tab)`
    const it = s.items[String(id)]
    const kind = it ? (it.placement === 'note' ? 'note' : it.kind) : kindOf(t?.url ?? c.url)
    return `${refToken({ kind: 'card', id })} ${q(it?.title || t?.title || c.url)} (${kind})`
  }
  const lines: string[] = []
  for (const f of s.frames) {
    const ids = s.cards.filter((c) => c.frame === f.id).map((c) => c.id)
    lines.push(
      `Frame ${f.id} ${q(f.name, 40)}${f.stack ? ' [folded]' : ''}: ${ids.map(cardLine).join('; ') || 'empty'}`
    )
  }
  const loose = s.cards.filter((c) => !c.frame).map((c) => cardLine(c.id))
  if (loose.length) lines.push(`Loose cards: ${loose.join('; ')}`)
  if (s.notes.length)
    lines.push(`Notes: ${s.notes.map((n) => `${n.id} ${q(n.text || '(empty)', 60)}`).join('; ')}`)
  const marks = marksOf(s).filter((m) => m.kind !== 'pen' && m.kind !== 'marker')
  if (marks.length)
    lines.push(
      `Shapes: ${marks.map((m) => `${m.id} ${m.kind}${m.text ? ' ' + q(m.text, 40) : ''}`).join('; ')}`
    )
  const arrows = connectorsOf(s)
  if (arrows.length) {
    const nameOf = (e: End): string =>
      e.kind === 'card'
        ? refToken({ kind: 'card', id: e.id })
        : e.kind === 'point'
          ? 'a point'
          : e.id
    lines.push(
      `Arrows: ${arrows.map((c) => `${nameOf(c.from)} to ${nameOf(c.to)}${c.label ? ' ' + q(c.label, 30) : ''}`).join('; ')}`
    )
  }
  lines.push(selected.length ? `Selected: ${selected.join(', ')}` : 'Nothing is selected.')
  const out = lines.join('\n')
  return out.length > max ? out.slice(0, max - 20) + '\n[board cut here]' : out
}

// ---- checking arguments ----

export type BoardCall =
  | { name: 'get_board' }
  | { name: 'tidy_up'; scope: 'keep' | 'all' }
  | {
      name: 'arrange'
      by: 'topic' | 'site' | 'kind' | 'custom'
      groups: Array<{ name: string; ids: Ref[] }>
    }
  | { name: 'create_frame'; frameName: string; ids: Ref[] }
  | { name: 'rename_frame'; frame: string; frameName: string }
  | { name: 'move_cards'; ids: Ref[]; frame: string }
  | { name: 'stack'; frame: string; open: boolean }
  | { name: 'delete_items'; ids: Ref[] }
  | { name: 'add_note'; text: string; near: Ref | null }
  | { name: 'add_card'; url: string; near: Ref | null }
  | { name: 'connect'; from: Ref; to: Ref; label: string }
  | { name: 'set_kind'; card: number; kind: Placement }
  | { name: 'focus' | 'select'; ids: Ref[] }
  | { name: 'add_shape'; kind: ShapeKind; text: string; color: number; near: Ref | null }
  | { name: 'flowchart'; steps: string[]; direction: 'down' | 'right'; near: Ref | null }
  | { name: 'style'; ids: Ref[]; color?: number; fill?: number; text?: string }

export type Checked = { ok: true; value: BoardCall } | { ok: false; error: string }

export const MAX_IDS = 80
export const MAX_NOTE = 4000

const refs = (v: unknown): Ref[] | null => {
  if (!Array.isArray(v) || v.length > MAX_IDS) return null
  const out: Ref[] = []
  for (const t of v) {
    const r = parseRef(t)
    if (!r) return null
    out.push(r)
  }
  return out
}
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

export function checkBoardCall(name: string, input: unknown): Checked {
  const a = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const bad = (error: string): Checked => ({ ok: false, error })
  const idsErr = 'ids must be object ids from get_board, like c12, v3, f2, n1'
  switch (name) {
    case 'get_board':
      return { ok: true, value: { name } }
    case 'tidy_up':
      return { ok: true, value: { name, scope: a.scope === 'all' ? 'all' : 'keep' } }
    case 'arrange': {
      const by = a.by
      if (by !== 'topic' && by !== 'site' && by !== 'kind' && by !== 'custom')
        return bad('by must be topic, site, kind or custom')
      const groups: Array<{ name: string; ids: Ref[] }> = []
      if (by === 'custom') {
        if (!Array.isArray(a.groups) || a.groups.length === 0 || a.groups.length > 20)
          return bad('custom needs 1 to 20 groups')
        for (const g of a.groups) {
          const o = (g ?? {}) as Record<string, unknown>
          const r = refs(o.cardIds)
          if (!r || r.length === 0 || !text(o.name, 40).trim())
            return bad('each group needs a name and cardIds from get_board')
          groups.push({ name: text(o.name, 40).trim(), ids: r })
        }
      }
      return { ok: true, value: { name, by, groups } }
    }
    case 'create_frame': {
      const r = refs(a.cardIds)
      const n = text(a.name, 40).trim()
      if (!r || r.length === 0) return bad('cardIds must be card ids from get_board')
      return n ? { ok: true, value: { name, frameName: n, ids: r } } : bad('name must not be empty')
    }
    case 'rename_frame': {
      const f = parseRef(a.frameId)
      const n = text(a.name, 40).trim()
      return f?.kind === 'frame' && n
        ? { ok: true, value: { name, frame: f.id, frameName: n } }
        : bad('frameId must be a frame id like f2, and name must not be empty')
    }
    case 'move_cards': {
      const r = refs(a.cardIds)
      const f = parseRef(a.toFrame)
      return r && f?.kind === 'frame'
        ? { ok: true, value: { name, ids: r, frame: f.id } }
        : bad('cardIds must be card ids and toFrame a frame id')
    }
    case 'stack': {
      const f = parseRef(a.frameId)
      return f?.kind === 'frame'
        ? { ok: true, value: { name, frame: f.id, open: a.open === true } }
        : bad('frameId must be a frame id like f2')
    }
    case 'delete_items': {
      const r = refs(a.ids)
      return r && r.length ? { ok: true, value: { name, ids: r } } : bad(idsErr)
    }
    case 'add_note': {
      const t = text(a.text, MAX_NOTE).trim()
      return t
        ? { ok: true, value: { name, text: t, near: parseRef(a.near) } }
        : bad('text must not be empty')
    }
    case 'add_card': {
      const u = text(a.url, 2000).trim()
      return /^https?:\/\/\S+$/i.test(u)
        ? { ok: true, value: { name, url: u, near: parseRef(a.near) } }
        : bad('url must be a full http or https address')
    }
    case 'connect': {
      const f = parseRef(a.fromId)
      const t = parseRef(a.toId)
      return f && t
        ? { ok: true, value: { name, from: f, to: t, label: text(a.label, 60).trim() } }
        : bad('fromId and toId must be object ids from get_board')
    }
    case 'set_kind': {
      const c = parseRef(a.cardId)
      const k = a.kind
      return c?.kind === 'card' && (k === 'note' || k === 'document' || k === 'live')
        ? { ok: true, value: { name, card: c.id, kind: k } }
        : bad('cardId must be a card id and kind note, document or live')
    }
    case 'focus':
    case 'select': {
      const r = refs(a.ids)
      return r && r.length ? { ok: true, value: { name, ids: r } } : bad(idsErr)
    }
    case 'add_shape': {
      const k = a.kind as ShapeKind
      if (!SHAPE_KINDS.includes(k)) return bad(`kind must be one of ${SHAPE_KINDS.join(', ')}`)
      const c = Number.isInteger(a.color) ? (a.color as number) : 0
      return {
        ok: true,
        value: { name, kind: k, text: text(a.text, 200), color: c, near: parseRef(a.near) }
      }
    }
    case 'flowchart': {
      const steps = Array.isArray(a.steps)
        ? a.steps.flatMap((x) => (typeof x === 'string' && x.trim() ? [x.slice(0, 120)] : []))
        : []
      if (steps.length < 2 || steps.length > FLOW_MAX)
        return bad(`steps must be 2 to ${FLOW_MAX} short texts`)
      return {
        ok: true,
        value: {
          name,
          steps,
          direction: a.direction === 'right' ? 'right' : 'down',
          near: parseRef(a.near)
        }
      }
    }
    case 'style': {
      const r = refs(a.ids)
      if (!r || r.length === 0) return bad(idsErr)
      return {
        ok: true,
        value: {
          name,
          ids: r,
          ...(Number.isInteger(a.color) ? { color: a.color as number } : {}),
          ...(Number.isInteger(a.fill) ? { fill: a.fill as number } : {}),
          ...(typeof a.text === 'string' ? { text: a.text.slice(0, 200) } : {})
        }
      }
    }
    default:
      return bad(`there is no tool ${name}`)
  }
}

// ---- doing it ----

export interface ApplyResult {
  state: CanvasState
  /** Told to the model. */
  result: string
  /** One plain line for the person ("Moved 4 cards into Research"). */
  said: string
  /** Not done here: the renderer runs it (it needs clustering, or moves the view). */
  effect?:
    | { kind: 'tidy'; all: boolean }
    | { kind: 'arrange'; by: 'topic' | 'site' }
    | { kind: 'focus' | 'select'; ids: Ref[] }
  /** Wait for the person's Confirm before applying `state`. */
  confirm?: { text: string }
}

const done = (state: CanvasState, said: string, result = said): ApplyResult => ({
  state,
  said,
  result
})
const fail = (s: CanvasState, msg: string): ApplyResult => ({
  state: s,
  said: '',
  result: `Error: ${msg}`
})

const cardIds = (r: Ref[]): number[] => r.flatMap((x) => (x.kind === 'card' ? [x.id] : []))
const endOf = (r: Ref): End =>
  r.kind === 'card'
    ? { kind: 'card', id: r.id }
    : r.kind === 'note'
      ? { kind: 'note', id: r.id }
      : r.kind === 'frame'
        ? { kind: 'frame', id: r.id }
        : { kind: 'mark', id: r.id }
const has = (s: CanvasState, r: Ref): boolean =>
  r.kind === 'card'
    ? s.cards.some((c) => c.id === r.id)
    : r.kind === 'frame'
      ? s.frames.some((f) => f.id === r.id)
      : r.kind === 'note'
        ? s.notes.some((n) => n.id === r.id)
        : marksOf(s).some((m) => m.id === r.id)
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`
/** A card added "near" a section goes into it (filling a preset's sections). */
const intoFrame = (s: CanvasState, card: number, near: Ref | null): CanvasState =>
  near?.kind === 'frame' && s.frames.some((f) => f.id === near.id)
    ? moveToFrame(s, card, near.id)
    : s

/** The place a new object goes: beside the one it is near, else the middle of what is on show. */
function nearPoint(
  s: CanvasState,
  near: Ref | null,
  view: { x: number; y: number }
): { x: number; y: number } {
  if (near?.kind === 'card') {
    const c = s.cards.find((x) => x.id === near.id)
    if (c) return { x: c.x + 260, y: c.y }
  }
  if (near?.kind === 'note') {
    const n = s.notes.find((x) => x.id === near.id)
    if (n) return { x: n.x + n.w + 24, y: n.y }
  }
  if (near?.kind === 'frame') {
    const f = s.frames.find((x) => x.id === near.id)
    if (f) return { x: f.x + f.w + 40, y: f.y }
  }
  return view
}

/**
 * Run a checked call on the board. Everything it changes comes back as one new state, so the caller can keep the old
 * one as a single undo step. `view` is where new things go when nothing is named.
 */
export function applyBoardTool(
  s: CanvasState,
  call: BoardCall,
  tabs: readonly BoardTab[],
  view: { x: number; y: number }
): ApplyResult {
  switch (call.name) {
    case 'get_board':
      return done(s, '', boardSummary(s, tabs))
    case 'tidy_up':
      return {
        state: s,
        said: 'Tidied the board',
        result: 'Tidying the board by topic.',
        effect: { kind: 'tidy', all: call.scope === 'all' }
      }
    case 'arrange':
      if (call.by === 'topic' || call.by === 'site')
        return {
          state: s,
          said: `Arranged by ${call.by}`,
          result: `Arranging by ${call.by}.`,
          effect: { kind: 'arrange', by: call.by }
        }
      return arrangeGroups(s, call.by === 'kind' ? kindGroups(s, tabs) : call.groups)
    case 'create_frame': {
      const g = groupInto(s, call.frameName, cardIds(call.ids))
      return g
        ? done(g.state, `Put ${plural(cardIds(call.ids).length, 'card')} into ${call.frameName}`)
        : fail(s, 'none of those cards are on the board')
    }
    case 'rename_frame': {
      const n = renameFrame(s, call.frame, call.frameName)
      return n === s
        ? fail(s, 'there is no such frame')
        : done(n, `Renamed a frame to ${call.frameName}`)
    }
    case 'move_cards': {
      let n = s
      let moved = 0
      for (const id of cardIds(call.ids)) {
        const m = moveToFrame(n, id, call.frame)
        if (m !== n) moved++
        n = m
      }
      return moved
        ? done(n, `Moved ${plural(moved, 'card')}`)
        : fail(s, 'nothing could be moved there')
    }
    case 'stack': {
      const n = call.open ? expandFrame(s, call.frame) : collapseFrame(s, call.frame)
      return n === s
        ? fail(s, 'that frame cannot be folded or opened')
        : done(n, call.open ? 'Opened a pile' : 'Folded a frame into a pile')
    }
    case 'delete_items': {
      const gone = call.ids.filter((r) => has(s, r))
      if (gone.length === 0) return fail(s, 'none of those are on the board')
      let n = s
      let tabsKept = 0
      for (const r of gone) {
        if (r.kind === 'card' && !isVirtual(r.id)) tabsKept++
        else if (r.kind === 'card') n = removeVirtual(n, [r.id])
        else if (r.kind === 'frame') n = deleteFrame(n, r.id)
        else if (r.kind === 'note') n = deleteNote(n, r.id)
        else n = deleteMarks(n, [r.id])
      }
      const said = `Removed ${plural(gone.length - tabsKept, 'item')} from the board`
      return {
        state: n,
        said,
        result: tabsKept
          ? `${said}. ${plural(tabsKept, 'card')} of open tabs stay: close those tabs themselves if asked.`
          : said,
        confirm: { text: `Remove ${plural(gone.length - tabsKept, 'item')} from the board?` }
      }
    }
    case 'add_note': {
      const at = nearPoint(s, call.near, view)
      const made = addLoose(
        s,
        {
          kind: 'answer',
          url: '',
          title: '',
          site: '',
          text: call.text,
          source: 'answer',
          placement: 'note'
        },
        { point: at }
      )
      return done(intoFrame(made.state, made.id, call.near), 'Added a note')
    }
    case 'add_card': {
      const item: CanvasItem = {
        ...itemFor(call.url, '', { source: 'web' }),
        placement: 'document'
      }
      const near = call.near?.kind === 'card' ? [call.near.id] : []
      const made = addLoose(s, item, { cards: near, point: nearPoint(s, call.near, view) })
      return done(intoFrame(made.state, made.id, call.near), 'Added a page to the board')
    }
    case 'connect': {
      if (!has(s, call.from) || !has(s, call.to)) return fail(s, 'one of those is not on the board')
      const made = addConnector(s, endOf(call.from), endOf(call.to))
      if (!made) return fail(s, 'those cannot be connected')
      return done(
        call.label ? patchConnector(made.state, made.id, { label: call.label }) : made.state,
        'Drew an arrow'
      )
    }
    case 'set_kind': {
      const it = s.items[String(call.card)]
      if (!it)
        return fail(
          s,
          'only cards the assistant or a search added can change kind; tab cards stay tabs'
        )
      return done(
        setItem(s, call.card, placeItem(it, call.kind)),
        `Showed a card as a ${call.kind === 'live' ? 'live page' : call.kind}`
      )
    }
    case 'focus':
    case 'select':
      return {
        state: s,
        said: '',
        result: call.name === 'focus' ? 'Moved the view.' : 'Selected.',
        effect: { kind: call.name, ids: call.ids }
      }
    case 'add_shape': {
      // beside what it is near, in free space: shapes added one after another do not pile up
      const at = freeSpot({ w: 180, h: 100 }, contentBoxes(s), nearPoint(s, call.near, view), 24)
      const made = addShape(
        s,
        call.kind,
        at,
        { x: at.x + 180, y: at.y + 100 },
        { color: call.color, text: call.text }
      )
      return made ? done(made.state, 'Drew a shape') : fail(s, 'the board is full of marks')
    }
    case 'flowchart': {
      const flow = layFlow(s, call.steps, nearPoint(s, call.near, view), call.direction)
      if (!flow) return fail(s, 'the board is full of marks')
      let n = flow.state
      for (let i = 1; i < flow.ids.length; i++) {
        const k = addConnector(
          n,
          { kind: 'mark', id: flow.ids[i - 1] },
          { kind: 'mark', id: flow.ids[i] },
          { shape: 'elbow', heads: 'end' }
        )
        if (k) n = k.state
      }
      return done(
        n,
        `Drew a flowchart of ${plural(flow.ids.length, 'step')}`,
        `Drew a flowchart of ${plural(flow.ids.length, 'step')}: ${flow.ids.map((id, i) => `${id} "${call.steps[i]}"`).join(', ')}.`
      )
    }
    case 'style': {
      let n = s
      let changed = 0
      for (const r of call.ids) {
        if (r.kind !== 'mark') continue
        const p = patchMark(n, r.id, {
          ...(call.color !== undefined ? { color: call.color } : {}),
          ...(call.fill !== undefined ? { fill: call.fill } : {}),
          ...(call.text !== undefined ? { text: call.text } : {})
        })
        if (p !== n) changed++
        n = p
      }
      return changed
        ? done(n, `Restyled ${plural(changed, 'shape')}`)
        : fail(s, 'ids must be shapes from get_board')
    }
  }
}

function kindGroups(
  s: CanvasState,
  tabs: readonly BoardTab[]
): Array<{ name: string; ids: Ref[] }> {
  const tab = new Map(tabs.map((t) => [t.id, t]))
  const label: Record<string, string> = {
    pdf: 'PDFs',
    image: 'Pictures',
    video: 'Videos',
    page: 'Pages',
    answer: 'Notes'
  }
  const by = new Map<string, Ref[]>()
  for (const c of s.cards) {
    if (c.private || tab.get(c.id)?.private) continue
    const it = s.items[String(c.id)]
    const k = it
      ? it.placement === 'note'
        ? 'answer'
        : it.kind
      : kindOf(tab.get(c.id)?.url ?? c.url)
    by.set(k, [...(by.get(k) ?? []), { kind: 'card', id: c.id }])
  }
  return [...by].map(([k, ids]) => ({ name: label[k] ?? k, ids }))
}

function arrangeGroups(s: CanvasState, groups: Array<{ name: string; ids: Ref[] }>): ApplyResult {
  let n = s
  let cards = 0
  let made = 0
  for (const g of groups) {
    const ids = cardIds(g.ids)
    const r = groupInto(n, g.name, ids)
    if (!r) continue
    n = r.state
    cards += ids.length
    made++
  }
  return made
    ? done(n, `Rearranged ${plural(cards, 'card')} into ${plural(made, 'frame')}`)
    : fail(s, 'no cards to arrange')
}

/** What the assistant is doing, as one quiet line, for a board tool that is running. */
export function boardStatus(name: string): string | null {
  switch (name as BoardToolName) {
    case 'get_board':
      return 'Looking at the board'
    case 'tidy_up':
    case 'arrange':
      return 'Arranging the board'
    case 'create_frame':
    case 'move_cards':
    case 'rename_frame':
    case 'stack':
      return 'Organising cards'
    case 'delete_items':
      return 'Waiting for your answer'
    case 'add_note':
    case 'add_card':
    case 'add_shape':
    case 'flowchart':
      return 'Adding to the board'
    case 'connect':
      return 'Drawing an arrow'
    case 'set_kind':
    case 'style':
      return 'Changing how it looks'
    case 'focus':
    case 'select':
      return 'Finding it on the board'
    default:
      return null
  }
}
