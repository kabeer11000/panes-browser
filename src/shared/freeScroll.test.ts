import { describe, expect, test } from 'bun:test'
import { FreeScroll, PanResampler } from './freeScroll'
import { ContactFrames } from './touchContacts'

function rig(gain = -10): { fs: FreeScroll; pans: number[][]; flings: number[][] } {
  const pans: number[][] = []
  const flings: number[][] = []
  const fs = new FreeScroll(
    { pan: (x, y) => pans.push([x, y]), fling: (x, y) => flings.push([x, y]), stop: () => {} },
    gain
  )
  return { fs, pans, flings }
}

describe('FreeScroll', () => {
  test('a diagonal two-finger scroll pans on both axes once Windows calls it a scroll', () => {
    const { fs, pans } = rig()
    fs.touch({ dx: 1, dy: 1, fingers: 2, t: 0 })
    expect(pans).toEqual([]) // not a scroll yet
    expect(fs.wheel(0, -10, false, 5)).toBe(true) // railed to y, swallowed
    fs.touch({ dx: 1, dy: 1, fingers: 2, t: 8 })
    const sx = pans.reduce((a, p) => a + p[0], 0)
    const sy = pans.reduce((a, p) => a + p[1], 0)
    expect(Math.abs(sx)).toBeGreaterThan(0)
    expect(sx).toBeCloseTo(sy, 5)
  })

  test('a pinch is left to the zoom', () => {
    const { fs, pans } = rig()
    fs.touch({ dx: 1, dy: 0, fingers: 2, t: 0 })
    expect(fs.wheel(0, 3, true, 5)).toBe(false)
    fs.touch({ dx: 1, dy: 0, fingers: 2, t: 8 })
    expect(fs.wheel(0, 3, false, 10)).toBe(false)
    expect(pans).toEqual([])
  })

  test('lifting flings, swallows Windows inertia, then lets a mouse wheel through', () => {
    const { fs, flings } = rig()
    for (let t = 0; t <= 40; t += 8) {
      fs.touch({ dx: 1, dy: 0, fingers: 2, t })
      fs.wheel(-10, 0, false, t + 1)
    }
    fs.touch({ dx: 0, dy: 0, fingers: 0, t: 48 })
    expect(flings.length).toBe(1)
    expect(flings[0][0]).not.toBe(0)
    expect(fs.wheel(-5, 0, false, 60)).toBe(true)
    expect(fs.wheel(-2, 0, false, 76)).toBe(true)
    expect(fs.wheel(0, 120, false, 600)).toBe(false)
  })

  test('without raw frames every wheel goes through', () => {
    const { fs } = rig()
    expect(fs.wheel(3, 4, false, 0)).toBe(false)
  })

  test('learns the gain, sign included, from railed wheels', () => {
    const { fs } = rig(-10)
    for (let t = 0; t < 2000; t += 8) {
      fs.touch({ dx: 0.5, dy: 0.1, fingers: 2, t })
      fs.wheel(15, 0, false, t + 1) // 30 px per mm, same direction as the fingers
    }
    expect(fs.gain).toBeGreaterThan(25)
    expect(fs.gain).toBeLessThan(31)
  })
})

describe('ContactFrames', () => {
  test('hybrid reports make one frame; motion ignores a finger that just landed', () => {
    const c = new ContactFrames()
    expect(c.feed(2, [{ id: 1, tip: true, x: 0, y: 0 }])).toBeNull()
    expect(c.feed(0, [{ id: 2, tip: true, x: 10, y: 0 }])).toEqual({
      dx: 0,
      dy: 0,
      fingers: 2,
      y: 0
    })
    const f = c.feed(3, [
      { id: 1, tip: true, x: 1, y: 2 },
      { id: 2, tip: true, x: 11, y: 2 },
      { id: 3, tip: true, x: 50, y: 50 }
    ])
    expect(f).toEqual({ dx: 1, dy: 2, fingers: 3, y: 18 }) // y: (2 + 2 + 50) / 3
  })
})

describe('PanResampler', () => {
  /** Reports every 8 ms of 8 px each, arriving in bursts; frames every 16.7 ms. The per-frame steps. */
  function steps(r: PanResampler, frames: number): number[] {
    const out: number[] = []
    let sent = 0
    for (let f = 1; f <= frames; f++) {
      const now = f * 16.7
      // reports up to 6 ms ago have arrived, a burst at a time
      while (sent * 8 <= now - 6) r.push(sent++ * 8, 8, 0, now)
      out.push(r.take(now).dx)
    }
    return out
  }
  test('even steps from bursty reports, adding up to the whole motion', () => {
    const r = new PanResampler()
    const s = steps(r, 30)
    const moving = s.slice(4) // once under way
    const mean = moving.reduce((a, b) => a + b, 0) / moving.length
    for (const d of moving) expect(Math.abs(d - mean)).toBeLessThan(0.15 * mean)
    const total = s.reduce((a, b) => a + b, 0) + r.flush().dx
    expect(total).toBeCloseTo(r['x'] as number, 6)
  })
  test('stops where the fingers stopped, and says it is done', () => {
    const r = new PanResampler()
    r.push(0, 5, 3, 1)
    r.push(8, 5, 3, 9)
    let dx = 0
    let dy = 0
    let done = false
    for (let now = 10; now < 200 && !done; now += 16) ({ dx, dy, done } = add(r.take(now), dx, dy))
    expect(done).toBe(true)
    expect([dx, dy]).toEqual([10, 6])
  })
  test('a pause is not glided over: the motion after it starts after it', () => {
    const r = new PanResampler()
    r.push(0, 10, 0, 1)
    r.take(100)
    r.push(500, 10, 0, 501)
    // nothing during the pause: the new motion fills only the report's own 8 ms, not the 500 since the last
    expect(r.take(491 + r.delay).dx).toBe(0)
    expect(r.take(600).dx).toBe(10)
  })
  test('flush gives what is left and nothing after', () => {
    const r = new PanResampler()
    r.push(0, 4, 0, 1)
    r.push(8, 4, 0, 9)
    const part = r.take(12).dx
    expect(part + r.flush().dx).toBeCloseTo(8, 6)
    expect(r.take(1000)).toEqual({ dx: 0, dy: 0, done: true })
  })
})

function add(
  s: { dx: number; dy: number; done: boolean },
  dx: number,
  dy: number
): { dx: number; dy: number; done: boolean } {
  return { dx: dx + s.dx, dy: dy + s.dy, done: s.done }
}

describe('PanResampler delay', () => {
  test('one late report does not jerk the board: the delay glides, so steps stay even', () => {
    const r = new PanResampler()
    const steps: number[] = []
    let sent = 0
    for (let f = 1; f <= 40; f++) {
      const now = f * 16.7
      while (sent * 8 <= now - 4) {
        // report 30 arrives 30 ms late (main was busy), the rest about 4 ms
        const arrive = sent === 30 ? sent * 8 + 30 : now
        r.push(sent * 8, 8, 0, Math.max(arrive, now))
        sent++
      }
      steps.push(r.take(now).dx)
    }
    const moving = steps.slice(6)
    const mean = moving.reduce((a, b) => a + b, 0) / moving.length
    for (const d of moving) expect(Math.abs(d - mean)).toBeLessThan(0.2 * mean)
  })
})
