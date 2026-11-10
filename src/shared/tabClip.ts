import {
  boundsOf,
  CARD_H,
  CARD_W,
  deleteNote,
  dropCards,
  dropNote,
  GAP,
  removeVirtual,
  type Box,
  type CanvasCard,
  type CanvasNote,
  type CanvasState
} from './ai/canvas'
import { keepItem, type CanvasItem } from './ai/canvasItems'
import { classifyPaste } from './ai/canvasPaste'

/**
 * Cut, copy and paste of tabs (sidebar and board) and of the board's own cards and notes. Pure: the renderer keeps one
 * `Clip`, writes `clipText` to the system clipboard, and asks here what a paste means and where things land.
 */

export type TabEntry = { kind: 'tab'; id: number; url: string; title: string; box?: Box }
export type ClipEntry =
  | TabEntry
  /** A board card that is not a tab (negative id): a link, a document, an answer. */
  | { kind: 'item'; id: number; item: CanvasItem; box: Box }
  | { kind: 'note'; note: CanvasNote }

export interface Clip {
  mode: 'copy' | 'cut'
  /** The space it was taken in: its notes and items belong to that space's board, its tabs to that space. */
  space: number
  entries: ClipEntry[]
  /** The plain text that went to the system clipboard. Other text there now means something else was copied since. */
  text: string
}

export type ClipAction =
  | { type: 'copy' | 'cut'; space: number; entries: ClipEntry[] }
  | { type: 'pasted' }
  | { type: 'escape' }

/** Copy or cut replaces what was held; a paste uses up a cut (the things have moved) but a copy pastes again; Esc
 * forgets a cut only. Copying nothing keeps what was held. */
export function nextClip(clip: Clip | null, a: ClipAction): Clip | null {
  if (a.type === 'copy' || a.type === 'cut') {
    if (a.entries.length === 0) return clip
    return { mode: a.type, space: a.space, entries: a.entries, text: clipText(a.entries).text }
  }
  return clip?.mode === 'cut' ? null : clip
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** What other apps get: the addresses one per line (a note's text as it is), and the same as links for rich text. */
export function clipText(entries: ClipEntry[]): { text: string; html: string } {
  const text: string[] = []
  const html: string[] = []
  for (const e of entries) {
    if (e.kind === 'note') {
      if (!e.note.text.trim()) continue
      text.push(e.note.text)
      html.push(`<p>${esc(e.note.text).replace(/\n/g, '<br>')}</p>`)
      continue
    }
    const url = e.kind === 'tab' ? e.url : e.item.url
    if (!url) continue
    const title = (e.kind === 'tab' ? e.title : e.item.title) || url
    text.push(url)
    html.push(`<a href="${esc(url)}">${esc(title)}</a>`)
  }
  return { text: text.join('\n'), html: html.join('<br>') }
}

/** A list of addresses, one per line (as copied from another browser or a text file); null when any line is not one. */
export function parseUrls(text: string, max = 20): string[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0 || lines.length > max) return null
  const urls: string[] = []
  for (const l of lines) {
    const p = classifyPaste(l)
    if (p.kind !== 'link') return null
    urls.push(p.url)
  }
  return urls
}

const norm = (t: string): string => t.replace(/\r\n?/g, '\n').trim()

export type PasteWhat =
  | { kind: 'clip'; clip: Clip }
  | { kind: 'urls'; urls: string[] }
  | { kind: 'none' }

/**
 * What Ctrl+V means: the held tabs while the system clipboard still has what was put there for them (`system` null:
 * it could not be read, so the held ones), else addresses copied elsewhere, else nothing of ours.
 */
export function resolvePaste(clip: Clip | null, system: string | null): PasteWhat {
  if (clip && (system === null || norm(system) === norm(clip.text))) return { kind: 'clip', clip }
  const urls = system ? parseUrls(system) : null
  return urls ? { kind: 'urls', urls } : { kind: 'none' }
}

/** Boxes for everything pasted: what came without a place (tabs from the sidebar) goes in a row to the right. */
export function layoutBoxes(boxes: Array<Box | undefined>): Box[] {
  const known = boundsOf(boxes.filter((b): b is Box => !!b))
  let x = known ? known.x + known.w + GAP : 0
  const y = known ? known.y : 0
  return boxes.map((b) => {
    if (b) return b
    const r = { x, y, w: CARD_W, h: CARD_H }
    x += CARD_W + GAP
    return r
  })
}

/** How far to shift the boxes so they sit centred on the point, keeping their layout. */
export function pasteOffset(boxes: Box[], at: { x: number; y: number }): { dx: number; dy: number } {
  const b = boundsOf(boxes)
  if (!b) return { dx: 0, dy: 0 }
  return { dx: Math.round(at.x - (b.x + b.w / 2)), dy: Math.round(at.y - (b.y + b.h / 2)) }
}

const withPos = (s: CanvasState, id: number, x: number, y: number): CanvasState => ({
  ...s,
  cards: s.cards.map((c) => (c.id === id ? { ...c, x, y } : c))
})

/**
 * Cards already on the board put at these places, then dropped as a drag would: into the section under `at` (its free
 * slots), or loose and clear of what is there.
 */
export function placeCards(
  s: CanvasState,
  targets: Array<{ id: number; x: number; y: number }>,
  at: { x: number; y: number }
): CanvasState {
  const here = targets.filter((t) => s.cards.some((c) => c.id === t.id))
  if (here.length === 0) return s
  const moved = here.reduce((n, t) => withPos(n, t.id, t.x, t.y), s)
  return dropCards(
    moved,
    here.map((t) => t.id),
    0,
    0,
    at
  )
}

export interface BoardPaste {
  state: CanvasState
  /** Selection keys of what was pasted (`c:<id>`, `n:<id>`). */
  keys: string[]
  /** Tabs the board cannot paste by itself (a duplicate to open, a tab of another space to bring here), and where. */
  tabs: Array<{ entry: TabEntry; x: number; y: number }>
}

/**
 * Paste onto a board: each entry at its box shifted by `d`. `move` (a cut taken from this same board) moves what is
 * here; otherwise notes and items are copied in as new ones and tabs are handed back for the caller to open or move.
 */
export function pasteOnBoard(
  s: CanvasState,
  entries: ClipEntry[],
  boxes: Box[],
  d: { dx: number; dy: number },
  at: { x: number; y: number },
  move: boolean
): BoardPaste {
  let next = s
  const keys: string[] = []
  const tabs: BoardPaste['tabs'] = []
  const drop: Array<{ id: number; x: number; y: number }> = []
  entries.forEach((e, i) => {
    const x = boxes[i].x + d.dx
    const y = boxes[i].y + d.dy
    if (e.kind === 'note') {
      const have = move ? next.notes.find((n) => n.id === e.note.id) : undefined
      if (have) {
        next = dropNote(next, have.id, x - have.x, y - have.y)
        keys.push(`n:${have.id}`)
        return
      }
      const id = `n${next.seq + 1}`
      next = {
        ...next,
        seq: next.seq + 1,
        notes: [...next.notes, { ...e.note, id, x, y, frame: null }]
      }
      next = dropNote(next, id, 0, 0) // seats it in a section under it
      keys.push(`n:${id}`)
      return
    }
    const card = move ? next.cards.find((c) => c.id === e.id) : undefined
    if (card) {
      drop.push({ id: card.id, x, y })
      keys.push(`c:${card.id}`)
      return
    }
    if (e.kind === 'tab') {
      tabs.push({ entry: e, x, y })
      return
    }
    const id = -(next.seq + 2) // as addLoose numbers cards that are not tabs
    const item: CanvasItem = { ...e.item }
    delete item.tab // the copy is not shown by the original's tab
    const made: CanvasCard = { id, url: item.url, x, y, frame: null, manual: true, private: false }
    next = {
      ...next,
      seq: next.seq + 1,
      cards: [...next.cards, made],
      items: { ...next.items, [String(id)]: keepItem(item) }
    }
    drop.push({ id, x, y })
    keys.push(`c:${id}`)
  })
  return { state: placeCards(next, drop, at), keys, tabs }
}

/** The cut notes and items taken off the board they were cut from (when pasted on another space's board). */
export function removeFromBoard(s: CanvasState, entries: ClipEntry[]): CanvasState {
  let next = s
  for (const e of entries) if (e.kind === 'note') next = deleteNote(next, e.note.id)
  const items = entries.flatMap((e) => (e.kind === 'item' ? [e.id] : []))
  return removeVirtual(next, items)
}

/** Undo of `removeFromBoard`: what it took is put back from the board as it was (`before`), if it is not there. */
export function restoreOnBoard(
  cur: CanvasState,
  before: CanvasState,
  entries: ClipEntry[]
): CanvasState {
  const frames = new Set(cur.frames.map((f) => f.id))
  const noteIds = new Set(entries.flatMap((e) => (e.kind === 'note' ? [e.note.id] : [])))
  const cardIds = new Set(entries.flatMap((e) => (e.kind === 'item' ? [e.id] : [])))
  const notes = before.notes.filter(
    (n) => noteIds.has(n.id) && !cur.notes.some((x) => x.id === n.id)
  )
  const cards = before.cards.filter(
    (c) => cardIds.has(c.id) && !cur.cards.some((x) => x.id === c.id)
  )
  if (notes.length === 0 && cards.length === 0) return cur
  const items = { ...cur.items }
  for (const c of cards) if (before.items[String(c.id)]) items[String(c.id)] = before.items[String(c.id)]
  const home = <T extends { frame?: string | null }>(x: T): T =>
    x.frame && !frames.has(x.frame) ? { ...x, frame: null } : x
  return {
    ...cur,
    notes: [...cur.notes, ...notes.map(home)],
    cards: [...cur.cards, ...cards.map(home)],
    items
  }
}
