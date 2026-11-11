/**
 * Board widgets: a stopwatch, a timer and a reminder, each living on a canvas note (CanvasNote.widget) so it moves,
 * selects, groups and saves like any note. Pure: every function takes the time it is asked about (`now`, epoch ms),
 * so the renderer's ticking face and main's notifications (main/widgetAlarms.ts) agree on what is due.
 */

export type WidgetKind = 'stopwatch' | 'timer' | 'reminder'

export interface StopwatchWidget {
  kind: 'stopwatch'
  /** When the current run started, or null while stopped. */
  since: number | null
  /** Time run before `since`. */
  acc: number
  /** Lap times, as total elapsed at each lap. */
  laps: number[]
}

export interface TimerWidget {
  kind: 'timer'
  /** The whole countdown. */
  total: number
  since: number | null
  /** Time counted down before `since`. */
  acc: number
}

export interface ReminderWidget {
  kind: 'reminder'
  /** When it is due, or null until a time is picked. */
  at: number | null
  /** Ticked off. */
  done: boolean
}

export type Widget = StopwatchWidget | TimerWidget | ReminderWidget

export const WIDGET_LABEL: Record<WidgetKind, string> = {
  stopwatch: 'Stopwatch',
  timer: 'Timer',
  reminder: 'Reminder'
}

export const WIDGET_SIZE: Record<WidgetKind, { w: number; h: number }> = {
  stopwatch: { w: 200, h: 200 }, // round
  timer: { w: 240, h: 176 },
  reminder: { w: 260, h: 176 }
}

export const MAX_LAPS = 99
export const TIMER_MAX = 24 * 3600_000

export function newWidget(kind: WidgetKind): Widget {
  if (kind === 'stopwatch') return { kind, since: null, acc: 0, laps: [] }
  if (kind === 'timer') return { kind, total: 5 * 60_000, since: null, acc: 0 }
  return { kind, at: null, done: false }
}

// ---- stopwatch ----

export const elapsed = (w: StopwatchWidget | TimerWidget, now: number): number =>
  w.acc + (w.since === null ? 0 : Math.max(0, now - w.since))

export const running = (w: Widget): boolean => w.kind !== 'reminder' && w.since !== null

/** Start or pause a stopwatch or timer (a finished timer starts again from the top). */
export function toggle<W extends StopwatchWidget | TimerWidget>(w: W, now: number): W {
  if (w.since !== null) return { ...w, since: null, acc: elapsed(w, now) }
  if (w.kind === 'timer' && timerLeft(w as TimerWidget, now) <= 0)
    return { ...w, since: now, acc: 0 }
  return { ...w, since: now }
}

export function reset<W extends StopwatchWidget | TimerWidget>(w: W): W {
  return w.kind === 'stopwatch'
    ? { ...w, since: null, acc: 0, laps: [] }
    : { ...w, since: null, acc: 0 }
}

export function lap(w: StopwatchWidget, now: number): StopwatchWidget {
  if (w.since === null) return w
  return { ...w, laps: [...w.laps, elapsed(w, now)].slice(-MAX_LAPS) }
}

// ---- timer ----

export const timerLeft = (w: TimerWidget, now: number): number =>
  Math.max(0, w.total - elapsed(w, now))

/** A new length for a timer that has not started (one that has keeps its length until reset). */
export function setTotal(w: TimerWidget, ms: number): TimerWidget {
  if (w.since !== null || w.acc > 0) return w
  return { ...w, total: Math.round(Math.min(TIMER_MAX, Math.max(1000, ms))) }
}

// ---- reminder ----

export function remindAt(w: ReminderWidget, at: number | null): ReminderWidget {
  return { ...w, at: at !== null && Number.isFinite(at) ? Math.round(at) : null, done: false }
}

/** 9 in the morning tomorrow, local time. */
export function tomorrowMorning(now: number): number {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d.getTime()
}

// ---- due ----

/** When the widget goes off (a running timer's end, a pending reminder), or null if it never will as it is. */
export function dueAt(w: Widget): number | null {
  if (w.kind === 'timer') return w.since === null ? null : w.since + (w.total - w.acc)
  if (w.kind === 'reminder') return w.done ? null : w.at
  return null
}

/** Gone off and not yet dealt with: a timer at zero still running, a reminder past its time not ticked off. */
export const isDue = (w: Widget, now: number): boolean => {
  const at = dueAt(w)
  return at !== null && at <= now
}

// ---- shown ----

const pad = (n: number): string => String(n).padStart(2, '0')

/** "4:05", "1:02:03"; with `cs`, hundredths too ("4:05.27"). Rounded up for a countdown (`up`), so 0:00 is the end. */
export function clock(ms: number, o: { cs?: boolean; up?: boolean } = {}): string {
  const t = Math.max(0, ms)
  const s = o.up ? Math.ceil(t / 1000) : Math.floor(t / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const base = h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
  return o.cs ? `${base}.${pad(Math.floor((t % 1000) / 10))}` : base
}

/** "in 5 min", "in 2 h 10 min", "in 3 days", "now", "12 min ago". */
export function relative(at: number, now: number): string {
  const d = at - now
  const a = Math.abs(d)
  const min = Math.round(a / 60_000)
  let s: string
  if (a < 45_000) return d >= 0 ? 'in under a minute' : 'just now'
  if (min < 60) s = `${min} min`
  else if (min < 48 * 60) {
    const h = Math.floor(min / 60)
    const m = min % 60
    s = m ? `${h} h ${m} min` : `${h} h`
  } else s = `${Math.round(min / 1440)} days`
  return d >= 0 ? `in ${s}` : `${s} ago`
}

/** A typed length: "90" (seconds), "5m", "1h30m", "2:30" (m:s), "1:00:00" (h:m:s). Null if it makes no sense. */
export function parseLength(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '')
  if (!t) return null
  if (/^\d+(?::\d{1,2}){1,2}$/.test(t)) {
    const parts = t.split(':').map(Number)
    if (parts.slice(1).some((p) => p >= 60)) return null
    const [a, b, c] = parts
    const s = parts.length === 3 ? a * 3600 + b * 60 + c : a * 60 + b
    return s > 0 ? s * 1000 : null
  }
  if (/^\d+(\.\d+)?$/.test(t)) {
    const s = Number(t)
    return s > 0 ? Math.round(s * 1000) : null
  }
  const re = /(\d+(?:\.\d+)?)(hours?|hrs|hr|h|minutes?|mins?|m|seconds?|secs?|s)/g
  let total = 0
  let used = 0
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const n = Number(m[1])
    const u = m[2][0]
    total += n * (u === 'h' ? 3600_000 : u === 'm' ? 60_000 : 1000)
    used += m[0].length
  }
  return used === t.length && total > 0 ? Math.round(total) : null
}

/** For an `<input type="datetime-local">`: "2026-11-11T09:30" in local time. */
export function localInput(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A saved widget as it should be: anything malformed (an old or hand-edited file) is dropped. */
export function cleanWidget(v: unknown): Widget | undefined {
  const w = v as Partial<Record<string, unknown>> | null
  if (!w || typeof w !== 'object') return undefined
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  const since = num(w.since) ? w.since : null
  const acc = num(w.acc) && w.acc >= 0 ? w.acc : 0
  if (w.kind === 'stopwatch')
    return {
      kind: 'stopwatch',
      since,
      acc,
      laps: Array.isArray(w.laps) ? w.laps.filter(num).slice(-MAX_LAPS) : []
    }
  if (w.kind === 'timer' && num(w.total) && w.total > 0)
    return { kind: 'timer', total: Math.min(TIMER_MAX, w.total), since, acc }
  if (w.kind === 'reminder')
    return { kind: 'reminder', at: num(w.at) ? w.at : null, done: w.done === true }
  return undefined
}

// ---- alarms (main/widgetAlarms.ts) ----

export interface Alarm {
  /** Stable for one going-off: the same widget set again for another time is another alarm. */
  key: string
  spaceId: number
  noteId: string
  at: number
  title: string
  body: string
}

/** What on a board will go off (or has gone off and has not been dealt with), for notifications. */
export function alarmsOf(
  spaceId: number,
  notes: ReadonlyArray<{ id: string; text: string; widget?: Widget }>
): Alarm[] {
  const out: Alarm[] = []
  for (const n of notes) {
    const w = n.widget
    if (!w) continue
    const at = dueAt(w)
    if (at === null) continue
    const label = n.text.trim()
    out.push({
      key: `${spaceId}:${n.id}:${Math.round(at)}`,
      spaceId,
      noteId: n.id,
      at,
      title: w.kind === 'timer' ? "Time's up" : 'Reminder',
      body:
        w.kind === 'timer'
          ? label
            ? `${label} (${clock((w as TimerWidget).total)})`
            : `${clock((w as TimerWidget).total)} timer`
          : label || 'A reminder on your board'
    })
  }
  return out
}

/** Gone off by `now` and not yet told (`told`: keys already notified). */
export const dueAlarms = (all: Alarm[], told: ReadonlySet<string>, now: number): Alarm[] =>
  all.filter((a) => a.at <= now && !told.has(a.key))

/** The next one still to go off after `now`, or null. */
export const nextAlarm = (all: Alarm[], now: number): number | null =>
  all.reduce<number | null>((m, a) => (a.at > now && (m === null || a.at < m) ? a.at : m), null)
