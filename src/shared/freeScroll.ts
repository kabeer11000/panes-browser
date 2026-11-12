import type { TouchpadSmoothing } from './types'

/**
 * Free (diagonal) two-finger scrolling on Windows precision touchpads.
 *
 * Chromium's Windows touchpad path (DirectManipulation) puts each scroll on rails: once a gesture starts mostly
 * along one axis, the other axis is thrown away, so the board can only pan straight. Main reads the touchpad's raw
 * contacts instead and sends their two-finger motion here as `touch` frames (millimetres on the pad).
 *
 * Windows still decides what a gesture is: its own wheel events say "this is a scroll" (or, with Ctrl, a pinch),
 * and they are what the raw motion is measured against, so the speed and direction match the system's scroll
 * settings. Only the deltas come from the raw contacts. Once a gesture is a scroll its wheel events are swallowed,
 * and when the fingers lift, Windows' (railed) inertia is swallowed too, replaced by a fling along the real
 * direction. Mice, and every platform without raw frames (macOS and Linux have no rails), take the plain wheel path.
 */

/** Two-finger motion since the previous frame, in mm; `fingers` is how many touch the pad now. */
export interface TouchFrame {
  dx: number
  dy: number
  fingers: number
  /** ms, same clock as the wheel timestamps (performance.now in the renderer). */
  t: number
}

export interface FreeScrollOutput {
  /** Pan the board by screen px (same sign as the wheel handler's panBy), for motion that happened at time `t`. */
  pan(dx: number, dy: number, t: number): void
  /** Carry on at this velocity (px per ms), slowing down. */
  fling(vx: number, vy: number): void
  /** Stop a running fling (fingers back on the pad). */
  stop(): void
}

/** Wheel px per mm of finger travel, before the first gestures measure it. Negative: fingers down, content down. */
export const DEFAULT_GAIN = -14
const MIN_GAIN = 2
const MAX_GAIN = 80
/** Windows' inertia arrives as a steady stream; a pause this long ends it (a mouse wheel after that is a mouse). */
const COAST_GAP = 90
/** No frame for this long while touching: the lift was missed (focus left the window, say). */
const STALE = 250
/** Velocity is averaged over this much of the end of a gesture. */
const VELOCITY_WINDOW = 60

type Mode = 'idle' | 'touch' | 'scroll' | 'other' | 'coast'

export class FreeScroll {
  private mode: Mode = 'idle'
  private pendX = 0
  private pendY = 0
  /** Raw motion since the last wheel event of this gesture, to pair with it. */
  private accX = 0
  private accY = 0
  private lastWheel = -Infinity
  private lastFrame = -Infinity
  private samples: { dx: number; dy: number; t: number }[] = []
  /** Running least-squares sums for the gain (wheel px = gain * mm). */
  private sxy = 0
  private sxx = 0

  constructor(
    private readonly out: FreeScrollOutput,
    public gain = DEFAULT_GAIN
  ) {
    if (!Number.isFinite(gain) || Math.abs(gain) < MIN_GAIN || Math.abs(gain) > MAX_GAIN)
      this.gain = DEFAULT_GAIN
    // a stored gain counts as a few gestures' worth of evidence, so one odd sample does not swing it
    this.sxx = 4
    this.sxy = this.gain * 4
  }

  touch(f: TouchFrame): void {
    if (this.mode !== 'idle' && this.mode !== 'coast' && f.t - this.lastFrame > STALE)
      this.lift(f.t)
    this.lastFrame = f.t
    if (f.fingers < 2) {
      if (this.mode === 'touch' || this.mode === 'scroll' || this.mode === 'other') this.lift(f.t)
      return
    }
    if (this.mode === 'idle' || this.mode === 'coast') {
      if (this.mode === 'coast') this.out.stop() // fingers back down catch the board, as Windows does
      this.mode = 'touch'
      this.pendX = this.pendY = this.accX = this.accY = 0
      this.samples = []
    }
    if (this.mode === 'other') return
    this.accX += f.dx
    this.accY += f.dy
    this.samples.push({ dx: f.dx, dy: f.dy, t: f.t })
    while (this.samples.length > 1 && f.t - this.samples[0].t > VELOCITY_WINDOW * 2)
      this.samples.shift()
    if (this.mode === 'touch') {
      this.pendX += f.dx
      this.pendY += f.dy
    } else this.out.pan(-this.gain * f.dx, -this.gain * f.dy, f.t)
  }

  /**
   * A wheel event the board would pan or zoom with (px; Ctrl for a pinch). True when it is taken care of here and
   * the caller must not act on it.
   */
  wheel(dx: number, dy: number, ctrl: boolean, t: number): boolean {
    if ((this.mode === 'touch' || this.mode === 'scroll') && t - this.lastFrame > STALE)
      this.lift(t)
    const prev = this.lastWheel
    this.lastWheel = t
    if (ctrl) {
      if (this.mode === 'touch' || this.mode === 'scroll') this.mode = 'other'
      if (this.mode === 'coast') this.mode = 'idle'
      return false
    }
    switch (this.mode) {
      case 'touch':
        this.mode = 'scroll'
        this.learn(dx, dy)
        this.out.stop()
        this.out.pan(-this.gain * this.pendX, -this.gain * this.pendY, t)
        this.pendX = this.pendY = 0
        return true
      case 'scroll':
        this.learn(dx, dy)
        return true
      case 'coast':
        if (t - prev <= COAST_GAP) return true
        this.mode = 'idle'
        return false
      default:
        return false
    }
  }

  /** Whether the gain has moved far enough from `since` to be worth storing. */
  changed(since: number): boolean {
    return Math.abs(this.gain - since) > 0.05 * Math.abs(since)
  }

  private lift(t: number): void {
    if (this.mode === 'scroll') {
      const recent = this.samples.filter((s) => t - s.t <= VELOCITY_WINDOW)
      let v = { x: 0, y: 0 }
      if (recent.length >= 2) {
        const span = Math.max(8, t - recent[0].t)
        // the first sample's motion happened before the window began
        const sx = recent.slice(1).reduce((a, s) => a + s.dx, 0)
        const sy = recent.slice(1).reduce((a, s) => a + s.dy, 0)
        v = { x: (-this.gain * sx) / span, y: (-this.gain * sy) / span }
      }
      this.mode = 'coast'
      this.out.fling(v.x, v.y)
    } else this.mode = 'idle'
    this.samples = []
  }

  /** Pair this wheel delta with the raw motion since the last one, along the axis Windows kept. */
  private learn(dx: number, dy: number): void {
    const [w, r] = Math.abs(dx) > Math.abs(dy) ? [dx, this.accX] : [dy, this.accY]
    this.accX = this.accY = 0
    if (Math.abs(r) < 0.05 || Math.abs(w) < 0.5) return
    // forget slowly, so a change in the system's scroll speed is picked up within a few gestures
    this.sxy = this.sxy * 0.98 + w * r
    this.sxx = this.sxx * 0.98 + r * r
    const g = this.sxy / this.sxx
    if (Number.isFinite(g) && Math.abs(g) >= MIN_GAIN && Math.abs(g) <= MAX_GAIN) this.gain = g
  }
}

/** Reports further apart than this (ms) are a pause, not one movement: the next one does not glide over the gap. */
const GAP_MS = 50
/** The display trails the newest report by at least this much (ms), per the smoothing setting. */
export const SMOOTHING_DELAY_MS: Record<TouchpadSmoothing, number> = {
  responsive: 4,
  balanced: 10,
  smooth: 18
}
/** ...and never by more than this, however late the reports come. */
const MAX_DELAY_MS = 40

/**
 * Smooths the raw two-finger motion to the display's frames. A touchpad reports about every 8 ms, and the reports
 * reach the page in uneven bursts, so panning by each one as it comes moves the board 0, 1 or 2 reports' worth from
 * one frame to the next: choppy, though the distance is right. Instead the motion is kept with the time of each
 * report (taken in main, before the trip over IPC) and each frame shows where the fingers were a little while ago,
 * interpolated between the reports either side, as Windows does with its own touchpad scrolling. The delay follows
 * how late the reports actually arrive. ponytail: the time is when main read the report, not the pad's own scan time
 * (HID usage 0x56); read that if main's own pauses ever show.
 */
export class PanResampler {
  /** The least the display trails the newest report (ms): the smoothing setting. */
  minDelay = SMOOTHING_DELAY_MS.balanced

  /** The total motion at each report's time, oldest first; the first is where the motion started. */
  private pts: { t: number; x: number; y: number }[] = []
  private x = 0
  private y = 0
  private shownX = 0
  private shownY = 0
  /** How late reports reach the page (ms), the worst of late, fading. */
  private late = 0

  /** Motion of (dx, dy) that happened at time `t`, seen here at `now` (same clock). */
  push(t: number, dx: number, dy: number, now: number): void {
    this.late = Math.max(now - t, this.late * 0.97)
    const last = this.pts.at(-1)
    if (!last || t - last.t > GAP_MS) this.pts.push({ t: t - 8, x: this.x, y: this.y }) // it starts moving here
    this.x += dx
    this.y += dy
    const at = Math.max(t, (this.pts.at(-1)?.t ?? t) + 0.01) // never back in time
    this.pts.push({ t: at, x: this.x, y: this.y })
  }

  get delay(): number {
    return Math.min(MAX_DELAY_MS, Math.max(this.minDelay, this.late + 4))
  }

  /** Motion to show this frame (`now`); `done` once everything pushed has been shown. */
  take(now: number): { dx: number; dy: number; done: boolean } {
    const at = now - this.delay
    let x = this.x
    let y = this.y
    const pts = this.pts
    let i = 0
    while (i < pts.length && pts[i].t <= at) i++
    if (i === 0 && pts.length)
      [x, y] = [pts[0].x, pts[0].y] // not started yet
    else if (i < pts.length) {
      const a = pts[i - 1]
      const b = pts[i]
      const f = (at - a.t) / (b.t - a.t)
      x = a.x + (b.x - a.x) * f
      y = a.y + (b.y - a.y) * f
    }
    if (i > 1) pts.splice(0, i - 1) // keep the one before `at`, to interpolate from
    return this.emit(x, y)
  }

  /** Everything not shown yet, at once (the fingers lifted: the fling carries on from where they really were). */
  flush(): { dx: number; dy: number } {
    this.pts = []
    return this.emit(this.x, this.y)
  }

  private emit(x: number, y: number): { dx: number; dy: number; done: boolean } {
    const dx = x - this.shownX
    const dy = y - this.shownY
    this.shownX = x
    this.shownY = y
    return { dx, dy, done: x === this.x && y === this.y }
  }
}
