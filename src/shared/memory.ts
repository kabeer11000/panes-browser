import type { Settings } from './types'

/** Memory saver choices; a preset is just a named pair of the two numbers below. */
export const IDLE_CHOICES_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 240] as const
export const MAX_LOADED_CHOICES = [0, 3, 5, 8, 12, 20, 30] as const // 0 means no limit
export const OTHER_SPACE_IDLE_MIN = 2
/** How many recently used tabs load in the background after a restart, so they open at once; 0 is off. */
export const PRELOAD_CHOICES = [0, 3, 5, 10] as const

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
  /** Tabs in spaces you are not in rest (caches given back, frozen) after OTHER_SPACE_IDLE_MIN; see pickRests. */
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
  /** A site that messages the person (it has sent a notification or shown an unread count): unloaded, it could
   *  not tell of new messages, so it is kept, except by "free memory now". */
  messenger?: boolean
  /** Its share of its process's private memory, MB (tabs of one site share a process); unknown when absent. */
  mb?: number
}

/**
 * Free memory, MB, below which the computer is short (Chromium's own lines on Windows: 500 MB on a 4 GB machine,
 * 1 GB above). Short, Windows soon starts paging to disk, which is the slowness people feel; hidden tabs go first.
 */
export const memoryShortMb = (totalMb: number): number => (totalMb <= 4096 ? 500 : 1000)

/** How much to free now (MB): up to half again over the line, so one sweep is not followed by another. 0: not short. */
export function memoryNeedMb(freeMb: number, totalMb: number): number {
  const line = memoryShortMb(totalMb)
  return freeMb < line ? Math.round(line * 1.5 - freeMb) : 0
}

/** Short of memory, a tab hidden at least this long may go (not one just switched away from). */
export const SHORT_MIN_HIDDEN_MS = 60_000
/** Over the loaded-tab limit, tabs not shown for this long go heaviest first; more recent ones only after them. */
export const HEAVY_FIRST_AFTER_MS = 5 * 60_000

/**
 * Which tabs to unload now. Visible, busy and listed-site tabs are never picked. With `force`
 * every other loaded tab goes (the "free memory now" button); otherwise a tab goes once it has
 * been idle long enough, then more go until the loaded-tab limit holds, and then, when the computer
 * is short of memory (`needMb`, see memoryNeedMb), until that much is freed. Those last two take the
 * tabs not shown for a while heaviest first, then the least recently shown.
 */
export function pickUnloads(
  tabs: readonly TabFacts[],
  policy: MemoryPolicy,
  now: number,
  force = false,
  needMb = 0
): number[] {
  if (!policy.enabled && !force) return []
  const eligible = tabs.filter(
    (t) => t.loaded && !t.visible && !t.busy && !siteListed(t.host, policy.neverSites)
  )
  if (force) return eligible.map((t) => t.id)
  // a site that messages the person stays loaded (it could not tell of new messages otherwise)
  const mayGo = eligible.filter((t) => !t.messenger)

  const picked = new Set<number>()
  for (const t of mayGo) {
    // other spaces rest early instead (pickRests): unloaded, switching back to a space reloaded every page in it
    if (now - t.lastShownAt >= policy.idleMin * 60_000) picked.add(t.id)
  }

  const stale = (t: TabFacts): boolean => now - t.lastShownAt >= HEAVY_FIRST_AFTER_MS
  const byCost = (a: TabFacts, b: TabFacts): number =>
    stale(a) !== stale(b)
      ? stale(a)
        ? -1
        : 1
      : (stale(a) && (b.mb ?? 0) - (a.mb ?? 0)) || a.lastShownAt - b.lastShownAt
  if (policy.maxLoaded > 0) {
    let loaded = tabs.filter((t) => t.loaded && !picked.has(t.id)).length
    for (const t of mayGo.filter((t) => !picked.has(t.id)).sort(byCost)) {
      if (loaded <= policy.maxLoaded) break
      picked.add(t.id)
      loaded--
    }
  }
  if (needMb > 0) {
    let freed = 0
    for (const t of mayGo) if (picked.has(t.id)) freed += t.mb ?? 0
    const more = mayGo
      .filter((t) => !picked.has(t.id) && now - t.lastShownAt >= SHORT_MIN_HIDDEN_MS)
      .sort(byCost)
    for (const t of more) {
      if (freed >= needMb) break
      picked.add(t.id)
      freed += t.mb ?? 0
    }
  }
  return [...picked]
}

/** A hidden tab gives back its caches after this long out of sight, and stops running after this long. */
export const REST_PURGE_MS = 2 * 60_000
export const REST_FREEZE_MS = 5 * 60_000

/** How far a loaded tab has been put to rest: nothing yet, caches given back, or frozen (no script runs). */
export type Rest = 'awake' | 'purged' | 'frozen'

export interface RestFacts extends TabFacts {
  rest: Rest
  /** Its renderer process: tabs of one site can share it, and a purge clears the whole process. */
  pid: number
  /** The site may send notifications: frozen, it could not, so it is never frozen. */
  notifies: boolean
  /** The processes of its frames from other sites (ads, embeds), which Chromium runs apart from `pid`. */
  framePids?: readonly number[]
}

/**
 * Which hidden tabs to rest now, without unloading them (they come back as they were, at once). After REST_PURGE_MS
 * out of sight a tab gives back its caches; only when nothing else in its process is on screen or busy, since the
 * purge is process-wide and a visible page would have to redraw its pictures. After REST_FREEZE_MS it is frozen,
 * except a site that messages the person or may notify (frozen, it could not tell of anything new).
 * Visible, busy and never-unload tabs are left alone. Chromium wakes a frozen page by itself as it is shown.
 */
export function pickRests(
  tabs: readonly RestFacts[],
  policy: Pick<MemoryPolicy, 'enabled' | 'neverSites'> & { otherSpaces?: boolean },
  now: number
): { purge: number[]; freeze: number[] } {
  if (!policy.enabled) return { purge: [], freeze: [] }
  // a tab of a space you are not in, with "other spaces" on, counts as out of sight long enough sooner
  const early = (t: RestFacts): boolean => !!policy.otherSpaces && !t.inActiveSpace
  const idle = (t: RestFacts): number => now - t.lastShownAt
  const purgeAt = (t: RestFacts): number =>
    early(t) ? OTHER_SPACE_IDLE_MIN * 60_000 : REST_PURGE_MS
  const freezeAt = (t: RestFacts): number =>
    early(t) ? OTHER_SPACE_IDLE_MIN * 60_000 : REST_FREEZE_MS
  const restful = (t: RestFacts): boolean =>
    t.loaded && !t.visible && !t.busy && !siteListed(t.host, policy.neverSites)
  // a process is purged only when every page in it may be
  const blocked = new Set(
    tabs.filter((t) => t.pid > 0 && (!restful(t) || idle(t) < purgeAt(t))).map((t) => t.pid)
  )
  const purge: number[] = []
  const freeze: number[] = []
  for (const t of tabs) {
    if (!restful(t)) continue
    if (t.rest === 'awake' && idle(t) >= purgeAt(t) && t.pid > 0 && !blocked.has(t.pid))
      purge.push(t.id)
    if (t.rest !== 'frozen' && idle(t) >= freezeAt(t) && !t.messenger && !t.notifies)
      freeze.push(t.id)
  }
  return { purge, freeze }
}

/**
 * Which restored tabs to load in the background after a restart: the `count` used most recently (last on screen,
 * newest first), web pages only, not ones already loaded. Ties keep the tab order.
 */
export function pickPreloads(
  tabs: ReadonlyArray<{ id: number; usedAt: number; web: boolean; loaded: boolean }>,
  count: number
): number[] {
  return tabs
    .filter((t) => t.web && !t.loaded && t.usedAt > 0)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.usedAt - a.t.usedAt || a.i - b.i)
    .slice(0, Math.max(0, count))
    .map(({ t }) => t.id)
}

/**
 * The processes to hand back to the system (main/trim.ts) once `frozenNow` are frozen, a tab's frames' processes
 * included: those every loaded tab using which is frozen, with at least one just frozen (one already trimmed is not trimmed again). A process shared with a
 * tab still running, or on screen, is left alone: that tab would only pull the memory straight back.
 */
export function pidsToTrim(tabs: readonly RestFacts[], frozenNow: readonly number[]): number[] {
  const now = new Set(frozenNow)
  const all = (t: RestFacts): number[] => [t.pid, ...(t.framePids ?? [])]
  const ok = new Map<number, boolean>()
  for (const t of tabs) {
    const frozen = now.has(t.id) || t.rest === 'frozen'
    for (const pid of all(t)) ok.set(pid, (ok.get(pid) ?? true) && frozen)
  }
  const pids = new Set(tabs.filter((t) => now.has(t.id)).flatMap(all))
  return [...pids].filter((pid) => ok.get(pid))
}
