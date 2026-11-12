import { describe, expect, test } from 'bun:test'
import { EdgeSwipe, SWIPE_ZONES, type PadFrame } from './edgeSwipe'

const EDGE_MM = SWIPE_ZONES.edge.edgeMm
const TRAVEL_MM = SWIPE_ZONES.edge.travelMm

/** Two fingers landing at `y`, then `steps` moves of (dx, dy) each, then lifting; the frames that fired. */
function swipe(y: number, dx: number, dy: number, steps = 10): number[] {
  const g = new EdgeSwipe()
  const frames: PadFrame[] = [
    { dx: 0, dy: 0, fingers: 2, y },
    ...Array.from({ length: steps }, (_, i) => ({ dx, dy, fingers: 2, y: y + dy * (i + 1) })),
    { dx: 0, dy: 0, fingers: 0, y: 0 }
  ]
  return frames.flatMap((f, i) => (g.touch(f) ? [i] : []))
}

describe('EdgeSwipe', () => {
  test('fires once, when two fingers from the top edge have slid far enough down', () => {
    const step = TRAVEL_MM / 4
    expect(swipe(1, 0, step)).toEqual([4])
  })
  test('not from the middle of the pad: that is a scroll', () => {
    expect(swipe(EDGE_MM + 5, 0, 5)).toEqual([])
  })
  test('not when it goes up, or sideways', () => {
    expect(swipe(1, 0, -3)).toEqual([])
    expect(swipe(1, 8, 3)).toEqual([])
  })
  test('not with one finger or three', () => {
    const g = new EdgeSwipe()
    for (const fingers of [1, 3]) {
      g.touch({ dx: 0, dy: 0, fingers: 0, y: 0 })
      g.touch({ dx: 0, dy: 0, fingers, y: 1 })
      for (let i = 0; i < 10; i++) expect(g.touch({ dx: 0, dy: 5, fingers, y: 1 })).toBe(false)
    }
  })
  test('a third finger joining calls it off', () => {
    const g = new EdgeSwipe()
    g.touch({ dx: 0, dy: 0, fingers: 2, y: 1 })
    g.touch({ dx: 0, dy: 5, fingers: 3, y: 6 })
    expect(g.touch({ dx: 0, dy: 30, fingers: 2, y: 36 })).toBe(false)
  })
  test('lifting and landing again at the edge starts afresh', () => {
    const g = new EdgeSwipe()
    g.touch({ dx: 0, dy: 0, fingers: 2, y: 30 }) // a scroll
    g.touch({ dx: 0, dy: 0, fingers: 0, y: 0 })
    g.touch({ dx: 0, dy: 0, fingers: 2, y: 1 })
    expect(g.touch({ dx: 0, dy: TRAVEL_MM, fingers: 2, y: 1 + TRAVEL_MM })).toBe(true)
  })
})

describe('EdgeSwipe zones', () => {
  test('an ordinary scroll starting 5 mm in: not on "edge", but on "easy"', () => {
    const run = (zone: (typeof SWIPE_ZONES)['edge']): boolean => {
      const g = new EdgeSwipe()
      g.zone = zone
      g.touch({ dx: 0, dy: 0, fingers: 2, y: 5 })
      let fired = false
      for (let i = 0; i < 10; i++) fired ||= g.touch({ dx: 0, dy: 4, fingers: 2, y: 5 + 4 * i })
      return fired
    }
    expect(run(SWIPE_ZONES.edge)).toBe(false)
    expect(run(SWIPE_ZONES.easy)).toBe(true)
  })
})
