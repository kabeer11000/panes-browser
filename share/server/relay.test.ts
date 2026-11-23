import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as Y from 'yjs'
import { ShareClient, type ShareStatus } from '../../src/shared/share/client'
import { newRoom, roomKeys } from '../../src/shared/share/crypto'
import { startRelay, STUN_SERVERS } from './relay'

let relay: { stop: () => void; port: number }
let dir: string
let url: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'panes-relay-'))
  relay = startRelay({ port: 0, dataDir: dir })
  url = `http://127.0.0.1:${relay.port}`
})
afterAll(() => {
  relay.stop()
  rmSync(dir, { recursive: true, force: true })
})

/** Waits until `ok()` holds (polling), failing after a while. */
async function until(ok: () => boolean, what: string, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 15))
  }
}

function join_(
  room: { room: string; secret: string },
  have = 0
): { c: ShareClient; doc: Y.Doc; status: () => ShareStatus; have: () => number } {
  const doc = new Y.Doc()
  let st: ShareStatus = 'connecting'
  let h = have
  const c = new ShareClient({
    relay: url,
    room: room.room,
    secret: room.secret,
    doc,
    have,
    onStatus: (s) => (st = s),
    onHave: (n) => (h = n)
  })
  return { c, doc, status: () => st, have: () => h }
}

const text = (d: Y.Doc): string => d.getText('t').toString()

describe('relay + clients', () => {
  test('a change made by one reaches the other, live', async () => {
    const room = newRoom()
    const a = join_(room)
    const b = join_(room)
    await until(() => a.status() === 'live' && b.status() === 'live', 'both live')
    a.doc.getText('t').insert(0, 'hello')
    await until(() => text(b.doc) === 'hello', 'b sees hello')
    b.doc.getText('t').insert(5, ' world')
    await until(() => text(a.doc) === 'hello world', 'a sees world')
    a.c.destroy()
    b.c.destroy()
  })

  test('typing at once on both sides ends the same on both', async () => {
    const room = newRoom()
    const a = join_(room)
    const b = join_(room)
    await until(() => a.status() === 'live' && b.status() === 'live', 'both live')
    for (let i = 0; i < 20; i++) {
      a.doc.getText('t').insert(0, 'a')
      b.doc.getText('t').insert(0, 'b')
    }
    await until(() => text(a.doc).length === 40 && text(a.doc) === text(b.doc), 'converged')
    a.c.destroy()
    b.c.destroy()
  })

  test('someone joining later gets the whole history; with `have` only what they missed', async () => {
    const room = newRoom()
    const a = join_(room)
    await until(() => a.status() === 'live', 'a live')
    a.doc.getText('t').insert(0, 'one')
    a.doc.getText('t').insert(3, ' two')
    await until(() => a.have() >= 2, 'acked')
    const late = join_(room)
    await until(() => text(late.doc) === 'one two', 'late gets history')
    expect(late.have()).toBe(a.have())
    late.c.destroy()
    a.c.destroy()
  })

  test('edits made while away go out when back', async () => {
    const room = newRoom()
    const a = join_(room)
    const b = join_(room)
    await until(() => a.status() === 'live' && b.status() === 'live', 'both live')
    // b drops off the network
    ;(b.c as unknown as { ws: WebSocket }).ws.close()
    await until(() => b.status() !== 'live', 'b offline')
    b.doc.getText('t').insert(0, 'offline edit')
    await until(() => b.status() === 'live', 'b reconnected', 6000)
    await until(() => text(a.doc) === 'offline edit', 'a gets the offline edit')
    a.c.destroy()
    b.c.destroy()
  })

  test('cursors and presence reach the others, and are never stored', async () => {
    const room = newRoom()
    const a = join_(room)
    const b = join_(room)
    await until(() => a.status() === 'live' && b.status() === 'live', 'both live')
    a.c.awareness.setLocalStateField('cursor', { x: 10, y: 20 })
    await until(
      () =>
        (b.c.awareness.getStates().get(a.doc.clientID) as { cursor?: { x: number } } | undefined)
          ?.cursor?.x === 10,
      'b sees a cursor'
    )
    a.c.destroy()
    b.c.destroy()
  })

  test('a wrong secret is refused at the door', async () => {
    const room = newRoom()
    const a = join_(room)
    await until(() => a.status() === 'live', 'a live')
    const wrong = join_({ room: room.room, secret: newRoom().secret })
    await until(() => wrong.status() === 'offline' || wrong.status() === 'refused', 'refused')
    expect(text(wrong.doc)).toBe('')
    wrong.c.destroy()
    a.c.destroy()
  })

  test('the relay holds only ciphertext: the words are nowhere in its database', async () => {
    const room = newRoom()
    const a = join_(room)
    await until(() => a.status() === 'live', 'a live')
    a.doc.getText('t').insert(0, 'TOP-SECRET-PLAN')
    await until(() => a.have() >= 1, 'stored')
    const db = new Database(join(dir, 'share.db'), { readonly: true })
    const rows = db.query<{ data: Uint8Array }, []>('SELECT data FROM log').all()
    db.close()
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows)
      expect(Buffer.from(r.data).toString('latin1')).not.toContain('TOP-SECRET-PLAN')
    a.c.destroy()
  })

  test('compaction: a snapshot replaces the log, and a newcomer still gets everything', async () => {
    const room = newRoom()
    const a = join_(room)
    await until(() => a.status() === 'live', 'a live')
    for (let i = 0; i < 30; i++) a.doc.getText('t').insert(0, 'x')
    await until(() => a.have() >= 30, 'all acked')
    // ask a's client to compact, as the relay would
    await (a.c as unknown as { receive: (d: Uint8Array) => Promise<void> }).receive(
      new Uint8Array([9])
    )
    const db = new Database(join(dir, 'share.db'), { readonly: true })
    await until(
      () =>
        (db
          .query<{ c: number }, [string]>('SELECT COUNT(*) AS c FROM log WHERE room = ?')
          .get(room.room)?.c ?? 99) === 1,
      'log compacted'
    )
    db.close()
    const late = join_(room)
    await until(() => text(late.doc) === 'x'.repeat(30), 'newcomer from snapshot')
    late.c.destroy()
    a.c.destroy()
  })

  test('pictures go up and come back as sealed blobs, for room members only', async () => {
    const room = newRoom()
    const { token } = await roomKeys(room.room, room.secret)
    // the room exists once someone has joined it
    const a = join_(room)
    await until(() => a.status() === 'live', 'a live')
    const body = crypto.getRandomValues(new Uint8Array(1000))
    const up = await fetch(`${url}/blob/${room.room}`, {
      method: 'POST',
      headers: { 'x-token': token },
      body
    })
    expect(up.status).toBe(200)
    const { id } = (await up.json()) as { id: string }
    const back = new Uint8Array(
      await (await fetch(`${url}/blob/${room.room}/${id}?token=${token}`)).arrayBuffer()
    )
    expect(back).toEqual(body)
    const denied = await fetch(`${url}/blob/${room.room}/${id}?token=${'A'.repeat(43)}`)
    expect(denied.status).toBe(403)
    a.c.destroy()
  })
})

describe('ICE servers for shared browsing', () => {
  test('room members get STUN when no TURN key is set; strangers and unknown rooms get nothing', async () => {
    const room = newRoom()
    const { token } = await roomKeys(room.room, room.secret)
    const before = await fetch(`${url}/ice/${room.room}`, { headers: { 'x-token': token } })
    expect(before.status).toBe(403) // the room does not exist yet, and asking does not make it
    const a = join_(room)
    await until(() => a.status() === 'live', 'a live')
    const ok = await fetch(`${url}/ice/${room.room}`, { headers: { 'x-token': token } })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { iceServers: unknown }).iceServers).toEqual(STUN_SERVERS)
    const denied = await fetch(`${url}/ice/${room.room}?token=${'A'.repeat(43)}`)
    expect(denied.status).toBe(403)
    a.c.destroy()
  })

  test('with a TURN key: Cloudflare credentials, asked once and shared, port 53 left out, STUN if it fails', async () => {
    const tdir = mkdtempSync(join(tmpdir(), 'panes-relay-turn-'))
    let asked = 0
    let fail = false
    const seen: Array<{ url: string; auth: string | null; body: string }> = []
    const fake = (async (u: string | URL | Request, init?: RequestInit) => {
      asked++
      seen.push({
        url: String(u),
        auth: new Headers(init?.headers).get('authorization'),
        body: String(init?.body)
      })
      if (fail) return new Response('nope', { status: 500 })
      return Response.json(
        {
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
            {
              urls: [
                'turn:turn.cloudflare.com:3478?transport=udp',
                'turn:turn.cloudflare.com:53?transport=udp'
              ],
              username: 'u',
              credential: 'c'
            }
          ]
        },
        { status: 201 }
      )
    }) as typeof fetch
    const r = startRelay({
      port: 0,
      dataDir: tdir,
      turn: { keyId: 'key1', token: 'tok' },
      fetchTurn: fake
    })
    const base = `http://127.0.0.1:${r.port}`
    const room = newRoom()
    const { token } = await roomKeys(room.room, room.secret)
    const doc = new Y.Doc()
    let st: ShareStatus = 'connecting'
    const c = new ShareClient({
      relay: base,
      room: room.room,
      secret: room.secret,
      doc,
      onStatus: (x) => (st = x)
    })
    await until(() => st === 'live', 'live on the TURN relay')
    const ice = async (): Promise<RTCIceServer[]> =>
      (
        (await (
          await fetch(`${base}/ice/${room.room}`, { headers: { 'x-token': token } })
        ).json()) as {
          iceServers: RTCIceServer[]
        }
      ).iceServers
    const [one, two] = await Promise.all([ice(), ice()])
    expect(one).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }
    ])
    expect(two).toEqual(one)
    expect(await ice()).toEqual(one)
    expect(asked).toBe(1)
    expect(seen[0].url).toBe(
      'https://rtc.live.cloudflare.com/v1/turn/keys/key1/credentials/generate-ice-servers'
    )
    expect(seen[0].auth).toBe('Bearer tok')
    expect(JSON.parse(seen[0].body)).toEqual({ ttl: 86400 })
    c.destroy()
    r.stop()
    // a relay whose Cloudflare call fails still answers, with STUN
    fail = true
    const r2 = startRelay({
      port: 0,
      dataDir: tdir,
      turn: { keyId: 'key1', token: 'tok' },
      fetchTurn: fake
    })
    const got = await fetch(`http://127.0.0.1:${r2.port}/ice/${room.room}`, {
      headers: { 'x-token': token }
    })
    expect(((await got.json()) as { iceServers: unknown }).iceServers).toEqual(STUN_SERVERS)
    r2.stop()
    rmSync(tdir, { recursive: true, force: true })
  })
})

describe('limits', () => {
  test('pictures: members of an existing room only, its share kept (oldest out), and not too fast', async () => {
    const tdir = mkdtempSync(join(tmpdir(), 'panes-relay-limits-'))
    const r = startRelay({
      port: 0,
      dataDir: tdir,
      limits: { roomBlobBytes: 3000, blobsPerMinute: 4, newRoomsPerHour: 100 }
    })
    const base = `http://127.0.0.1:${r.port}`
    const room = newRoom()
    const { token } = await roomKeys(room.room, room.secret)
    const up = (n: number): Promise<Response> =>
      fetch(`${base}/blob/${room.room}`, {
        method: 'POST',
        headers: { 'x-token': token },
        body: new Uint8Array(1000).fill(n)
      })
    // no such room yet: refused, and the asking does not make it
    expect((await up(0)).status).toBe(403)
    const doc = new Y.Doc()
    let st: ShareStatus = 'connecting'
    const c = new ShareClient({
      relay: base,
      room: room.room,
      secret: room.secret,
      doc,
      onStatus: (x) => (st = x)
    })
    await until(() => st === 'live', 'live')
    const ids: string[] = []
    for (let i = 1; i <= 4; i++) {
      const res = await up(i)
      expect(res.status).toBe(200)
      ids.push(((await res.json()) as { id: string }).id)
    }
    const get = (id: string): Promise<number> =>
      fetch(`${base}/blob/${room.room}/${id}`, { headers: { 'x-token': token } }).then(
        (x) => x.status
      )
    // 4000 bytes into a 3000 share: the first went
    expect(await get(ids[0])).toBe(404)
    expect(await get(ids[3])).toBe(200)
    // a fifth within the minute is too fast
    expect((await up(5)).status).toBe(429)
    c.destroy()
    r.stop()
    rmSync(tdir, { recursive: true, force: true })
  })

  test('one address makes only so many new rooms an hour; existing rooms still open', async () => {
    const tdir = mkdtempSync(join(tmpdir(), 'panes-relay-rooms-'))
    const r = startRelay({ port: 0, dataDir: tdir, limits: { newRoomsPerHour: 2 } })
    const base = `http://127.0.0.1:${r.port}`
    const knock = async (room: { room: string; secret: string }): Promise<number> => {
      const { token } = await roomKeys(room.room, room.secret)
      // not a WebSocket: past the door it says so (400), at the door it is refused
      return (await fetch(`${base}/sync/${room.room}?token=${token}`)).status
    }
    const first = newRoom()
    expect(await knock(first)).toBe(400)
    expect(await knock(newRoom())).toBe(400)
    expect(await knock(newRoom())).toBe(429)
    expect(await knock(first)).toBe(400)
    r.stop()
    rmSync(tdir, { recursive: true, force: true })
  })
})

describe('usage statistics', () => {
  test('keeps good batches, refuses bad ones, and answers stats only with the key', async () => {
    const udir = mkdtempSync(join(tmpdir(), 'panes-usage-'))
    const r = startRelay({ port: 0, dataDir: udir, statsKey: 'k'.repeat(32) })
    const base = `http://127.0.0.1:${r.port}`
    const send = (b: unknown): Promise<Response> =>
      fetch(`${base}/usage`, {
        method: 'POST',
        body: typeof b === 'string' ? b : JSON.stringify(b)
      })
    const batch = {
      id: 'install-one',
      v: '0.1.0-beta.150',
      os: 'win32 10.0.26300',
      ram: 16,
      boot: 900,
      active: 1800,
      actions: { 'tabs:create': 4 },
      sites: { 'youtube.com': 3600 }
    }
    expect((await send(batch)).status).toBe(204)
    expect(
      (await send({ ...batch, id: 'install-two', boot: undefined, actions: { 'tabs:create': 1 } }))
        .status
    ).toBe(204)
    expect((await send('not json')).status).toBe(400)
    expect((await send({ ...batch, sites: { 'a.com/secret path': 1 } })).status).toBe(400)
    expect((await send('x'.repeat(70_000))).status).toBe(413)
    expect((await fetch(`${base}/usage/stats`)).status).toBe(403)
    expect((await fetch(`${base}/usage/stats`, { headers: { 'x-key': 'wrong' } })).status).toBe(403)
    const s = (await (
      await fetch(`${base}/usage/stats?days=1`, { headers: { 'x-key': 'k'.repeat(32) } })
    ).json()) as Record<string, unknown>
    expect(s.people).toBe(2)
    expect(s.actions).toEqual({ 'tabs:create': 5 })
    expect(s.sitesHours).toEqual({ 'youtube.com': 2 })
    expect(s.activeHours).toBe(1)
    expect(s.bootMs).toEqual({ p50: 900, p90: 900, n: 1 })
    expect(s.versions).toEqual({ '0.1.0-beta.150': 2 })
    // a relay with no key set never shows them
    const r2 = startRelay({ port: 0, dataDir: mkdtempSync(join(tmpdir(), 'panes-usage-')) })
    expect(
      (await fetch(`http://127.0.0.1:${r2.port}/usage/stats`, { headers: { 'x-key': '' } })).status
    ).toBe(403)
    r2.stop()
    r.stop()
    rmSync(udir, { recursive: true, force: true })
  })

  test('one address cannot flood it', async () => {
    const udir = mkdtempSync(join(tmpdir(), 'panes-usage-'))
    const r = startRelay({ port: 0, dataDir: udir })
    const codes: number[] = []
    for (let i = 0; i < 25; i++)
      codes.push(
        (await fetch(`http://127.0.0.1:${r.port}/usage`, { method: 'POST', body: '{}' })).status
      )
    expect(codes.filter((c) => c === 429).length).toBe(5)
    r.stop()
    rmSync(udir, { recursive: true, force: true })
  })
})
