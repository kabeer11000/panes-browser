import { expect, test } from 'bun:test'
import { MAX_SCALE, MIN_SCALE, dotStep, placeGrid } from './gridDots'

test('dot spacing stays between 12 and 48 px', () => {
  for (let k = 0.08; k <= 2.5; k *= 1.07) {
    const ds = dotStep(k)
    expect(ds).toBeGreaterThanOrEqual(12)
    expect(ds).toBeLessThan(48)
  }
})

test('first placement paints; a small zoom only scales; a big one repaints', () => {
  const a = placeGrid(0, 0, 1, NaN, false)
  expect(a.repaint).toBe(true)
  expect(a.scale).toBe(1)
  const b = placeGrid(0, 0, 1.1, a.painted, false)
  expect(b.repaint).toBe(false)
  expect(b.scale).toBeCloseTo(1.1)
  const c = placeGrid(0, 0, 1.5, a.painted, false)
  expect(c.repaint).toBe(true)
  expect(c.scale).toBe(1)
})

test('scale never leaves its range mid-gesture', () => {
  let painted = NaN
  for (let k = 0.08; k <= 2.5; k *= 1.01) {
    const g = placeGrid(37, -91, k, painted, false)
    painted = g.painted
    expect(g.scale).toBeGreaterThanOrEqual(MIN_SCALE)
    expect(g.scale).toBeLessThanOrEqual(MAX_SCALE)
  }
})

test('settling repaints at the true spacing', () => {
  const g = placeGrid(0, 0, 1.1, 24, true)
  expect(g.repaint).toBe(true)
  expect(g.painted).toBeCloseTo(26.4)
  expect(placeGrid(0, 0, 1, 24, true).repaint).toBe(false)
})

test('a dot lands on the same screen spot whether scaled or painted exactly', () => {
  // a dot's screen x: the layer's layout left (-painted coarse tile) + tx + scale * (dot's x in the layer)
  const firstDot = (x: number, k: number, painted: number): number => {
    const g = placeGrid(x, 0, k, painted, false)
    return -g.painted * 4 + g.tx + g.scale * (g.painted / 2)
  }
  const ds = dotStep(1.2)
  for (const x of [0, 13.4, -250, 999]) {
    const scaled = firstDot(x, 1.2, 24)
    const exact = firstDot(x, 1.2, ds)
    // same lattice: the two differ by a whole number of dot steps
    const steps = (scaled - exact) / ds
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9)
  }
})
