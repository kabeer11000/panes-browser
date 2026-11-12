import { describe, expect, test } from 'bun:test'
import { FreeScroll } from './freeScroll'
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
