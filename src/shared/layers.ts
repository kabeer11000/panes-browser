/**
 * App layers: Panes' own code (one app.asar) updated apart from the Electron shell it runs in.
 *
 * A release publishes a manifest naming the full layer (gzip) and small zstd deltas from earlier layers. Panes fetches
 * one while it runs, rebuilds the new app.asar beside the running one, and the loader (main/loader.ts) starts it the
 * next time Panes opens. Nothing is installed, and a launch never waits on the network. Only an Electron upgrade, a
 * new shell, goes through the installer.
 *
 * Everything here is pure, so the loader, the updater and the release script share one set of rules.
 */

/** Bumped when the loader's contract with the app changes: a layer only runs under the loader it was built for. */
export const LOADER_VERSION = 1

/**
 * What a layer must have been built for to run here: the platform and processor (a layer can carry platform-specific
 * code and settings), the Electron version and the loader version, e.g. `win32-x64-44.10.0+1`.
 */
export const shellId = (platform: string, arch: string, electron: string): string =>
  `${platform}-${arch}-${electron}+${LOADER_VERSION}`

export const MANIFEST_NAME = 'app-layer.json'
/** Where staged layers and their state live, inside the data folder. */
export const LAYERS_FOLDER = 'app-layers'
export const STATE_NAME = 'state.json'
/** Starts of a new layer that never reached a painted window before it is given up on. */
export const MAX_BOOTS = 2
/** A layer bigger than this is not a layer (today's is about 21 MB). */
export const MAX_LAYER_BYTES = 256 * 1024 * 1024

/** The local file a staged layer is kept as. */
export const layerFileName = (build: number): string => `app-${build}.asar`

export interface LayerManifest {
  schema: 1
  version: string
  /** Goes up with every release: the only thing compared, so "beta.10" vs "beta.9" never comes into it. */
  build: number
  shell: string
  notes: string
  /** The whole layer, gzip compressed; sha256 and size are of the layer itself, after decompressing. */
  full: { file: string; sha256: string; size: number }
  /** zstd deltas, each made against the earlier layer whose sha256 is `from`. */
  deltas: { from: string; file: string }[]
}

/** A layer that is staged on this computer. */
export interface LayerEntry {
  build: number
  version: string
  file: string
  sha256: string
  shell: string
}

export interface LayerState {
  /** The newest staged layer, started the next time Panes opens. */
  current: LayerEntry | null
  /** What was running when `current` was staged: where Panes goes back to if `current` fails. */
  previous: LayerEntry | null
  /** Starts of `current` that have not reached a painted window yet. */
  boots: number
  /** Builds that failed and are never started or downloaded again. */
  bad: number[]
}

export const EMPTY_LAYER_STATE: LayerState = { current: null, previous: null, boots: 0, bad: [] }

const SHA256 = /^[0-9a-f]{64}$/
// A plain file name: no folders, so a manifest can never point outside the layers folder.
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/
const MAX_NOTES = 4000
const MAX_BAD = 20

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isBuild = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0
const isFile = (v: unknown): v is string =>
  typeof v === 'string' && FILE.test(v) && !v.includes('..')
const isSha = (v: unknown): v is string => typeof v === 'string' && SHA256.test(v)
const isVersion = (v: unknown): v is string => typeof v === 'string' && VERSION.test(v)
const isShell = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 64

/** A manifest from the network, checked field by field; anything off and it is not used at all. */
export function parseManifest(raw: unknown): LayerManifest | null {
  if (!isObject(raw) || raw['schema'] !== 1) return null
  const { version, build, shell, notes, full, deltas } = raw
  if (!isVersion(version) || !isBuild(build) || !isShell(shell)) return null
  if (!isObject(full) || !isFile(full['file']) || !isSha(full['sha256'])) return null
  const size = full['size']
  if (!Number.isSafeInteger(size) || (size as number) <= 0 || (size as number) > MAX_LAYER_BYTES)
    return null
  if (!Array.isArray(deltas)) return null
  const okDeltas = deltas.filter(
    (d): d is { from: string; file: string } => isObject(d) && isSha(d['from']) && isFile(d['file'])
  )
  return {
    schema: 1,
    version,
    build,
    shell,
    notes: typeof notes === 'string' ? notes.slice(0, MAX_NOTES) : '',
    full: { file: full['file'] as string, sha256: full['sha256'] as string, size: size as number },
    deltas: okDeltas.map((d) => ({ from: d.from, file: d.file }))
  }
}

function parseEntry(v: unknown): LayerEntry | null {
  if (!isObject(v)) return null
  const { build, version, file, sha256, shell } = v
  if (!isBuild(build) || !isVersion(version) || !isFile(file) || !isSha(sha256) || !isShell(shell))
    return null
  return { build, version, file, sha256, shell }
}

/** The state file as read from disk. A damaged one reads as empty: Panes then runs what it was installed with. */
export function parseLayerState(raw: unknown): LayerState {
  if (!isObject(raw)) return EMPTY_LAYER_STATE
  const boots = raw['boots']
  return {
    current: parseEntry(raw['current']),
    previous: parseEntry(raw['previous']),
    boots: Number.isSafeInteger(boots) && (boots as number) > 0 ? (boots as number) : 0,
    bad: Array.isArray(raw['bad']) ? raw['bad'].filter(isBuild).slice(-MAX_BAD) : []
  }
}

/**
 * Which layer the loader starts. `current` while it has not failed too often, else `previous`, else nothing (the
 * app Panes was installed with). A layer only counts when it was built for this shell, is newer than the installed
 * app (an installer update brings its own, newer code) and its file is there. `crashed` names a `current` that just
 * used up its starts, so the loader can mark it bad.
 */
export function chooseLayer(
  state: LayerState,
  here: { shell: string; builtInBuild: number; exists: (file: string) => boolean }
): { run: LayerEntry | null; crashed: number | null } {
  const usable = (e: LayerEntry | null): e is LayerEntry =>
    e !== null &&
    e.shell === here.shell &&
    e.build > here.builtInBuild &&
    !state.bad.includes(e.build) &&
    here.exists(e.file)
  let crashed: number | null = null
  if (usable(state.current)) {
    if (state.boots < MAX_BOOTS) return { run: state.current, crashed: null }
    crashed = state.current.build
  }
  return { run: usable(state.previous) ? state.previous : null, crashed }
}

/**
 * The staged version that failed and was given up on, while Panes runs something older: worth telling the user, since
 * the version they see went backwards. Null once a newer layer is staged or the failed one is running.
 */
export function rolledBackFrom(state: LayerState, running: string | null): LayerEntry | null {
  const failed = state.current
  return failed && state.bad.includes(failed.build) && failed.file !== running ? failed : null
}

/** A build that failed: never started or downloaded again. */
export function markBad(state: LayerState, build: number): LayerState {
  if (state.bad.includes(build)) return { ...state, boots: 0 }
  return { ...state, boots: 0, bad: [...state.bad, build].slice(-MAX_BAD) }
}

/** Panes started `running` (a layer file, or null for the installed app): one more start of `current` to account for. */
export function noteBoot(state: LayerState, running: string | null): LayerState {
  return running !== null && state.current?.file === running
    ? { ...state, boots: state.boots + 1 }
    : state
}

/** The window painted: the running layer works, so its starts are forgiven. */
export function noteHealthy(state: LayerState, running: string | null): LayerState {
  return running !== null && state.current?.file === running && state.boots > 0
    ? { ...state, boots: 0 }
    : state
}

/**
 * A new layer is staged. What is running now becomes the way back (it is working: it is running), unless that is
 * the installed app, which needs no entry.
 */
export function stageLayer(
  state: LayerState,
  entry: LayerEntry,
  running: string | null
): LayerState {
  const runningEntry =
    running === null
      ? null
      : ([state.current, state.previous].find((e) => e?.file === running) ?? null)
  return {
    current: entry,
    previous: runningEntry && runningEntry.build !== entry.build ? runningEntry : null,
    boots: 0,
    bad: state.bad
  }
}

/** Layer files to keep on disk: the staged one, the way back, and whatever is running (its files are open). */
export function layerFilesToKeep(state: LayerState, running: string | null): Set<string> {
  const keep = new Set<string>()
  if (state.current) keep.add(state.current.file)
  if (state.previous) keep.add(state.previous.file)
  if (running) keep.add(running)
  return keep
}

/**
 * What to do with a manifest. `newest` is the newest build already here (installed, running or staged), so a
 * check after staging does not stage the same layer again.
 */
export function planLayerUpdate(
  manifest: LayerManifest,
  here: { shell: string; newest: number; bad: number[] }
): 'none' | 'layer' | 'installer' {
  if (manifest.build <= here.newest || here.bad.includes(manifest.build)) return 'none'
  return manifest.shell === here.shell ? 'layer' : 'installer'
}

/** The first base on hand that a delta in the manifest was made against. */
export function pickDelta<B extends { sha256: string }>(
  manifest: LayerManifest,
  bases: B[]
): { base: B; file: string } | null {
  for (const base of bases) {
    const d = manifest.deltas.find((x) => x.from === base.sha256)
    if (d) return { base, file: d.file }
  }
  return null
}

/** Where a release's files are fetched from. */
export interface LayerFeed {
  manifest: string
  file: (version: string, name: string) => string
}

/** GitHub releases: the manifest of the latest release, and each file from its own release (tag `v<version>`). */
export function githubFeed(owner: string, repo: string): LayerFeed {
  const root = `https://github.com/${owner}/${repo}/releases`
  return {
    manifest: `${root}/latest/download/${MANIFEST_NAME}`,
    file: (version, name) => `${root}/download/v${version}/${name}`
  }
}

/** Every file in one folder (PANES_LAYER_FEED, for trying an update against a local server). */
export function folderFeed(base: string): LayerFeed {
  const root = base.replace(/\/+$/, '')
  return { manifest: `${root}/${MANIFEST_NAME}`, file: (_version, name) => `${root}/${name}` }
}

const NAME = /^[A-Za-z0-9_.-]+$/

/**
 * The release feed from the app-update.yml electron-builder writes next to the app (from the `publish` config): a
 * flat file of `key: value` lines. Only GitHub is understood; anything else means no layer updates.
 */
export function feedFromUpdateConfig(text: string): LayerFeed | null {
  const fields = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z]+):\s*['"]?([^'"#\s]+)['"]?\s*$/.exec(line)
    if (m) fields.set(m[1], m[2])
  }
  const owner = fields.get('owner')
  const repo = fields.get('repo')
  if (fields.get('provider') !== 'github' || !owner || !repo) return null
  return NAME.test(owner) && NAME.test(repo) ? githubFeed(owner, repo) : null
}
