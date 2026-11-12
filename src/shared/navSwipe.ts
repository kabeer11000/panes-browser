/**
 * Two-finger touchpad gestures for the tab view (Windows precision touchpads, from the raw contacts; see
 * main/gestures.ts): a sideways swipe goes back or forward in the history of the page, and a swipe that starts at
 * the left or right edge of the pad switches to the previous or next tab. Both follow the fingers (`track`, with how
 * far along they are) and act only when the fingers lift past the mark, so sliding back takes it back.
 */

export type NavAction = 'back' | 'forward' | 'prevTab' | 'nextTab'

export interface NavFrame {
  /** Mean motion since the last frame, mm. */
  dx: number
  dy: number
  fingers: number
  /** Where the fingers are, mm from the left and top edges of the pad, and how wide the pad is. */
  x: number
  y: number
  padW: number
  /** The leftmost and rightmost finger (mm from the left edge); `x` when not given. */
  xMin?: number
  xMax?: number
}

export type NavEvent =
  | { kind: 'track'; action: NavAction; progress: number }
  | { kind: 'commit'; action: NavAction }
  | { kind: 'cancel' }

/** A finger landing this close (mm) to the left or right edge starts a tab switch. */
export const NAV_EDGE_MM = 6
/** Travel (mm) that completes a tab switch, and a history step. */
export const TAB_MM = 22
export const HISTORY_MM = 40
/** A history swipe shows only past this much sideways travel (mm), so a plain scroll is not interrupted. */
const HISTORY_START_MM = 8

export class NavSwipe {
  /** Which gestures are on (Settings). */
  history = true
  tabs = true
  private fingers = 0
  private mode: 'none' | 'tab' | 'history' = 'none'
  private edge: 'left' | 'right' | null = null
  private sx = 0
  private sy = 0
  private tracking: NavAction | null = null
  private progress = 0

  /** Feed one frame; what it means, or null for nothing (yet). */
  touch(f: NavFrame): NavEvent | null {
    const landed = f.fingers === 2 && this.fingers < 2
    const was = this.fingers
    this.fingers = f.fingers
    if (landed) {
      this.sx = this.sy = 0
      this.progress = 0
      this.tracking = null
      this.edge =
        f.padW > 0 && (f.xMin ?? f.x) <= NAV_EDGE_MM
          ? 'left'
          : f.padW > 0 && (f.xMax ?? f.x) >= f.padW - NAV_EDGE_MM
            ? 'right'
            : null
      this.mode = this.edge && this.tabs ? 'tab' : this.history ? 'history' : 'none'
      return null
    }
    if (f.fingers !== 2) {
      // lifted (or a third finger joined): act if it went far enough, else let it go
      const lifted = was === 2 && f.fingers < 2
      const act = lifted && this.tracking && this.progress >= 1 ? this.tracking : null
      const had = this.tracking !== null
      this.drop()
      if (act) return { kind: 'commit', action: act }
      return had ? { kind: 'cancel' } : null
    }
    if (this.mode === 'none') return null
    this.sx += f.dx
    this.sy += f.dy
    // up or down more than sideways: a scroll, not this
    if (Math.abs(this.sy) > Math.max(6, Math.abs(this.sx) * 0.7)) return this.cancel()
    let action: NavAction
    let progress: number
    if (this.mode === 'tab') {
      const inward = this.edge === 'left' ? this.sx : -this.sx
      if (inward < -3) return this.cancel() // went off the edge, not in from it
      action = this.edge === 'left' ? 'prevTab' : 'nextTab'
      progress = Math.max(0, inward) / TAB_MM
    } else {
      if (this.tracking === null && Math.abs(this.sx) < HISTORY_START_MM) return null
      action = this.sx > 0 ? 'back' : 'forward'
      progress = Math.max(0, Math.abs(this.sx) - HISTORY_START_MM) / (HISTORY_MM - HISTORY_START_MM)
      // turned round past where it started: the other way now, from nothing
      if (this.tracking !== null && this.tracking !== action) progress = 0
    }
    this.tracking = action
    this.progress = Math.min(1, progress)
    return { kind: 'track', action, progress: this.progress }
  }

  /** This gesture is not one after all: what was shown goes. */
  private cancel(): NavEvent | null {
    const had = this.tracking !== null
    this.drop()
    return had ? { kind: 'cancel' } : null
  }

  private drop(): void {
    this.mode = 'none'
    this.tracking = null
    this.progress = 0
  }
}
