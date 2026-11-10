// The assistant tidying a page to the person's liking ("only my Jira cards", "no Shorts"): the model only gives words
// to keep or hide; this finds the page's repeated items (cards, rows, video tiles) and hides those that do not fit.
// Nothing site-specific, so a small model is enough.

export interface FilterArgs {
  keep: string[]
  hide: string[]
  /** Show everything again (undo an earlier filter). */
  reset: boolean
}
export interface FilterResult {
  items: number
  hidden: number
}

/** Whether an item stays: it holds one of `keep` (any item, when none is given) and none of `hide`. Case-insensitive. */
export function wants(text: string, keep: string[], hide: string[]): boolean {
  const t = text.toLowerCase()
  if (hide.some((h) => h && t.includes(h.toLowerCase()))) return false
  return keep.length === 0 || keep.some((k) => k && t.includes(k.toLowerCase()))
}

/**
 * Runs in the page (injected as its source, with `want` being `wants`). The page's items are the elements of the
 * shape (tag and classes) that repeats most over the most room; a shape inside a bigger one is taken instead when it
 * is about as big and there are clearly several per bigger one (a row of tiles gives its tiles, a row with its title
 * stays the row). Hidden items are marked, so a reset (or the next filter) brings
 * them back first.
 * ponytail: one shape per page; a page with two lists side by side of different shapes filters only the bigger.
 */
export function filterInPage(
  want: (text: string, keep: string[], hide: string[]) => boolean,
  args: FilterArgs
): FilterResult {
  const MARK = 'data-panes-filtered'
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[${MARK}]`))) {
    el.style.removeProperty('display')
    el.removeAttribute(MARK)
  }
  if (args.reset) return { items: 0, hidden: 0 }
  const view = innerWidth * innerHeight
  const groups = new Map<string, HTMLElement[]>()
  for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
    if (!el.className || typeof el.className !== 'string') continue
    const r = el.getBoundingClientRect()
    const a = r.width * r.height
    if (a < 1500 || a > view * 0.45 || (el.innerText || '').trim().length < 2) continue
    const sig = el.tagName + '.' + Array.from(el.classList).sort().join('.')
    const g = groups.get(sig)
    if (g) g.push(el)
    else groups.set(sig, [el])
  }
  const area = (els: HTMLElement[]): number =>
    els.reduce((s, e) => {
      const r = e.getBoundingClientRect()
      return s + r.width * r.height
    }, 0)
  const ranked = [...groups.values()]
    .filter((g) => g.length >= 4)
    .map((g) => ({ g, score: area(g) }))
    .sort((a, b) => b.score - a.score)
  let pick = ranked[0]
  if (!pick) return { items: 0, hidden: 0 }
  for (const c of ranked.slice(1)) {
    if (c.score < pick.score * 0.5) break
    // several per bigger item (tiles in a row): those are the items; about one each (a title in a row): the row is
    if (
      c.g.length >= pick.g.length * 1.5 &&
      c.g.some((e) => pick.g.some((p) => p !== e && p.contains(e)))
    )
      pick = c
  }
  let hidden = 0
  for (const el of pick.g) {
    if (want(el.innerText || '', args.keep, args.hide)) continue
    el.setAttribute(MARK, '')
    el.style.setProperty('display', 'none', 'important')
    hidden++
  }
  return { items: pick.g.length, hidden }
}

/** The script to run in the page. */
export const filterScript = (args: FilterArgs): string =>
  `(${filterInPage.toString()})((${wants.toString()}), ${JSON.stringify(args)})`
