import type { Settings } from './types'

/** Memory saver choices; a preset is just a named pair of the two numbers below. */
export const IDLE_CHOICES_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 240] as const
export const MAX_LOADED_CHOICES = [0, 3, 5, 8, 12, 20, 30] as const // 0 means no limit
export const OTHER_SPACE_IDLE_MIN = 2

export const MEMORY_PRESETS = {
  relaxed: { unloadIdleMin: 60, maxLoadedTabs: 0 },
  balanced: { unloadIdleMin: 30, maxLoadedTabs: 0 },
  aggressive: { unloadIdleMin: 5, maxLoadedTabs: 8 }
} as const
export type MemoryPreset = keyof typeof MEMORY_PRESETS

/** Which preset the two numbers add up to, or 'custom' when they match none. */
export function presetOf(
  s: Pick<Settings, 'unloadIdleMin' | 'maxLoadedTabs'>
): MemoryPreset | 'custom' {
  for (const [name, p] of Object.entries(MEMORY_PRESETS)) {
    if (p.unloadIdleMin === s.unloadIdleMin && p.maxLoadedTabs === s.maxLoadedTabs) {
      return name as MemoryPreset
    }
  }
  return 'custom'
}

const MAX_SITES = 100

/** Zoom levels the browser allows (Chromium's own range is 25% to 500%). */
export const ZOOM_LEVEL_MIN = -7
export const ZOOM_LEVEL_MAX = 8

/** Untrusted map (host name to zoom level) to host names with a sane level, 100% included (a site can opt out of a larger default). */
export function normalizeZoom(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [host, level] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeSites([host])[0]
    if (!key || typeof level !== 'number' || !Number.isFinite(level)) continue
    const clamped = Math.min(ZOOM_LEVEL_MAX, Math.max(ZOOM_LEVEL_MIN, Math.round(level * 2) / 2))
    out[key] = clamped
  }
  return out
}

/** Untrusted list (it can come from a panes:// page) to bare, lowercase, de-duplicated host names. */
export function normalizeSites(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    if (/\s/.test(item.trim())) continue
    const host = item
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/^www\./, '')
      .split(/[/?#:\s]/)[0]
    if (host && host.length <= 100 && /^[a-z0-9.-]+$/.test(host)) out.add(host)
    if (out.size >= MAX_SITES) break
  }
  return [...out]
}

/** A site is exempt when its host is a listed one or a subdomain of it. */
export function siteListed(host: string, sites: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  return sites.some((s) => h === s || h.endsWith('.' + s))
}

export interface MemoryPolicy {
  enabled: boolean
  idleMin: number
  /** Most tabs kept loaded; 0 means no limit. */
  maxLoaded: number
  /** Tabs in spaces you are not in unload after OTHER_SPACE_IDLE_MIN. */
  otherSpaces: boolean
  neverSites: readonly string[]
}

export interface TabFacts {
  id: number
  /** A page is loaded (not already unloaded, not blank). */
  loaded: boolean
  /** On screen right now. */
  visible: boolean
  /** Playing sound, in picture in picture, downloading, or otherwise worth keeping alive. */
  busy: boolean
  host: string
  inActiveSpace: boolean
  /** Last time it was on screen, ms since epoch. */
  lastShownAt: number
}

/**
 * Which tabs to unload now. Visible, busy and listed-site tabs are never picked. With `force`
 * every other loaded tab goes (the "free memory now" button); otherwise a tab goes once it has
 * been idle long enough, and then the least recently shown ones go until the loaded-tab limit holds.
 */
export function pickUnloads(
  tabs: readonly TabFacts[],
  policy: MemoryPolicy,
  now: number,
  force = false
): number[] {
  if (!policy.enabled && !force) return []
  const eligible = tabs.filter(
    (t) => t.loaded && !t.visible && !t.busy && !siteListed(t.host, policy.neverSites)
  )
  if (force) return eligible.map((t) => t.id)

  const picked = new Set<number>()
  for (const t of eligible) {
    const idleMin =
      !t.inActiveSpace && policy.otherSpaces
        ? Math.min(policy.idleMin, OTHER_SPACE_IDLE_MIN)
        : policy.idleMin
    if (now - t.lastShownAt >= idleMin * 60_000) picked.add(t.id)
  }

  if (policy.maxLoaded > 0) {
    let loaded = tabs.filter((t) => t.loaded && !picked.has(t.id)).length
    const oldestFirst = eligible
      .filter((t) => !picked.has(t.id))
      .sort((a, b) => a.lastShownAt - b.lastShownAt)
    for (const t of oldestFirst) {
      if (loaded <= policy.maxLoaded) break
      picked.add(t.id)
      loaded--
    }
  }
  return [...picked]
}
