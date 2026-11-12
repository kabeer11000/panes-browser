/** One finger slot of a precision touchpad report, positions already in mm. */
export interface Contact {
  id: number
  tip: boolean
  x: number
  y: number
}

/**
 * Builds whole frames out of precision touchpad reports and turns them into two-finger motion.
 *
 * A report carries a contact count and a few finger slots. In parallel mode one report holds every contact; in
 * hybrid mode the first report has the count and the next ones (count 0) carry the remaining contacts.
 * Motion is the mean move of the contacts present in both this frame and the last, so a finger landing or lifting
 * does not jump the centroid.
 */
export class ContactFrames {
  private expected = 0
  private building: Contact[] = []
  private last = new Map<number, Contact>()

  /**
   * Returns a finished frame's motion and where the fingers are (`y`: their mean distance from the pad's top edge,
   * mm; 0 with none down), or null while a hybrid frame is still coming in.
   */
  feed(
    count: number,
    slots: Contact[]
  ): { dx: number; dy: number; fingers: number; y: number } | null {
    if (count > 0) {
      this.expected = count
      this.building = []
    }
    if (this.expected === 0) return null
    for (const s of slots) {
      if (this.building.length >= this.expected) break
      this.building.push(s)
    }
    if (this.building.length < this.expected) return null
    const down = this.building.filter((c) => c.tip)
    this.expected = 0
    this.building = []
    let dx = 0
    let dy = 0
    let n = 0
    for (const c of down) {
      const p = this.last.get(c.id)
      if (!p) continue
      dx += c.x - p.x
      dy += c.y - p.y
      n++
    }
    this.last = new Map(down.map((c) => [c.id, c]))
    const y = down.length ? down.reduce((sum, c) => sum + c.y, 0) / down.length : 0
    return { dx: n ? dx / n : 0, dy: n ? dy / n : 0, fingers: down.length, y }
  }
}
