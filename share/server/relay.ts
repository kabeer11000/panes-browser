/**
 * The shared spaces relay (tasks/shared-spaces.md): rooms of people editing one board. It keeps each room's log of
 * sealed changes and passes changes, cursors and WebRTC signals between the people in it. It cannot read any of it:
 * everything is encrypted with a key from the invite link's secret, which never reaches it.
 *
 * A room is made by the first person to come with its token; after that the token must match (only its hash is
 * kept). Rooms nobody has opened for ROOM_DAYS are deleted.
 *
 * Run: bun share/server/relay.ts   (PORT, DATA_DIR, WEB_DIR from the environment)
 */
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'fs'
import { join } from 'path'
import type { ServerWebSocket } from 'bun'
import {
  COMPACT_AFTER,
  frame,
  jsonFrame,
  MAX_BLOB,
  MAX_MESSAGE,
  MAX_PEERS,
  NUMS,
  T,
  unframe,
  type Welcome
} from '../../src/shared/share/wire'

const ROOM_DAYS = 90
const ROOM_RE = /^[A-Za-z0-9_-]{16,64}$/
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
/** Changes one person may send a second, on average (a drag sends many; a burst is allowed). */
const RATE = 60
const BURST = 240

export interface RelayOptions {
  port: number
  dataDir: string
  /** The built web board (share/web/dist): served at /s/<room>. */
  webDir?: string
}

interface Conn {
  room: string
  id: number
  tokens: number
  at: number
}

const sha256 = (s: string): string => new Bun.CryptoHasher('sha256').update(s).digest('hex')

export function startRelay(o: RelayOptions): { stop: () => void; port: number } {
  mkdirSync(o.dataDir, { recursive: true })
  const db = new Database(join(o.dataDir, 'share.db'), { create: true })
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, token TEXT NOT NULL, made INTEGER, used INTEGER);
    CREATE TABLE IF NOT EXISTS log (room TEXT, n INTEGER, data BLOB, PRIMARY KEY (room, n));
    CREATE TABLE IF NOT EXISTS blobs (room TEXT, id TEXT, data BLOB, PRIMARY KEY (room, id));
  `)
  const q = {
    room: db.query<{ token: string }, [string]>('SELECT token FROM rooms WHERE id = ?'),
    make: db.query('INSERT INTO rooms (id, token, made, used) VALUES (?, ?, ?, ?)'),
    touch: db.query('UPDATE rooms SET used = ? WHERE id = ?'),
    last: db.query<{ n: number | null }, [string]>('SELECT MAX(n) AS n FROM log WHERE room = ?'),
    count: db.query<{ c: number }, [string]>('SELECT COUNT(*) AS c FROM log WHERE room = ?'),
    append: db.query('INSERT INTO log (room, n, data) VALUES (?, ?, ?)'),
    since: db.query<{ n: number; data: Uint8Array }, [string, number]>(
      'SELECT n, data FROM log WHERE room = ? AND n > ? ORDER BY n'
    ),
    cut: db.query('DELETE FROM log WHERE room = ? AND n <= ?'),
    putBlob: db.query('INSERT OR REPLACE INTO blobs (room, id, data) VALUES (?, ?, ?)'),
    getBlob: db.query<{ data: Uint8Array }, [string, string]>(
      'SELECT data FROM blobs WHERE room = ? AND id = ?'
    ),
    old: db.query<{ id: string }, [number]>('SELECT id FROM rooms WHERE used < ?')
  }

  /** Whether a token may be in a room; a room not seen before is made for it. */
  function admit(room: string, token: string): boolean {
    if (!ROOM_RE.test(room) || !TOKEN_RE.test(token)) return false
    const row = q.room.get(room)
    const now = Date.now()
    if (!row) {
      q.make.run(room, sha256(token), now, now)
      return true
    }
    if (row.token !== sha256(token)) return false
    q.touch.run(now, room)
    return true
  }

  // who is in each room now
  const rooms = new Map<string, Map<number, ServerWebSocket<Conn>>>()
  let nextId = 1
  const others = (c: Conn): ServerWebSocket<Conn>[] =>
    [...(rooms.get(c.room)?.entries() ?? [])].filter(([id]) => id !== c.id).map(([, ws]) => ws)

  function sweep(): void {
    const before = Date.now() - ROOM_DAYS * 86400_000
    for (const { id } of q.old.all(before)) {
      if (rooms.has(id)) continue
      db.query('DELETE FROM log WHERE room = ?').run(id)
      db.query('DELETE FROM blobs WHERE room = ?').run(id)
      db.query('DELETE FROM rooms WHERE id = ?').run(id)
    }
  }
  const sweeper = setInterval(sweep, 3600_000)

  const server = Bun.serve<Conn, undefined>({
    port: o.port,
    async fetch(req, srv) {
      const url = new URL(req.url)
      const parts = url.pathname.split('/').filter(Boolean)
      if (url.pathname === '/health') return new Response('ok')
      // the WebSocket of a room
      if (parts[0] === 'sync' && parts.length === 2) {
        const room = parts[1]
        const token = url.searchParams.get('token') ?? ''
        if (!admit(room, token)) return new Response('not allowed', { status: 403 })
        if ((rooms.get(room)?.size ?? 0) >= MAX_PEERS)
          return new Response('room full', { status: 429 })
        const ok = srv.upgrade(req, { data: { room, id: nextId++, tokens: BURST, at: Date.now() } })
        return ok ? undefined : new Response('a WebSocket is expected', { status: 400 })
      }
      // pictures: sealed bytes in, sealed bytes out, by their hash
      if (parts[0] === 'blob' && parts.length >= 2) {
        const room = parts[1]
        const token = req.headers.get('x-token') ?? url.searchParams.get('token') ?? ''
        if (!admit(room, token)) return new Response('not allowed', { status: 403 })
        if (req.method === 'POST' && parts.length === 2) {
          const body = new Uint8Array(await req.arrayBuffer())
          if (body.length === 0 || body.length > MAX_BLOB)
            return new Response('too big', { status: 413 })
          const id = sha256(Buffer.from(body).toString('base64')).slice(0, 32)
          q.putBlob.run(room, id, body)
          return Response.json({ id })
        }
        if (req.method === 'GET' && parts.length === 3) {
          const row = q.getBlob.get(room, parts[2])
          return row
            ? new Response(row.data, {
                headers: {
                  'content-type': 'application/octet-stream',
                  'cache-control': 'private, max-age=31536000, immutable'
                }
              })
            : new Response('not found', { status: 404 })
        }
      }
      // the web board for people without Panes
      if (o.webDir && (parts[0] === 's' || url.pathname === '/' || parts[0] === 'assets')) {
        const path = parts[0] === 'assets' ? join(o.webDir, ...parts) : join(o.webDir, 'index.html')
        const file = Bun.file(path)
        if (await file.exists()) return new Response(file)
      }
      return new Response('not found', { status: 404 })
    },
    websocket: {
      maxPayloadLength: MAX_MESSAGE,
      open(ws) {
        const c = ws.data
        let peers = rooms.get(c.room)
        if (!peers) rooms.set(c.room, (peers = new Map()))
        const welcome: Welcome = { you: c.id, peers: [...peers.keys()] }
        peers.set(c.id, ws)
        ws.send(jsonFrame(T.WELCOME, welcome))
        for (const p of others(c)) p.send(jsonFrame(T.PEER, { join: c.id }))
      },
      message(ws, raw) {
        const c = ws.data
        if (typeof raw === 'string') {
          // the first message after joining: which log entries this client still needs
          const m = /^have:(\d+)$/.exec(raw)
          if (!m) return
          for (const e of q.since.all(c.room, Number(m[1]))) ws.send(frame(T.LOG, [e.n], e.data))
          ws.send(frame(T.SYNCED, []))
          return
        }
        // a rate per person: a burst (a drag) is fine, a flood is cut off
        const now = Date.now()
        c.tokens = Math.min(BURST, c.tokens + ((now - c.at) / 1000) * RATE)
        c.at = now
        if (c.tokens < 1) return ws.close(1008, 'too fast')
        c.tokens--
        const data = new Uint8Array(raw)
        const type = data[0]
        const m = unframe(data, NUMS[type] ?? 0)
        if (!m) return
        if (type === T.UPDATE && m.rest.length > 0) {
          const n = (q.last.get(c.room)?.n ?? 0) + 1
          q.append.run(c.room, n, m.rest)
          ws.send(frame(T.ACK, [n]))
          for (const p of others(c)) p.send(frame(T.LOG, [n], m.rest))
          if (n % 50 === 0 && (q.count.get(c.room)?.c ?? 0) > COMPACT_AFTER)
            ws.send(frame(T.COMPACT, []))
        } else if (type === T.AWARE) {
          // a client sends AWARE with a 0 where the sender goes
          for (const p of others(c)) p.send(frame(T.AWARE, [c.id], m.rest))
        } else if (type === T.SNAPSHOT && m.rest.length > 0) {
          const upTo = m.nums[0]
          const last = q.last.get(c.room)?.n ?? 0
          if (upTo < 1 || upTo > last) return
          db.transaction(() => {
            q.cut.run(c.room, upTo)
            q.append.run(c.room, upTo, m.rest)
          })()
        } else if (type === T.SIGNAL) {
          const to = rooms.get(c.room)?.get(m.nums[0])
          to?.send(frame(T.SIGNAL, [c.id], m.rest))
        }
      },
      close(ws) {
        const c = ws.data
        const peers = rooms.get(c.room)
        peers?.delete(c.id)
        if (peers && peers.size === 0) rooms.delete(c.room)
        for (const p of peers?.values() ?? []) p.send(jsonFrame(T.PEER, { leave: c.id }))
      }
    }
  })

  return {
    port: server.port ?? o.port,
    stop: () => {
      clearInterval(sweeper)
      server.stop(true)
      db.close()
    }
  }
}

if (import.meta.main) {
  const r = startRelay({
    port: Number(process.env.PORT ?? 8787),
    dataDir: process.env.DATA_DIR ?? join(import.meta.dir, '.data'),
    webDir: process.env.WEB_DIR ?? join(import.meta.dir, '..', 'web', 'dist')
  })
  console.log(`relay: listening on ${r.port}`)
}
