import { describe, expect, test } from 'bun:test'
import {
  KEEP_WARM,
  memoryNeedMb,
  memoryRoomy,
  releaseHelper,
  HELPER_IDLE_MS,
  memoryShortMb,
  normalizeSites,
  normalizeZoom,
  pickPreloads,
  OTHER_SPACE_IDLE_MIN,
  pickRests,
  pidsToTrim,
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

describe('memory pressure', () => {
  test("Chromium's lines: 500 MB free on a 4 GB machine, 1 GB above", () => {
    expect(memoryShortMb(4096)).toBe(500)
    expect(memoryShortMb(8192)).toBe(1000)
  })
  test('nothing to free above the line; below it, back to half again over it', () => {
    expect(memoryNeedMb(1000, 8192)).toBe(0)
    expect(memoryNeedMb(600, 8192)).toBe(900)
    expect(memoryNeedMb(200, 4096)).toBe(550)
  })
})

describe('pickUnloads under memory pressure and the tab limit', () => {
  const now = 100 * MIN
  const short = { ...policy, idleMin: 240 } // nothing idle long enough on its own

  test('short of memory, hidden tabs go heaviest first until enough is freed', () => {
    const tabs = [
      tab(1, { lastShownAt: now - 20 * MIN, mb: 100 }),
      tab(2, { lastShownAt: now - 20 * MIN, mb: 700 }),
      tab(3, { lastShownAt: now - 20 * MIN, mb: 300 })
    ]
    expect(pickUnloads(tabs, short, now, false, 0)).toEqual([])
    expect(pickUnloads(tabs, short, now, false, 600)).toEqual([2])
    expect(pickUnloads(tabs, short, now, false, 900).sort()).toEqual([2, 3])
  })

  test('short of memory, a tab just switched away from, a visible, busy, messaging or listed one stays', () => {
    const tabs = [
      tab(1, { lastShownAt: now - 30_000, mb: 900 }),
      tab(2, { lastShownAt: now - 20 * MIN, mb: 900, visible: true }),
      tab(3, { lastShownAt: now - 20 * MIN, mb: 900, busy: true }),
      tab(4, { lastShownAt: now - 20 * MIN, mb: 900, messenger: true }),
      tab(5, { lastShownAt: now - 20 * MIN, mb: 900, host: 'keep.me' }),
      tab(6, { lastShownAt: now - 20 * MIN, mb: 50 })
    ]
    expect(pickUnloads(tabs, { ...short, neverSites: ['keep.me'] }, now, false, 5000)).toEqual([6])
  })

  test('short of memory with the saver off: nothing goes', () => {
    const tabs = [tab(1, { lastShownAt: now - 20 * MIN, mb: 900 })]
    expect(pickUnloads(tabs, { ...short, enabled: false }, now, false, 5000)).toEqual([])
  })

  test('over the tab limit, the heaviest of those not shown for a while goes before older light ones', () => {
    const tabs = [
      tab(1, { lastShownAt: now - 60 * MIN, mb: 80 }),
      tab(2, { lastShownAt: now - 10 * MIN, mb: 900 }),
      tab(3, { lastShownAt: now - 2 * MIN, mb: 2000 }), // shown just now: only after the stale ones
      tab(4, { lastShownAt: now - 1 * MIN, mb: 10 })
    ]
    expect(pickUnloads(tabs, { ...short, maxLoaded: 3 }, now)).toEqual([2])
    expect(pickUnloads(tabs, { ...short, maxLoaded: 1 }, now)).toEqual([2, 1, 3])
  })
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
  ): { id: number; usedAt: number; web: boolean; loaded: boolean } => ({
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

describe('pidsToTrim', () => {
  const rt = (id: number, pid: number, rest: RestFacts['rest'] = 'awake'): RestFacts => ({
    ...tab(id),
    rest,
    pid,
    notifies: false
  })

  test('a process whose only tab was just frozen is trimmed', () => {
    expect(pidsToTrim([rt(1, 10), rt(2, 20)], [1])).toEqual([10])
  })

  test('a process shared with a tab still running (or on screen) is not', () => {
    expect(pidsToTrim([rt(1, 10), rt(2, 10)], [1])).toEqual([])
  })

  test('shared with tabs frozen earlier, or frozen now too: trimmed once', () => {
    expect(pidsToTrim([rt(1, 10), rt(2, 10, 'frozen')], [1])).toEqual([10])
    expect(pidsToTrim([rt(1, 10), rt(2, 10)], [1, 2])).toEqual([10])
  })

  test("a tab's frame processes are trimmed with it, unless a running tab uses them too", () => {
    const a = { ...rt(1, 10), framePids: [30, 40] }
    const b = { ...rt(2, 20), framePids: [40] }
    expect(pidsToTrim([a, b], [1]).sort()).toEqual([10, 30])
    expect(pidsToTrim([a, b], [1, 2]).sort()).toEqual([10, 20, 30, 40])
  })

  test('nothing just frozen: nothing trimmed (an earlier trim is not repeated)', () => {
    expect(pidsToTrim([rt(1, 10, 'frozen')], [])).toEqual([])
  })
})

describe('roomy memory', () => {
  test('memoryRoomy: three times the short line and a quarter of the machine', () => {
    expect(memoryRoomy(3000, 8192)).toBe(true)
    expect(memoryRoomy(1900, 8192)).toBe(false)
    expect(memoryRoomy(3500, 16384)).toBe(false)
    expect(memoryRoomy(4096, 16384)).toBe(true)
  })
  test('idle tabs are not unloaded with roomy memory, the loaded-tab limit still holds', () => {
    const policy = { enabled: true, idleMin: 1, maxLoaded: 2, otherSpaces: false, neverSites: [] }
    const tab = (id: number): TabFacts => ({
      id,
      loaded: true,
      visible: false,
      busy: false,
      host: 'a.com',
      inActiveSpace: true,
      lastShownAt: 0
    })
    const now = 10 * 60_000
    expect(pickUnloads([tab(1), tab(2)], policy, now, false, 0, true)).toEqual([])
    expect(pickUnloads([tab(1), tab(2)], policy, now, false, 0, false).sort()).toEqual([1, 2])
    expect(pickUnloads([tab(1), tab(2), tab(3)], policy, now, false, 0, true)).toHaveLength(1)
  })
})

describe('releaseHelper', () => {
  const base = { exists: true, visible: false, lastUsedAt: 0, now: HELPER_IDLE_MS, roomy: false }
  test('hidden, idle and memory not roomy: let go', () => expect(releaseHelper(base)).toBe(true))
  test('kept while memory is roomy', () =>
    expect(releaseHelper({ ...base, roomy: true })).toBe(false))
  test('kept while shown or recently used', () => {
    expect(releaseHelper({ ...base, visible: true })).toBe(false)
    expect(releaseHelper({ ...base, lastUsedAt: 1 })).toBe(false)
  })
  test('nothing to let go', () => expect(releaseHelper({ ...base, exists: false })).toBe(false))
})

describe('the pages used last stay loaded', () => {
  const now = 10 * 60 * 60_000
  const policy: MemoryPolicy = {
    enabled: true,
    idleMin: 30,
    maxLoaded: 2,
    otherSpaces: false,
    neverSites: [],
    keepWarm: KEEP_WARM
  }
  const tab = (id: number, minutesAgo: number, mb = 100): TabFacts => ({
    id,
    loaded: true,
    visible: false,
    busy: false,
    host: `s${id}.com`,
    lastShownAt: now - minutesAgo * 60_000,
    mb
  })
  // six hidden tabs, all idle well past the 30 minutes; 1 is the one used last
  const tabs = [1, 2, 3, 4, 5, 6].map((id) => tab(id, 60 + id * 10))
  test('neither idleness nor the tab limit unloads the last three', () => {
    const out = pickUnloads(tabs, policy, now)
    expect(out.sort()).toEqual([4, 5, 6])
  })
  test('memory running short takes them, but only after everything else', () => {
    expect(pickUnloads(tabs, policy, now, false, 350).sort()).toEqual([3, 4, 5, 6])
  })
  test('off, they go like any other', () => {
    expect(pickUnloads(tabs, { ...policy, keepWarm: 0 }, now).length).toBe(6)
  })
})
