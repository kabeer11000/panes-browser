import { describe, expect, test } from 'bun:test'
import { autoscrollSpeed, DEAD_ZONE, endsOnRelease, MAX_SPEED } from './autoscroll'

describe('autoscroll', () => {
  test('still inside the dead zone, then faster the further out, toward the pointer', () => {
    expect(autoscrollSpeed(0)).toBe(0)
    expect(autoscrollSpeed(DEAD_ZONE)).toBe(0)
    expect(autoscrollSpeed(-DEAD_ZONE)).toBe(0)
    const near = autoscrollSpeed(40)
    const far = autoscrollSpeed(120)
    expect(near).toBeGreaterThan(0)
    expect(far).toBeGreaterThan(near * 3)
    expect(autoscrollSpeed(-120)).toBe(-far)
    expect(autoscrollSpeed(100_000)).toBe(MAX_SPEED)
  })
  test('a quick click stays on; a hold or a drag ends on release', () => {
    expect(endsOnRelease(120, false)).toBe(false)
    expect(endsOnRelease(120, true)).toBe(true)
    expect(endsOnRelease(900, false)).toBe(true)
  })
})
