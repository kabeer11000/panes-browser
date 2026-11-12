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
   * How many finger slots of a report with this contact count can still go into the frame: the rest are empty, and
   * need not be read (each costs main a few calls into the HID parser).
   */
  room(count: number): number {
    return count > 0 ? count : Math.max(0, this.expected - this.building.length)
  }

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

/**
 * Puts the touchpad's own report times (HID Scan Time: 0.1 ms steps, wrapping every 6.5536 s) on the system clock.
 * Main reads reports when it gets round to it, so its own clock bunches them whenever it is busy; the pad's times are
 * even. The offset between the two clocks is taken from the quickest report seen (the least delay is the truest),
 * allowed to creep forward a little so the pad's clock drifting from the system's is followed.
 */
export class ScanClock {
  private lastRaw = -1
  private hw = 0
  private off = NaN
  private lastAt = 0

  /** The report's time on the system clock (ms), given its scan time (or null) and when main read it (`at`, ms). */
  time(raw: number | null, at: number): number {
    if (raw === null || !Number.isFinite(at)) return at
    const gap = at - this.lastAt
    this.lastAt = at
    if (this.lastRaw < 0 || gap > 3000) {
      // first report, or a pause long enough that the counter may have wrapped unseen: start again from here
      this.hw = 0
      this.off = at
    } else this.hw += ((raw - this.lastRaw + 65536) % 65536) / 10
    this.lastRaw = raw
    this.off = Math.min(this.off + gap * 0.0005, at - this.hw)
    const t = this.hw + this.off
    // a pad whose clock runs wild (or a counter that is not one): fall back on main's time
    if (at - t > 100) {
      this.off = at - this.hw
      return at
    }
    return Math.min(t, at)
  }
}
