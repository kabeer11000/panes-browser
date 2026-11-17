import { stepSpring, type SpringParams } from './spring'

/**
 * The board's hand-feel, pure: how fast the pointer is going, how far a held card tilts for it, how a zoom limit gives
 * a little before it holds, and the camera (pan, zoom and their glides) as one stepped state. No DOM: the renderer
 * steps these once a frame and writes the result.
 */

export interface Pt {
  x: number
  y: number
}

// ---- pointer velocity ----

/**
 * The pointer's velocity in px/s over the last `windowMs`, read at any time: a pointer that stopped reads as slowing
 * to 0 (its last sample stays put while time goes on), so whatever follows it settles instead of freezing mid-tilt.
 */
export class VelocityTracker {
  private s: Array<{ t: number; x: number; y: number }> = []
  constructor(private windowMs = 100) {}
  push(t: number, x: number, y: number): void {
    this.s.push({ t, x, y })
    // keep one sample older than the window, as the base
    while (this.s.length > 2 && this.s[1].t < t - this.windowMs) this.s.shift()
  }
  reset(): void {
    this.s = []
  }
  velocity(now: number): Pt {
    const n = this.s.length
    if (n < 2) return { x: 0, y: 0 }
    const last = this.s[n - 1]
    // the newest sample at or before the window's start (else the oldest one there is)
    let base = this.s[0]
    for (const p of this.s) if (p.t <= now - this.windowMs) base = p
    if (base === last) return { x: 0, y: 0 }
    // a pointer still moving reads over its own samples; one that stopped reads over the time since
    const dt = Math.max(16, last.t - base.t, now - base.t - 20) / 1000
    return { x: (last.x - base.x) / dt, y: (last.y - base.y) / dt }
  }
}

// ---- drag tilt ----

/** Degrees of tilt per px/s of sideways speed (Park: about 5.6 degrees at 1000 px/s). */
export const TILT_PER_PXS = 5.6 / 1000
/** The most a held card tilts. */
export const TILT_MAX = 15

/** How far a held card leans for a sideways speed (px/s): linear near rest, easing into ±TILT_MAX. Moving right
 * leans it clockwise (positive), as a card held near its top swings its bottom behind. */
export function tiltFor(vx: number): number {
  if (!Number.isFinite(vx)) return 0
  return TILT_MAX * Math.tanh((vx * TILT_PER_PXS) / TILT_MAX)
}

// ---- limits that give ----

/**
 * A soft limit: inside [min, max] the value is itself; past a limit it keeps moving, ever more slowly, never more than
 * `give` beyond it (the iOS rubber band).
 */
export function rubberBand(v: number, min: number, max: number, give: number): number {
  if (v < min) return min - give * (1 - 1 / ((min - v) / give + 1))
  if (v > max) return max + give * (1 - 1 / ((v - max) / give + 1))
  return v
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

// ---- a WAAPI spring, evaluated ----

/** Where a 0→1 spring (starting at `velocity` whole distances per second) is after `t` seconds. */
export function springProgress(p: SpringParams, t: number, velocity = 0): number {
  if (t <= 0) return 0
  return 1 + stepSpring({ x: -1, v: velocity }, p, t).x
}

/**
 * Delays for items moving together, one frame or two apart, so a group ripples instead of moving as a slab; capped so
 * a big board still starts its last item soon.
 */
export function staggerDelay(i: number, step = 16, cap = 160): number {
  return Math.min(Math.max(0, i) * step, cap)
}

// ---- the camera ----

export interface View {
  x: number
  y: number
  k: number
}

/** How far (log units of zoom) a zoom may be pushed past its limit before it holds. */
export const ZOOM_GIVE = 0.16

type Pan =
  | { kind: 'spring'; tx: number; ty: number; p: SpringParams }
  | { kind: 'coast'; tau: number }
  | null
type Zoom = {
  /** Where the zoom is going (log k). */
  tl: number
  /** What the input asked for, unclamped: the target is it rubber-banded. */
  raw: number
  p: SpringParams
  /** The screen point that stays put (null: a glide, which moves x and y on its own). */
  anchor: Pt | null
} | null

/**
 * The board's view as motion: x, y (screen px) and the zoom on a log scale, each with a velocity. A pan either chases
 * a target on a spring (a wheel notch, a glide) or coasts and slows (a fling); a zoom chases its target on a spring,
 * scaled about a screen point. Retargeting keeps the velocity, so input arriving mid-glide carries the motion on.
 */
export class Camera {
  x: number
  y: number
  /** log of the zoom */
  l: number
  vx = 0
  vy = 0
  vl = 0
  private pan: Pan = null
  private zoom: Zoom = null
  private readonly lmin: number
  private readonly lmax: number
  constructor(v: View, minK: number, maxK: number) {
    this.lmin = Math.log(minK)
    this.lmax = Math.log(maxK)
    this.x = v.x
    this.y = v.y
    this.l = Math.log(clamp(v.k, minK, maxK))
  }
  get view(): View {
    return { x: this.x, y: this.y, k: Math.exp(this.l) }
  }
  get moving(): boolean {
    return this.pan !== null || this.zoom !== null
  }
  /** A glide (animateTo) is in flight. */
  get gliding(): boolean {
    return this.zoom !== null && this.zoom.anchor === null
  }
  set(v: View): void {
    this.x = v.x
    this.y = v.y
    this.l = clamp(Math.log(v.k), this.lmin, this.lmax)
    this.stop()
  }
  /** Hold still: a hand caught the board. */
  stop(): void {
    this.pan = null
    this.zoom = null
    this.vx = this.vy = this.vl = 0
  }
  /** Move now by screen px. A spring in flight keeps its course relative to the board (its target moves too). */
  panBy(dx: number, dy: number): void {
    this.x += dx
    this.y += dy
    if (this.pan?.kind === 'spring') {
      this.pan.tx += dx
      this.pan.ty += dy
    }
  }
  /** Move by screen px, smoothed on spring `p` (a wheel notch): adds to wherever a smoothed move was going. */
  panSmooth(dx: number, dy: number, p: SpringParams): void {
    if (this.pan?.kind === 'spring') {
      this.pan.tx += dx
      this.pan.ty += dy
      this.pan.p = p
    } else this.pan = { kind: 'spring', tx: this.x + dx, ty: this.y + dy, p }
  }
  /** Carry on at (vx, vy) px/s, slowing with time constant `tau` s. */
  coast(vx: number, vy: number, tau: number): void {
    this.vx = vx
    this.vy = vy
    this.pan = tau > 0 && Math.hypot(vx, vy) > 1 ? { kind: 'coast', tau } : null
    if (!this.pan) this.vx = this.vy = 0
  }
  /**
   * Zoom by `dl` (log units) about the screen point (ax, ay), smoothed on spring `p`. Past a limit the zoom gives
   * (rubberBand) until `release` springs it back.
   */
  zoomBy(dl: number, ax: number, ay: number, p: SpringParams): void {
    const z = this.zoom
    // input during a glide takes over from where the glide is now, keeping its speed: the pan coasts on
    if (z && !z.anchor && this.pan?.kind === 'spring') this.pan = { kind: 'coast', tau: 0.2 }
    const raw = (z && z.anchor ? z.raw : this.l) + dl
    this.zoom = {
      raw,
      tl: rubberBand(raw, this.lmin, this.lmax, ZOOM_GIVE),
      p,
      anchor: { x: ax, y: ay }
    }
  }
  /** The zoom input ended: carry on by `momentum` (log units) and come back inside the limits. */
  release(momentum = 0): void {
    const z = this.zoom
    if (!z || !z.anchor) return
    z.raw = clamp(z.raw + momentum, this.lmin, this.lmax)
    z.tl = z.raw
  }
  /** Glide to a view on spring `p` (x, y and log zoom each on it), from the motion there is now. */
  glideTo(v: View, p: SpringParams): void {
    const l = clamp(Math.log(v.k), this.lmin, this.lmax)
    this.pan = { kind: 'spring', tx: v.x, ty: v.y, p }
    this.zoom = { raw: l, tl: l, p, anchor: null }
  }
  /**
   * Where the motion in flight comes to rest, as things stand: a spring's target, a coast's run-out (v * tau), a zoom's
   * target about its point. A forecast, for getting ready ahead of time (a page about to be landed on).
   */
  get restingView(): View {
    const pan = this.pan
    let x = pan?.kind === 'spring' ? pan.tx : pan?.kind === 'coast' ? this.x + this.vx * pan.tau : this.x
    let y = pan?.kind === 'spring' ? pan.ty : pan?.kind === 'coast' ? this.y + this.vy * pan.tau : this.y
    const z = this.zoom
    const l = z ? clamp(z.tl, this.lmin, this.lmax) : this.l
    if (z?.anchor) {
      const f = Math.exp(l - this.l)
      x = z.anchor.x - (z.anchor.x - x) * f
      y = z.anchor.y - (z.anchor.y - y) * f
    }
    return { x, y, k: Math.exp(l) }
  }
  /** Advance `dt` seconds. */
  step(dt: number): void {
    if (dt <= 0) return
    const l0 = this.l
    const z = this.zoom
    if (z) {
      const s = stepSpring({ x: this.l - z.tl, v: this.vl }, z.p, dt)
      if (Math.abs(s.x) < 1e-4 && Math.abs(s.v) < 1e-3) {
        this.l = z.tl
        this.vl = 0
        // a zoom that ended past a limit (no release came) still comes back
        const inside = clamp(z.tl, this.lmin, this.lmax)
        if (inside !== z.tl) z.raw = z.tl = inside
        else this.zoom = null
      } else {
        this.l = z.tl + s.x
        this.vl = s.v
      }
    }
    const pan = this.pan
    if (pan?.kind === 'spring') {
      const sx = stepSpring({ x: this.x - pan.tx, v: this.vx }, pan.p, dt)
      const sy = stepSpring({ x: this.y - pan.ty, v: this.vy }, pan.p, dt)
      if (Math.hypot(sx.x, sy.x) < 0.05 && Math.hypot(sx.v, sy.v) < 1) {
        this.x = pan.tx
        this.y = pan.ty
        this.vx = this.vy = 0
        this.pan = null
      } else {
        this.x = pan.tx + sx.x
        this.y = pan.ty + sy.x
        this.vx = sx.v
        this.vy = sy.v
      }
    } else if (pan?.kind === 'coast') {
      const f = Math.exp(-dt / pan.tau)
      this.x += this.vx * pan.tau * (1 - f)
      this.y += this.vy * pan.tau * (1 - f)
      this.vx *= f
      this.vy *= f
      if (Math.hypot(this.vx, this.vy) < 4) {
        this.vx = this.vy = 0
        this.pan = null
      }
    }
    // a zoom about a point: the board under it stays under it (a spring's target too)
    if (z?.anchor && this.l !== l0) {
      const f = Math.exp(this.l - l0)
      const { x: ax, y: ay } = z.anchor
      this.x = ax - (ax - this.x) * f
      this.y = ay - (ay - this.y) * f
      if (this.pan?.kind === 'spring') {
        this.pan.tx = ax - (ax - this.pan.tx) * f
        this.pan.ty = ay - (ay - this.pan.ty) * f
      }
    }
  }
}

// ---- a shake ----

/**
 * A held thing shaken: the sideways speed turning back and forth quickly. `push` it the velocity each frame; it says
 * true once, when the speed has reversed `turns` times within `windowMs` (each leg faster than `minSpeed` px/s).
 */
export class ShakeDetector {
  private sign = 0
  private turns: number[] = []
  constructor(
    private need = 3,
    private windowMs = 600,
    private minSpeed = 350
  ) {}
  reset(): void {
    this.sign = 0
    this.turns = []
  }
  push(t: number, vx: number): boolean {
    if (Math.abs(vx) < this.minSpeed) return false
    const s = Math.sign(vx)
    if (this.sign !== 0 && s !== this.sign) this.turns.push(t)
    this.sign = s
    this.turns = this.turns.filter((x) => t - x <= this.windowMs)
    if (this.turns.length >= this.need) {
      this.turns = []
      return true
    }
    return false
  }
}

// ---- a throw's carry ----

const reach = new Map<SpringParams, number>()
/** How far a spring from rest at its target travels at most when started at 1 unit/s (s). */
export function springReach(p: SpringParams): number {
  let r = reach.get(p)
  if (r === undefined) {
    let s = { x: 0, v: 1 }
    r = 0
    for (let i = 0; i < 240; i++) {
      s = stepSpring(s, p, 1 / 120)
      r = Math.max(r, Math.abs(s.x))
    }
    reach.set(p, r)
  }
  return r
}

/**
 * The speed a let-go thing carries into its settle on spring `p`: `share` of the throw's, but never so much that it
 * would glide past its place by more than `maxGlide` (same units as the velocity, per second).
 */
export function carryVelocity(v: Pt, p: SpringParams, share: number, maxGlide: number): Pt {
  const x = v.x * share
  const y = v.y * share
  const sp = Math.hypot(x, y)
  const cap = maxGlide / springReach(p)
  if (!Number.isFinite(sp) || sp === 0) return { x: 0, y: 0 }
  const f = sp > cap ? cap / sp : 1
  return { x: x * f, y: y * f }
}
