/**
 * A damped spring, solved exactly (no integration steps, so any frame time is stable), and the one source of every
 * board motion: JS animations step it, CSS and WAAPI get it as a `linear()` easing sampled from the same physics.
 *
 * Parameters are perceptual, as Apple's are: `response` is roughly the time in seconds to get there, `damping` is the
 * damping fraction (1 = no overshoot, 0.7 = a visible but friendly bounce). Velocity is carried across retargets,
 * which is what makes an interrupted motion feel continuous instead of restarting.
 */
export interface SpringParams {
  /** Seconds for one undamped period: how quick it is. */
  response: number
  /** Damping fraction: 1 critically damped, below 1 overshoots, above 1 creeps. */
  damping: number
}

export const SPRINGS = {
  /** Small UI: buttons, pills, menus popping. Quick, a hair of overshoot. */
  snappy: { response: 0.28, damping: 0.82 },
  /** Things that grow or fly (a card opening, a panel): quick and clean, no wobble. */
  smooth: { response: 0.4, damping: 0.94 },
  /** Fun moments: a dropped card settling, a stack fanning out, a section snapping in. */
  bouncy: { response: 0.44, damping: 0.68 },
  /** Large camera moves: fit, fly to a card. Unhurried, no overshoot. */
  glide: { response: 0.6, damping: 1 },
  /** Following the pointer (drag tilt, lift): very quick, settles without a ring. */
  follow: { response: 0.16, damping: 0.9 }
} satisfies Record<string, SpringParams>

export type SpringName = keyof typeof SPRINGS

export interface SpringState {
  /** Displacement from the target. */
  x: number
  /** Velocity, units per second. */
  v: number
}

/** Advance a spring `dt` seconds toward 0 (state is displacement from the target). Exact for any dt. */
export function stepSpring(s: SpringState, p: SpringParams, dt: number): SpringState {
  const w = (2 * Math.PI) / Math.max(1e-3, p.response)
  const z = Math.max(0, p.damping)
  const { x: a, v: v0 } = s
  if (dt <= 0) return { x: a, v: v0 }
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z)
    const decay = Math.exp(-z * w * dt)
    const b = (v0 + z * w * a) / wd
    const c = Math.cos(wd * dt)
    const sn = Math.sin(wd * dt)
    return {
      x: decay * (a * c + b * sn),
      v: decay * (v0 * c - (z * w * b + a * wd) * sn)
    }
  }
  if (z === 1) {
    const decay = Math.exp(-w * dt)
    const b = v0 + w * a
    return { x: decay * (a + b * dt), v: decay * (b - w * (a + b * dt)) }
  }
  const r = w * Math.sqrt(z * z - 1)
  const r1 = -z * w + r
  const r2 = -z * w - r
  const c2 = (v0 - r1 * a) / (r2 - r1)
  const c1 = a - c2
  const e1 = Math.exp(r1 * dt)
  const e2 = Math.exp(r2 * dt)
  return { x: c1 * e1 + c2 * e2, v: c1 * r1 * e1 + c2 * r2 * e2 }
}

/** Close enough to stop: within `precision` of the target (in the units moved) and barely moving. */
export function springAtRest(s: SpringState, precision = 0.001): boolean {
  return Math.abs(s.x) < precision && Math.abs(s.v) < precision * 10
}

/**
 * The spring going from 0 to 1 (with an optional starting velocity, in "whole distances per second"), as a CSS
 * `linear()` easing plus the duration it takes to settle. Sampled at 60 Hz, then thinned where the curve is straight.
 */
export function springCurve(
  p: SpringParams,
  velocity = 0
): { easing: string; duration: number; points: number[] } {
  const dt = 1 / 60
  const pts: number[] = [0]
  let s: SpringState = { x: -1, v: velocity }
  let t = 0
  while (t < 4) {
    s = stepSpring(s, p, dt)
    t += dt
    pts.push(1 + s.x)
    if (springAtRest(s, 0.0015)) break
  }
  pts[pts.length - 1] = 1
  // keep a point only where dropping it would bend the curve by more than a hair
  const n = pts.length - 1
  const keep: Array<[number, number]> = [[0, 0]]
  for (let i = 1; i < n; i++) {
    const [pi, pv] = keep[keep.length - 1]
    const interp = pv + ((pts[i + 1] - pv) * (i - pi)) / (i + 1 - pi)
    if (Math.abs(interp - pts[i]) > 0.002) keep.push([i, pts[i]])
  }
  keep.push([n, 1])
  const r = (v: number): string => String(Math.round(v * 10000) / 10000)
  const stops = keep.map(([i, v], k) =>
    k === 0 || k === keep.length - 1 ? r(v) : `${r(v)} ${r((i / n) * 100)}%`
  )
  return { easing: `linear(${stops.join(', ')})`, duration: Math.round(t * 1000), points: pts }
}
