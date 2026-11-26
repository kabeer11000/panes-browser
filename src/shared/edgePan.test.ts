import { describe, expect, test } from 'bun:test'
import {
  EDGE_PAN_REST,
  EDGE_ZONE_PX,
  edgePanActive,
  stepEdgePan,
  type EdgePanState
} from './edgePan'

const R = { left: 0, top: 0, right: 1000, bottom: 800 }
/** `ms` of frames at 60 fps with the pointer held at (x, y). */
function hold(x: number, y: number, ms: number, s: EdgePanState = EDGE_PAN_REST): EdgePanState {
  for (let t = 0; t < ms; t += 16) s = stepEdgePan(s, x, y, R, 16)
  return s
}

describe('edge pan', () => {
  test('nothing moves with the pointer away from the edges', () => {
    const s = hold(500, 400, 500)
    expect(s).toEqual(EDGE_PAN_REST)
    expect(edgePanActive(s)).toBe(false)
  })

  test('each edge pans its own way', () => {
    expect(hold(995, 400, 300).vx).toBeGreaterThan(0)
    expect(hold(5, 400, 300).vx).toBeLessThan(0)
    expect(hold(500, 795, 300).vy).toBeGreaterThan(0)
    expect(hold(500, 5, 300).vy).toBeLessThan(0)
    // a corner pans both ways at once
    const c = hold(995, 795, 300)
    expect(c.vx).toBeGreaterThan(0)
    expect(c.vy).toBeGreaterThan(0)
  })

  test('deeper in the zone is faster, and past the edge faster still', () => {
    const inner = hold(1000 - EDGE_ZONE_PX + 10, 400, 1000).vx
    const edge = hold(999, 400, 1000).vx
    const past = hold(1030, 400, 1000).vx
    expect(inner).toBeGreaterThan(0)
    expect(edge).toBeGreaterThan(inner * 3)
    expect(past).toBeGreaterThan(edge)
  })

  test('it accelerates: held longer at the edge, it goes faster', () => {
    const early = hold(999, 400, 150).vx
    const later = hold(999, 400, 600).vx
    const full = hold(999, 400, 1500).vx
    expect(later).toBeGreaterThan(early * 1.5)
    expect(full).toBeGreaterThan(later)
    // and it tops out
    expect(hold(999, 400, 3000).vx).toBeCloseTo(full, 0)
  })

  test('it picks up smoothly: no jump to speed on the first frame', () => {
    const first = stepEdgePan(EDGE_PAN_REST, 999, 400, R, 16)
    expect(first.vx).toBeGreaterThan(0)
    expect(first.vx).toBeLessThan(hold(999, 400, 300).vx / 2)
  })

  test('it glides to a stop when the pointer comes away, then rests', () => {
    const going = hold(999, 400, 1000)
    const next = stepEdgePan(going, 500, 400, R, 16)
    expect(next.vx).toBeGreaterThan(0) // still moving: a glide, not a halt
    expect(next.vx).toBeLessThan(going.vx)
    expect(next.held).toBe(0)
    const rested = hold(500, 400, 1000, going)
    expect(rested).toEqual(EDGE_PAN_REST)
  })

  test('a long frame counts as a short one: the board never jumps', () => {
    const going = hold(999, 400, 1000)
    expect(stepEdgePan(going, 999, 400, R, 2000)).toEqual(stepEdgePan(going, 999, 400, R, 50))
  })

  test('a board too small for two zones keeps a still middle', () => {
    const small = { left: 0, top: 0, right: 90, bottom: 90 }
    expect(stepEdgePan(EDGE_PAN_REST, 45, 45, small, 16)).toEqual(EDGE_PAN_REST)
  })
})
