import { leaves, type LayoutNode } from './layout'
import type { TabInfo } from './types'

/** One card in the Ctrl+wheel stack: a single tab, or a whole tiled group shown as one card. */
export interface StackEntry {
  key: string
  tabs: TabInfo[]
  /** The tiling for a group card; null for a single tab. */
  layout: LayoutNode | null
  /** The tab to activate when this card is chosen. */
  primaryId: number
}

/**
 * Collapse a tiled group into one entry at its first member's position. Group members are kept
 * contiguous in the tab list, so this matches what the sidebar shows.
 */
export function stackEntries(
  tabs: TabInfo[],
  layout: LayoutNode | null,
  activeId: number | null
): StackEntry[] {
  const group = layout ? leaves(layout) : []
  const isGroup = group.length > 1
  const byId = new Map(tabs.map((t) => [t.id, t]))
  const entries: StackEntry[] = []
  let groupEmitted = false

  for (const tab of tabs) {
    if (isGroup && group.includes(tab.id)) {
      if (groupEmitted) continue
      groupEmitted = true
      entries.push({
        key: `g${group.join('-')}`,
        tabs: group.map((id) => byId.get(id)).filter((t): t is TabInfo => !!t),
        layout,
        primaryId: activeId !== null && group.includes(activeId) ? activeId : group[0]
      })
    } else {
      entries.push({ key: `t${tab.id}`, tabs: [tab], layout: null, primaryId: tab.id })
    }
  }
  return entries
}
