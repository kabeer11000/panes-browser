import { describe, expect, test } from 'bun:test'
import { RUNNER, hits, newRunner, scoreOf, step, type RunnerState } from './runner'

const fixed = (v: number) => () => v
const run = (
  s: RunnerState,
  seconds: number,
  jumpAt: (t: number) => boolean = () => false
): RunnerState => {
  let t = 0
  while (t < seconds && !s.over) {
    s = step(s, 1 / 60, jumpAt(t), fixed(0.5))
    t += 1 / 60
  }
  return s
}

describe('runner', () => {
  test('a jump leaves the ground and comes back', () => {
    let s = step(newRunner(), 1 / 60, true, fixed(0.5))
    expect(s.y).toBeGreaterThan(0)
    s = run({ ...s, obstacles: [], gap: 1e9 }, 1.2)
    expect(s.y).toBe(0)
  })

  test('cannot jump in mid-air', () => {
    const up = step(newRunner(), 1 / 60, true, fixed(0.5))
    const again = step(up, 1 / 60, true, fixed(0.5))
    expect(again.vy).toBeLessThan(up.vy) // gravity only: no second kick
  })

  test('standing still into the first obstacle ends the run', () => {
    const s = run(newRunner(), 10)
    expect(s.over).toBe(true)
  })

  test('hits needs real overlap and a low enough pane', () => {
    const base = newRunner()
    const at = (x: number, y = 0): RunnerState => ({ ...base, y, obstacles: [{ x, w: 20, h: 30 }] })
    expect(hits(at(RUNNER.x + 4))).toBe(true)
    expect(hits(at(RUNNER.x + 200))).toBe(false)
    expect(hits(at(RUNNER.x + 4, 60))).toBe(false) // jumped clear
  })

  test('score grows with distance and speed is capped', () => {
    const s = run({ ...newRunner(), obstacles: [], gap: 1e9 }, 30)
    expect(scoreOf(s)).toBeGreaterThan(100)
    expect(s.speed).toBeLessThanOrEqual(RUNNER.maxSpeed)
  })

  test('a finished run stays finished', () => {
    const over = { ...newRunner(), over: true }
    expect(step(over, 1, false, fixed(0.5))).toBe(over)
  })
})
