/**
 * Screen time (tasks/polish-3.md): how long each site was in front of the person, day by day, kept on this computer
 * only. Counted while Panes is the window in use and its page is on screen (not idle, or playing a video), by the
 * site's host without "www.". Daily limits per site: past one, the site's tab shows a "time's up" page, with a way to
 * take a few more minutes.
 */

export interface ScreenTime {
  /** Seconds per host, per day ("2026-11-23"). */
  days: Record<string, Record<string, number>>
  /** Daily limits in minutes, per host. */
  limits: Record<string, number>
  /** Minutes added today past a limit ("2026-11-23|example.com"). */
  extra: Record<string, number>
}

export const emptyScreenTime = (): ScreenTime => ({ days: {}, limits: {}, extra: {} })

/** How many days are kept. */
export const KEEP_DAYS = 60
/** What "a few more minutes" is. */
export const MORE_MINUTES = 15

/** The day a moment falls on, in local time ("2026-11-23"). */
export function dayOf(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** The site a page counts for: its host without "www."; null for what is not a web page. */
export function siteOf(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.hostname.replace(/^www\./, '').toLowerCase() || null
  } catch {
    return null
  }
}

/** Time spent on a site added to a day (whole seconds, a tick at a time). */
export function addTime(st: ScreenTime, day: string, site: string, seconds: number): ScreenTime {
  if (!(seconds > 0)) return st
  const d = st.days[day] ?? {}
  return {
    ...st,
    days: { ...st.days, [day]: { ...d, [site]: (d[site] ?? 0) + Math.round(seconds) } }
  }
}

/** Days older than KEEP_DAYS before `today` dropped, and grants of extra time from other days. */
export function prune(st: ScreenTime, today: string, keep = KEEP_DAYS): ScreenTime {
  const cut = dayOf(new Date(`${today}T12:00:00`).getTime() - keep * 86400_000)
  const days: ScreenTime['days'] = {}
  for (const [d, v] of Object.entries(st.days)) if (d > cut) days[d] = v
  const extra: ScreenTime['extra'] = {}
  for (const [k, v] of Object.entries(st.extra)) if (k.startsWith(today + '|')) extra[k] = v
  return { ...st, days, extra }
}

/** The days of the week ending `today`, oldest first. */
export function weekOf(today: string): string[] {
  const t = new Date(`${today}T12:00:00`).getTime()
  return Array.from({ length: 7 }, (_, i) => dayOf(t - (6 - i) * 86400_000))
}

const total = (d: Record<string, number> | undefined): number =>
  Object.values(d ?? {}).reduce((a, b) => a + b, 0)

export interface ScreenSummary {
  today: string
  /** Seconds today, all sites. */
  todayTotal: number
  /** The week ending today: each day's total seconds. */
  week: Array<{ day: string; seconds: number }>
  /** Sites by time, today and over the week (seconds), with their limits (minutes) when set. */
  /** `extra`: minutes taken past the limit today ("15 more minutes"). */
  sites: Array<{ site: string; today: number; week: number; limit: number | null; extra: number }>
}

export function summarize(st: ScreenTime, today: string): ScreenSummary {
  const week = weekOf(today)
  const perSite = new Map<string, { today: number; week: number }>()
  for (const day of week)
    for (const [site, s] of Object.entries(st.days[day] ?? {})) {
      const cur = perSite.get(site) ?? { today: 0, week: 0 }
      cur.week += s
      if (day === today) cur.today += s
      perSite.set(site, cur)
    }
  for (const site of Object.keys(st.limits))
    if (!perSite.has(site)) perSite.set(site, { today: 0, week: 0 })
  return {
    today,
    todayTotal: total(st.days[today]),
    week: week.map((day) => ({ day, seconds: total(st.days[day]) })),
    sites: [...perSite]
      .map(([site, v]) => ({
        site,
        ...v,
        limit: st.limits[site] ?? null,
        extra: st.extra[`${today}|${site}`] ?? 0
      }))
      .sort((a, b) => b.today - a.today || b.week - a.week || a.site.localeCompare(b.site))
  }
}

/** A daily limit set (minutes, at least 1) or taken off (null). */
export function setLimit(st: ScreenTime, site: string, minutes: number | null): ScreenTime {
  const limits = { ...st.limits }
  if (minutes === null || !Number.isFinite(minutes)) delete limits[site]
  else limits[site] = Math.max(1, Math.min(24 * 60, Math.round(minutes)))
  return { ...st, limits }
}

/** A few more minutes on a site today, past its limit. */
export function grantMore(
  st: ScreenTime,
  today: string,
  site: string,
  minutes = MORE_MINUTES
): ScreenTime {
  const k = `${today}|${site}`
  return { ...st, extra: { ...st.extra, [k]: (st.extra[k] ?? 0) + minutes } }
}

/** Seconds left on a site today under its limit (extra time included); null when it has no limit. */
export function timeLeft(st: ScreenTime, today: string, site: string): number | null {
  const limit = st.limits[site]
  if (limit === undefined) return null
  const allowed = (limit + (st.extra[`${today}|${site}`] ?? 0)) * 60
  return allowed - (st.days[today]?.[site] ?? 0)
}

/** "1 h 5 min", "12 min", "under a minute". */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  if (m < 1) return 'under a minute'
  const h = Math.floor(m / 60)
  const r = m % 60
  return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${m} min`
}

/** A stored screen time, checked (it is read back from disk). */
export function cleanScreenTime(v: unknown): ScreenTime {
  const o = v as Partial<ScreenTime> | null
  const st = emptyScreenTime()
  if (!o || typeof o !== 'object') return st
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0
  for (const [d, sites] of Object.entries(o.days ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !sites || typeof sites !== 'object') continue
    const clean: Record<string, number> = {}
    for (const [s, n] of Object.entries(sites))
      if (num(n) && s.length < 260) clean[s] = Math.round(n)
    st.days[d] = clean
  }
  for (const [s, n] of Object.entries(o.limits ?? {}))
    if (num(n) && n >= 1) st.limits[s] = Math.round(n)
  for (const [k, n] of Object.entries(o.extra ?? {})) if (num(n)) st.extra[k] = n
  return st
}
