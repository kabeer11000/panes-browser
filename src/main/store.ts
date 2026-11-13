import { app } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { rename, writeFile } from 'fs/promises'
import { join } from 'path'

const stores = new Set<JsonStore<unknown>>()

/** Small JSON-file persistence with debounced atomic writes. Object fallbacks are merged over what's on disk. */
export class JsonStore<T> {
  value: T
  private file: string
  private timer: NodeJS.Timeout | null = null

  constructor(name: string, fallback: T) {
    this.file = join(app.getPath('userData'), `${name}.json`)
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      this.value = Array.isArray(fallback) ? (raw as T) : { ...fallback, ...(raw as object) }
    } catch {
      this.value = fallback
    }
    stores.add(this as JsonStore<unknown>)
  }

  save(): void {
    if (this.timer) return
    this.timer = setTimeout(() => void this.write(), 500)
  }

  /**
   * The debounced write: off the main thread's way (a big file such as the history would hold up input and IPC for
   * the length of a synchronous write). One at a time; a save while one is running writes again after it.
   */
  private writing: Promise<void> | null = null
  private seq = 0
  private flushedAt = 0
  private async write(): Promise<void> {
    this.timer = null
    if (this.writing) {
      await this.writing
      // (TypeScript cannot see the write's own `finally` clearing it while this waited)
      if (this.timer || (this.writing as Promise<void> | null)) return // a later save, or another waiter, has it
    }
    const started = ++this.seq
    const tmp = this.file + '.tmp'
    const text = JSON.stringify(this.value)
    this.writing = writeFile(tmp, text)
      // a synchronous flush since (quitting) wrote newer contents: this older copy must not land over them
      .then(() => (this.flushedAt > started ? undefined : rename(tmp, this.file)))
      .catch((err) => console.error('[store] write failed:', this.file, err))
      .finally(() => (this.writing = null))
    await this.writing
  }

  /** Write now, synchronously (Panes is quitting). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.flushedAt = ++this.seq
    try {
      const tmp = this.file + '.sync.tmp' // never the file an unfinished async write is using
      writeFileSync(tmp, JSON.stringify(this.value))
      renameSync(tmp, this.file)
    } catch (err) {
      console.error('[store] write failed:', this.file, err)
    }
  }
}

export function flushAllStores(): void {
  for (const s of stores) s.flush()
}
