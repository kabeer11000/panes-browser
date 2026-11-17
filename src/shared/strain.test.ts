import { describe, expect, test } from 'bun:test'
import {
  budgetTier,
  CALM,
  CALM_WINDOWS,
  liveBudget,
  nextStrain,
  windowScore,
  type StrainSample,
  type StrainState
} from './strain'

const quiet: StrainSample = {
  blockedMs: 0,
  videoFrames: 60,
  videoDropped: 0,
  pressure: 'nominal',
  onBattery: false
}

describe('windowScore', () => {
  test('a quiet window is calm', () => expect(windowScore(quiet)).toBe(0))
  test('long frames on the board', () => {
    expect(windowScore({ ...quiet, blockedMs: 200 })).toBe(1)
    expect(windowScore({ ...quiet, blockedMs: 600 })).toBe(2)
  })
  test('dropped video frames', () => {
    expect(windowScore({ ...quiet, videoFrames: 50, videoDropped: 10 })).toBe(1)
    expect(windowScore({ ...quiet, videoFrames: 30, videoDropped: 30 })).toBe(2)
  })
  test('too few frames to tell is not counted', () => {
    expect(windowScore({ ...quiet, videoFrames: 5, videoDropped: 5 })).toBe(0)
  })
  test('system pressure', () => {
    expect(windowScore({ ...quiet, pressure: 'fair' })).toBe(0)
    expect(windowScore({ ...quiet, pressure: 'serious' })).toBe(1)
    expect(windowScore({ ...quiet, pressure: 'critical' })).toBe(2)
  })
  test('the board missing frames while it moves', () => {
    expect(windowScore({ ...quiet, boardFrames: 100, boardSlow: 10 })).toBe(0)
    expect(windowScore({ ...quiet, boardFrames: 100, boardSlow: 20 })).toBe(1)
    expect(windowScore({ ...quiet, boardFrames: 100, boardSlow: 50 })).toBe(2)
    expect(windowScore({ ...quiet, boardFrames: 10, boardSlow: 10 })).toBe(0)
  })
  test('the worst signal wins', () => {
    expect(windowScore({ ...quiet, blockedMs: 200, pressure: 'critical' })).toBe(2)
  })
})

describe('nextStrain', () => {
  const run = (start: StrainState, samples: StrainSample[]): StrainState =>
    samples.reduce(nextStrain, start)

  test('up fast', () => {
    expect(nextStrain(CALM, { ...quiet, blockedMs: 200 }).level).toBe(1)
    expect(nextStrain(CALM, { ...quiet, blockedMs: 600 }).level).toBe(2)
    expect(run(CALM, Array(5).fill({ ...quiet, blockedMs: 600 })).level).toBe(3)
  })
  test('down slowly, one level per calm stretch', () => {
    const s: StrainState = { level: 3, calm: 0 }
    expect(run(s, Array(CALM_WINDOWS - 1).fill(quiet)).level).toBe(3)
    expect(run(s, Array(CALM_WINDOWS).fill(quiet)).level).toBe(2)
    expect(run(s, Array(CALM_WINDOWS * 3).fill(quiet)).level).toBe(0)
  })
  test('one bad window restarts the calm stretch', () => {
    const s: StrainState = { level: 2, calm: CALM_WINDOWS - 1 }
    const after = nextStrain(s, { ...quiet, blockedMs: 200 })
    expect(after).toEqual({ level: 3, calm: 0 })
  })
  test('on battery it stays at least a little strained', () => {
    const b = { ...quiet, onBattery: true }
    expect(nextStrain(CALM, b).level).toBe(1)
    expect(run({ level: 3, calm: 0 }, Array(CALM_WINDOWS * 5).fill(b)).level).toBe(1)
  })
})

describe('liveBudget', () => {
  test('at rest, all the hardware allows', () => {
    expect(liveBudget(0, 4, 30)).toEqual({ cap: 4, tierDrop: 0, fps: 30 })
  })
  test('sharpness goes first, then count, then frame rate', () => {
    expect(liveBudget(1, 4, 30)).toEqual({ cap: 4, tierDrop: 1, fps: 30 })
    expect(liveBudget(2, 4, 30)).toEqual({ cap: 2, tierDrop: 2, fps: 30 })
    expect(liveBudget(3, 4, 30)).toEqual({ cap: 1, tierDrop: 2, fps: 15 })
  })
  test('never more than the hardware allows, at least one when any is allowed', () => {
    expect(liveBudget(2, 1, 30).cap).toBe(1)
    expect(liveBudget(3, 0, 30).cap).toBe(0)
  })
  test('hidden, nothing streams', () => {
    expect(liveBudget(0, 4, 30, true).cap).toBe(0)
  })
  test('budgetTier', () => {
    expect(budgetTier(2, 1)).toBe(1)
    expect(budgetTier(1, 2)).toBe(0)
    expect(budgetTier(0, 0)).toBe(0)
  })
})
