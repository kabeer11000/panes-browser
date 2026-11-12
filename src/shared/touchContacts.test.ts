import { describe, expect, test } from 'bun:test'
import { ContactFrames, ScanClock } from './touchContacts'

describe('ScanClock', () => {
  test('evens out reports that main read in bunches', () => {
    const c = new ScanClock()
    // the pad reports every 8 ms (80 ticks); main reads them late by 2..14 ms, unevenly
    const lateBy = [2, 14, 3, 12, 2, 9, 2, 13, 2, 2]
    const times = lateBy.map((late, i) => c.time((i * 80) % 65536, 1000 + i * 8 + late))
    const gaps = times.slice(2).map((t, i) => t - times[i + 1])
    for (const g of gaps) expect(g).toBeCloseTo(8, 0)
    for (let i = 0; i < times.length; i++)
      expect(times[i]).toBeLessThanOrEqual(1000 + i * 8 + lateBy[i])
  })
  test('follows the counter round its wrap', () => {
    const c = new ScanClock()
    const a = c.time(65500, 1000)
    const b = c.time(44, 1008) // 80 ticks later, past 65535
    expect(b - a).toBeCloseTo(8, 6)
  })
  test('no scan time, or a long pause: main time', () => {
    const c = new ScanClock()
    expect(c.time(null, 500)).toBe(500)
    c.time(100, 1000)
    expect(c.time(5000, 9000)).toBe(9000) // 8 s later: the counter may have wrapped, start afresh
  })
  test('a counter that runs far from real time is not trusted', () => {
    const c = new ScanClock()
    c.time(0, 1000)
    expect(c.time(10, 1500)).toBe(1500) // 1 ms of pad time for 500 ms of real time
  })
})

describe('ContactFrames.room', () => {
  test('a report needs only as many slots as contacts are still to come', () => {
    const c = new ContactFrames()
    expect(c.room(2)).toBe(2)
    expect(c.room(0)).toBe(0) // nothing under way
    c.feed(3, [{ id: 1, tip: true, x: 0, y: 0 }]) // hybrid: 1 of 3 so far
    expect(c.room(0)).toBe(2)
  })
})
