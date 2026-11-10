/** A tab's back and forward list, kept across a restart or a memory unload (see main/tabs.ts). */
export interface NavEntry {
  url: string
  title: string
}
export interface NavHistory {
  entries: NavEntry[]
  index: number
}

const KEEP = /^(https?|file):/i
const FORWARD = 5

/**
 * The part of a back/forward list worth keeping: web and file pages only (not panes:// or about:), at most `max`
 * entries, mostly behind the current one. Null when there is nothing to go back or forward to. Takes anything, so it
 * also checks a list read back from disk.
 */
export function keepHistory(entries: unknown, index: unknown, max = 25): NavHistory | null {
  if (!Array.isArray(entries) || typeof index !== 'number') return null
  const kept: NavEntry[] = []
  let at = -1
  entries.forEach((e: unknown, i) => {
    const r = e as { url?: unknown; title?: unknown } | null
    if (!r || typeof r.url !== 'string' || !KEEP.test(r.url)) return
    if (i === index) at = kept.length
    kept.push({ url: r.url, title: typeof r.title === 'string' ? r.title.slice(0, 300) : '' })
  })
  if (at < 0 || kept.length < 2) return null
  const fwd = Math.min(kept.length - 1 - at, FORWARD)
  const back = Math.min(at, max - 1 - fwd)
  return { entries: kept.slice(at - back, at + fwd + 1), index: back }
}
