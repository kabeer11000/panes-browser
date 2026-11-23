/**
 * Shared spaces in Panes (tasks/shared-spaces.md): each shared space's board kept in step with everyone in its room
 * through the relay, end to end encrypted. The board stays the board (CanvasService saves it as ever); this is the
 * seam: a local save writes what changed into the room's document, a change from elsewhere comes back as a board,
 * saved and handed to the board page.
 *
 * The room's secret never leaves this file: it is kept encrypted by the system (safeStorage) in its own store, never
 * on the space (spaces are sent to the window whole). The space only says that it is shared.
 */
import {
  app,
  clipboard,
  ipcMain,
  nativeImage,
  Notification,
  safeStorage,
  type BrowserWindow
} from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { userInfo } from 'os'
import { join } from 'path'
import * as Y from 'yjs'
import { emptyState, type CanvasState } from '@shared/ai/canvas'
import { ShareClient, type ShareStatus } from '@shared/share/client'
import { inviteLink, newRoom, parseInvite } from '@shared/share/crypto'
import { chatOf, sayIn, watchChat, type ChatMessage } from '@shared/share/chat'
import { isEmptyDoc, readInto, sharedSeq, writeDiff } from '@shared/share/doc'
import type { SharePerson, ShareState } from '@shared/types'
import { parseRemoteInput, type RemoteInput } from '@shared/share/live'
import { JsonStore } from './store'
import type { SpaceStore } from './spaces'
import type { CanvasService } from './ai/canvas'

/** The relay Panes uses (share/server, on Render). */
export const SHARE_RELAY = 'https://panes-share.onrender.com'
const LOCAL = 'panes-local'
/** How long a burst of changes from elsewhere is gathered before the board is rebuilt and sent (one frame or so). */
const APPLY_MS = 30
const PERSIST_MS = 800
/** Tabs' pictures for the others: looked at this often, one tab at most this often, a few per look, this size. */
const PIC_TICK_MS = 15_000
/** Tab changes gathered this long before they go to the rooms (a page loading changes its tab many times). */
const TABS_MOVED_MS = 400
const PIC_EVERY_MS = 30_000
const PICS_PER_ROUND = 4
const PIC_WIDTH = 320
const PIC_QUALITY = 62
/** Pictures of the others' tabs kept opened, at most. */
const PICS_KEPT = 300
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
  /** The tab this person shows live here, if any. */
  liveTab?: number
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
  /** A tab's address now; null once it has closed. */
  tabUrl: (tabId: number) => string | null
  /** A tab's picture (a JPEG data address) and when it was taken; null and 0 when it has none. */
  thumbOf: (tabId: number) => string | null
  thumbAt: (tabId: number) => number
  /** Showing a tab live (main/tabs.ts): keep it painting or stop; its address and title; input from the driver. */
  setLiveShared: (tabId: number, on: boolean) => boolean
  liveInfo: (tabId: number) => { url: string; title: string } | null
  remoteInput: (tabId: number, ev: RemoteInput) => void
  /** Where the pointer is over that tab on screen (fractions of its page), or null. */
  pointerIn: (tabId: number) => { x: number; y: number } | null
  /** Bring the window up on a space's board (a chat notification was clicked). */
  openBoard: (spaceId: number) => void
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
  private tabsOut(spaceId: number): {
    by: string
    title: (id: number) => string
    pic: (id: number) => string | undefined
    url: (id: number) => string | null
  } {
    return {
      by: this.who,
      title: (id) => this.d.tabTitle(id),
      url: (id) => this.d.tabUrl(id),
      pic: (id) => this.sentPics.get(`${spaceId}:${id}`)?.id
    }
  }

  /** This person's tabs' pictures sent to each room: by space and tab, the store id and when the picture was taken. */
  private sentPics = new Map<string, { id: string; at: number; sent: number }>()
  /** Pictures of the others' tabs, opened, by store id (image addresses), and those on their way. */
  private pics = new Map<string, string>()
  private picsComing = new Set<string>()
  private picTimer: NodeJS.Timeout | null = null

  /**
   * Every little while: the pictures of this person's tabs in each shared space that changed since they last went
   * (one tab at most every PIC_EVERY_MS, a few per round), shrunk and sealed into the room's store. The tab's card
   * in the room then names it, and the others see the page as it looks.
   */
  private async sendPics(): Promise<void> {
    let budget = PICS_PER_ROUND
    // a tab shown live: its title and address said again (it may have moved on), or the show ends (it closed)
    for (const room of this.rooms.values()) this.liveAnnounce(room)
    for (const room of this.rooms.values()) {
      if (room.status !== 'live' || !room.last) continue
      let changed = false
      for (const c of room.last.cards) {
        if (budget <= 0) break
        if (c.id <= 0 || c.private) continue
        const key = `${room.spaceId}:${c.id}`
        const at = this.d.thumbAt(c.id)
        const was = this.sentPics.get(key)
        if (!at || (was && (at <= was.at || Date.now() - was.sent < PIC_EVERY_MS))) continue
        const data = this.d.thumbOf(c.id)
        if (!data) continue
        const img = nativeImage.createFromDataURL(data)
        if (img.isEmpty()) continue
        budget--
        const jpeg = img.resize({ width: PIC_WIDTH, quality: 'good' }).toJPEG(PIC_QUALITY)
        const id = await room.client.putBlob(new Uint8Array(jpeg))
        if (!id || !this.rooms.has(room.spaceId)) continue
        this.sentPics.set(key, { id, at, sent: Date.now() })
        changed = true
      }
      // the cards name their pictures now: the tabs go into the room again (nothing else changed)
      if (changed && room.last)
        writeDiff(room.doc, room.last, room.last, LOCAL, this.tabsOut(room.spaceId))
    }
  }

  /** A picture of someone else's tab, once it is here; asked for the first time it is wanted. */
  private picOf(room: Room): (id: string) => string | undefined {
    return (id) => {
      const have = this.pics.get(id)
      if (have !== undefined || this.picsComing.has(id)) return have
      this.picsComing.add(id)
      void room.client
        .getBlob(id)
        .then((bytes) => {
          if (!bytes) return
          if (this.pics.size >= PICS_KEPT) this.pics.delete(this.pics.keys().next().value!)
          this.pics.set(id, 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64'))
          if (this.rooms.get(room.spaceId) === room) this.applySoon(room)
        })
        .finally(() => this.picsComing.delete(id))
      return undefined
    }
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
    this.picTimer ??= setInterval(() => void this.sendPics(), PIC_TICK_MS)
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
        // where the others reach this person for a live tab's signals (the relay's id, new each connection)
        if (s === 'syncing' || s === 'live')
          room.client.awareness.setLocalStateField('rtc', room.client.me)
        this.tell(room)
      },
      onSignal: (from, data) => {
        if (!this.d.win.isDestroyed())
          this.d.win.webContents.send(
            'share:signal',
            room.spaceId,
            from,
            new TextDecoder().decode(data)
          )
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
    // the room's chat, to the window as it changes (shared/share/chat.ts); someone else's new message is a
    // notification while the window is not in front (the history already there when the room opens is not)
    let heard: string | null | undefined
    watchChat(doc, (messages) => {
      if (!this.d.win.isDestroyed())
        this.d.win.webContents.send('share:chat', spaceId, { messages, me: doc.clientID })
      const latest = messages.at(-1)
      const before = heard
      heard = latest?.id ?? null
      if (before === undefined || !latest || latest.id === before || latest.by === doc.clientID)
        return
      if (this.d.win.isDestroyed() || this.d.win.isFocused() || !Notification.isSupported()) return
      const space = this.d.spaces.get(spaceId)
      const n = new Notification({
        title: space ? `${latest.name} in ${space.name}` : latest.name,
        body: latest.text.slice(0, 240),
        silent: false
      })
      n.on('click', () => this.d.openBoard(spaceId))
      n.show()
    })
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
      const next = {
        ...readInto(room.doc, base, this.who, this.picOf(room)),
        seq: sharedSeq(base.seq, room.doc.clientID)
      }
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
    writeDiff(room.doc, room.last, state, LOCAL, this.tabsOut(spaceId))
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
        rtc?: unknown
        live?: { title?: unknown; url?: unknown } | null
      }
      if (!s.user) return
      people.push({
        id,
        name: String(s.user.name ?? 'Someone').slice(0, 40),
        color: /^#[0-9a-f]{6}$/i.test(s.user.color ?? '') ? (s.user.color as string) : COLORS[0],
        cursor:
          s.cursor && Number.isFinite(s.cursor.x) && Number.isFinite(s.cursor.y)
            ? { x: s.cursor.x, y: s.cursor.y }
            : null,
        rtc: typeof s.rtc === 'number' && Number.isSafeInteger(s.rtc) ? s.rtc : 0,
        live:
          s.live && typeof s.live.url === 'string' && s.live.url.length > 0 // only shown, never opened
            ? { url: s.live.url.slice(0, 2000), title: String(s.live.title ?? '').slice(0, 200) }
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
    return { status: room.status, people: room.people, me: this.me, liveTab: room.liveTab ?? null }
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
    if (room?.liveTab !== undefined) this.d.setLiveShared(room.liveTab, false)
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

  /**
   * Show a tab live to everyone in the space (null stops): it keeps painting, and the others hear of it (its title
   * and address, in presence) and can ask for its picture over WebRTC (the board's LiveShare). One at a time.
   */
  showLive(spaceId: number, tabId: number | null): boolean {
    const room = this.rooms.get(spaceId)
    if (!room) return false
    if (room.liveTab !== undefined && room.liveTab !== tabId)
      this.d.setLiveShared(room.liveTab, false)
    if (tabId === null) {
      room.liveTab = undefined
      room.client.awareness.setLocalStateField('live', null)
      this.tell(room)
      return true
    }
    if (!this.d.setLiveShared(tabId, true)) return false
    room.liveTab = tabId
    this.liveAnnounce(room)
    this.tell(room)
    return true
  }

  /** ICE servers for a live tab's calls in this space, from its relay (STUN, and TURN when the relay has a key). */
  async iceServers(spaceId: number): Promise<RTCIceServer[] | null> {
    return (await this.rooms.get(spaceId)?.client.iceServers()) ?? null
  }

  liveTabOf(spaceId: number): number | null {
    return this.rooms.get(spaceId)?.liveTab ?? null
  }

  /** The live tab's title and address, to the others (again when its page changes). */
  liveAnnounce(room: Room): void {
    if (room.liveTab === undefined) return
    const info = this.d.liveInfo(room.liveTab)
    if (!info) return void this.showLive(room.spaceId, null) // the tab went
    room.client.awareness.setLocalStateField('live', { title: info.title, url: info.url })
  }

  /**
   * The tabs changed (one closed, went elsewhere, was retitled): the others' copies of this person's tabs follow at
   * once, not when the board is next saved (closing a tab away from the board never saves it, and the others kept
   * it), and the live one is said again or ends.
   */
  tabsMoved(): void {
    if (this.tabsTimer) return
    this.tabsTimer = setTimeout(() => {
      this.tabsTimer = null
      for (const room of this.rooms.values()) {
        this.liveAnnounce(room)
        if (room.last) writeDiff(room.doc, room.last, room.last, LOCAL, this.tabsOut(room.spaceId))
      }
    }, TABS_MOVED_MS)
  }
  private tabsTimer: NodeJS.Timeout | null = null

  signal(spaceId: number, to: number, data: string): void {
    const room = this.rooms.get(spaceId)
    if (room && to > 0 && data.length < 64_000)
      void room.client.signal(to, new TextEncoder().encode(data))
  }

  /** Input from whoever drives the live tab (the board let them: the host's own window decides that). */
  input(spaceId: number, ev: RemoteInput): void {
    const room = this.rooms.get(spaceId)
    if (room?.liveTab !== undefined) this.d.remoteInput(room.liveTab, ev)
  }

  /** A shared space's chat: the latest messages, and this person's id in them (theirs are drawn on the right). */
  chat(spaceId: number): { messages: ChatMessage[]; me: number } | null {
    const room = this.rooms.get(spaceId)
    return room ? { messages: chatOf(room.doc), me: room.doc.clientID } : null
  }

  /** Say something in a shared space's chat, as this person. */
  say(spaceId: number, text: string): void {
    const room = this.rooms.get(spaceId)
    if (room) sayIn(room.doc, this.me, text, LOCAL)
  }

  /** Where the host's pointer is over their live tab in this space, for the watchers (null: not over it). */
  pointer(spaceId: number): { x: number; y: number } | null {
    const room = this.rooms.get(spaceId)
    return room?.liveTab !== undefined ? this.d.pointerIn(room.liveTab) : null
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
  ipcMain.handle('share:show-live', (e, id: unknown, tab: unknown) =>
    mine(e) ? svc.showLive(num(id), typeof tab === 'number' ? tab : null) : false
  )
  ipcMain.handle('share:live-tab', (e, id: unknown) => (mine(e) ? svc.liveTabOf(num(id)) : null))
  ipcMain.handle('share:ice', (e, id: unknown) => (mine(e) ? svc.iceServers(num(id)) : null))
  ipcMain.handle('share:pointer', (e, id: unknown) => (mine(e) ? svc.pointer(num(id)) : null))
  ipcMain.handle('share:chat', (e, id: unknown) => (mine(e) ? svc.chat(num(id)) : null))
  ipcMain.on('share:say', (e, id: unknown, text: unknown) => {
    if (mine(e) && typeof text === 'string') svc.say(num(id), text)
  })
  ipcMain.on('share:signal', (e, id: unknown, to: unknown, data: unknown) => {
    if (mine(e) && typeof data === 'string') svc.signal(num(id), num(to), data)
  })
  ipcMain.on('share:input', (e, id: unknown, event: unknown) => {
    const ev = parseRemoteInput(event)
    if (mine(e) && ev) svc.input(num(id), ev)
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
