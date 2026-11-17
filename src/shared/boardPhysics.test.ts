import { describe, expect, test } from 'bun:test'
import {
  Camera,
  carryVelocity,
  rubberBand,
  ShakeDetector,
  springProgress,
  staggerDelay,
  tiltFor,
  TILT_MAX,
  VelocityTracker,
  ZOOM_GIVE
} from './boardPhysics'
import { SPRINGS, stepSpring } from './spring'

const run = (c: Camera, secs: number, dt = 1 / 60): void => {
  for (let t = 0; t < secs; t += dt) c.step(dt)
}

describe('VelocityTracker', () => {
  test('a steady move reads its speed', () => {
    const v = new VelocityTracker(100)
    for (let t = 0; t <= 200; t += 16) v.push(t, t * 0.5, 0) // 500 px/s
    expect(v.velocity(200).x).toBeCloseTo(500, -1)
  })
  test('a pointer that stopped slows to 0', () => {
    const v = new VelocityTracker(100)
    for (let t = 0; t <= 200; t += 16) v.push(t, t, 0)
    const a = Math.abs(v.velocity(230).x)
    const b = Math.abs(v.velocity(280).x)
    expect(b).toBeLessThan(a)
    expect(v.velocity(400).x).toBe(0)
  })
  test('nothing to go on is still', () => {
    const v = new VelocityTracker()
    expect(v.velocity(0)).toEqual({ x: 0, y: 0 })
    v.push(0, 5, 5)
    expect(v.velocity(10)).toEqual({ x: 0, y: 0 })
  })
})

describe('tiltFor', () => {
  test('about 5.6 degrees at 1000 px/s, clockwise to the right', () => {
    expect(tiltFor(1000)).toBeGreaterThan(5)
    expect(tiltFor(1000)).toBeLessThan(5.7)
    expect(tiltFor(-1000)).toBeCloseTo(-tiltFor(1000), 9)
  })
  test('never past the cap', () => {
    expect(tiltFor(1e6)).toBeLessThanOrEqual(TILT_MAX)
    expect(tiltFor(-1e6)).toBeGreaterThanOrEqual(-TILT_MAX)
    expect(tiltFor(NaN)).toBe(0)
  })
})

describe('rubberBand', () => {
  test('inside is itself', () => {
    expect(rubberBand(0.5, 0, 1, 0.2)).toBe(0.5)
  })
  test('past a limit it gives, ever less, never more than the give', () => {
    const a = rubberBand(1.1, 0, 1, 0.2)
    const b = rubberBand(1.5, 0, 1, 0.2)
    const c = rubberBand(100, 0, 1, 0.2)
    expect(a).toBeGreaterThan(1)
    expect(b).toBeGreaterThan(a)
    expect(b - 1).toBeLessThan(0.5)
    expect(c).toBeLessThan(1.2)
    expect(rubberBand(-100, 0, 1, 0.2)).toBeGreaterThan(-0.2)
  })
  test('continuous at the limit', () => {
    expect(rubberBand(1 + 1e-9, 0, 1, 0.2)).toBeCloseTo(1, 6)
  })
})

describe('springProgress / staggerDelay', () => {
  test('a spring goes from 0 to 1', () => {
    expect(springProgress(SPRINGS.smooth, 0)).toBe(0)
    expect(springProgress(SPRINGS.smooth, 2)).toBeCloseTo(1, 3)
  })
  test('stagger is a frame apart and capped', () => {
    expect(staggerDelay(0)).toBe(0)
    expect(staggerDelay(2)).toBe(32)
    expect(staggerDelay(1000)).toBe(160)
  })
})

describe('Camera', () => {
  test('a zoom keeps the point under the cursor in place', () => {
    const c = new Camera({ x: 0, y: 0, k: 1 }, 0.1, 4)
    const ax = 300
    const ay = 200
    const wx = (ax - c.x) / Math.exp(c.l)
    c.zoomBy(Math.log(2), ax, ay, SPRINGS.follow)
    for (let i = 0; i < 5; i++) {
      c.step(1 / 60)
      const v = c.view
      expect((ax - v.x) / v.k).toBeCloseTo(wx, 6)
    }
    run(c, 2)
    expect(c.view.k).toBeCloseTo(2, 3)
    expect(c.moving).toBe(false)
  })
  test('the zoom is smoothed: it gets there over a few frames, not at once', () => {
    const c = new Camera({ x: 0, y: 0, k: 1 }, 0.1, 4)
    c.zoomBy(Math.log(2), 0, 0, SPRINGS.follow)
    c.step(1 / 60)
    expect(c.view.k).toBeGreaterThan(1)
    expect(c.view.k).toBeLessThan(1.5)
  })
  test('pushed past the limit it gives, then springs back on release', () => {
    const c = new Camera({ x: 0, y: 0, k: 3.5 }, 0.1, 4)
    c.zoomBy(Math.log(4), 0, 0, SPRINGS.follow)
    run(c, 0.12)
    expect(c.view.k).toBeGreaterThan(4)
    expect(c.l).toBeLessThan(Math.log(4) + ZOOM_GIVE)
    c.release()
    run(c, 1.5)
    expect(c.view.k).toBeCloseTo(4, 3)
  })
  test('a zoom left past the limit comes back without a release', () => {
    const c = new Camera({ x: 0, y: 0, k: 4 }, 0.1, 4)
    c.zoomBy(1, 0, 0, SPRINGS.follow)
    run(c, 3)
    expect(c.view.k).toBeCloseTo(4, 3)
    expect(c.moving).toBe(false)
  })
  test('a glide lands exactly and can be retargeted mid-flight without a jolt', () => {
    const c = new Camera({ x: 0, y: 0, k: 1 }, 0.1, 4)
    c.glideTo({ x: 500, y: 0, k: 2 }, SPRINGS.glide)
    run(c, 0.2)
    const vBefore = c.vx
    expect(vBefore).toBeGreaterThan(0)
    c.glideTo({ x: 800, y: 0, k: 2 }, SPRINGS.glide)
    expect(c.vx).toBe(vBefore) // velocity kept
    run(c, 3)
    expect(c.view).toEqual({ x: 800, y: 0, k: 2 })
  })
  test('a fling coasts and slows to a stop', () => {
    const c = new Camera({ x: 0, y: 0, k: 1 }, 0.1, 4)
    c.coast(1000, 0, 0.32)
    run(c, 3)
    expect(c.x).toBeGreaterThan(300)
    expect(c.x).toBeLessThan(330)
    expect(c.moving).toBe(false)
  })
  test('a smoothed pan adds up and lands where asked', () => {
    const c = new Camera({ x: 0, y: 0, k: 1 }, 0.1, 4)
    c.panSmooth(0, 100, SPRINGS.follow)
    c.step(1 / 60)
    c.panSmooth(0, 100, SPRINGS.follow)
    run(c, 2)
    expect(c.y).toBe(200)
  })
  test('zoom input mid-glide carries on from the glide, no freeze', () => {
    const c = new Camera({ x: 0, y: 0, k: 1 }, 0.1, 4)
    c.glideTo({ x: 1000, y: 0, k: 1 }, SPRINGS.glide)
    run(c, 0.15)
    const x = c.x
    const vx = c.vx
    c.zoomBy(0.1, 0, 0, SPRINGS.follow)
    c.step(1 / 60)
    expect(c.x).toBeGreaterThan(x) // still moving the way it went
    expect(vx).toBeGreaterThan(0)
  })
  test('stop holds still', () => {
    const c = new Camera({ x: 0, y: 0, k: 1 }, 0.1, 4)
    c.coast(1000, 1000, 0.3)
    c.stop()
    run(c, 0.5)
    expect(c.view).toEqual({ x: 0, y: 0, k: 1 })
  })
})

describe('ShakeDetector', () => {
  test('three quick turns are a shake, once', () => {
    const d = new ShakeDetector()
    const vs = [800, -800, 800, -800]
    const hits = vs.map((v, i) => d.push(i * 120, v))
    expect(hits).toEqual([false, false, false, true])
    expect(d.push(500, 800)).toBe(false)
  })
  test('slow or spread-out turns are not', () => {
    const d = new ShakeDetector()
    expect([800, -800, 800, -800].map((v, i) => d.push(i * 400, v)).some(Boolean)).toBe(false)
    const e = new ShakeDetector()
    expect([200, -200, 200, -200].map((v, i) => e.push(i * 50, v)).some(Boolean)).toBe(false)
  })
})

describe('carryVelocity', () => {
  const p = { response: 0.4, damping: 0.72 }
  test('a gentle throw keeps its share', () => {
    const v = carryVelocity({ x: 100, y: 0 }, p, 0.5, 80)
    expect(v.x).toBeCloseTo(50, 6)
  })
  test('a hard flick never glides past its place by more than the cap', () => {
    const v = carryVelocity({ x: 20000, y: -15000 }, p, 0.5, 80)
    let s = { x: 0, v: Math.hypot(v.x, v.y) }
    let peak = 0
    for (let i = 0; i < 300; i++) {
      s = stepSpring(s, p, 1 / 120)
      peak = Math.max(peak, Math.abs(s.x))
    }
    expect(peak).toBeLessThanOrEqual(80.01)
    expect(peak).toBeGreaterThan(79)
    expect(v.x / v.y).toBeCloseTo(20000 / -15000, 6) // same direction
  })
})
