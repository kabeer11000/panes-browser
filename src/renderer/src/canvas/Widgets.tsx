import { memo, useEffect, useRef, useState } from 'react'
import type { CanvasNote } from '@shared/ai/canvas'
import {
  clock,
  elapsed,
  isDue,
  lap,
  localInput,
  parseLength,
  relative,
  remindAt,
  reset,
  setTotal,
  timerLeft,
  toggle,
  tomorrowMorning,
  whenLabel,
  WIDGET_LABEL,
  type ReminderWidget,
  type StopwatchWidget,
  type TimerWidget,
  type Widget
} from '@shared/widgets'

/**
 * A stopwatch, timer or reminder on the board. It is a note underneath (data-nid), so the board moves, selects,
 * groups, copies and deletes it like one; only its face is its own. Main (widgetAlarms.ts) sends the notification
 * when a timer runs out or a reminder is due, whether the board is open or not.
 */

const at = (x: number, y: number): React.CSSProperties => ({
  transform: `translate3d(${x}px, ${y}px, 0)`
})

/** The time now, re-read every `ms` while `on` (and once more when it turns off). */
function useNow(on: boolean, ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const read = (): void => setNow(Date.now())
    const first = window.setTimeout(read, 0) // at once: what was shown may be long out of date
    const t = on ? window.setInterval(read, ms) : undefined
    return () => {
      window.clearTimeout(first)
      window.clearInterval(t)
    }
  }, [on, ms])
  return now
}

/** Pointer presses on the widget's own controls are theirs, not the start of a drag of the widget. */
const own = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent) => e.stopPropagation()
}

interface Props {
  note: CanvasNote & { widget: Widget }
  selected: boolean
  onText: (id: string, text: string | null) => void
  /** Change the widget (no undo step: starting and stopping a clock is not an edit of the board). */
  onWidget: (id: string, fn: (w: Widget) => Widget) => void
}

export const WidgetView = memo(function WidgetView({
  note,
  selected,
  onText,
  onWidget
}: Props): React.JSX.Element {
  const w = note.widget
  const change = (fn: (w: Widget) => Widget): void => onWidget(note.id, fn)
  // the stopwatch shows hundredths, so it ticks fast; a timer by the second; a reminder only says "in 5 min"
  const tick = w.kind === 'stopwatch' ? 47 : w.kind === 'timer' ? 250 : 15_000
  const live = w.kind === 'reminder' ? w.at !== null && !w.done : w.since !== null
  const now = useNow(live, tick)
  const due = isDue(w, now)
  return (
    <div
      className={'cv-note cv-widget k-' + w.kind + (selected ? ' sel' : '') + (due ? ' due' : '')}
      data-nid={note.id}
      role="group"
      aria-label={note.text || WIDGET_LABEL[w.kind]}
      style={{ ...at(note.x, note.y), width: note.w, height: note.h }}
    >
      <input
        key={note.text}
        className="cv-w-label"
        defaultValue={note.text}
        maxLength={120}
        placeholder={w.kind === 'reminder' ? 'Remind me to...' : WIDGET_LABEL[w.kind]}
        aria-label="Label"
        {...own}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
        }}
        onBlur={(e) => {
          if (e.currentTarget.value !== note.text) onText(note.id, e.currentTarget.value)
        }}
      />
      {w.kind === 'stopwatch' ? (
        <Stopwatch w={w} now={now} change={change} />
      ) : w.kind === 'timer' ? (
        <Timer w={w} now={now} due={due} change={change} />
      ) : (
        <Reminder w={w} now={now} due={due} change={change} />
      )}
    </div>
  )
})

type Change = (fn: (w: Widget) => Widget) => void

function Stopwatch({
  w,
  now,
  change
}: {
  w: StopwatchWidget
  now: number
  change: Change
}): React.JSX.Element {
  const t = elapsed(w, now)
  const laps = w.laps.slice(-1) // the round face has room for the latest
  return (
    <>
      <div className="cv-w-face" aria-live="off">
        {clock(t, { cs: true })}
      </div>
      <div className="cv-w-laps">
        {laps.map((l, i) => {
          const n = w.laps.length - i
          const prev = w.laps[n - 2] ?? 0
          return (
            <span key={n}>
              Lap {n} <b>{clock(l - prev, { cs: true })}</b>
            </span>
          )
        })}
      </div>
      <div className="cv-w-row">
        <button
          type="button"
          className="cv-w-btn main"
          {...own}
          onClick={() => change((x) => toggle(x as StopwatchWidget, Date.now()))}
        >
          {w.since !== null ? 'Pause' : t > 0 ? 'Resume' : 'Start'}
        </button>
        {w.since !== null ? (
          <button
            type="button"
            className="cv-w-btn"
            {...own}
            onClick={() => change((x) => lap(x as StopwatchWidget, Date.now()))}
          >
            Lap
          </button>
        ) : (
          <button
            type="button"
            className="cv-w-btn"
            disabled={t === 0}
            {...own}
            onClick={() => change((x) => reset(x as StopwatchWidget))}
          >
            Reset
          </button>
        )}
      </div>
    </>
  )
}

const PRESETS = [1, 5, 10, 25] // minutes

function Timer({
  w,
  now,
  due,
  change
}: {
  w: TimerWidget
  now: number
  due: boolean
  change: Change
}): React.JSX.Element {
  const left = timerLeft(w, now)
  const fresh = w.since === null && w.acc === 0
  const [typing, setTyping] = useState(false)
  return (
    <>
      {!fresh && !due && (
        <div
          className="cv-w-fill"
          aria-hidden="true"
          style={{ transform: `scaleX(${w.total > 0 ? left / w.total : 0})` }}
        />
      )}
      {fresh && typing ? (
        <input
          className="cv-w-face cv-w-edit"
          autoFocus
          defaultValue={clock(w.total)}
          aria-label="Timer length"
          {...own}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setTyping(false)
          }}
          onBlur={(e) => {
            const ms = parseLength(e.currentTarget.value)
            if (ms !== null) change((x) => setTotal(x as TimerWidget, ms))
            setTyping(false)
          }}
        />
      ) : (
        <div
          className="cv-w-face"
          title={fresh ? 'Click to type a length (5m, 1h30m, 2:30)' : undefined}
          onClick={fresh ? () => setTyping(true) : undefined}
          {...(fresh ? own : {})}
        >
          {due ? "Time's up" : clock(left, { up: true })}
        </div>
      )}
      <div className="cv-w-laps">
        {fresh ? (
          PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              className={'cv-w-chip' + (w.total === m * 60_000 ? ' on' : '')}
              {...own}
              aria-label={`${m} minutes`}
              onClick={() => change((x) => setTotal(x as TimerWidget, m * 60_000))}
            >
              {m}m
            </button>
          ))
        ) : (
          <span>of {clock(w.total)}</span>
        )}
      </div>
      <div className="cv-w-row">
        <button
          type="button"
          className="cv-w-btn main"
          {...own}
          onClick={() =>
            change((x) => (due ? reset(x as TimerWidget) : toggle(x as TimerWidget, Date.now())))
          }
        >
          {due ? 'Dismiss' : w.since !== null ? 'Pause' : fresh ? 'Start' : 'Resume'}
        </button>
        {!fresh && (
          <button
            type="button"
            className="cv-w-btn"
            {...own}
            onClick={() =>
              change((x) =>
                due ? toggle(reset(x as TimerWidget), Date.now()) : reset(x as TimerWidget)
              )
            }
          >
            {due ? 'Again' : 'Reset'}
          </button>
        )}
      </div>
    </>
  )
}

function Reminder({
  w,
  now,
  due,
  change
}: {
  w: ReminderWidget
  now: number
  due: boolean
  change: Change
}): React.JSX.Element {
  const set = (t: number | null): void => change((x) => remindAt(x as ReminderWidget, t))
  // the browser's own date field reads "mm/dd/yyyy --:--" when empty: it stays out of sight, and the time is shown
  // as words that open its picker (starting an hour from now when nothing is set)
  const picker = useRef<HTMLInputElement>(null)
  const pick = (): void => {
    const el = picker.current
    if (!el) return
    if (!el.value) el.value = localInput(Math.ceil((Date.now() + 3600_000) / 900_000) * 900_000)
    try {
      el.showPicker()
    } catch {
      el.focus()
    }
  }
  return (
    <>
      <div className="cv-w-when">
        {w.done ? (
          <span>Done</span>
        ) : (
          <>
            <button
              type="button"
              className={'cv-w-pick' + (w.at === null ? ' empty' : '')}
              {...own}
              onClick={pick}
            >
              {w.at === null ? 'Pick a time' : whenLabel(w.at, now)}
            </button>
            <input
              ref={picker}
              type="datetime-local"
              className="cv-w-native"
              tabIndex={-1}
              aria-label="Remind at"
              value={w.at === null ? '' : localInput(w.at)}
              {...own}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                const t = e.currentTarget.value ? new Date(e.currentTarget.value).getTime() : NaN
                if (Number.isFinite(t)) set(t)
              }}
            />
            {w.at !== null && (
              <small>{due ? `Due ${relative(w.at, now)}` : relative(w.at, now)}</small>
            )}
          </>
        )}
      </div>
      {!w.done && (
        <div className="cv-w-laps">
          <button
            type="button"
            className="cv-w-chip"
            {...own}
            onClick={() => set(Date.now() + 10 * 60_000)}
          >
            +10 min
          </button>
          <button
            type="button"
            className="cv-w-chip"
            {...own}
            onClick={() => set(Date.now() + 3600_000)}
          >
            +1 hour
          </button>
          <button
            type="button"
            className="cv-w-chip"
            {...own}
            onClick={() => set(tomorrowMorning(Date.now()))}
          >
            Tomorrow 9am
          </button>
        </div>
      )}
      <div className="cv-w-row">
        {w.done ? (
          <button type="button" className="cv-w-btn" {...own} onClick={() => set(null)}>
            Remind again
          </button>
        ) : (
          w.at !== null && (
            <button
              type="button"
              className="cv-w-btn main"
              {...own}
              onClick={() => change((x) => ({ ...(x as ReminderWidget), done: true }))}
            >
              Done
            </button>
          )
        )}
        {due && (
          <button
            type="button"
            className="cv-w-btn"
            {...own}
            onClick={() => set(Date.now() + 10 * 60_000)}
          >
            Snooze 10 min
          </button>
        )}
      </div>
    </>
  )
}
