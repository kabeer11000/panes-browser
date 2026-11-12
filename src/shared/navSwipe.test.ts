import { describe, expect, test } from 'bun:test'
import { HISTORY_MM, NavSwipe, TAB_MM, type NavEvent, type NavFrame } from './navSwipe'

const PAD = 100

/** Two fingers down at x, moved `steps` times by (dx, dy), then lifted: the events, in order. */
function swipe(x: number, dx: number, dy = 0, steps = 10, g = new NavSwipe()): NavEvent[] {
  const out: NavEvent[] = []
  const feed = (f: NavFrame): void => {
    const e = g.touch(f)
    if (e) out.push(e)
  }
  feed({ dx: 0, dy: 0, fingers: 2, x, y: 30, padW: PAD })
  for (let i = 0; i < steps; i++)
    feed({ dx, dy, fingers: 2, x: x + dx * (i + 1), y: 30, padW: PAD })
  feed({ dx: 0, dy: 0, fingers: 0, x: 0, y: 0, padW: PAD })
  return out
}
const last = (e: NavEvent[]): NavEvent | undefined => e.at(-1)
const at = (x: number, dx = 0, fingers = 2): NavFrame => ({
  dx,
  dy: 0,
  fingers,
  x,
  y: 30,
  padW: PAD
})

describe('NavSwipe history', () => {
  test('a long swipe right goes back on lift; left goes forward', () => {
    expect(last(swipe(50, 5))).toEqual({ kind: 'commit', action: 'back' })
    expect(last(swipe(50, -5))).toEqual({ kind: 'commit', action: 'forward' })
  })
  test('follows the fingers: progress rises to 1', () => {
    const p = swipe(50, 5).flatMap((e) => (e.kind === 'track' ? [e.progress] : []))
    for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThanOrEqual(p[i - 1])
    expect(p.at(-1)).toBe(1)
  })
  test('too short: shown, then let go', () => {
    expect(last(swipe(50, 2))).toEqual({ kind: 'cancel' })
  })
  test('a small sideways move shows nothing (the page may be scrolling)', () => {
    expect(swipe(50, 0.5)).toEqual([])
  })
  test('a vertical scroll never becomes one', () => {
    expect(swipe(50, 1, 6)).toEqual([])
  })
  test('sliding back before lifting takes it back', () => {
    const g = new NavSwipe()
    g.touch(at(50))
    for (let i = 0; i < 10; i++) g.touch(at(50, 5))
    for (let i = 0; i < 6; i++) g.touch(at(50, -5))
    expect(g.touch(at(0, 0, 0))).toEqual({ kind: 'cancel' })
  })
  test('off in settings: nothing', () => {
    const g = new NavSwipe()
    g.history = false
    expect(swipe(50, 5, 0, 10, g)).toEqual([])
  })
})

describe('NavSwipe tabs', () => {
  test('in from the left edge: previous tab; from the right: next', () => {
    expect(last(swipe(2, 3))).toEqual({ kind: 'commit', action: 'prevTab' })
    expect(last(swipe(PAD - 2, -3))).toEqual({ kind: 'commit', action: 'nextTab' })
  })
  test('it takes TAB_MM, less than a history step', () => {
    expect(TAB_MM).toBeLessThan(HISTORY_MM)
    expect(last(swipe(2, TAB_MM / 10 - 0.5))).toEqual({ kind: 'cancel' })
  })
  test('outward from an edge is not a tab switch', () => {
    expect(swipe(2, -3).some((e) => e.kind === 'commit')).toBe(false)
  })
  test('tabs off: an edge swipe is an ordinary history swipe', () => {
    const g = new NavSwipe()
    g.tabs = false
    expect(last(swipe(2, 5, 0, 10, g))).toEqual({ kind: 'commit', action: 'back' })
  })
  test('a third finger calls it off', () => {
    const g = new NavSwipe()
    g.touch(at(2))
    for (let i = 0; i < 10; i++) g.touch(at(2, 3))
    expect(g.touch(at(30, 0, 3))).toEqual({ kind: 'cancel' })
  })
})

describe('NavSwipe edges', () => {
  test('two fingers side by side count as at the edge when the outer one is', () => {
    const g = new NavSwipe()
    const out: NavEvent[] = []
    const f = (x: number, dx: number, fingers = 2): void => {
      const e = g.touch({ dx, dy: 0, fingers, x: x + 9, y: 30, padW: PAD, xMin: x, xMax: x + 18 })
      if (e) out.push(e)
    }
    f(2, 0)
    for (let i = 1; i <= 8; i++) f(2 + i * 4, 4)
    f(0, 0, 0)
    expect(out.at(-1)).toEqual({ kind: 'commit', action: 'prevTab' })
  })
})
