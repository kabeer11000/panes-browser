import { app } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'fs'
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
    this.timer = setTimeout(() => this.flush(), 500)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      const tmp = this.file + '.tmp'
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
