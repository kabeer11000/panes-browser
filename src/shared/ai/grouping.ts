import { agglomerative } from './cluster'
import { parseJsonObject } from './titles'

export const MIN_UNGROUPED_TABS = 6
export const SUGGEST_INTERVAL_MS = 2 * 60_000
export const GROUP_NAME_MAX = 32

export interface GroupTab {
  id: number
  url: string
  title: string
  vec: ArrayLike<number>
}

/** Sets of tab ids that are about the same thing (at least GROUP_MIN_SIZE tabs each). */
export function planGroups(tabs: GroupTab[], threshold?: number, minSize?: number): number[][] {
  return agglomerative(
    tabs.map((t) => t.vec),
    threshold,
    minSize
  ).map((g) => g.map((i) => tabs[i].id))
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** A group name from the most common site among its tabs ("github.com" gives "Github"). */
export function fallbackName(urls: string[]): string {
  const counts = new Map<string, number>()
  for (const u of urls) {
    const h = hostOf(u)
    if (h) counts.set(h, (counts.get(h) ?? 0) + 1)
  }
  let best = ''
  let n = 0
  for (const [h, c] of counts) {
    if (c > n) {
      best = h
      n = c
    }
  }
  const label = best.split('.').slice(-2, -1)[0] || best
  return (label.charAt(0).toUpperCase() + label.slice(1)).slice(0, GROUP_NAME_MAX) || 'Tabs'
}

/** A model's group name made safe: one line, 2 to 3 words at most, short. Null if nothing usable. */
export function sanitizeGroupName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const line = (raw.split(/\r?\n/).find((l) => l.trim()) ?? '').replace(/\p{Cc}/gu, ' ')
  const cleaned = line
    .replace(/["'`.]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const words = cleaned.split(' ').filter(Boolean).slice(0, 3).join(' ')
  return words.slice(0, GROUP_NAME_MAX).trim() || null
}

/** Pulls {"name": "..."} out of a model's reply. */
export const nameFromReply = (text: string): string | null =>
  sanitizeGroupName(parseJsonObject(text)?.name)

/**
 * When a suggestion may be made, and what the person already said no to. At most one run per space every
 * SUGGEST_INTERVAL_MS, and only when enough tabs are ungrouped; a dismissed set is not suggested again this
 * session, nor any part of it.
 */
export class GroupSuggestionState {
  private lastRun = new Map<number, number>()
  private dismissed = new Map<number, number[][]>()

  due(spaceId: number, ungrouped: number, now: number): boolean {
    if (ungrouped < MIN_UNGROUPED_TABS) return false
    const last = this.lastRun.get(spaceId)
    return last === undefined || now - last >= SUGGEST_INTERVAL_MS
  }

  markRun(spaceId: number, now: number): void {
    this.lastRun.set(spaceId, now)
  }

  dismiss(spaceId: number, ids: number[]): void {
    this.dismissed.set(spaceId, [...(this.dismissed.get(spaceId) ?? []), ids])
  }

  isDismissed(spaceId: number, ids: number[]): boolean {
    if (ids.length === 0) return false
    return (this.dismissed.get(spaceId) ?? []).some((d) => ids.every((i) => d.includes(i)))
  }

  /** The suggestions not yet turned down. */
  remaining(spaceId: number, groups: number[][]): number[][] {
    return groups.filter((g) => !this.isDismissed(spaceId, g))
  }
}
