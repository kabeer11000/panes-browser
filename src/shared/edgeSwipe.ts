/**
 * Two fingers that land at the touchpad's top edge and slide down: the preview's "put it away" gesture, like pulling
 * a sheet down. Fed the frames of shared/touchContacts.ts (mm, y measured from the pad's top edge).
 */

import type { PreviewSwipe } from './types'

/**
 * How strict the gesture is, per the setting: fingers landing within `edgeMm` of the top edge start it (further in
 * is an ordinary scroll), and it counts once they have slid `travelMm` down. "edge" asks for the very edge, where a
 * laptop's ordinary two-finger scroll hardly ever starts.
 */
export const SWIPE_ZONES: Record<
  Exclude<PreviewSwipe, 'off'>,
  { edgeMm: number; travelMm: number }
> = {
  edge: { edgeMm: 3, travelMm: 22 },
  easy: { edgeMm: 8, travelMm: 18 }
}

export interface PadFrame {
  dx: number
  dy: number
  fingers: number
  /** The fingers' mean distance from the pad's top edge, in mm. */
  y: number
}

export class EdgeSwipe {
  /** Which zone it uses: may be changed between swipes (the setting changed). */
  zone = SWIPE_ZONES.edge
  private fingers = 0
  private armed = false
  private down = 0
  private side = 0

  /** Feed one frame; true on the frame the gesture completes (once per swipe). */
  touch(f: PadFrame): boolean {
    const landed = f.fingers === 2 && this.fingers < 2
    this.fingers = f.fingers
    if (landed) {
      this.armed = f.y <= this.zone.edgeMm
      this.down = 0
      this.side = 0
      return false
    }
    if (!this.armed || f.fingers !== 2) {
      this.armed = false
      return false
    }
    this.down += f.dy
    this.side += Math.abs(f.dx)
    if (this.down < -2 || this.side > this.zone.travelMm) {
      this.armed = false // up or sideways: a scroll after all
      return false
    }
    if (this.down >= this.zone.travelMm && this.down > 2 * this.side) {
      this.armed = false
      return true
    }
    return false
  }
}
