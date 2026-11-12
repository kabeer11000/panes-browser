/**
 * Two fingers that land at the touchpad's top edge and slide down: the preview's "put it away" gesture, like pulling
 * a sheet down. Fed the frames of shared/touchContacts.ts (mm, y measured from the pad's top edge).
 */

/** Fingers landing this close to the top edge (mm) start the gesture; further in is an ordinary scroll. */
export const EDGE_MM = 8
/** How far down (mm) they must slide before it counts. */
export const TRAVEL_MM = 18

export interface PadFrame {
  dx: number
  dy: number
  fingers: number
  /** The fingers' mean distance from the pad's top edge, in mm. */
  y: number
}

export class EdgeSwipe {
  private fingers = 0
  private armed = false
  private down = 0
  private side = 0

  /** Feed one frame; true on the frame the gesture completes (once per swipe). */
  touch(f: PadFrame): boolean {
    const landed = f.fingers === 2 && this.fingers < 2
    this.fingers = f.fingers
    if (landed) {
      this.armed = f.y <= EDGE_MM
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
    if (this.down < -2 || this.side > TRAVEL_MM) {
      this.armed = false // up or sideways: a scroll after all
      return false
    }
    if (this.down >= TRAVEL_MM && this.down > 2 * this.side) {
      this.armed = false
      return true
    }
    return false
  }
}
