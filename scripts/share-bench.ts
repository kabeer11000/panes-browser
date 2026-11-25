/**
 * Shared spaces bench: a relay on this machine and people in a room, timed. Run: bun scripts/share-bench.ts
 *
 * What it checks (and fails on): a change reaches the other side, quickly; a burst of changes (a drag) all arrive; a
 * late joiner gets the whole board; pictures go up and come back; a relay restart loses nothing, including changes
 * made while it was down; three people typing at once end the same.
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as Y from 'yjs'
import { ShareClient, type ShareStatus } from '../src/shared/share/client'
import { newRoom } from '../src/shared/share/crypto'
import { startRelay } from '../share/server/relay'

const dir = mkdtempSync(join(tmpdir(), 'panes-share-bench-'))
let relay = startRelay({ port: 0, dataDir: dir })
const port = relay.port
const url = `http://127.0.0.1:${port}`
let failed = 0

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function until(ok: () => boolean, what: string, ms = 15_000): Promise<number> {
  const t0 = performance.now()
  while (!ok()) {
    if (performance.now() - t0 > ms) throw new Error(`timed out: ${what}`)
    await sleep(1)
  }
  return performance.now() - t0
}
const pct = (xs: number[], p: number): number =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))]
const ms = (n: number): string => `${n.toFixed(1)} ms`

function person(room: { room: string; secret: string }): {
  c: ShareClient
  doc: Y.Doc
  status: () => ShareStatus
} {
  const doc = new Y.Doc()
  let st: ShareStatus = 'connecting'
  const c = new ShareClient({
    relay: url,
    room: room.room,
    secret: room.secret,
    doc,
    onStatus: (s) => (st = s)
  })
  return { c, doc, status: () => st }
}

async function check(name: string, run: () => Promise<string>): Promise<void> {
  try {
    console.log(`ok    ${name}: ${await run()}`)
  } catch (e) {
    failed++
    console.log(`FAIL  ${name}: ${e instanceof Error ? e.message : e}`)
  }
}

const room = newRoom()
const a = person(room)
const b = person(room)
const cards = (d: Y.Doc): Y.Map<unknown> => d.getMap('cards')

await check('both live', async () => {
  const t = await until(() => a.status() === 'live' && b.status() === 'live', 'live')
  return ms(t)
})

await check('one change, one way (200 in turn)', async () => {
  const lat: number[] = []
  for (let i = 0; i < 200; i++) {
    const t0 = performance.now()
    cards(a.doc).set('c1', { x: i, y: i })
    await until(() => (cards(b.doc).get('c1') as { x: number } | undefined)?.x === i, `move ${i}`)
    lat.push(performance.now() - t0)
  }
  if (pct(lat, 95) > 100) throw new Error(`p95 ${ms(pct(lat, 95))} over 100 ms`)
  return `p50 ${ms(pct(lat, 50))}, p95 ${ms(pct(lat, 95))}, max ${ms(Math.max(...lat))}`
})

await check('a drag: 600 moves as fast as they come', async () => {
  const t0 = performance.now()
  for (let i = 0; i < 600; i++) cards(a.doc).set('drag', { x: i })
  const t = await until(
    () => (cards(b.doc).get('drag') as { x: number } | undefined)?.x === 599,
    'last move arrives',
    30_000
  )
  return `sent in ${ms(performance.now() - t0 - t)}, last arrived after ${ms(t)}`
})

await check('a late joiner gets the whole board (2000 cards)', async () => {
  a.doc.transact(() => {
    for (let i = 0; i < 2000; i++) cards(a.doc).set(`k${i}`, { x: i, title: 'Card ' + i })
  })
  await until(() => cards(b.doc).size >= 2002, 'b has them')
  const t0 = performance.now()
  const late = person(room)
  await until(() => late.status() === 'live' && cards(late.doc).size >= 2002, 'late joiner synced')
  const t = performance.now() - t0
  late.c.destroy()
  if (t > 3000) throw new Error(`took ${ms(t)}`)
  return ms(t)
})

await check('pictures: 40 x 40 KB up and back', async () => {
  const pic = crypto.getRandomValues(new Uint8Array(40 * 1024))
  const t0 = performance.now()
  const ids = await Promise.all(Array.from({ length: 40 }, () => a.c.putBlob(pic)))
  const up = performance.now() - t0
  if (ids.some((x) => !x)) throw new Error('a picture did not go up')
  const t1 = performance.now()
  const back = await Promise.all(ids.map((id) => b.c.getBlob(id!)))
  const down = performance.now() - t1
  if (back.some((x) => !x || x.length !== pic.length || x[0] !== pic[0]))
    throw new Error('a picture came back wrong')
  return `up ${ms(up)}, down ${ms(down)}`
})

await check('cursors (awareness) cross', async () => {
  const t0 = performance.now()
  a.c.awareness.setLocalStateField('cursor', { x: 10, y: 20 })
  await until(
    () =>
      [...b.c.awareness.getStates().values()].some(
        (s) => (s as { cursor?: { x: number } }).cursor?.x === 10
      ),
    'cursor seen'
  )
  return ms(performance.now() - t0)
})

await check('the relay restarts: nothing lost, offline edits merge', async () => {
  relay.stop()
  await until(() => a.status() !== 'live' && b.status() !== 'live', 'both notice', 20_000)
  // both keep working while it is down
  cards(a.doc).set('offA', 1)
  cards(b.doc).set('offB', 2)
  relay = startRelay({ port, dataDir: dir })
  a.c.reconnectNow()
  b.c.reconnectNow()
  const t = await until(
    () => cards(a.doc).get('offB') === 2 && cards(b.doc).get('offA') === 1,
    'offline edits cross',
    30_000
  )
  return `merged ${ms(t)} after the relay came back`
})

await check('three people typing at once end the same', async () => {
  const c = person(room)
  await until(() => c.status() === 'live' && cards(c.doc).size >= 2004, 'third synced')
  const text = (d: Y.Doc): string => d.getText('t').toString()
  for (let i = 0; i < 50; i++) {
    a.doc.getText('t').insert(0, 'a')
    b.doc.getText('t').insert(0, 'b')
    c.doc.getText('t').insert(0, 'c')
  }
  const t = await until(
    () => text(a.doc).length === 150 && text(a.doc) === text(b.doc) && text(b.doc) === text(c.doc),
    'converged'
  )
  c.c.destroy()
  return ms(t)
})

a.c.destroy()
b.c.destroy()
relay.stop()
rmSync(dir, { recursive: true, force: true })
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
