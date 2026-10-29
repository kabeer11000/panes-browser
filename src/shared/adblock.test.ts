import { describe, expect, test } from 'bun:test'
import { ADBLOCK_ENV, RESOURCES_URL, filterLists } from './adblock'

describe('filterLists', () => {
  const urls = (year: number): string[] => filterLists(year).map((l) => l.url)

  test('has the lists YouTube blocking depends on, all required', () => {
    const lists = filterLists(2026)
    for (const name of [
      'quick-fixes.txt',
      'unbreak.txt',
      'filters/filters.txt',
      'filters-2025.txt',
      'filters-2026.txt',
      'easylist.txt',
      'easyprivacy.txt'
    ]) {
      const list = lists.find((l) => l.url.endsWith(name))
      expect(list).toBeDefined()
      expect(list?.optional).toBeFalsy()
    }
  })

  test('every yearly list since 2020, and later years only as optional', () => {
    const lists = filterLists(2028)
    for (let y = 2020; y <= 2028; y++) {
      const list = lists.find((l) => l.url.endsWith(`filters-${y}.txt`))
      expect(list?.optional ?? false).toBe(y > 2026)
    }
  })

  test('a clock set in the past still loads every known year', () => {
    expect(urls(2019)).toEqual(urls(2026))
  })

  test('https only, no duplicates', () => {
    const all = urls(2027)
    expect(new Set(all).size).toBe(all.length)
    for (const u of [...all, RESOURCES_URL]) expect(u.startsWith('https://')).toBe(true)
  })

  test('the environment is a Chromium one', () => {
    expect(new Map(ADBLOCK_ENV).get('env_chromium')).toBe(true)
    expect(new Map(ADBLOCK_ENV).has('env_firefox')).toBe(false)
  })
})
