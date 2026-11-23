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
