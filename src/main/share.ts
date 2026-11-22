/**
 * Shared spaces in Panes (tasks/shared-spaces.md): each shared space's board kept in step with everyone in its room
 * through the relay, end to end encrypted. The board stays the board (CanvasService saves it as ever); this is the
 * seam: a local save writes what changed into the room's document, a change from elsewhere comes back as a board,
 * saved and handed to the board page.
 *
 * The room's secret never leaves this file: it is kept encrypted by the system (safeStorage) in its own store, never
 * on the space (spaces are sent to the window whole). The space only says that it is shared.
 */
import { app, ipcMain, safeStorage, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
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
  /** The board as last written into the document or read from it: what the next diff is taken against. */
  last: CanvasState | null
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
}

export class ShareService {
  private store = new JsonStore<{ rooms: Record<string, Saved> }>('shares', { rooms: {} })
  private rooms = new Map<number, Room>()
  /** This person, as the others see them. */
  private me = {
    name: userInfo().username || 'Someone',
    color: COLORS[Math.floor(Math.random() * COLORS.length)]
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
      const next = { ...readInto(room.doc, base), seq: sharedSeq(base.seq, room.doc.clientID) }
      room.last = next
      this.d.canvas.saveQuiet(room.spaceId, next)
      if (!this.d.win.isDestroyed())
        this.d.win.webContents.send('canvas:remote', room.spaceId, next)
    }, APPLY_MS)
  }

  /** A board saved here: what changed goes into the room. */
  onLocalSave(spaceId: number, state: CanvasState): void {
    const room = this.rooms.get(spaceId)
    if (!room) return
    writeDiff(room.doc, room.last, state, LOCAL)
    room.last = state
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
  writeMeta(spaceId: number): void {
    const room = this.rooms.get(spaceId)
    const space = this.d.spaces.get(spaceId)
    if (!room || !space) return
    const m = room.doc.getMap<string>('meta')
    room.doc.transact(() => {
      if (m.get('name') !== space.name) m.set('name', space.name)
      if (m.get('color') !== space.color) m.set('color', space.color)
      if (m.get('icon') !== space.icon) m.set('icon', space.icon)
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
    if (!this.d.win.isDestroyed()) this.d.win.webContents.send('canvas:remote', spaceId, moved)
    this.d.refresh()
    return inviteLink(saved.relay, saved.room, secret)
  }

  /** The invite link of a shared space. */
  link(spaceId: number): string | null {
    const s = this.store.value.rooms[String(spaceId)]
    return s ? inviteLink(s.relay, s.room, this.secretOf(s)) : null
  }

  /** Whether a link is an invite this Panes can join (its own relay). */
  isInvite(link: string): boolean {
    const p = parseInvite(link)
    return !!p && p.relay === new URL(SHARE_RELAY).origin
  }

  /** Join from an invite link: a new space, its board coming in from the room. The space's id, or null. */
  join(link: string): number | null {
    const p = parseInvite(link)
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

  /** Where this person's pointer is on the board (board coordinates), or null when it left. */
  cursor(spaceId: number, at: { x: number; y: number } | null): void {
    this.rooms.get(spaceId)?.client.awareness.setLocalStateField('cursor', at)
  }

  /** A space deleted: its room is left. */
  forget(spaceId: number): void {
    if (this.store.value.rooms[String(spaceId)]) this.stop(spaceId)
  }
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
  ipcMain.on('share:stop', (e, id: unknown) => {
    if (mine(e)) svc.stop(num(id))
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
