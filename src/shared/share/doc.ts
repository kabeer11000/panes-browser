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
  boundsOf,
  CARD_H,
  CARD_W,
  cardBox,
  freeSpot,
  intersects,
  type Box,
  type CanvasCard,
  type CanvasFrame,
  type CanvasNote,
  type CanvasState
} from '../ai/canvas'
import { fileUrl, itemFor, sharingPaused, type CanvasItem } from '../ai/canvasItems'
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
  /** A tab on a file of its owner's computer, shared: the file, sealed into the room's store (see sealedFor). */
  sealed?: string
}

const isShared = (c: CanvasCard): boolean => c.id < 0 && !isMirror(c.id)

/**
 * A card holding a file of this person's own computer (a picture or PDF dropped on the board, a download): it stays
 * here until they share it, and then goes as its file sealed into the room's store (`sealed`), never as a path. One
 * that came from the room (`sealed` set) is a shared card like any other.
 */
export function ownFile(item: CanvasItem | undefined): string | null {
  if (!item || item.sealed) return null
  return item.file ?? pathOfFileUrl(item.url)
}
export const isOwnFile = (item: CanvasItem | undefined): boolean => ownFile(item) !== null
/** An own file that can be shared (any kind with an extension; the size is checked as it goes). */
export const canShareFile = (item: CanvasItem | undefined): boolean =>
  SHAREABLE_FILE.test(extOf(ownFile(item) ?? ''))
/** A path's extension with its dot, lower case ('' when none). */
const extOf = (path: string): string => {
  const name = nameOf(path)
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i).toLowerCase() : ''
}
const nameOf = (path: string): string => path.split(/[\\/]/).pop() ?? ''

/** The path a file: address names (null for any other address). */
export function pathOfFileUrl(url: string | undefined): string | null {
  if (!url || !/^file:\/\//i.test(url)) return null
  try {
    const p = decodeURIComponent(new URL(url).pathname)
    return /^\/[A-Za-z]:/.test(p) ? p.slice(1) : p
  } catch {
    return null
  }
}

/**
 * A local file's address as the others are told it (a tab on a file of this computer, shown live or shared): neither
 * its folders (a Windows path holds the person's name) nor its name, only its kind, under `key` (owner and tab, so two
 * such tabs stay two). Any other address is returned as it is.
 */
export function maskFileUrl(url: string, key: string): string {
  const path = pathOfFileUrl(url)
  return path === null
    ? url
    : `file:///${encodeURIComponent(key)}${SHAREABLE_FILE.test(extOf(path)) ? extOf(path) : ''}`
}
/** What a file of this computer is called to the others, whatever its own name or title. */
export const SHARED_FILE_TITLE = 'Shared file'

/** Kinds of file that go to the others: any with a short extension (the extensions they may come back with). */
export const SHAREABLE_FILE = /^\.[a-z0-9]{1,8}$/
/** Copies from the room that open as files (the browser's own picture and PDF viewers); any other kind is sandboxed. */
export const INERT_FILE = /^\.(png|jpe?g|gif|webp|avif|bmp|pdf)$/
/**
 * The address a file that came from the room opens at here: a picture or PDF as the file, anything else (a web page,
 * an SVG, text) at panes-shared://f/, served sandboxed (main/ai/canvasContent.ts serveShared): no cookies or storage of
 * any site, and no reading of this computer's files, whatever its scripts do.
 */
export function sharedOpenUrl(file: string): string {
  return INERT_FILE.test(extOf(file))
    ? fileUrl(file)
    : `panes-shared://f/${encodeURIComponent(nameOf(file))}`
}
/** A sealed file as written: its parts' store ids (dot-separated) and its extension. Null when not well-formed. */
export function parseSealed(sealed: string): { ids: string[]; ext: string } | null {
  const m = /^((?:[A-Za-z0-9_-]{8,64}\.){0,7}[A-Za-z0-9_-]{8,64})\/(\.[a-z0-9]{1,8})$/.exec(sealed)
  return m && SHAREABLE_FILE.test(m[2]) ? { ids: m[1].split('.'), ext: m[2] } : null
}
/**
 * A card's item as it came from the room, made safe: a path on this computer is never taken from someone else (a
 * file: address, or `file`), only a copy of a sealed file this computer fetched itself.
 */
function fromRoom(item: CanvasItem): CanvasItem {
  if (item.file === undefined && !/^file:/i.test(item.url ?? '')) return item
  const out: CanvasItem = { ...item, url: /^file:/i.test(item.url ?? '') ? '' : item.url }
  delete out.file
  return out
}
/** A card's item as it goes to the room once its file is sealed: no path and no address of this computer. */
const sealedItem = (item: CanvasItem, sealed: string): CanvasItem => {
  const out: CanvasItem = {
    ...item,
    url: `panes-file:${sealed}`,
    title: SHARED_FILE_TITLE,
    site: SHARED_FILE_TITLE,
    sealed
  }
  delete out.file
  delete out.image
  return out
}

/** Whether an arrow's end is on something shared (or a point): an arrow to a tab's card stays its owner's. */
function sharedEnd(e: End, cards: ReadonlySet<number>): boolean {
  return e.kind !== 'card' || cards.has(e.id)
}

/**
 * The shared parts of a board, each by id, in the board's order. `files`: a file of this computer's sealed id once
 * it has gone to the room (null until then); its card goes only when it was shared and its file is there.
 */
export function sharedOf(
  s: CanvasState,
  files?: (file: string) => string | null
): { [K in Kind]: Map<string, Kinds[K]> } {
  const cards = new Map<string, SharedCard>()
  for (const c of s.cards) {
    const item = s.items[String(c.id)]
    if (!isShared(c) || !item) continue
    const sealed = item.sealed ?? (isOwnFile(item) && c.shared ? files?.(ownFile(item)!) : null)
    if (sealed) {
      const out = sealedItem(item, sealed)
      cards.set(String(c.id), { card: { ...c, url: out.url }, item: out })
    } else if (!isOwnFile(item)) cards.set(String(c.id), { card: c, item })
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
  tabs?: {
    by: string
    title: (id: number) => string
    pic?: (id: number) => string | undefined
    /** Each tab's address now, null once closed (the board's card may be older than the tab). */
    url?: (id: number) => string | null
    /** Tabs to send that have no card yet (the one shown live, opened away from the board: see withTabs). */
    all?: () => Array<{ id: number; url: string }>
    /** The tab shown live: it goes to the others whether or not its card was shared. */
    live?: number
    /** Files of this computer shared on the board: each one's sealed id once it is in the room (see sharedOf). */
    files?: (file: string) => string | null
  }
): void {
  const was = prev ? sharedOf(prev, tabs?.files) : null
  const now = sharedOf(next, tabs?.files)
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
    if (tabs)
      writeTabs(
        doc,
        tabs.all ? withTabs(next, tabs.all()) : next,
        tabs.by,
        tabs.title,
        tabs.pic,
        tabs.url,
        tabs.live,
        tabs.files
      )
  }, origin)
}

/**
 * This person's shared tabs into the document, as they are now: each card they shared, and the one shown live (private
 * and Tor tabs never), and none of theirs that is gone or no longer shared. Tabs are private until shared: the others
 * never see a tab of someone's they were not given. Reconciled whole each time, not diffed: tab ids start again when Panes does, and the last
 * run's would otherwise stay on everyone's board.
 */
function writeTabs(
  doc: Y.Doc,
  s: CanvasState,
  by: string,
  title: (id: number) => string,
  pic?: (id: number) => string | undefined,
  urlOf?: (id: number) => string | null,
  live?: number,
  files?: (file: string) => string | null
): void {
  const map = doc.getMap<TabMirror>('tabs')
  const mine = new Set<string>()
  for (const board of s.cards) {
    if (!board.shared && board.id !== live) continue
    const url = urlOf ? urlOf(board.id) : board.url
    if (url === null) continue // closed: it goes from the others' boards below
    if (board.id !== live && sharingPaused(board, url)) {
      mine.add(`${by}:${board.id}`) // on another site: the others keep the last page of it, nothing new goes
      continue
    }
    if (board.id <= 0 || board.private) continue
    const key = `${by}:${board.id}`
    // a tab on a file of this computer: its name only, and, shared, its file (once in the room) for the others to open
    const path = pathOfFileUrl(url)
    let sealed: string | null = null
    if (path !== null) {
      sealed = board.shared ? (files?.(path) ?? null) : null
      if (!sealed && board.id !== live) continue // its file is on its way: it goes once it is there
    } else if (!/^https?:/i.test(url)) continue
    const out = path !== null ? maskFileUrl(url, key) : url
    const c = out === board.url ? board : { ...board, url: out }
    mine.add(key)
    const p = pic?.(c.id)
    const v: TabMirror = { card: c, title: path !== null ? SHARED_FILE_TITLE : title(c.id), by }
    if (p) v.pic = p
    if (sealed) v.sealed = sealed
    if (!same(map.get(key), v)) map.set(key, v)
  }
  for (const [key, v] of map) if (v.by === by && !mine.has(key)) map.delete(key)
}

/**
 * The board with a loose card for each of this person's tabs in the space that has none yet: a card is only made when
 * the board itself is open (see syncTabs), so a tab opened in the tab view would reach the others only once its owner
 * opened their board. Placed after what is on the board, in free space, in tab order. Only for what goes to the
 * room: the owner's own board lays the tab out its way when it next opens (the mirror follows it then).
 */
export function withTabs(s: CanvasState, tabs: Array<{ id: number; url: string }>): CanvasState {
  const have = new Set(s.cards.map((c) => c.id))
  const fresh = tabs.filter((t) => t.id > 0 && !have.has(t.id) && /^(https?|file):/i.test(t.url))
  if (!fresh.length) return s
  const taken: Box[] = [...s.cards.map(cardBox), ...s.frames, ...s.notes]
  const b = boundsOf(taken)
  let near = b ? { x: b.x + b.w + 48, y: b.y } : { x: 0, y: 0 }
  const cards = [...s.cards]
  for (const t of fresh) {
    const at = freeSpot({ w: CARD_W, h: CARD_H }, taken, near, 16)
    const card: CanvasCard = {
      id: t.id,
      url: t.url,
      ...at,
      frame: null,
      manual: false,
      private: false
    }
    cards.push(card)
    taken.push(cardBox(card))
    near = { x: at.x + CARD_W + 16, y: at.y }
  }
  return { ...s, cards }
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
  picOf?: (id: string) => string | undefined,
  /** A shared file's copy on this computer (a path), once it is here (undefined until then). */
  fileOf?: (sealed: string) => string | undefined
): CanvasState {
  const shared = listOf(doc, 'cards')
  const inRoom = new Set(shared.map((x) => x.card.id))
  // this person's own files stay as they are here (path and all): private ones, and shared ones not in the room yet
  const own = local.cards.filter(
    (c) =>
      !isMirror(c.id) &&
      (!isShared(c) || (isOwnFile(local.items[String(c.id)]) && !inRoom.has(c.id)))
  )
  const ownIds = new Set(own.map((c) => c.id))
  const localUrl = new Map(local.cards.map((c) => [c.id, c.url]))
  const items: Record<string, CanvasItem> = {}
  for (const [id, item] of Object.entries(local.items))
    if (
      ownIds.has(Number(id)) ||
      (!isShared({ id: Number(id) } as CanvasCard) && !isMirror(Number(id)))
    )
      items[id] = item
  for (const x of shared) {
    const id = String(x.card.id)
    const mine = local.items[id]
    if (isOwnFile(mine))
      items[id] = mine // the sharer's own: their file, not the room's copy
    else if (x.item.sealed) {
      const file = fileOf?.(x.item.sealed)
      items[id] = file ? { ...fromRoom(x.item), file, url: sharedOpenUrl(file) } : fromRoom(x.item)
    } else items[id] = fromRoom(x.item)
  }
  // the others' tabs: where their owner has them, as the page they are (opened here, it is a page of one's own).
  // A page already on this board (this person's own tab, or someone else's first) shows once: opening someone's tab
  // here makes a tab of one's own, which goes back to them too, and both boards showed the page twice.
  const mirrors: CanvasCard[] = []
  const pages = new Set(own.map((c) => samePage(c.url)))
  const entries: Array<[string, TabMirror]> = []
  doc.getMap<TabMirror>('tabs').forEach((v, key) => entries.push([key, v]))
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) // the same one wins on every board
  for (const [key, v] of entries) {
    if (v.by === me) continue
    const page = samePage(v.card.url)
    if (pages.has(page)) continue
    pages.add(page)
    const id = mirrorId(key)
    mirrors.push({ ...v.card, id, private: false })
    const image = v.pic ? picOf?.(v.pic) : undefined
    // a tab on a file of its owner's: it opens here as this computer's copy of the file, once that is here
    const copy = v.sealed ? fileOf?.(v.sealed) : undefined
    const item = itemFor(copy ? sharedOpenUrl(copy) : v.card.url, v.title, {
      source: 'tab',
      ...(image ? { image } : {})
    })
    items[String(id)] = copy ? { ...item, file: copy, sealed: v.sealed } : fromRoom(item)
  }
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
    cards: [
      ...own,
      // the sharer's own file: where the room has it, as their own card (its address on this computer)
      ...shared.map((x) => {
        const url = isOwnFile(local.items[String(x.card.id)]) ? localUrl.get(x.card.id) : undefined
        return url !== undefined ? { ...x.card, url } : x.card
      }),
      ...mirrors
    ],
    items
  }
}

/** A page's address as far as "the same page" goes: no #part, no trailing slash, no "www.", any case of host. */
export function samePage(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    u.hostname = u.hostname.replace(/^www\./i, '')
    return u.toString().replace(/\/$/, '')
  } catch {
    return url
  }
}

/** Whether the document holds anything yet (a room just made, or one being joined, before its history came). */
export const isEmptyDoc = (doc: Y.Doc): boolean =>
  KINDS.every((k) => doc.getMap(k).size === 0) && doc.getMap('tabs').size === 0
