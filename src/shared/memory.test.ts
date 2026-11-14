import { describe, expect, test } from 'bun:test'
import {
  normalizeSites,
  normalizeZoom,
  pickPreloads,
  OTHER_SPACE_IDLE_MIN,
  pickRests,
  pickUnloads,
  presetOf,
  REST_FREEZE_MS,
  REST_PURGE_MS,
  siteListed,
  type MemoryPolicy,
  type RestFacts,
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
  test('a messaging site (it notified, or showed an unread count) stays, except when freeing memory now', () => {
    const now = 100 * MIN
    const tabs = [
      tab(1, { lastShownAt: now - 90 * MIN, messenger: true }),
      tab(2, { lastShownAt: now - 90 * MIN })
    ]
    expect(pickUnloads(tabs, policy, now)).toEqual([2])
    expect(pickUnloads(tabs, { ...policy, maxLoaded: 1 }, now)).toEqual([2])
    expect(pickUnloads(tabs, policy, now, true).sort()).toEqual([1, 2])
  })

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

  test('other spaces are no longer unloaded early (they rest instead)', () => {
    const now = 10 * MIN
    const tabs = [tab(1, { inActiveSpace: false, lastShownAt: now - 3 * MIN })]
    expect(pickUnloads(tabs, { ...policy, otherSpaces: true }, now)).toEqual([])
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

describe('pickRests', () => {
  const on = { enabled: true, neverSites: [] as string[] }
  const rt = (id: number, over: Partial<RestFacts> = {}): RestFacts => ({
    ...tab(id),
    rest: 'awake',
    pid: id,
    notifies: false,
    ...over
  })
  const at = REST_FREEZE_MS + 1

  test('purges after two minutes hidden, freezes after five', () => {
    expect(pickRests([rt(1)], on, REST_PURGE_MS - 1)).toEqual({ purge: [], freeze: [] })
    expect(pickRests([rt(1)], on, REST_PURGE_MS)).toEqual({ purge: [1], freeze: [] })
    expect(pickRests([rt(1)], on, at)).toEqual({ purge: [1], freeze: [1] })
  })

  test('each step happens once per hidden spell', () => {
    expect(pickRests([rt(1, { rest: 'purged' })], on, at)).toEqual({ purge: [], freeze: [1] })
    expect(pickRests([rt(1, { rest: 'frozen' })], on, at)).toEqual({ purge: [], freeze: [] })
  })

  test('visible, busy, unloaded, never-unload tabs and the memory saver off are left alone', () => {
    const tabs = [
      rt(1, { visible: true }),
      rt(2, { busy: true }),
      rt(3, { loaded: false }),
      rt(4, { host: 'keep.com' })
    ]
    expect(pickRests(tabs, { enabled: true, neverSites: ['keep.com'] }, at)).toEqual({
      purge: [],
      freeze: []
    })
    expect(pickRests([rt(1)], { enabled: false, neverSites: [] }, at)).toEqual({
      purge: [],
      freeze: []
    })
  })

  test('a site that messages or may notify is purged but never frozen', () => {
    expect(pickRests([rt(1, { messenger: true }), rt(2, { notifies: true })], on, at)).toEqual({
      purge: [1, 2],
      freeze: []
    })
  })

  test('a shared process is purged only when no page in it is on screen, busy or freshly hidden', () => {
    const hidden = rt(1, { pid: 9 })
    expect(pickRests([hidden, rt(2, { pid: 9, visible: true })], on, at).purge).toEqual([])
    expect(pickRests([hidden, rt(2, { pid: 9, busy: true })], on, at).purge).toEqual([])
    expect(pickRests([hidden, rt(2, { pid: 9, lastShownAt: at - 1000 })], on, at).purge).toEqual([])
    expect(pickRests([hidden, rt(2, { pid: 9 })], on, at).purge).toEqual([1, 2])
    // a frozen page in the process does not need to be awake for the others to be purged
    expect(pickRests([hidden, rt(2, { pid: 9, rest: 'frozen' })], on, at).purge).toEqual([1])
  })

  test('with other spaces on, a tab of another space rests fully after two minutes', () => {
    const other = rt(1, { inActiveSpace: false })
    const two = OTHER_SPACE_IDLE_MIN * MIN
    expect(pickRests([other], { ...on, otherSpaces: true }, two - 1)).toEqual({
      purge: [],
      freeze: []
    })
    expect(pickRests([other], { ...on, otherSpaces: true }, two)).toEqual({
      purge: [1],
      freeze: [1]
    })
    expect(pickRests([other], on, two)).toEqual({ purge: [1], freeze: [] })
  })

  test('no known process: never purged', () => {
    expect(pickRests([rt(1, { pid: 0 })], on, at).purge).toEqual([])
  })
})

describe('pickPreloads', () => {
  const t = (
    id: number,
    usedAt: number,
    over: Partial<{ web: boolean; loaded: boolean }> = {}
  ) => ({
    id,
    usedAt,
    web: true,
    loaded: false,
    ...over
  })
  test('the most recently used first, up to the count', () => {
    expect(pickPreloads([t(1, 10), t(2, 30), t(3, 20)], 2)).toEqual([2, 3])
  })
  test('loaded, non-web and never-used tabs are skipped; 0 is off', () => {
    expect(
      pickPreloads([t(1, 10, { loaded: true }), t(2, 9, { web: false }), t(3, 0), t(4, 5)], 5)
    ).toEqual([4])
    expect(pickPreloads([t(1, 10)], 0)).toEqual([])
  })
  test('ties keep the tab order', () => {
    expect(pickPreloads([t(1, 5), t(2, 5)], 2)).toEqual([1, 2])
  })
})
