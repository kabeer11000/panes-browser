import { describe, expect, test } from 'bun:test'
import { SPRINGS, springAtRest, springCurve, stepSpring, type SpringState } from './spring'

const run = (s: SpringState, p = SPRINGS.bouncy, secs = 3, dt = 1 / 60): SpringState => {
  for (let t = 0; t < secs; t += dt) s = stepSpring(s, p, dt)
  return s
}

describe('stepSpring', () => {
  test('every preset comes to rest at the target', () => {
    for (const p of Object.values(SPRINGS)) {
      const s = run({ x: 100, v: 0 }, p)
      expect(Math.abs(s.x)).toBeLessThan(0.01)
      expect(springAtRest(s, 0.01)).toBe(true)
    }
  })
  test('one big step equals many small ones (it is exact, not integrated)', () => {
    const p = SPRINGS.bouncy
    const big = stepSpring({ x: 50, v: -200 }, p, 0.3)
    const small = run({ x: 50, v: -200 }, p, 0.3 - 1e-9, 0.001)
    expect(big.x).toBeCloseTo(small.x, 1)
    expect(big.v).toBeCloseTo(small.v, 0)
  })
  test('under-damped overshoots, critically damped does not', () => {
    let s: SpringState = { x: -1, v: 0 }
    let max = -Infinity
    for (let i = 0; i < 120; i++) {
      s = stepSpring(s, SPRINGS.bouncy, 1 / 60)
      max = Math.max(max, s.x)
    }
    expect(max).toBeGreaterThan(0.02)
    s = { x: -1, v: 0 }
    max = -Infinity
    for (let i = 0; i < 120; i++) {
      s = stepSpring(s, SPRINGS.glide, 1 / 60)
      max = Math.max(max, s.x)
    }
    expect(max).toBeLessThanOrEqual(1e-9)
  })
  test('over-damped is stable and continuous', () => {
    const s = run({ x: 10, v: 5 }, { response: 0.4, damping: 1.6 })
    expect(Math.abs(s.x)).toBeLessThan(0.05)
  })
  test('velocity carries: a moving spring keeps going before turning back', () => {
    const s = stepSpring({ x: 0, v: 500 }, SPRINGS.smooth, 1 / 60)
    expect(s.x).toBeGreaterThan(0)
  })
})

describe('springCurve', () => {
  test('a linear() easing from 0 to 1 with a settle time', () => {
    const c = springCurve(SPRINGS.bouncy)
    expect(c.easing.startsWith('linear(0, ')).toBe(true)
    expect(c.easing.endsWith(', 1)')).toBe(true)
    expect(c.duration).toBeGreaterThan(300)
    expect(c.duration).toBeLessThan(1500)
    expect(Math.max(...c.points)).toBeGreaterThan(1)
  })
  test('stops are in order', () => {
    const pcts = [...springCurve(SPRINGS.snappy).easing.matchAll(/ ([\d.]+)%/g)].map((m) =>
      Number(m[1])
    )
    for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeGreaterThan(pcts[i - 1])
  })
})
