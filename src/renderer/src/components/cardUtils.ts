import type { StackEntry } from '../../../shared/stack'
import { tabTitle } from '../tabTitle'

/** Cards are sized like the page area so every tab (and group) looks the same size. */
export function pageAspect(): number {
  const r = document.querySelector('.stage')?.getBoundingClientRect()
  return r && r.height > 0 ? Math.min(2.2, Math.max(1, r.width / r.height)) : 1.4
}

export const entryTitle = (e: StackEntry): string =>
  e.tabs.length > 1 ? e.tabs.map(tabTitle).join('  |  ') : tabTitle(e.tabs[0])
