/**
 * A shared space's board as a Yjs document (see tasks/shared-spaces.md). The board itself stays one immutable
 * CanvasState changed through edit(); this sits at that seam. After a local change `writeDiff` puts what changed into
 * the document; when the document changes from elsewhere `readInto` makes the board from it plus what is only this
 * person's (their tabs' cards, where they are looking, what they have open).
 *
 * What is shared: sections, notes, arrows, drawings, and the cards that are content (pictures, PDFs, links, answers:
 * negative ids, each with its item). A tab stays on its owner's machine; its card goes to the others as a mirror (its
 * place, address and title, in the `tabs` map, keyed by owner): the others see the page there and open it themselves.
 *
 * Each entity is one value in a Y.Map by its id, the last write winning per entity, with its place in the board's
 * order beside it (`o`) so what is on top stays on top.
 */
import * as Y from 'yjs'
import {
  cardBox,
  freeSpot,
  intersects,
  type Box,
  type CanvasCard,
  type CanvasFrame,
  type CanvasNote,
  type CanvasState
} from '../ai/canvas'
import { itemFor, type CanvasItem } from '../ai/canvasItems'
import type { CanvasMark } from '../ai/canvasMarks'
import type { CanvasConnector, End } from '../ai/connectors'

/** A content card and what it holds, shared together. */
export interface SharedCard {
  card: CanvasCard
  item: CanvasItem
}

interface Kinds {
  frames: CanvasFrame
  notes: CanvasNote
  marks: CanvasMark
  connectors: CanvasConnector
  cards: SharedCard
}
type Kind = keyof Kinds
const KINDS: readonly Kind[] = ['frames', 'notes', 'marks', 'connectors', 'cards']

/** One entity in the document: the value and its place in the board's order. */
interface Slot<T> {
  v: T
  o: number
}

/**
 * Where this person's new ids start. Every id on the board comes from the board's counter (`seq`: f12, n13, k14,
 * -15...); in a shared space each person counts in a block of their own, so two people adding at once never make
 * the same id. 2^20 blocks of 2^24 ids each, well inside a double's exact integers.
 */
export function idBlock(clientID: number): number {
  return (clientID % 2 ** 20) * 2 ** 24
}

/** This person's counter for a shared board: their block, or past it if they have used some of it already. */
export function sharedSeq(local: number, clientID: number): number {
  const base = idBlock(clientID)
  return local >= base && local < base + 2 ** 24 ? local : base
}

/**
 * Someone else's tab, as it shows on this board: an id far below any content card's (those count down from a person's
 * id block, under 2^45), made from the owner and their tab, so it stays the same from one change to the next.
 */
const MIRROR_BASE = 2 ** 52
export const isMirror = (id: number): boolean => id <= -MIRROR_BASE
export function mirrorId(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0
  let g = 7
  for (let i = key.length - 1; i >= 0; i--) g = (Math.imul(g, 37) + key.charCodeAt(i)) >>> 0
  return -(MIRROR_BASE + (h * 2 ** 8 + (g & 0xff)))
}

/** A tab's card as the others get it. `by` is its owner (a person's lasting id, not the document's session id). */
export interface TabMirror {
  card: CanvasCard
  title: string
  by: string
  /** Its picture in the room's store (sealed), when the owner has sent one. */
  pic?: string
}

const isShared = (c: CanvasCard): boolean => c.id < 0 && !isMirror(c.id)

/** Whether an arrow's end is on something shared (or a point): an arrow to a tab's card stays its owner's. */
function sharedEnd(e: End, cards: ReadonlySet<number>): boolean {
  return e.kind !== 'card' || cards.has(e.id)
}

/** The shared parts of a board, each by id, in the board's order. */
export function sharedOf(s: CanvasState): { [K in Kind]: Map<string, Kinds[K]> } {
  const cards = new Map<string, SharedCard>()
  for (const c of s.cards) {
    const item = s.items[String(c.id)]
    if (isShared(c) && item) cards.set(String(c.id), { card: c, item })
  }
  const ids = new Set([...cards.values()].map((x) => x.card.id))
  return {
    frames: new Map(s.frames.map((f) => [f.id, f])),
    notes: new Map(s.notes.map((n) => [n.id, n])),
    marks: new Map((s.marks ?? []).map((m) => [m.id, m])),
    connectors: new Map(
      (s.connectors ?? [])
        .filter((k) => sharedEnd(k.from, ids) && sharedEnd(k.to, ids))
        .map((k) => [k.id, k])
    ),
    cards
  }
}

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)

/**
 * Put what changed between two boards into the document, in one transaction (one update to send). Entities are
 * compared by reference first (the board is immutable: an untouched one is the same object), then by value, so
 * nothing unchanged is written. `prev` null: everything (the first share).
 */
export function writeDiff(
  doc: Y.Doc,
  prev: CanvasState | null,
  next: CanvasState,
  origin?: unknown,
  /** This person's tabs go to the others too (see TabMirror): who they are, each tab's title and picture. */
  tabs?: { by: string; title: (id: number) => string; pic?: (id: number) => string | undefined }
): void {
  const was = prev ? sharedOf(prev) : null
  const now = sharedOf(next)
  doc.transact(() => {
    for (const kind of KINDS) {
      const map = doc.getMap<Slot<unknown>>(kind)
      const before = was?.[kind] as Map<string, unknown> | undefined
      const after = now[kind] as Map<string, unknown>
      let o = 0
      for (const [id, v] of after) {
        const old = before?.get(id)
        const slot = map.get(id)
        // written when it changed here, or its place in the order did, or the document lacks it
        if (!slot || old === undefined || !same(old, v) || slot.o !== o) map.set(id, { v, o })
        o++
      }
      if (before) for (const id of before.keys()) if (!after.has(id)) map.delete(id)
    }
    if (tabs) writeTabs(doc, next, tabs.by, tabs.title, tabs.pic)
  }, origin)
}

/**
 * This person's tabs into the document, as they are now: each one's card (private and Tor tabs never), and none of
 * theirs that is gone. Reconciled whole each time, not diffed: tab ids start again when Panes does, and the last
 * run's would otherwise stay on everyone's board.
 */
function writeTabs(
  doc: Y.Doc,
  s: CanvasState,
  by: string,
  title: (id: number) => string,
  pic?: (id: number) => string | undefined
): void {
  const map = doc.getMap<TabMirror>('tabs')
  const mine = new Set<string>()
  for (const c of s.cards) {
    if (c.id <= 0 || c.private || !/^https?:/i.test(c.url)) continue
    const key = `${by}:${c.id}`
    mine.add(key)
    const p = pic?.(c.id)
    const v: TabMirror = p
      ? { card: c, title: title(c.id), by, pic: p }
      : { card: c, title: title(c.id), by }
    if (!same(map.get(key), v)) map.set(key, v)
  }
  for (const [key, v] of map) if (v.by === by && !mine.has(key)) map.delete(key)
}

/** A kind's entities from the document, in order (ties, from two people at once, by id). */
function listOf<K extends Kind>(doc: Y.Doc, kind: K): Kinds[K][] {
  const out: Array<{ id: string; s: Slot<Kinds[K]> }> = []
  doc.getMap<Slot<Kinds[K]>>(kind).forEach((s, id) => out.push({ id, s }))
  out.sort((a, b) => a.s.o - b.s.o || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return out.map((x) => x.s.v)
}

/**
 * The board from the document, with this person's own parts of `local` kept: their tabs' cards (and arrows to
 * them), their view, what they have open, how pages show for them.
 */
export function readInto(
  doc: Y.Doc,
  local: CanvasState,
  me?: string,
  /** A picture from the room's store, as an image address, once it is here (undefined until then). */
  picOf?: (id: string) => string | undefined
): CanvasState {
  const shared = listOf(doc, 'cards')
  const own = local.cards.filter((c) => !isShared(c) && !isMirror(c.id))
  const ownIds = new Set(own.map((c) => c.id))
  const items: Record<string, CanvasItem> = {}
  for (const [id, item] of Object.entries(local.items))
    if (!isShared({ id: Number(id) } as CanvasCard) && !isMirror(Number(id))) items[id] = item
  for (const x of shared) items[String(x.card.id)] = x.item
  // the others' tabs: where their owner has them, as the page they are (opened here, it is a page of one's own)
  const mirrors: CanvasCard[] = []
  doc.getMap<TabMirror>('tabs').forEach((v, key) => {
    if (v.by === me) return
    const id = mirrorId(key)
    mirrors.push({ ...v.card, id, private: false })
    const image = v.pic ? picOf?.(v.pic) : undefined
    items[String(id)] = itemFor(
      v.card.url,
      v.title,
      image ? { source: 'tab', image } : { source: 'tab' }
    )
  })
  // Someone else's tab laid out from the same spot as one of this person's (both boards place a section's cards in
  // the same slots) moves to the nearest free place here, so the two never sit on top of each other.
  const taken: Box[] = [...own, ...shared.map((x) => x.card)].map(cardBox)
  for (const m of mirrors) {
    const b = cardBox(m)
    if (taken.some((o) => intersects(b, o))) {
      const spot = freeSpot({ w: b.w, h: b.h }, taken, { x: m.x, y: m.y }, 16)
      m.x = spot.x
      m.y = spot.y
    }
    taken.push(cardBox(m))
  }
  const sharedIds = new Set(shared.map((x) => x.card.id))
  // an own arrow is one that touches one of this person's tab cards
  const ownArrows = (local.connectors ?? []).filter(
    (k) =>
      !(sharedEnd(k.from, sharedIds) && sharedEnd(k.to, sharedIds)) &&
      [k.from, k.to].some((e) => e.kind === 'card' && ownIds.has(e.id))
  )
  return {
    ...local,
    frames: listOf(doc, 'frames'),
    notes: listOf(doc, 'notes'),
    marks: listOf(doc, 'marks'),
    connectors: [...listOf(doc, 'connectors'), ...ownArrows],
    cards: [...own, ...shared.map((x) => x.card), ...mirrors],
    items
  }
}

/** Whether the document holds anything yet (a room just made, or one being joined, before its history came). */
export const isEmptyDoc = (doc: Y.Doc): boolean =>
  KINDS.every((k) => doc.getMap(k).size === 0) && doc.getMap('tabs').size === 0
