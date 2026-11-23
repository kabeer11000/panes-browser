/**
 * Usage statistics, sent only when the person said yes (welcome tour, Settings > Privacy). A batch is counts and
 * seconds: which commands were used (by name, never their arguments), how long each site was in front, how long
 * Panes was in use, how long it took to start. Never page contents, addresses past the site, typed text or passwords.
 * Panes sends one every half hour (main/usage.ts); the relay keeps them (share/server/relay.ts, POST /usage).
 */
export interface UsageBatch {
  /** A random id for this install, so one person's batches can be counted as one. */
  id: string
  /** Panes' version. */
  v: string
  /** Platform and its release, e.g. "win32 10.0.26300". */
  os: string
  /** Memory in GB, rounded to a tier (ramTier). */
  ram: number
  /** Milliseconds from launch to the window's page loaded, in the first batch of a run. */
  boot?: number
  /** Seconds Panes was in front and in use. */
  active: number
  /** Commands used, by IPC channel name, and how often. */
  actions: Record<string, number>
  /** Seconds each site was in front (hostname, no "www."). */
  sites: Record<string, number>
}

export const USAGE_MAX_BYTES = 64 * 1024
const MAX_KEYS = 500
const KEY_RE = /^[a-z0-9:._-]{1,100}$/i
const ID_RE = /^[a-z0-9-]{8,64}$/i
const SHORT_RE = /^[\w .:+-]{1,40}$/

/** The memory tier: 4, 8, 16, 32 or 64 GB (the nearest power of two, so a machine is never told apart by it). */
export function ramTier(bytes: number): number {
  const gb = bytes / 1024 ** 3
  return Math.min(64, Math.max(4, 2 ** Math.round(Math.log2(Math.max(gb, 1)))))
}

function counts(x: unknown): Record<string, number> | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null
  const out: Record<string, number> = {}
  let n = 0
  for (const [k, v] of Object.entries(x)) {
    if (++n > MAX_KEYS) return null
    if (!KEY_RE.test(k) || typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null
    out[k] = Math.round(v)
  }
  return out
}

const num = (v: unknown, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : null

/** A batch as it came over the wire, checked field by field; null if anything is off. */
export function cleanBatch(x: unknown): UsageBatch | null {
  if (!x || typeof x !== 'object') return null
  const b = x as Record<string, unknown>
  if (typeof b.id !== 'string' || !ID_RE.test(b.id)) return null
  if (typeof b.v !== 'string' || !SHORT_RE.test(b.v)) return null
  if (typeof b.os !== 'string' || !SHORT_RE.test(b.os)) return null
  const ram = num(b.ram, 1024)
  const active = num(b.active, 7 * 86400)
  const actions = counts(b.actions)
  const sites = counts(b.sites)
  if (ram === null || active === null || !actions || !sites) return null
  const out: UsageBatch = { id: b.id, v: b.v, os: b.os, ram, active, actions, sites }
  if (b.boot !== undefined) {
    const boot = num(b.boot, 600_000)
    if (boot === null) return null
    out.boot = boot
  }
  return out
}

/** Whether a batch has anything in it worth sending. */
export const hasUsage = (b: UsageBatch): boolean =>
  b.active > 0 || b.boot !== undefined || Object.keys(b.actions).length > 0
