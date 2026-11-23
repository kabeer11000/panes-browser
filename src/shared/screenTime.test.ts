import { describe, expect, test } from 'bun:test'
import {
  addTime,
  cleanScreenTime,
  emptyScreenTime,
  formatDuration,
  grantMore,
  prune,
  setLimit,
  siteOf,
  summarize,
  timeLeft,
  weekOf
} from './screenTime'

describe('screen time', () => {
  test('time adds up per site and day; sites are hosts without www', () => {
    expect(siteOf('https://www.YouTube.com/watch?v=1')).toBe('youtube.com')
    expect(siteOf('panes://settings')).toBeNull()
    let st = emptyScreenTime()
    st = addTime(st, '2026-11-23', 'youtube.com', 5)
    st = addTime(st, '2026-11-23', 'youtube.com', 5)
    st = addTime(st, '2026-11-22', 'news.example', 120)
    expect(st.days['2026-11-23']['youtube.com']).toBe(10)
    const s = summarize(st, '2026-11-23')
    expect(s.todayTotal).toBe(10)
    expect(s.week.map((d) => d.seconds)).toEqual([0, 0, 0, 0, 0, 120, 10])
    expect(s.sites.map((x) => x.site)).toEqual(['youtube.com', 'news.example'])
  })

  test('a week is the seven days ending today', () => {
    expect(weekOf('2026-11-03')).toEqual([
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03'
    ])
  })

  test('limits: time left counts extra minutes; no limit, no answer', () => {
    let st = setLimit(emptyScreenTime(), 'youtube.com', 30)
    st = addTime(st, '2026-11-23', 'youtube.com', 29 * 60)
    expect(timeLeft(st, '2026-11-23', 'youtube.com')).toBe(60)
    st = addTime(st, '2026-11-23', 'youtube.com', 120)
    expect(timeLeft(st, '2026-11-23', 'youtube.com')).toBe(-60)
    st = grantMore(st, '2026-11-23', 'youtube.com')
    expect(timeLeft(st, '2026-11-23', 'youtube.com')).toBe(14 * 60)
    expect(timeLeft(st, '2026-11-23', 'other.example')).toBeNull()
    expect(summarize(st, '2026-11-23').sites[0]).toMatchObject({
      site: 'youtube.com',
      limit: 30,
      extra: 15
    })
    expect(timeLeft(setLimit(st, 'youtube.com', null), '2026-11-23', 'youtube.com')).toBeNull()
  })

  test('old days and yesterday’s extra time are let go', () => {
    let st = addTime(emptyScreenTime(), '2026-08-01', 'a.example', 10)
    st = addTime(st, '2026-11-20', 'a.example', 10)
    st = grantMore(st, '2026-11-22', 'a.example')
    st = grantMore(st, '2026-11-23', 'a.example')
    const p = prune(st, '2026-11-23')
    expect(Object.keys(p.days)).toEqual(['2026-11-20'])
    expect(Object.keys(p.extra)).toEqual(['2026-11-23|a.example'])
  })

  test('durations read like people say them; stored data is checked', () => {
    expect(formatDuration(30)).toBe('under a minute')
    expect(formatDuration(12 * 60)).toBe('12 min')
    expect(formatDuration(65 * 60)).toBe('1 h 5 min')
    expect(formatDuration(120 * 60)).toBe('2 h')
    expect(
      cleanScreenTime({
        days: { bad: {}, '2026-11-23': { 'a.example': -3, 'b.example': 7 } },
        limits: { x: 0 }
      })
    ).toEqual({
      days: { '2026-11-23': { 'b.example': 7 } },
      limits: {},
      extra: {}
    })
  })
})
