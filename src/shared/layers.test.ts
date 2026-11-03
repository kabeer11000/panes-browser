import { describe, expect, test } from 'bun:test'
import {
  chooseLayer,
  EMPTY_LAYER_STATE,
  feedFromUpdateConfig,
  folderFeed,
  layerFilesToKeep,
  markBad,
  MAX_BOOTS,
  noteBoot,
  noteHealthy,
  parseLayerState,
  parseManifest,
  pickDelta,
  planLayerUpdate,
  shellId,
  stageLayer,
  type LayerEntry,
  type LayerState
} from './layers'

const sha = (c: string): string => c.repeat(64)
const SHELL = shellId('44.7.2')

const entry = (build: number, shell = SHELL): LayerEntry => ({
  build,
  version: `0.1.${build}`,
  file: `app-${build}.asar`,
  sha256: sha(String(build % 10)),
  shell
})

const manifest = {
  schema: 1,
  version: '0.1.0-beta.6',
  build: 1762300000,
  shell: SHELL,
  notes: 'Faster tabs',
  full: { file: 'app-1762300000.asar.gz', sha256: sha('a'), size: 21_000_000 },
  deltas: [
    { from: sha('b'), file: 'app-1762200000-1762300000.delta.zst' },
    { from: sha('c'), file: 'app-1762100000-1762300000.delta.zst' }
  ]
}

describe('parseManifest', () => {
  test('accepts a well-formed manifest as it is', () => {
    expect(parseManifest(manifest)).toEqual(manifest as never)
  })

  test('refuses file names that could leave the layers folder, and bad hashes, builds and sizes', () => {
    const bad = (patch: object): unknown => ({ ...manifest, ...patch })
    expect(parseManifest(bad({ full: { ...manifest.full, file: '../evil.asar' } }))).toBeNull()
    expect(parseManifest(bad({ full: { ...manifest.full, file: 'dir/app.gz' } }))).toBeNull()
    expect(parseManifest(bad({ full: { ...manifest.full, file: 'C:\\x.gz' } }))).toBeNull()
    expect(parseManifest(bad({ full: { ...manifest.full, sha256: 'abc' } }))).toBeNull()
    expect(parseManifest(bad({ full: { ...manifest.full, size: 0 } }))).toBeNull()
    expect(parseManifest(bad({ full: { ...manifest.full, size: 1e12 } }))).toBeNull()
    expect(parseManifest(bad({ build: 1.5 }))).toBeNull()
    expect(parseManifest(bad({ build: -1 }))).toBeNull()
    expect(parseManifest(bad({ version: '1.0 beta' }))).toBeNull()
    expect(parseManifest(bad({ schema: 2 }))).toBeNull()
    expect(parseManifest(null)).toBeNull()
    expect(parseManifest('{}')).toBeNull()
  })

  test('drops only the malformed deltas, and caps the notes', () => {
    const m = parseManifest({
      ...manifest,
      notes: 'x'.repeat(10_000),
      deltas: [
        ...manifest.deltas,
        { from: 'nope', file: 'a.zst' },
        { from: sha('d'), file: '../a' }
      ]
    })
    expect(m?.deltas).toEqual(manifest.deltas)
    expect(m?.notes.length).toBe(4000)
  })
})

describe('parseLayerState', () => {
  test('a damaged or missing state reads as empty', () => {
    expect(parseLayerState(null)).toEqual(EMPTY_LAYER_STATE)
    expect(parseLayerState('garbage')).toEqual(EMPTY_LAYER_STATE)
    expect(parseLayerState({ current: { build: 'x' }, boots: -3, bad: ['a', 7] })).toEqual({
      current: null,
      previous: null,
      boots: 0,
      bad: [7]
    })
  })

  test('round-trips a real state', () => {
    const s: LayerState = { current: entry(20), previous: entry(10), boots: 1, bad: [5] }
    expect(parseLayerState(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })
})

describe('chooseLayer', () => {
  const here = { shell: SHELL, builtInBuild: 5, exists: () => true }

  test('starts the staged layer', () => {
    const s = { ...EMPTY_LAYER_STATE, current: entry(20), previous: entry(10) }
    expect(chooseLayer(s, here)).toEqual({ run: entry(20), crashed: null })
  })

  test('runs the installed app when nothing is staged', () => {
    expect(chooseLayer(EMPTY_LAYER_STATE, here)).toEqual({ run: null, crashed: null })
  })

  test('a layer for another Electron, or older than the installed app, is not started', () => {
    expect(
      chooseLayer({ ...EMPTY_LAYER_STATE, current: entry(20, shellId('45.0.0')) }, here).run
    ).toBeNull()
    expect(
      chooseLayer({ ...EMPTY_LAYER_STATE, current: entry(20) }, { ...here, builtInBuild: 30 }).run
    ).toBeNull()
  })

  test('a missing file or a bad build falls back to the previous layer', () => {
    const s = { ...EMPTY_LAYER_STATE, current: entry(20), previous: entry(10) }
    expect(chooseLayer(s, { ...here, exists: (f) => f !== 'app-20.asar' }).run).toEqual(entry(10))
    expect(chooseLayer({ ...s, bad: [20] }, here).run).toEqual(entry(10))
  })

  test('a layer that keeps failing to start is given up on and reported', () => {
    const s = { ...EMPTY_LAYER_STATE, current: entry(20), previous: entry(10), boots: MAX_BOOTS }
    expect(chooseLayer(s, here)).toEqual({ run: entry(10), crashed: 20 })
    expect(chooseLayer({ ...s, previous: null }, here)).toEqual({ run: null, crashed: 20 })
  })
})

describe('boots and health', () => {
  const s: LayerState = { ...EMPTY_LAYER_STATE, current: entry(20), previous: entry(10) }

  test('only starts of the staged layer count, and a painted window forgives them', () => {
    const once = noteBoot(s, 'app-20.asar')
    expect(once.boots).toBe(1)
    expect(noteBoot(s, 'app-10.asar')).toBe(s) // running the way back: nothing to count
    expect(noteBoot(s, null)).toBe(s) // the installed app
    expect(noteHealthy(once, 'app-20.asar').boots).toBe(0)
    expect(noteHealthy(s, 'app-20.asar')).toBe(s) // nothing to forgive: no write
  })

  test('marking bad clears the count and keeps the list short', () => {
    const marked = markBad({ ...s, boots: 2 }, 20)
    expect(marked.bad).toEqual([20])
    expect(marked.boots).toBe(0)
    let many = s
    for (let b = 1; b <= 30; b++) many = markBad(many, b)
    expect(many.bad.length).toBe(20)
    expect(many.bad.at(-1)).toBe(30)
  })
})

describe('stageLayer and clean-up', () => {
  test('the running layer becomes the way back', () => {
    const s: LayerState = { ...EMPTY_LAYER_STATE, current: entry(20), boots: 1 }
    const next = stageLayer(s, entry(30), 'app-20.asar')
    expect(next).toEqual({ current: entry(30), previous: entry(20), boots: 0, bad: [] })
    expect([...layerFilesToKeep(next, 'app-20.asar')].sort()).toEqual([
      'app-20.asar',
      'app-30.asar'
    ])
  })

  test('a layer staged but never started is not a way back', () => {
    // Running 10; 20 was staged but Panes was not restarted; now 30 arrives.
    const s: LayerState = { ...EMPTY_LAYER_STATE, current: entry(20), previous: entry(10) }
    const next = stageLayer(s, entry(30), 'app-10.asar')
    expect(next.previous).toEqual(entry(10))
    expect(layerFilesToKeep(next, 'app-10.asar').has('app-20.asar')).toBe(false)
  })

  test('running the installed app needs no way back', () => {
    expect(stageLayer(EMPTY_LAYER_STATE, entry(30), null).previous).toBeNull()
  })
})

describe('planLayerUpdate', () => {
  const m = parseManifest(manifest)!
  const here = { shell: SHELL, newest: 1762200000, bad: [] }

  test('a newer layer for this shell is a layer update; for another Electron it needs the installer', () => {
    expect(planLayerUpdate(m, here)).toBe('layer')
    expect(planLayerUpdate(m, { ...here, shell: shellId('43.0.0') })).toBe('installer')
  })

  test('nothing newer, or a build that failed here, is no update', () => {
    expect(planLayerUpdate(m, { ...here, newest: m.build })).toBe('none')
    expect(planLayerUpdate(m, { ...here, bad: [m.build] })).toBe('none')
  })
})

describe('pickDelta', () => {
  const m = parseManifest(manifest)!

  test('takes the first base on hand that a delta was made from', () => {
    const bases = [
      { sha256: sha('f'), path: 'staged' },
      { sha256: sha('c'), path: 'running' },
      { sha256: sha('b'), path: 'installed' }
    ]
    expect(pickDelta(m, bases)).toEqual({ base: bases[1], file: m.deltas[1].file })
    expect(pickDelta(m, [{ sha256: sha('9') }])).toBeNull()
  })
})

describe('feeds', () => {
  test('reads the GitHub feed from electron-builder app-update.yml', () => {
    const feed = feedFromUpdateConfig(
      'owner: kabeer11000\r\nrepo: panes-browser\r\nprovider: github\r\nupdaterCacheDirName: panes-updater\r\n'
    )
    expect(feed?.manifest).toBe(
      'https://github.com/kabeer11000/panes-browser/releases/latest/download/app-layer.json'
    )
    expect(feed?.file('0.1.0-beta.6', 'a.gz')).toBe(
      'https://github.com/kabeer11000/panes-browser/releases/download/v0.1.0-beta.6/a.gz'
    )
  })

  test('other providers or odd names mean no layer feed', () => {
    expect(feedFromUpdateConfig('provider: generic\nurl: https://x')).toBeNull()
    expect(feedFromUpdateConfig('provider: github\nowner: a/b\nrepo: c')).toBeNull()
    expect(feedFromUpdateConfig('')).toBeNull()
  })

  test('a folder feed serves every file from one place', () => {
    const feed = folderFeed('http://127.0.0.1:8080/')
    expect(feed.manifest).toBe('http://127.0.0.1:8080/app-layer.json')
    expect(feed.file('1.0.0', 'x.zst')).toBe('http://127.0.0.1:8080/x.zst')
  })
})
