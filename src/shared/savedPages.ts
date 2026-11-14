/** A page saved to disk (main/savedPages.ts): shown at once, from disk, while its tab loads the live page again. */
export interface SavedPage {
  /** File name in the saved-pages folder. */
  file: string
  /** When it was saved, ms since epoch. */
  at: number
  bytes: number
  /** Where the page was scrolled to. */
  y: number
}

/** All saved pages together stay under this; the oldest go first. */
export const SAVED_BUDGET_BYTES = 300 * 1024 ** 2
/** A page bigger than this is not kept: it would be slower to open from disk than worth it. */
export const SAVED_MAX_BYTES = 25 * 1024 ** 2
/** A page saved this recently is not saved again on leaving the screen unless it changed. */
export const SAVED_FRESH_MS = 2 * 60_000

/**
 * The saved pages to delete: those no tab holds any more (`keep`, by address), then the oldest of the rest until all
 * fit in `budget` bytes.
 */
export function prunePlan(
  saved: Readonly<Record<string, SavedPage>>,
  keep: ReadonlySet<string>,
  budget = SAVED_BUDGET_BYTES
): string[] {
  const out = Object.keys(saved).filter((url) => !keep.has(url))
  let total = 0
  const kept = Object.entries(saved).filter(([url]) => keep.has(url))
  for (const [, p] of kept) total += p.bytes
  for (const [url, p] of kept.sort((a, b) => a[1].at - b[1].at)) {
    if (total <= budget) break
    out.push(url)
    total -= p.bytes
  }
  return out
}
