import { app, net } from 'electron'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import ofs from 'original-fs'
import { basename, dirname, join, resolve } from 'path'
import { promisify } from 'util'
import zlib from 'zlib'
import {
  feedFromUpdateConfig,
  folderFeed,
  layerFileName,
  layerFilesToKeep,
  LAYERS_FOLDER,
  MAX_LAYER_BYTES,
  noteBoot,
  noteHealthy,
  parseLayerState,
  parseManifest,
  pickDelta,
  rolledBackFrom,
  shellId,
  stageLayer,
  STATE_NAME,
  type LayerEntry,
  type LayerFeed,
  type LayerManifest,
  type LayerState
} from '../shared/layers'

/**
 * The main-process side of app layers (see shared/layers.ts and loader.ts): which one is running, its starts, and
 * fetching a new one. Every read and write of an .asar file goes through original-fs, because Electron's own fs
 * treats such a path as an archive to look inside rather than a file.
 */

const gunzip = promisify(zlib.gunzip)
const zstdDecompress = promisify(zlib.zstdDecompress)
// The zstd `dictionary` option is in Node's documentation but not yet in @types/node.
type ZstdDictionaryOptions = zlib.ZstdOptions & { dictionary: Buffer }

export const layersDir = (): string => join(app.getPath('userData'), LAYERS_FOLDER)

/** This app's own package.json: in a layer, the one inside it (the shell's would name the installed version). */
function ownPackage(): { version?: unknown; panesBuild?: unknown } {
  try {
    return JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'))
  } catch {
    return {}
  }
}
const pkg = ownPackage()

/** The version of the code that is running, a layer's when one is. Use this, not app.getVersion(). */
export const appVersion = (): string =>
  typeof pkg.version === 'string' ? pkg.version : app.getVersion()

/** The build number of the running code (0 for a development build). */
export const appBuild = (): number =>
  Number.isSafeInteger(pkg.panesBuild) ? (pkg.panesBuild as number) : 0

/** The installed app.asar, the one the shell came with. */
const installedAsar = (): string => join(process.resourcesPath, 'app.asar')

/** The asar this code runs from: out/main/ is two levels inside it. */
const runningAsar = (): string => resolve(__dirname, '..', '..')

const samePath = (a: string, b: string): boolean =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

/** The layer file Panes is running from, or null when it runs the installed app (or a development build). */
export function runningLayer(): string | null {
  const asar = runningAsar()
  return samePath(dirname(asar), layersDir()) ? basename(asar) : null
}

export const thisShell = (): string =>
  shellId(process.platform, process.arch, process.versions.electron)

export function readLayerState(): LayerState {
  try {
    return parseLayerState(JSON.parse(ofs.readFileSync(join(layersDir(), STATE_NAME), 'utf8')))
  } catch {
    return parseLayerState(null)
  }
}

function writeLayerState(state: LayerState): void {
  const file = join(layersDir(), STATE_NAME)
  ofs.mkdirSync(layersDir(), { recursive: true })
  ofs.writeFileSync(file + '.tmp', JSON.stringify(state))
  ofs.renameSync(file + '.tmp', file)
}

function update(change: (s: LayerState) => LayerState): void {
  try {
    const before = readLayerState()
    const after = change(before)
    if (after !== before) writeLayerState(after)
  } catch (err) {
    console.error('[layers] state write failed:', err)
  }
}

/** The version that failed to start and was rolled back from, for the Software page; null when nothing was. */
export function rolledBackVersion(): string | null {
  return rolledBackFrom(readLayerState(), runningLayer())?.version ?? null
}

/** Panes got past its single-instance lock: one more start of the running layer to account for. */
export const noteLayerBoot = (): void => update((s) => noteBoot(s, runningLayer()))

/** The window painted, so the running layer works. */
export const noteLayerHealthy = (): void => update((s) => noteHealthy(s, runningLayer()))

/** Where releases are fetched from, or null when this build has no GitHub feed (then only the installer updates). */
export function layerFeed(): LayerFeed | null {
  const override = process.env['PANES_LAYER_FEED']
  if (override) return folderFeed(override)
  try {
    return feedFromUpdateConfig(readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf8'))
  } catch {
    return null
  }
}

/** The newest build already on this computer: installed, running or staged and not given up on. */
export function newestBuildHere(state: LayerState): number {
  const staged = state.current && !state.bad.includes(state.current.build) ? state.current.build : 0
  return Math.max(appBuild(), staged)
}

export class FeedMissing extends Error {}

/** The latest release's manifest. FeedMissing when the release has none (one made before layers, or mid-upload). */
export async function fetchManifest(feed: LayerFeed): Promise<LayerManifest> {
  const res = await net.fetch(feed.manifest, { cache: 'no-store' })
  if (res.status === 404) throw new FeedMissing('no app layer in the latest release')
  if (!res.ok) throw new Error(`update server answered ${res.status}`)
  const manifest = parseManifest(await res.json())
  if (!manifest) throw new Error('the update manifest is not valid')
  return manifest
}

/** Downloads a file whole, refusing anything larger than `limit`, and reports progress as it arrives. */
async function download(
  url: string,
  limit: number,
  onProgress?: (received: number, total: number) => void
): Promise<Buffer> {
  const res = await net.fetch(url, { cache: 'no-store' })
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status}): ${basename(url)}`)
  const total = Number(res.headers.get('content-length')) || 0
  if (total > limit) throw new Error(`download too large: ${basename(url)}`)
  const chunks: Buffer[] = []
  let received = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > limit) {
      void reader.cancel()
      throw new Error(`download too large: ${basename(url)}`)
    }
    chunks.push(Buffer.from(value))
    onProgress?.(received, total)
  }
  return Buffer.concat(chunks)
}

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

/** Layers on hand that a delta can start from: staged, running, installed. Read only when a delta needs them. */
function deltaBases(state: LayerState): { path: string; sha256: string }[] {
  const paths = [
    state.current ? join(layersDir(), state.current.file) : null,
    runningAsar(),
    installedAsar()
  ].filter((p): p is string => p !== null)
  const seen = new Set<string>()
  const out: { path: string; sha256: string }[] = []
  for (const path of paths) {
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    if (seen.has(key)) continue
    seen.add(key)
    try {
      if (!path.endsWith('.asar') || !ofs.statSync(path).isFile()) continue // a development build runs from out/
      out.push({ path, sha256: sha256(ofs.readFileSync(path)) })
    } catch {
      // not there: one base fewer
    }
  }
  return out
}

/** The new layer's bytes from a delta, or null when no delta fits or it does not check out. */
async function fromDelta(
  manifest: LayerManifest,
  feed: LayerFeed,
  state: LayerState
): Promise<Buffer | null> {
  const picked = pickDelta(manifest, deltaBases(state))
  if (!picked) return null
  try {
    const delta = await download(feed.file(manifest.version, picked.file), manifest.full.size)
    const options: ZstdDictionaryOptions = {
      dictionary: ofs.readFileSync(picked.base.path),
      maxOutputLength: manifest.full.size,
      params: { [zlib.constants.ZSTD_d_windowLogMax]: 31 }
    }
    const bytes = await zstdDecompress(delta, options)
    return sha256(bytes) === manifest.full.sha256 ? bytes : null
  } catch (err) {
    console.warn('[layers] delta failed, taking the whole layer:', err)
    return null
  }
}

/**
 * Fetches the manifest's layer (a delta when one fits what is here, else the whole layer), checks it against the
 * manifest's hash and size, writes it beside the others and records it as the one to start next. Nothing running is
 * touched: the new code runs the next time Panes opens.
 */
export async function stageFromManifest(
  manifest: LayerManifest,
  feed: LayerFeed,
  onProgress: (fraction: number, bytesPerSecond: number) => void
): Promise<LayerEntry> {
  const state = readLayerState()
  let bytes = await fromDelta(manifest, feed, state)
  if (!bytes) {
    const started = Date.now()
    const packed = await download(
      feed.file(manifest.version, manifest.full.file),
      MAX_LAYER_BYTES,
      (received, total) => {
        const seconds = Math.max(0.001, (Date.now() - started) / 1000)
        if (total > 0) onProgress(received / total, received / seconds)
      }
    )
    bytes = await gunzip(packed, { maxOutputLength: manifest.full.size })
    if (sha256(bytes) !== manifest.full.sha256) throw new Error('the downloaded update is damaged')
  }
  if (bytes.length !== manifest.full.size) throw new Error('the downloaded update is damaged')

  const dir = layersDir()
  ofs.mkdirSync(dir, { recursive: true })
  const file = layerFileName(manifest.build)
  const partial = join(dir, file + '.partial')
  ofs.writeFileSync(partial, bytes)
  ofs.renameSync(partial, join(dir, file))

  const entry: LayerEntry = {
    build: manifest.build,
    version: manifest.version,
    file,
    sha256: manifest.full.sha256,
    shell: manifest.shell
  }
  const running = runningLayer()
  const next = stageLayer(readLayerState(), entry, running)
  writeLayerState(next)
  removeUnused(next, running)
  return entry
}

/** Deletes layer files nothing points at any more. The running one is always kept: its files are open. */
function removeUnused(state: LayerState, running: string | null): void {
  const keep = layerFilesToKeep(state, running)
  try {
    for (const name of ofs.readdirSync(layersDir())) {
      if (!/\.asar(\.partial)?$/.test(name) || keep.has(name)) continue
      try {
        ofs.rmSync(join(layersDir(), name), { force: true })
      } catch {
        // still open somewhere: next time
      }
    }
  } catch {
    // no folder: nothing to clean
  }
}
