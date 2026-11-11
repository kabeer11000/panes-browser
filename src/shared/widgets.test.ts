import { describe, expect, test } from 'bun:test'
import {
  whenLabel,
  alarmsOf,
  cleanWidget,
  dueAlarms,
  nextAlarm,
  clock,
  dueAt,
  elapsed,
  isDue,
  lap,
  newWidget,
  parseLength,
  relative,
  remindAt,
  reset,
  setTotal,
  timerLeft,
  toggle,
  type StopwatchWidget,
  type TimerWidget,
  type ReminderWidget
} from './widgets'

describe('stopwatch', () => {
  test('runs, pauses and resumes, keeping what it ran', () => {
    let w = newWidget('stopwatch') as StopwatchWidget
    w = toggle(w, 1000)
    expect(elapsed(w, 3500)).toBe(2500)
    w = toggle(w, 3500)
    expect(elapsed(w, 99_999)).toBe(2500)
    w = toggle(w, 10_000)
    expect(elapsed(w, 11_000)).toBe(3500)
  })
  test('laps only while running; reset clears them', () => {
    let w = toggle(newWidget('stopwatch') as StopwatchWidget, 0)
    w = lap(w, 1200)
    w = lap(w, 3000)
    expect(w.laps).toEqual([1200, 3000])
    expect(lap(toggle(w, 4000), 5000).laps).toEqual([1200, 3000])
    expect(reset(w)).toEqual({ kind: 'stopwatch', since: null, acc: 0, laps: [] })
  })
})

describe('timer', () => {
  test('counts down and is due at its end', () => {
    let w = newWidget('timer') as TimerWidget
    w = setTotal(w, 60_000)
    expect(dueAt(w)).toBeNull()
    w = toggle(w, 1000)
    expect(dueAt(w)).toBe(61_000)
    expect(timerLeft(w, 31_000)).toBe(30_000)
    w = toggle(w, 31_000) // paused with 30 s left
    expect(dueAt(w)).toBeNull()
    w = toggle(w, 100_000)
    expect(dueAt(w)).toBe(130_000)
    expect(isDue(w, 129_999)).toBe(false)
    expect(isDue(w, 130_000)).toBe(true)
    expect(timerLeft(w, 200_000)).toBe(0)
  })
  test('a finished timer starts again from the top', () => {
    const w = toggle(setTotal(newWidget('timer') as TimerWidget, 10_000), 0)
    const again = toggle(toggle(w, 20_000), 25_000)
    expect(timerLeft(again, 25_000)).toBe(10_000)
  })
  test('its length is only changed before it starts', () => {
    const w = toggle(newWidget('timer') as TimerWidget, 0)
    expect(setTotal(w, 1000)).toBe(w)
    expect(setTotal(newWidget('timer') as TimerWidget, 10).total).toBe(1000)
  })
})

describe('reminder', () => {
  test('due at its time until ticked off', () => {
    const w = remindAt(newWidget('reminder') as ReminderWidget, 5000)
    expect(isDue(w, 4999)).toBe(false)
    expect(isDue(w, 5000)).toBe(true)
    expect(dueAt({ ...w, done: true })).toBeNull()
    expect(remindAt({ ...w, done: true }, 9000).done).toBe(false)
  })
})

describe('shown', () => {
  test('clock', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(65_270, { cs: true })).toBe('1:05.27')
    expect(clock(3_723_000)).toBe('1:02:03')
    expect(clock(1, { up: true })).toBe('0:01')
  })
  test('relative', () => {
    expect(relative(10 * 60_000, 0)).toBe('in 10 min')
    expect(relative(0, 130 * 60_000)).toBe('2 h 10 min ago')
    expect(relative(20_000, 0)).toBe('in under a minute')
    expect(relative(3 * 86_400_000, 0)).toBe('in 3 days')
  })
  test('parseLength', () => {
    expect(parseLength('90')).toBe(90_000)
    expect(parseLength('5m')).toBe(300_000)
    expect(parseLength('1h 30m')).toBe(5_400_000)
    expect(parseLength('2:30')).toBe(150_000)
    expect(parseLength('1:00:00')).toBe(3_600_000)
    expect(parseLength('25 min')).toBe(1_500_000)
    expect(parseLength('2:75')).toBeNull()
    expect(parseLength('soon')).toBeNull()
    expect(parseLength('0')).toBeNull()
  })
})

describe('cleanWidget', () => {
  test('keeps good ones, drops junk', () => {
    expect(cleanWidget({ kind: 'timer', total: 1000, since: 5, acc: 2 })).toEqual({
      kind: 'timer',
      total: 1000,
      since: 5,
      acc: 2
    })
    expect(cleanWidget({ kind: 'timer', total: -1 })).toBeUndefined()
    expect(cleanWidget({ kind: 'nope' })).toBeUndefined()
    expect(cleanWidget(null)).toBeUndefined()
    expect(cleanWidget({ kind: 'stopwatch', laps: [1, 'x', 3] })).toEqual({
      kind: 'stopwatch',
      since: null,
      acc: 0,
      laps: [1, 3]
    })
  })
})

describe('alarms', () => {
  const notes = [
    {
      id: 'n1',
      text: 'Tea',
      widget: toggle(setTotal(newWidget('timer') as TimerWidget, 180_000), 0)
    },
    { id: 'n2', text: '', widget: remindAt(newWidget('reminder') as ReminderWidget, 500_000) },
    { id: 'n3', text: 'x', widget: newWidget('stopwatch') },
    { id: 'n4', text: 'plain note' }
  ]
  test('timers and reminders, with what to say', () => {
    const all = alarmsOf(2, notes)
    expect(all.map((a) => [a.key, a.at, a.title, a.body])).toEqual([
      ['2:n1:180000', 180_000, "Time's up", 'Tea (3:00)'],
      ['2:n2:500000', 500_000, 'Reminder', 'A reminder on your board']
    ])
  })
  test('due once, next after now', () => {
    const all = alarmsOf(2, notes)
    expect(dueAlarms(all, new Set(), 200_000).map((a) => a.noteId)).toEqual(['n1'])
    expect(dueAlarms(all, new Set(['2:n1:180000']), 200_000)).toEqual([])
    expect(nextAlarm(all, 200_000)).toBe(500_000)
    expect(nextAlarm(all, 600_000)).toBeNull()
  })
})

describe('whenLabel', () => {
  const now = new Date(2026, 10, 11, 15, 0).getTime()
  test('today, tomorrow and yesterday by name', () => {
    expect(whenLabel(new Date(2026, 10, 11, 15, 45).getTime(), now, 'en-US')).toBe('Today, 3:45 PM')
    expect(whenLabel(new Date(2026, 10, 12, 9, 0).getTime(), now, 'en-US')).toBe(
      'Tomorrow, 9:00 AM'
    )
    expect(whenLabel(new Date(2026, 10, 10, 9, 0).getTime(), now, 'en-US')).toBe(
      'Yesterday, 9:00 AM'
    )
  })
  test('another day by its date, and the year only when it is not this one', () => {
    expect(whenLabel(new Date(2026, 10, 14, 9, 0).getTime(), now, 'en-US')).toBe(
      'Sat, Nov 14, 9:00 AM'
    )
    expect(whenLabel(new Date(2027, 0, 2, 9, 0).getTime(), now, 'en-US')).toContain('2027')
  })
})
