import type { Bookmark, HistoryEntry } from '../shared/types'
import { JsonStore } from './store'

const MAX_ENTRIES = 20000
const DUPLICATE_WINDOW_MS = 5000

const isWeb = (url: string): boolean => /^https?:\/\//i.test(url)

interface HistoryData {
  nextId: number
  entries: HistoryEntry[] // newest first
}

export class HistoryStore {
  private store = new JsonStore<HistoryData>('history', { nextId: 1, entries: [] })

  add(url: string, title: string): void {
    if (!isWeb(url)) return
    const d = this.store.value
    const top = d.entries[0]
    const now = Date.now()
    if (top && top.url === url && now - top.time < DUPLICATE_WINDOW_MS) {
      top.time = now // reload or redirect echo, not a new visit
    } else {
      d.entries.unshift({ id: d.nextId++, url, title, favicon: null, time: now })
      if (d.entries.length > MAX_ENTRIES) d.entries.length = MAX_ENTRIES
    }
    this.store.save()
  }

  /** Titles and favicons arrive after navigation commits, so patch the most recent visit. */
  updateMeta(url: string, meta: { title?: string; favicon?: string | null }): void {
    const entry = this.store.value.entries.slice(0, 5).find((e) => e.url === url)
    if (!entry) return
    if (meta.title) entry.title = meta.title
    if (meta.favicon) entry.favicon = meta.favicon
    this.store.save()
  }

  list(query: string, limit: number, offset: number): HistoryEntry[] {
    const q = query.trim().toLowerCase()
    const all = this.store.value.entries
    const hits = q
      ? all.filter((e) => e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q))
      : all
    return hits.slice(offset, offset + limit)
  }

  remove(id: number): void {
    const d = this.store.value
    d.entries = d.entries.filter((e) => e.id !== id)
    this.store.save()
  }

  /** Clear everything, or only visits newer than `sinceMs` milliseconds ago. */
  clear(sinceMs: number | null): void {
    const d = this.store.value
    const cutoff = sinceMs === null ? Infinity : Date.now() - sinceMs
    d.entries = sinceMs === null ? [] : d.entries.filter((e) => e.time < cutoff)
    this.store.save()
  }
}

interface BookmarkData {
  nextId: number
  items: Bookmark[] // newest first
}

export class BookmarkStore {
  private store = new JsonStore<BookmarkData>('bookmarks', { nextId: 1, items: [] })

  list(): Bookmark[] {
    return this.store.value.items
  }

  has(url: string): boolean {
    return this.store.value.items.some((b) => b.url === url)
  }

  /** Add the page, or remove it if already bookmarked. Returns true when it is now bookmarked. */
  toggle(url: string, title: string, favicon: string | null): boolean {
    const d = this.store.value
    if (this.has(url)) {
      d.items = d.items.filter((b) => b.url !== url)
      this.store.save()
      return false
    }
    d.items.unshift({ id: d.nextId++, url, title: title || url, favicon, time: Date.now() })
    this.store.save()
    return true
  }

  remove(id: number): void {
    const d = this.store.value
    d.items = d.items.filter((b) => b.id !== id)
    this.store.save()
  }
}
