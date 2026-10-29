import { describe, expect, test } from 'bun:test'
import {
  normalizeSites,
  normalizeZoom,
  pickUnloads,
  presetOf,
  siteListed,
  type MemoryPolicy,
  type TabFacts
} from './memory'

const MIN = 60_000
const policy: MemoryPolicy = {
  enabled: true,
  idleMin: 30,
  maxLoaded: 0,
  otherSpaces: false,
  neverSites: []
}
const tab = (id: number, over: Partial<TabFacts> = {}): TabFacts => ({
  id,
  loaded: true,
  visible: false,
  busy: false,
  host: 'example.com',
  inActiveSpace: true,
  lastShownAt: 0,
  ...over
})

describe('pickUnloads', () => {
  test('unloads only tabs idle for at least the threshold', () => {
    const now = 100 * MIN
    const tabs = [tab(1, { lastShownAt: now - 31 * MIN }), tab(2, { lastShownAt: now - 5 * MIN })]
    expect(pickUnloads(tabs, policy, now)).toEqual([1])
  })

  test('does nothing when the saver is off, except when forced', () => {
    const tabs = [tab(1)]
    const off = { ...policy, enabled: false }
    expect(pickUnloads(tabs, off, 999 * MIN)).toEqual([])
    expect(pickUnloads(tabs, off, 999 * MIN, true)).toEqual([1])
  })

  test('never picks visible, busy, listed or already unloaded tabs', () => {
    const tabs = [
      tab(1, { visible: true }),
      tab(2, { busy: true }),
      tab(3, { host: 'docs.google.com' }),
      tab(4, { loaded: false })
    ]
    const p = { ...policy, neverSites: ['google.com'] }
    expect(pickUnloads(tabs, p, 999 * MIN)).toEqual([])
    expect(pickUnloads(tabs, p, 999 * MIN, true)).toEqual([])
  })

  test('other spaces use the short threshold when enabled', () => {
    const now = 10 * MIN
    const tabs = [tab(1, { inActiveSpace: false, lastShownAt: now - 3 * MIN })]
    expect(pickUnloads(tabs, policy, now)).toEqual([])
    expect(pickUnloads(tabs, { ...policy, otherSpaces: true }, now)).toEqual([1])
  })

  test('the loaded-tab limit unloads the least recently shown first and counts protected tabs', () => {
    const now = 5 * MIN
    const tabs = [
      tab(1, { visible: true, lastShownAt: now }),
      tab(2, { lastShownAt: 1 * MIN }),
      tab(3, { lastShownAt: 3 * MIN }),
      tab(4, { lastShownAt: 2 * MIN, busy: true })
    ]
    // 4 loaded, limit 2: the visible and busy tabs stay, so both others go, oldest first
    expect(pickUnloads(tabs, { ...policy, maxLoaded: 2 }, now).sort()).toEqual([2, 3])
    // limit 3: only the oldest has to go
    expect(pickUnloads(tabs, { ...policy, maxLoaded: 3 }, now)).toEqual([2])
  })

  test('tabs already picked for idleness count toward the limit', () => {
    const now = 100 * MIN
    const tabs = [
      tab(1, { lastShownAt: now - 40 * MIN }),
      tab(2, { lastShownAt: now - 1 * MIN }),
      tab(3, { lastShownAt: now - 2 * MIN })
    ]
    expect(pickUnloads(tabs, { ...policy, maxLoaded: 2 }, now)).toEqual([1])
  })
})

describe('sites', () => {
  test('normalizeSites reduces input to bare unique hosts', () => {
    expect(
      normalizeSites([
        ' https://www.Figma.com/file/1 ',
        'figma.com',
        'a b',
        '',
        5,
        'mail.google.com:443'
      ])
    ).toEqual(['figma.com', 'mail.google.com'])
    expect(normalizeSites('nope')).toEqual([])
  })

  test('siteListed matches the host and its subdomains only', () => {
    expect(siteListed('www.figma.com', ['figma.com'])).toBe(true)
    expect(siteListed('app.figma.com', ['figma.com'])).toBe(true)
    expect(siteListed('notfigma.com', ['figma.com'])).toBe(false)
  })
})

describe('presetOf', () => {
  test('recognises presets and falls back to custom', () => {
    expect(presetOf({ unloadIdleMin: 30, maxLoadedTabs: 0 })).toBe('balanced')
    expect(presetOf({ unloadIdleMin: 5, maxLoadedTabs: 8 })).toBe('aggressive')
    expect(presetOf({ unloadIdleMin: 15, maxLoadedTabs: 0 })).toBe('custom')
  })
})

describe('normalizeZoom', () => {
  test('keeps sane levels in half steps (100% too), drops junk', () => {
    expect(
      normalizeZoom({ 'a.com': 2, 'b.com': 0, 'c.com': 99, 'd.com': 'x', 'e.com': 1.3, '': 1 })
    ).toEqual({ 'a.com': 2, 'b.com': 0, 'c.com': 8, 'e.com': 1.5 })
    expect(normalizeZoom(null)).toEqual({})
    expect(normalizeZoom([1, 2])).toEqual({})
  })
})
