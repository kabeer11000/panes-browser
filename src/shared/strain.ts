// How hard the computer is working, measured rather than guessed from its specs, and what the board may spend on
// live cards because of it. A fast machine that is busy (a build, a game) and a slow one at rest both show it the
// same way: the board's own frames run long, live videos drop frames, the system says the CPU is under pressure.
// Pure so it can be tested; the board (renderer canvas/strain.ts) feeds it samples.

/** 0: all is well. 1: a little strained. 2: strained. 3: struggling. */
export type Strain = 0 | 1 | 2 | 3

/** Chromium's Compute Pressure states (PressureObserver, 'cpu'). */
export type Pressure = 'nominal' | 'fair' | 'serious' | 'critical'

/** What one sampling window (about SAMPLE_MS) saw. */
export interface StrainSample {
  /** How long the board's main thread was blocked in that window (long animation frames' blocking time), ms. */
  blockedMs: number
  /** Frames the live card videos showed and dropped in that window (getVideoPlaybackQuality deltas). */
  videoFrames: number
  videoDropped: number
  /**
   * Frames the board drew while moving (its own frame loop) and how many of them missed the display's refresh: a pan
   * at 30 fps blocks nothing for long, but drops every other frame. Absent: the board did not move.
   */
  boardFrames?: number
  boardSlow?: number
  /** The system's CPU pressure, when the API is there. */
  pressure: Pressure | null
  /** Running on battery: kept at least a little strained, so a laptop unplugged lasts. */
  onBattery: boolean
}

export const SAMPLE_MS = 2000
/** Calm windows in a row before the strain steps down one level: up fast, down slowly, so it does not flicker. */
export const CALM_WINDOWS = 6
/** Blocked time in one window that counts as strained / struggling. */
const BLOCKED_BAD_MS = 150
const BLOCKED_AWFUL_MS = 450
/** Share of live video frames dropped that counts as strained / struggling (ignored with too few frames to tell). */
const DROPS_BAD = 0.12
const DROPS_AWFUL = 0.35
const DROPS_MIN_FRAMES = 20
/** Share of the board's moving frames that missed the refresh, strained / struggling (with enough frames to tell). */
const SLOW_BAD = 0.15
const SLOW_AWFUL = 0.4

/** How bad one window was: 0 calm, 1 bad, 2 awful. */
export function windowScore(s: StrainSample): 0 | 1 | 2 {
  let score: 0 | 1 | 2 = 0
  const worse = (n: 0 | 1 | 2): void => {
    if (n > score) score = n
  }
  if (s.blockedMs >= BLOCKED_AWFUL_MS) worse(2)
  else if (s.blockedMs >= BLOCKED_BAD_MS) worse(1)
  if (s.videoFrames + s.videoDropped >= DROPS_MIN_FRAMES) {
    const ratio = s.videoDropped / (s.videoFrames + s.videoDropped)
    if (ratio >= DROPS_AWFUL) worse(2)
    else if (ratio >= DROPS_BAD) worse(1)
  }
  const bf = s.boardFrames ?? 0
  if (bf >= DROPS_MIN_FRAMES) {
    const slow = (s.boardSlow ?? 0) / bf
    if (slow >= SLOW_AWFUL) worse(2)
    else if (slow >= SLOW_BAD) worse(1)
  }
  if (s.pressure === 'critical') worse(2)
  else if (s.pressure === 'serious') worse(1)
  return score
}

export interface StrainState {
  level: Strain
  /** Calm windows in a row so far. */
  calm: number
}

export const CALM: StrainState = { level: 0, calm: 0 }

/**
 * The strain after one more window: a bad one raises it a level, an awful one two; CALM_WINDOWS calm ones in a row
 * lower it one. On battery it never goes below 1.
 */
export function nextStrain(cur: StrainState, s: StrainSample): StrainState {
  const floor: Strain = s.onBattery ? 1 : 0
  const score = windowScore(s)
  if (score > 0) {
    const level = Math.min(3, cur.level + score) as Strain
    return { level: Math.max(floor, level) as Strain, calm: 0 }
  }
  const calm = cur.calm + 1
  if (calm >= CALM_WINDOWS && cur.level > floor)
    return { level: (cur.level - 1) as Strain, calm: 0 }
  return { level: Math.max(floor, cur.level) as Strain, calm }
}

export interface LiveBudget {
  /** Most cards streaming at once. */
  cap: number
  /** Sharpness tiers to give up (tabStream's liveTier): sharpness goes first, as a small card hardly shows it. */
  tierDrop: 0 | 1 | 2
  /** Frames per second asked of each stream. */
  fps: number
}

/**
 * What the board may spend on live cards at a strain, from what the hardware allows at rest (`baseCap`, streamCap).
 * Sharpness goes first, then how many stream, and frame rate last (fewer frames reads as stutter). Hidden (the window
 * minimised or covered), nothing streams at all.
 */
export function liveBudget(
  level: Strain,
  baseCap: number,
  fps: number,
  hidden = false
): LiveBudget {
  if (hidden) return { cap: 0, tierDrop: 2, fps }
  switch (level) {
    case 0:
      return { cap: baseCap, tierDrop: 0, fps }
    case 1:
      return { cap: baseCap, tierDrop: 1, fps }
    case 2:
      return { cap: Math.min(baseCap, Math.max(1, Math.ceil(baseCap / 2))), tierDrop: 2, fps }
    case 3:
      return { cap: Math.min(baseCap, 1), tierDrop: 2, fps: Math.min(fps, 15) }
  }
}

/** A stream's sharpness tier once the budget has taken its share. */
export const budgetTier = (tier: 0 | 1 | 2, drop: 0 | 1 | 2): 0 | 1 | 2 =>
  Math.max(0, tier - drop) as 0 | 1 | 2
