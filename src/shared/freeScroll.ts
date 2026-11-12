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
  /** Pan the board by screen px (same sign as the wheel handler's panBy). */
  pan(dx: number, dy: number): void
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
    } else this.out.pan(-this.gain * f.dx, -this.gain * f.dy)
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
        this.out.pan(-this.gain * this.pendX, -this.gain * this.pendY)
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
