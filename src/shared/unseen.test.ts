import { describe, expect, test } from 'bun:test'
import { unseenShim } from './unseen'

/**
 * A stand-in page: `state` is what Chromium says, `fire()` is Chromium's visibilitychange (through the window's
 * capture listeners first, then the document, unless stopped), `tick()` a rendered frame (only while visible).
 */
function page(): {
  win: Record<string, unknown> & EventTarget
  doc: Document
  set: (s: 'visible' | 'hidden') => void
  hold: (on: boolean, shown?: boolean) => void
  heard: string[]
  tick: () => void
  io: { fire: (n: number) => void; seen: number[] }
} {
  let state = 'visible'
  class FakeDocument extends EventTarget {}
  Object.defineProperty(FakeDocument.prototype, 'visibilityState', {
    configurable: true,
    get: () => state
  })
  Object.defineProperty(FakeDocument.prototype, 'hidden', {
    configurable: true,
    get: () => state === 'hidden'
  })
  const doc = new FakeDocument() as unknown as Document
  const win = new EventTarget() as Record<string, unknown> & EventTarget
  let rafs: Array<[number, (t: number) => void]> = []
  let rafSeq = 0
  const observers: Array<(e: unknown[], o: unknown) => void> = []
  class FakeIO {
    constructor(cb: (e: unknown[], o: unknown) => void) {
      observers.push(cb)
    }
  }
  Object.assign(win, {
    Document: FakeDocument,
    document: doc,
    requestAnimationFrame: (cb: (t: number) => void) => (rafs.push([++rafSeq, cb]), rafSeq),
    cancelAnimationFrame: (id: number) => (rafs = rafs.filter(([i]) => i !== id)),
    IntersectionObserver: FakeIO
  })
  let holder: (on: boolean, shown?: boolean) => void = () => undefined
  unseenShim({ onHold: (cb) => (holder = cb) }, win as unknown as typeof globalThis)
  const heard: string[] = []
  doc.addEventListener('visibilitychange', () => heard.push(doc.visibilityState))
  const fire = (): void => {
    const e = new Event('visibilitychange')
    let stopped = false
    const stop = e.stopImmediatePropagation.bind(e)
    e.stopImmediatePropagation = () => ((stopped = true), stop())
    win.dispatchEvent(e)
    if (!stopped) doc.dispatchEvent(new Event('visibilitychange'))
  }
  const seen: number[] = []
  const IO = win.IntersectionObserver as new (cb: (e: number[]) => void) => object
  const obs = new IO((e) => seen.push(...e))
  return {
    win,
    doc,
    set: (s) => {
      state = s
      fire()
    },
    hold: (on, shown) => holder(on, shown),
    heard,
    tick: () => {
      if (state !== 'visible') return
      const due = rafs
      rafs = []
      for (const [, cb] of due) cb(1)
    },
    io: { fire: (n) => observers[0].call(obs, [n], obs), seen }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('unseenShim', () => {
  test('passes everything through when not held', () => {
    const p = page()
    p.set('hidden')
    p.set('visible')
    expect(p.heard).toEqual(['hidden', 'visible'])
    let ran = 0
    ;(p.win.requestAnimationFrame as (cb: () => void) => number)(() => ran++)
    p.tick()
    expect(ran).toBe(1)
    p.io.fire(1)
    expect(p.io.seen).toEqual([1])
  })

  test('a page painted out of sight and hidden again never learns it was shown', async () => {
    const p = page()
    p.set('hidden')
    p.heard.length = 0
    let ran = 0
    ;(p.win.requestAnimationFrame as (cb: () => void) => number)(() => ran++)
    p.hold(true)
    p.set('visible') // shown in the corner
    expect(p.doc.visibilityState).toBe('hidden')
    expect(p.doc.hidden).toBe(true)
    p.tick()
    p.io.fire(7)
    expect(ran).toBe(0)
    expect(p.io.seen).toEqual([])
    // released before Chromium's hiding reaches the page
    p.hold(false, false)
    expect(p.doc.visibilityState).toBe('hidden')
    p.set('hidden')
    expect(p.heard).toEqual([]) // no event at all: it never saw a change
    expect(p.doc.visibilityState).toBe('hidden')
    // shown for real later: what waited runs then
    p.set('visible')
    expect(p.heard).toEqual(['visible'])
    await sleep(5)
    p.tick()
    expect(ran).toBe(1)
    expect(p.io.seen).toEqual([7])
  })

  test('hidden before the release arrives', () => {
    const p = page()
    p.set('hidden')
    p.heard.length = 0
    p.hold(true)
    p.set('visible')
    p.set('hidden')
    p.hold(false, false)
    expect(p.heard).toEqual([])
    p.set('visible')
    expect(p.heard).toEqual(['visible'])
  })

  test('opened while held: told it is shown, and what waited runs', () => {
    const p = page()
    p.set('hidden')
    p.heard.length = 0
    let ran = 0
    p.hold(true)
    p.set('visible')
    ;(p.win.requestAnimationFrame as (cb: () => void) => number)(() => ran++)
    p.tick()
    p.io.fire(3)
    p.hold(false, true)
    expect(p.doc.visibilityState).toBe('visible')
    expect(p.heard).toEqual(['visible'])
    expect(p.io.seen).toEqual([3])
    p.tick()
    expect(ran).toBe(1)
  })

  test('cancelAnimationFrame still cancels a frame that waited', () => {
    const p = page()
    let ran = 0
    const raf = p.win.requestAnimationFrame as (cb: () => void) => number
    p.hold(true)
    const id = raf(() => ran++)
    p.tick()
    ;(p.win.cancelAnimationFrame as (id: number) => void)(id)
    p.hold(false, true)
    p.tick()
    expect(ran).toBe(0)
  })

  test('a release whose hiding never comes shows the page after a while', async () => {
    const p = page()
    p.set('hidden')
    p.heard.length = 0
    p.hold(true)
    p.set('visible')
    p.hold(false, false)
    expect(p.doc.visibilityState).toBe('hidden')
    await sleep(2100)
    expect(p.doc.visibilityState).toBe('visible')
    expect(p.heard).toEqual(['visible'])
  })
})
