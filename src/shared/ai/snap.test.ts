import { describe, expect, test } from 'bun:test'
import { keepAspect, SNAP_GRID, snapAngle, snapBox } from './snap'

describe('snapBox', () => {
  const other = { x: 0, y: 0, w: 200, h: 100 }
  test('lines a left edge up with another left edge within the threshold, with a guide over both', () => {
    const s = snapBox({ x: 5, y: 300, w: 100, h: 100 }, [other], { threshold: 8, grid: 0 })
    expect(s.dx).toBe(-5)
    const g = s.guides.find((x) => x.axis === 'x' && x.at === 0)!
    expect(g).toBeDefined()
    expect(g.from).toBe(0)
    expect(g.to).toBe(400)
    // the gap between them is measured across the line
    expect(s.gaps[0]).toMatchObject({ axis: 'y', from: 100, to: 300 })
  })
  test('centres line up too', () => {
    const s = snapBox({ x: 400, y: 3, w: 100, h: 100 }, [other], { threshold: 8 })
    expect(s.dy).toBe(-3)
    const t = snapBox({ x: 400, y: 0, w: 60, h: 60 }, [{ x: 0, y: 0, w: 100, h: 100 }], {
      threshold: 8,
      grid: 0
    })
    expect(t.dy).toBe(0)
    const c = snapBox({ x: 400, y: 22, w: 60, h: 60 }, [{ x: 0, y: 0, w: 100, h: 100 }], {
      threshold: 8,
      grid: 0
    })
    expect(c.dy).toBe(-2) // centre 52 -> 50
  })
  test('nothing near: the corner goes to the grid, and no guides', () => {
    const s = snapBox({ x: 1000 + 10, y: 1000 - 9, w: 50, h: 50 }, [other], { threshold: 4 })
    expect((1010 + s.dx) % SNAP_GRID).toBe(0)
    expect((991 + s.dy) % SNAP_GRID).toBe(0)
    expect(s.guides).toEqual([])
    expect(s.gaps).toEqual([])
  })
  test('without boxes or grid it does not move', () => {
    expect(snapBox({ x: 3, y: 4, w: 5, h: 6 }, [], { threshold: 8, grid: 0 })).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
      gaps: []
    })
  })
})

describe('snapAngle and keepAspect', () => {
  test('keeps to 45 degree steps', () => {
    expect(snapAngle({ x: 0, y: 0 }, { x: 100, y: 7 })).toEqual({ x: 100, y: 0 })
    const d = snapAngle({ x: 0, y: 0 }, { x: 100, y: 90 })
    expect(d.x).toBeCloseTo(d.y)
    expect(snapAngle({ x: 10, y: 10 }, { x: 12, y: 200 })).toEqual({ x: 10, y: 200 })
  })
  test('a resize keeps the proportions from its fixed corner', () => {
    const b = keepAspect(
      { x: 0, y: 0, w: 200, h: 100 },
      { x: 0, y: 0, w: 300, h: 100 },
      {
        x: 0,
        y: 0
      }
    )
    expect(b).toEqual({ x: 0, y: 0, w: 300, h: 150 })
    const up = keepAspect(
      { x: 0, y: 0, w: 200, h: 100 },
      { x: -100, y: -50, w: 300, h: 50 },
      {
        x: 200,
        y: 100
      }
    )
    expect(up).toEqual({ x: -100, y: -50, w: 300, h: 150 })
  })
})

describe('even spacing', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 }
  const c = { x: 400, y: 0, w: 100, h: 100 }
  test('a box near the middle of two neighbours snaps to equal gaps, with both gaps to draw', () => {
    // gaps of 95 and 105: moved by 5 to sit at 150, gaps of 100 each
    const s = snapBox({ x: 195, y: 3, w: 100, h: 100 }, [a, c], { threshold: 8, grid: 0 })
    expect(s.dx).toBe(5)
    const even = s.gaps.filter((g) => g.even)
    expect(even.map((g) => g.to - g.from)).toEqual([100, 100])
    expect(even.every((g) => g.axis === 'x')).toBe(true)
  })
  test('far from even, or not between two, no hint', () => {
    expect(
      snapBox({ x: 120, y: 3, w: 100, h: 100 }, [a, c], { threshold: 8, grid: 0 }).gaps.some(
        (g) => g.even
      )
    ).toBe(false)
    expect(
      snapBox({ x: 195, y: 300, w: 100, h: 100 }, [a, c], { threshold: 8, grid: 0 }).gaps.some(
        (g) => g.even
      )
    ).toBe(false)
  })
  test('down a column too', () => {
    const s = snapBox({ x: 2, y: 190, w: 100, h: 50 }, [a, { x: 0, y: 340, w: 100, h: 100 }], {
      threshold: 8,
      grid: 0
    })
    expect(s.dy).toBe(5)
    expect(s.gaps.filter((g) => g.even).map((g) => g.axis)).toEqual(['y', 'y'])
  })
})
