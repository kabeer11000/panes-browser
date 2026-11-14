/** A tab's back and forward list, kept across a restart or a memory unload (see main/tabs.ts). */
export interface NavEntry {
  url: string
  title: string
  /** Chromium's saved state of the page (scroll position, form values): kept for the current entry only. */
  pageState?: string
}
export interface NavHistory {
  entries: NavEntry[]
  index: number
}

const KEEP = /^(https?|file):/i
const FORWARD = 5
/** A larger saved page state is dropped: the page then simply opens at its top. */
const MAX_PAGE_STATE = 64 * 1024

/**
 * The part of a back/forward list worth keeping: web and file pages only (not panes:// or about:), at most `max`
 * entries, mostly behind the current one, with the current entry's saved page state (scroll, forms), so a page
 * brought back opens where it was, from cache. Null when the current entry is not one of those. Takes anything, so
 * it also checks a list read back from disk.
 */
export function keepHistory(entries: unknown, index: unknown, max = 25): NavHistory | null {
  if (!Array.isArray(entries) || typeof index !== 'number') return null
  const kept: NavEntry[] = []
  let at = -1
  entries.forEach((e: unknown, i) => {
    const r = e as { url?: unknown; title?: unknown; pageState?: unknown } | null
    if (!r || typeof r.url !== 'string' || !KEEP.test(r.url)) return
    const entry: NavEntry = {
      url: r.url,
      title: typeof r.title === 'string' ? r.title.slice(0, 300) : ''
    }
    if (i === index) {
      at = kept.length
      const state = r.pageState
      if (typeof state === 'string' && state.length > 0 && state.length <= MAX_PAGE_STATE)
        entry.pageState = state
    }
    kept.push(entry)
  })
  if (at < 0) return null
  const fwd = Math.min(kept.length - 1 - at, FORWARD)
  const back = Math.min(at, max - 1 - fwd)
  return { entries: kept.slice(at - back, at + fwd + 1), index: back }
}
