/**
 * One person's connection to a shared space (tasks/shared-spaces.md): a Yjs document kept in step with everyone
 * else's through the relay (share/server/relay.ts), every message sealed with the room's key (crypto.ts). Runs where
 * there is a WebSocket: Panes' pages and the web board.
 *
 * Offline is normal: changes made meanwhile wait (Yjs updates can be sent twice without harm) and go out once the
 * relay is back. `have` (the last log entry applied) is the caller's to keep with the document, so a reopened space
 * only fetches what it missed.
 */
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import { open, roomKeys, seal, type RoomKeys } from './crypto'
import { frame, jsonOf, NUMS, T, unframe, type PeerEvent, type Welcome } from './wire'

export type ShareStatus = 'connecting' | 'syncing' | 'live' | 'offline' | 'refused'

export interface ShareClientOptions {
  relay: string
  room: string
  secret: string
  doc: Y.Doc
  /** The last log entry this document holds (0 for none). */
  have?: number
  onStatus?: (s: ShareStatus) => void
  /** A log entry was applied: keep this with the document (see `have`). */
  onHave?: (n: number) => void
  /** A WebRTC signal from another person (shared browsing). */
  onSignal?: (from: number, data: Uint8Array) => void
  /** Who is here changed (relay ids). */
  onPeers?: (ids: number[]) => void
  /** Tests: the WebSocket to use. */
  WebSocketImpl?: typeof WebSocket
}

const REMOTE = Symbol('share-remote')

export class ShareClient {
  readonly doc: Y.Doc
  readonly awareness: awarenessProtocol.Awareness
  status: ShareStatus = 'connecting'
  /** This connection's id at the relay (for signals), once welcomed. */
  me = 0
  private ws: WebSocket | null = null
  private keys: Promise<RoomKeys>
  private have: number
  /** Sealed updates sent and not yet acknowledged, in order: sent again after a reconnect. */
  private unacked: Uint8Array[] = []
  private peers = new Set<number>()
  private closed = false
  private retry = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  /** Messages are opened and applied one at a time, in the order they came. */
  private chain: Promise<void> = Promise.resolve()

  constructor(private o: ShareClientOptions) {
    this.doc = o.doc
    this.have = o.have ?? 0
    this.keys = roomKeys(o.room, o.secret)
    this.awareness = new awarenessProtocol.Awareness(this.doc)
    this.doc.on('update', this.onLocal)
    this.awareness.on('update', this.onAware)
    this.connect()
  }

  /** Try again now, not at the next backoff step (the computer woke, the network came back). */
  reconnectNow(): void {
    if (this.closed || this.ws || this.status === 'refused') return
    clearTimeout(this.timer)
    this.retry = 0
    void this.connect()
  }

  /** A picture (or any bytes) into the room's store, sealed: its id there, or null when it could not go. */
  async putBlob(bytes: Uint8Array): Promise<string | null> {
    const { key, token } = await this.keys
    try {
      const res = await fetch(`${this.o.relay.replace(/\/+$/, '')}/blob/${this.o.room}`, {
        method: 'POST',
        headers: { 'x-token': token },
        body: (await seal(key, bytes)) as Uint8Array<ArrayBuffer>
      })
      if (!res.ok) return null
      const { id } = (await res.json()) as { id?: unknown }
      return typeof id === 'string' ? id : null
    } catch {
      return null
    }
  }

  /** A picture from the room's store, opened; null when it is not there or not this room's. */
  async getBlob(id: string): Promise<Uint8Array | null> {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null
    const { key, token } = await this.keys
    try {
      const res = await fetch(`${this.o.relay.replace(/\/+$/, '')}/blob/${this.o.room}/${id}`, {
        headers: { 'x-token': token }
      })
      if (!res.ok) return null
      return await open(key, new Uint8Array(await res.arrayBuffer()))
    } catch {
      return null
    }
  }

  /**
   * The ICE servers the room's relay hands out for shared browsing: STUN, and Cloudflare TURN (short-lived
   * credentials) when the relay has a key. Null when it cannot be asked (an older relay, offline).
   */
  async iceServers(): Promise<RTCIceServer[] | null> {
    const { token } = await this.keys
    try {
      const res = await fetch(`${this.o.relay.replace(/\/+$/, '')}/ice/${this.o.room}`, {
        headers: { 'x-token': token }
      })
      if (!res.ok) return null
      const got = ((await res.json()) as { iceServers?: unknown }).iceServers
      return Array.isArray(got) && got.length > 0 ? (got as RTCIceServer[]) : null
    } catch {
      return null
    }
  }

  /** Leave: the document stays as it is (the caller keeps it), others see this person go. */
  destroy(): void {
    this.closed = true
    clearTimeout(this.timer)
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'local')
    this.doc.off('update', this.onLocal)
    this.awareness.off('update', this.onAware)
    this.ws?.close()
    this.awareness.destroy()
  }

  /** A WebRTC signal to one other person. */
  async signal(to: number, data: Uint8Array): Promise<void> {
    const { key } = await this.keys
    this.send(frame(T.SIGNAL, [to], await seal(key, data)))
  }

  private setStatus(s: ShareStatus): void {
    if (this.status === s) return
    this.status = s
    this.o.onStatus?.(s)
  }

  private async connect(): Promise<void> {
    if (this.closed) return
    this.setStatus('connecting')
    const { token } = await this.keys
    const url = `${this.o.relay.replace(/^http/, 'ws')}/sync/${this.o.room}?token=${token}`
    const WS = this.o.WebSocketImpl ?? WebSocket
    const ws = new WS(url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.setStatus('syncing')
      ws.send(`have:${this.have}`)
    }
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') return
      const data = new Uint8Array(e.data as ArrayBuffer)
      this.chain = this.chain.then(() => this.receive(data)).catch(() => undefined)
    }
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      this.ws = null
      this.peers.clear()
      this.o.onPeers?.([])
      if (this.closed) return
      // refused at the door (a wrong token) is not worth retrying. Anything else is: it used to give up after five
      // failed tries (16 s), and a relay redeploy or a dropped network outlasts that, leaving the space offline
      // until Panes restarted
      if (e.code === 1008) return this.setStatus('refused')
      this.setStatus('offline')
      const wait = Math.min(30_000, 500 * 2 ** this.retry++) * (0.75 + Math.random() / 2)
      this.timer = setTimeout(() => void this.connect(), wait)
    }
  }

  private send(bytes: Uint8Array): void {
    if (this.ws?.readyState === 1) this.ws.send(bytes)
  }

  private async receive(data: Uint8Array): Promise<void> {
    const type = data[0]
    const m = unframe(data, NUMS[type] ?? 0)
    if (!m) return
    const { key } = await this.keys
    switch (type) {
      case T.WELCOME: {
        const w = jsonOf<Welcome>(m.rest)
        if (!w) return
        this.me = w.you
        this.peers = new Set(w.peers)
        this.o.onPeers?.([...this.peers])
        return
      }
      case T.LOG: {
        const n = m.nums[0]
        if (n <= this.have) return
        const plain = await open(key, m.rest)
        // not openable with this room's key: someone else's junk, skipped (the log goes on)
        if (plain) Y.applyUpdate(this.doc, plain, REMOTE)
        this.have = n
        this.o.onHave?.(n)
        return
      }
      case T.SYNCED: {
        // what was made offline goes now, then everyone sees where this person is
        for (const u of this.unacked) this.send(frame(T.UPDATE, [], u))
        this.setStatus('live')
        this.onAware({ added: [this.doc.clientID], updated: [], removed: [] }, 'local')
        return
      }
      case T.ACK: {
        this.unacked.shift()
        if (m.nums[0] === this.have + 1) {
          this.have = m.nums[0]
          this.o.onHave?.(this.have)
        }
        return
      }
      case T.AWARE: {
        const plain = await open(key, m.rest)
        if (plain) awarenessProtocol.applyAwarenessUpdate(this.awareness, plain, REMOTE)
        return
      }
      case T.SIGNAL: {
        const plain = await open(key, m.rest)
        if (plain) this.o.onSignal?.(m.nums[0], plain)
        return
      }
      case T.PEER: {
        const p = jsonOf<PeerEvent>(m.rest)
        if (p?.join) this.peers.add(p.join)
        if (p?.leave) this.peers.delete(p.leave)
        this.o.onPeers?.([...this.peers])
        // someone new: they need to see this person's cursor without waiting for it to move
        if (p?.join) this.onAware({ added: [this.doc.clientID], updated: [], removed: [] }, 'local')
        return
      }
      case T.COMPACT: {
        // the whole document, as of what this client has applied, in place of the log up to there
        if (this.have < 1) return
        const snap = await seal(key, Y.encodeStateAsUpdate(this.doc))
        this.send(frame(T.SNAPSHOT, [this.have], snap))
        return
      }
    }
  }

  private onLocal = (update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE) return
    void this.keys.then(async ({ key }) => {
      const sealed = await seal(key, update)
      this.unacked.push(sealed)
      if (this.status === 'live') this.send(frame(T.UPDATE, [], sealed))
    })
  }

  private onAware = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ): void => {
    if (origin === REMOTE) return
    const ids = [...changes.added, ...changes.updated, ...changes.removed]
    if (!ids.includes(this.doc.clientID) || this.status !== 'live') return
    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
    void this.keys.then(async ({ key }) => this.send(frame(T.AWARE, [0], await seal(key, update))))
  }
}
