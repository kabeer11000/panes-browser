import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Pictures this big or bigger wait on disk instead of in memory (a full-size one is a few hundred KB). */
const DISK_FROM = 96 * 1024

/**
 * The tabs' pictures (JPEG bytes), by tab id. Small ones are kept in memory; big ones (a full-size picture of a page
 * that left the screen) are written to a folder of this run's and read back when asked for, so a window of many tabs
 * does not hold megabytes of pictures nobody is looking at. A private or Tor tab's picture never goes to disk.
 */
export class TabPics {
  private mem = new Map<number, Buffer>()
  private disk = new Map<number, string>()
  private made = false

  constructor(private dir: string) {
    // the last run's pictures name tabs that are gone
    rmSync(dir, { recursive: true, force: true })
  }

  set(id: number, jpeg: Buffer, mayDisk: boolean): void {
    this.drop(id)
    if (!mayDisk || jpeg.length < DISK_FROM) return void this.mem.set(id, jpeg)
    try {
      if (!this.made) mkdirSync(this.dir, { recursive: true })
      this.made = true
      // a new name for each picture: one being read for the window is never half overwritten
      const file = join(this.dir, `${id}-${Date.now().toString(36)}.jpg`)
      writeFileSync(file, jpeg)
      this.disk.set(id, file)
    } catch {
      this.mem.set(id, jpeg) // a full or read-only disk: kept in memory as before
    }
  }

  has(id: number): boolean {
    return this.mem.has(id) || this.disk.has(id)
  }

  get(id: number): Buffer | null {
    const m = this.mem.get(id)
    if (m) return m
    const file = this.disk.get(id)
    if (!file) return null
    try {
      return readFileSync(file)
    } catch {
      this.disk.delete(id)
      return null
    }
  }

  delete(id: number): void {
    this.drop(id)
  }

  private drop(id: number): void {
    this.mem.delete(id)
    const file = this.disk.get(id)
    if (!file) return
    this.disk.delete(id)
    try {
      unlinkSync(file)
    } catch {
      // already gone
    }
  }
}
