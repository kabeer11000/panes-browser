/**
 * A shared space's board as a Yjs document (see tasks/shared-spaces.md). The board itself stays one immutable
 * CanvasState changed through edit(); this sits at that seam. After a local change `writeDiff` puts what changed into
 * the document; when the document changes from elsewhere `readInto` makes the board from it plus what is only this
 * person's (their tabs' cards, where they are looking, what they have open).
 *
 * What is shared: sections, notes, arrows, drawings, and the cards that are content (pictures, PDFs, links, answers:
 * negative ids, each with its item). A tab's card is not: the tab is on its owner's machine only.
 *
 * Each entity is one value in a Y.Map by its id, the last write winning per entity, with its place in the board's
 * order beside it (`o`) so what is on top stays on top.
 */
import * as Y from 'yjs'
import type { CanvasCard, CanvasFrame, CanvasNote, CanvasState } from '../ai/canvas'
import type { CanvasItem } from '../ai/canvasItems'
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

const isShared = (c: CanvasCard): boolean => c.id < 0

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
  origin?: unknown
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
  }, origin)
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
export function readInto(doc: Y.Doc, local: CanvasState): CanvasState {
  const shared = listOf(doc, 'cards')
  const own = local.cards.filter((c) => !isShared(c))
  const ownIds = new Set(own.map((c) => c.id))
  const items: Record<string, CanvasItem> = {}
  for (const [id, item] of Object.entries(local.items))
    if (!isShared({ id: Number(id) } as CanvasCard)) items[id] = item
  for (const x of shared) items[String(x.card.id)] = x.item
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
    cards: [...own, ...shared.map((x) => x.card)],
    items
  }
}

/** Whether the document holds anything yet (a room just made, or one being joined, before its history came). */
export const isEmptyDoc = (doc: Y.Doc): boolean => KINDS.every((k) => doc.getMap(k).size === 0)
