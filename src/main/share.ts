/**
 * Shared spaces in Panes (tasks/shared-spaces.md): each shared space's board kept in step with everyone in its room
 * through the relay, end to end encrypted. The board stays the board (CanvasService saves it as ever); this is the
 * seam: a local save writes what changed into the room's document, a change from elsewhere comes back as a board,
 * saved and handed to the board page.
 *
 * The room's secret never leaves this file: it is kept encrypted by the system (safeStorage) in its own store, never
 * on the space (spaces are sent to the window whole). The space only says that it is shared.
 */
import { app, clipboard, ipcMain, safeStorage, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { userInfo } from 'os'
import { join } from 'path'
import * as Y from 'yjs'
import { emptyState, type CanvasState } from '@shared/ai/canvas'
import { ShareClient, type ShareStatus } from '@shared/share/client'
import { inviteLink, newRoom, parseInvite } from '@shared/share/crypto'
import { isEmptyDoc, readInto, sharedSeq, writeDiff } from '@shared/share/doc'
import type { SharePerson, ShareState } from '@shared/types'
import { JsonStore } from './store'
import type { SpaceStore } from './spaces'
import type { CanvasService } from './ai/canvas'

/** The relay Panes uses (share/server, on Render). */
export const SHARE_RELAY = 'https://panes-share.onrender.com'
const LOCAL = 'panes-local'
/** How long a burst of changes from elsewhere is gathered before the board is rebuilt and sent (one frame or so). */
const APPLY_MS = 30
const PERSIST_MS = 800
const COLORS = [
  '#f97316',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
  '#14b8a6',
  '#eab308',
  '#ef4444'
]

interface Saved {
  relay: string
  room: string
  /** The secret, sealed by the system (base64); `plain` when the system has no store for it. */
  secret: string
  plain?: boolean
  /** The last log entry this machine holds. */
  have: number
}

interface Room {
  spaceId: number
  saved: Saved
  doc: Y.Doc
  client: ShareClient
  /** The board the window holds (its last save, or the last board from here it took): what the next diff of a local
   * save is taken against. Never a board only sent: a save made before the window took it would undo what it brought. */
  last: CanvasState | null
  /** Boards sent to the window, by number, until it says which it took (share:took). */
  sent: Map<number, CanvasState>
  sentN: number
  tookN: number
  status: ShareStatus
  people: SharePerson[]
  applyTimer?: NodeJS.Timeout
  persistTimer?: NodeJS.Timeout
}

export interface ShareDeps {
  win: BrowserWindow
  spaces: SpaceStore
  canvas: CanvasService
  /** A space was added or changed (the window is told). */
  refresh: () => void
  /** Make a new space and go to it. */
  createSpace: () => { id: number }
  /** A tab's title, for the card the others see of it. */
  tabTitle: (tabId: number) => string
}

export class ShareService {
  private store = new JsonStore<{
    rooms: Record<string, Saved>
    /** This person, as the others see them: a name they can change, a colour kept from the first share on. */
    me?: { name: string; color: string; id?: string }
  }>('shares', { rooms: {} })
  private rooms = new Map<number, Room>()

  private get me(): { name: string; color: string; id?: string } {
    if (!this.store.value.me) {
      this.store.value.me = {
        name: userInfo().username || 'Someone',
        color: COLORS[Math.floor(Math.random() * COLORS.length)]
      }
      this.store.save()
    }
    return this.store.value.me
  }

  /** This person in every room, lasting (the document's own id changes each start): whose tabs are whose. */
  private get who(): string {
    const me = this.me
    if (!me.id) {
      me.id = randomUUID().slice(0, 12)
      this.store.save()
    }
    return me.id
  }

  /** This person's tabs go into the room with their titles (see TabMirror). */
  private get tabsOut(): { by: string; title: (id: number) => string } {
    return { by: this.who, title: (id) => this.d.tabTitle(id) }
  }

  /** The name the others see (every room is told at once). */
  setName(name: string): void {
    const n = name.trim().slice(0, 40)
    if (!n) return
    this.store.value.me = { ...this.me, name: n }
    this.store.save()
    for (const room of this.rooms.values()) {
      room.client.awareness.setLocalStateField('user', this.me)
      this.tell(room)
    }
  }

  constructor(private d: ShareDeps) {}

  private get dir(): string {
    const p = join(app.getPath('userData'), 'share')
    mkdirSync(p, { recursive: true })
    return p
  }

  /** Every shared space connects once the window is up. */
  init(): void {
    for (const [id, saved] of Object.entries(this.store.value.rooms)) {
      const spaceId = Number(id)
      if (this.d.spaces.get(spaceId)) this.open(spaceId, saved)
      else delete this.store.value.rooms[id]
    }
  }

  private seal(secret: string): Pick<Saved, 'secret' | 'plain'> {
    if (safeStorage.isEncryptionAvailable())
      return { secret: safeStorage.encryptString(secret).toString('base64') }
    return { secret, plain: true }
  }

  private secretOf(s: Saved): string {
    return s.plain ? s.secret : safeStorage.decryptString(Buffer.from(s.secret, 'base64'))
  }

  private docFile(room: string): string {
    return join(this.dir, `${room}.ydoc`)
  }

  /** Connect a shared space: its document from disk (it opens offline), then the relay. */
  private open(spaceId: number, saved: Saved): Room {
    const doc = new Y.Doc()
    const file = this.docFile(saved.room)
    if (existsSync(file)) {
      try {
        Y.applyUpdate(doc, readFileSync(file), LOCAL)
      } catch {
        saved.have = 0 // a broken copy: fetch everything again
      }
    }
    const room: Room = {
      spaceId,
      saved,
      doc,
      last: this.d.canvas.load(spaceId).state,
      status: 'connecting',
      people: [],
      sent: new Map(),
      sentN: 0,
      tookN: 0,
      client: null as unknown as ShareClient
    }
    room.client = new ShareClient({
      relay: saved.relay,
      room: saved.room,
      secret: this.secretOf(saved),
      doc,
      have: saved.have,
      onStatus: (s) => {
        room.status = s
        this.tell(room)
      },
      onHave: (n) => {
        saved.have = n
        this.persistSoon(room)
      }
    })
    room.client.awareness.setLocalStateField('user', this.me)
    room.client.awareness.on('change', () => this.onPresence(room))
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      this.persistSoon(room)
      if (origin !== LOCAL) this.applySoon(room)
    })
    doc.getMap('meta').observe(() => this.onMeta(room))
    this.rooms.set(spaceId, room)
    return room
  }

  private persistSoon(room: Room): void {
    clearTimeout(room.persistTimer)
    room.persistTimer = setTimeout(() => {
      writeFileSync(this.docFile(room.saved.room), Y.encodeStateAsUpdate(room.doc))
      this.store.save()
    }, PERSIST_MS)
  }

  /** Changes from elsewhere: the board made again from the document (with this person's own parts), saved, shown. */
  private applySoon(room: Room): void {
    clearTimeout(room.applyTimer)
    room.applyTimer = setTimeout(() => {
      const base =
        room.last ?? this.d.canvas.load(room.spaceId).state ?? emptyState(this.d.canvas.boot)
      const next = { ...readInto(room.doc, base, this.who), seq: sharedSeq(base.seq, room.doc.clientID) }
      this.d.canvas.saveQuiet(room.spaceId, next)
      const n = ++room.sentN
      room.sent.set(n, next)
      // no board open for it: what is on disk is what the board will open with
      if (this.d.win.isDestroyed()) return void (room.last = next)
      this.d.win.webContents.send('canvas:remote', room.spaceId, next, n)
    }, APPLY_MS)
  }

  /** A board saved here: what changed since the board it was made from goes into the room. */
  onLocalSave(spaceId: number, state: CanvasState): void {
    const room = this.rooms.get(spaceId)
    if (!room) return
    writeDiff(room.doc, room.last, state, LOCAL, this.tabsOut)
    room.last = state
    // the room has changes this board was not made with: the two together go back to it
    if (room.sentN > room.tookN) this.applySoon(room)
  }

  /**
   * The window took board `n` from here (0: it opened the board from disk). Saves after this are made from it.
   */
  took(spaceId: number, n: number): void {
    const room = this.rooms.get(spaceId)
    if (!room) return
    if (n === 0) {
      room.last = this.d.canvas.load(spaceId).state ?? room.last
      room.tookN = room.sentN
    } else {
      const b = room.sent.get(n)
      if (!b) return
      room.last = b
      room.tookN = n
    }
    for (const k of room.sent.keys()) if (k <= room.tookN) room.sent.delete(k)
  }

  /** The space's name, colour and icon came (or changed) from the room. */
  private onMeta(room: Room): void {
    const m = room.doc.getMap<string>('meta')
    const name = m.get('name')
    const color = m.get('color')
    const icon = m.get('icon')
    const space = this.d.spaces.get(room.spaceId)
    if (!space) return
    const patch: Record<string, string> = {}
    if (name && name !== space.name) patch.name = name
    if (color && color !== space.color) patch.color = color
    if (icon && icon !== space.icon) patch.icon = icon
    if (Object.keys(patch).length === 0) return
    this.d.spaces.update(room.spaceId, patch)
    this.d.refresh()
  }

  /** This space's name, colour and icon, written for the others (when it changes here, or on sharing). */
  /**
   * Only what `keys` names (what the person changed here): a space's other settings changing (how it browses, its
   * theme) must not send its name again. A space just joined has a stand-in name until the room's arrives, and
   * writing that back renamed the space for everyone.
   */
  writeMeta(spaceId: number, keys: readonly string[] = ['name', 'color', 'icon']): void {
    const room = this.rooms.get(spaceId)
    const space = this.d.spaces.get(spaceId)
    if (!room || !space) return
    const m = room.doc.getMap<string>('meta')
    room.doc.transact(() => {
      for (const k of ['name', 'color', 'icon'] as const) {
        const v = space[k]
        if (keys.includes(k) && typeof v === 'string' && m.get(k) !== v) m.set(k, v)
      }
    }, LOCAL)
  }

  private onPresence(room: Room): void {
    const people: SharePerson[] = []
    room.client.awareness.getStates().forEach((st, id) => {
      if (id === room.doc.clientID) return
      const s = st as {
        user?: { name?: string; color?: string }
        cursor?: { x: number; y: number } | null
      }
      if (!s.user) return
      people.push({
        id,
        name: String(s.user.name ?? 'Someone').slice(0, 40),
        color: /^#[0-9a-f]{6}$/i.test(s.user.color ?? '') ? (s.user.color as string) : COLORS[0],
        cursor:
          s.cursor && Number.isFinite(s.cursor.x) && Number.isFinite(s.cursor.y)
            ? { x: s.cursor.x, y: s.cursor.y }
            : null
      })
    })
    room.people = people
    this.tell(room)
  }

  /** The window hears how a shared space is doing: connected or not, and who is in it (cursors included). */
  private tell(room: Room): void {
    if (this.d.win.isDestroyed()) return
    this.d.win.webContents.send('share:state', room.spaceId, this.stateOf(room))
  }

  private stateOf(room: Room): ShareState {
    return { status: room.status, people: room.people, me: this.me }
  }

  state(spaceId: number): ShareState | null {
    const room = this.rooms.get(spaceId)
    return room ? this.stateOf(room) : null
  }

  /** Share a space: its room is made and its board goes up. The invite link comes back. */
  start(spaceId: number): string | null {
    if (!this.d.spaces.get(spaceId)) return null
    const existing = this.rooms.get(spaceId)
    if (existing) return this.link(spaceId)
    const { room, secret } = newRoom()
    const saved: Saved = { relay: SHARE_RELAY, room, ...this.seal(secret), have: 0 }
    this.store.value.rooms[String(spaceId)] = saved
    this.store.save()
    const r = this.open(spaceId, saved)
    // the board as it is now: everything goes up as the room's first change (from this person's id block on)
    const board = this.d.canvas.load(spaceId).state ?? emptyState(this.d.canvas.boot)
    r.last = null
    this.onLocalSave(spaceId, board)
    this.writeMeta(spaceId)
    this.d.spaces.setShared(spaceId, true)
    // this person counts ids in their own block from now on
    const moved = { ...board, seq: sharedSeq(board.seq, r.doc.clientID) }
    r.last = moved
    this.d.canvas.saveQuiet(spaceId, moved)
    const n = ++r.sentN
    r.sent.set(n, moved)
    if (!this.d.win.isDestroyed()) this.d.win.webContents.send('canvas:remote', spaceId, moved, n)
    this.d.refresh()
    return inviteLink(saved.relay, saved.room, secret)
  }

  /** The invite link of a shared space. */
  link(spaceId: number): string | null {
    const s = this.store.value.rooms[String(spaceId)]
    return s ? inviteLink(s.relay, s.room, this.secretOf(s)) : null
  }

  /** Whether a link is an invite this Panes can join (its own relay, or panes://join from the invite page). */
  isInvite(link: string): boolean {
    const p = parseInvite(fromJoin(link))
    return !!p && p.relay === new URL(SHARE_RELAY).origin
  }

  /** An invite link on the clipboard for a room this Panes is not in yet (the search popover offers to join it). */
  async clipboardInvite(): Promise<string | null> {
    const text = (await clipboard.readText()).trim()
    if (text.length > 300 || !this.isInvite(text)) return null
    const p = parseInvite(fromJoin(text))
    if (!p || Object.values(this.store.value.rooms).some((s) => s.room === p.room)) return null
    return text
  }

  /** Join from an invite link: a new space, its board coming in from the room. The space's id, or null. */
  join(link: string): number | null {
    const p = parseInvite(fromJoin(link))
    if (!p) return null
    // already in it: go there
    for (const [id, s] of Object.entries(this.store.value.rooms))
      if (s.room === p.room) return Number(id)
    const space = this.d.createSpace()
    this.d.spaces.update(space.id, { name: 'Shared space', browseWith: 'canvas' })
    const saved: Saved = { relay: p.relay, room: p.room, ...this.seal(p.secret), have: 0 }
    this.store.value.rooms[String(space.id)] = saved
    this.store.save()
    const r = this.open(space.id, saved)
    r.last = emptyState(this.d.canvas.boot)
    this.d.spaces.setShared(space.id, true)
    this.d.refresh()
    // a room that was empty is still a room: nothing more to wait for
    if (!isEmptyDoc(r.doc)) this.applySoon(r)
    return space.id
  }

  /** Stop sharing (or leave): this machine keeps its copy of the board, the room is left. */
  stop(spaceId: number): void {
    const room = this.rooms.get(spaceId)
    if (room) {
      room.client.destroy()
      clearTimeout(room.applyTimer)
      clearTimeout(room.persistTimer)
      this.rooms.delete(spaceId)
    }
    delete this.store.value.rooms[String(spaceId)]
    this.store.save()
    this.d.spaces.setShared(spaceId, false)
    this.d.refresh()
  }

  /** The computer woke: every room that dropped meanwhile connects again now. */
  wake(): void {
    for (const room of this.rooms.values()) room.client.reconnectNow()
  }

  /** Where this person's pointer is on the board (board coordinates), or null when it left. */
  cursor(spaceId: number, at: { x: number; y: number } | null): void {
    this.rooms.get(spaceId)?.client.awareness.setLocalStateField('cursor', at)
  }

  /** A space deleted: its room is left. */
  forget(spaceId: number): void {
    if (this.store.value.rooms[String(spaceId)]) this.stop(spaceId)
  }
}

/** panes://join/<room>#<secret> (the invite page's Open in Panes) as the invite link it stands for. */
export function fromJoin(link: string): string {
  return link.trim().replace(/^panes:\/\/join\//i, `${SHARE_RELAY}/s/`)
}

export function registerShare(d: ShareDeps): ShareService {
  const svc = new ShareService(d)
  const mine = (e: { sender: unknown }): boolean => e.sender === d.win.webContents
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : -1)
  ipcMain.handle('share:start', (e, id: unknown) => (mine(e) ? svc.start(num(id)) : null))
  ipcMain.handle('share:link', (e, id: unknown) => (mine(e) ? svc.link(num(id)) : null))
  ipcMain.handle('share:join', (e, link: unknown) =>
    mine(e) && typeof link === 'string' ? svc.join(link) : null
  )
  ipcMain.handle('share:state', (e, id: unknown) => (mine(e) ? svc.state(num(id)) : null))
  ipcMain.on('share:name', (e, name: unknown) => {
    if (mine(e) && typeof name === 'string') svc.setName(name)
  })
  ipcMain.handle('share:clipboard', (e) => (mine(e) ? svc.clipboardInvite() : null))
  ipcMain.on('share:stop', (e, id: unknown) => {
    if (mine(e)) svc.stop(num(id))
  })
  ipcMain.on('share:took', (e, id: unknown, n: unknown) => {
    if (mine(e) && typeof n === 'number' && Number.isInteger(n) && n >= 0) svc.took(num(id), n)
  })
  ipcMain.on('share:cursor', (e, id: unknown, at: unknown) => {
    if (!mine(e)) return
    const p = at as { x?: unknown; y?: unknown } | null
    svc.cursor(
      num(id),
      p &&
        typeof p.x === 'number' &&
        typeof p.y === 'number' &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y)
        ? { x: p.x, y: p.y }
        : null
    )
  })
  return svc
}
