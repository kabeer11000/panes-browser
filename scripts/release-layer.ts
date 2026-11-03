/**
 * Makes (and with --publish, uploads) the app layer of a release: the built app.asar as a whole (gzip), zstd deltas
 * from the last few published layers, and the manifest that names them (see src/shared/layers.ts). Run after
 * electron-builder has built the release; `bun run release:win` (scripts/release.ts) does both.
 *
 *   bun scripts/release-layer.ts [--asar <app.asar>] [--target <platform-arch>] [--out <dir>] [--base <app.asar> ...]
 *                                [--publish]
 *
 * --asar   the layer to release (default dist/win-unpacked/resources/app.asar)
 * --target the platform and processor that build is for (default win32-x64, what `electron-builder --win` makes);
 *          only a Panes on the same one takes the layer
 * --out    where the files are written (default dist/layer); with no --publish this folder is a feed that
 *          PANES_LAYER_FEED can point a Panes at, for trying an update without a release
 * --base   make a delta from this local app.asar instead of from the published releases (repeatable)
 * --publish upload to the GitHub release v<version>: the layer and deltas first, the manifest last, so a Panes never
 *          reads a manifest whose files are not there yet
 */
import { getRawHeader, extractFile } from '@electron/asar'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { $, type ShellError } from 'bun'
import { gunzipSync, gzipSync, constants, zstdCompressSync, zstdDecompressSync } from 'zlib'
import electronPackage from 'electron/package.json'
import { MANIFEST_NAME, parseManifest, shellId, type LayerManifest } from '../src/shared/layers'

/** How many earlier layers get a delta: someone further behind downloads the whole layer (about 5 MB). */
const DELTA_FROM_LAST = 3

const args = process.argv.slice(2)
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const all = (name: string): string[] =>
  args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []))
const publish = args.includes('--publish')
const asarPath = resolve(option('--asar', 'dist/win-unpacked/resources/app.asar'))
const outDir = resolve(option('--out', 'dist/layer'))
const localBases = all('--base').map((p) => resolve(p))
const [targetPlatform, targetArch] = option('--target', 'win32-x64').split('-')

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(2)} MB`

function fail(message: string): never {
  console.error(`release-layer: ${message}`)
  process.exit(1)
}

async function gh(...ghArgs: string[]): Promise<string> {
  try {
    return await $`gh ${ghArgs}`.quiet().text()
  } catch (e) {
    return fail(`gh ${ghArgs.join(' ')} failed: ${(e as ShellError).stderr}`)
  }
}

/** Every entry of the archive header that is kept outside the archive. A layer replaces app.asar alone. */
function unpackedFiles(node: unknown, path = ''): string[] {
  if (typeof node !== 'object' || node === null) return []
  const n = node as { files?: Record<string, unknown>; unpacked?: boolean }
  if (n.files)
    return Object.entries(n.files).flatMap(([name, child]) =>
      unpackedFiles(child, path ? `${path}/${name}` : name)
    )
  return n.unpacked ? [path] : []
}

/** A delta from `base` to `next`: zstd with the old layer as dictionary, so unchanged code costs almost nothing. */
function makeDelta(base: Buffer, next: Buffer): Buffer {
  // The window must reach back across the whole old layer for its matches.
  const windowLog = Math.min(30, Math.max(23, Math.ceil(Math.log2(base.length + next.length))))
  const delta = zstdCompressSync(next, {
    params: {
      [constants.ZSTD_c_compressionLevel]: 19,
      [constants.ZSTD_c_windowLog]: windowLog,
      [constants.ZSTD_c_enableLongDistanceMatching]: 1
    },
    dictionary: base
  } as Parameters<typeof zstdCompressSync>[1])
  // Prove it the way a Panes will read it before anyone downloads it.
  const back = zstdDecompressSync(delta, {
    params: { [constants.ZSTD_d_windowLogMax]: 31 },
    dictionary: base
  } as Parameters<typeof zstdDecompressSync>[1])
  if (sha256(back) !== sha256(next)) fail('a delta did not decode back to the layer')
  return delta
}

/** The layers of the last few published releases on this shell, as bases for deltas. */
async function publishedBases(
  shell: string,
  version: string
): Promise<{ name: string; bytes: Buffer }[]> {
  const tags = (
    JSON.parse(await gh('release', 'list', '--limit', '20', '--json', 'tagName,isDraft')) as {
      tagName: string
      isDraft: boolean
    }[]
  )
    // a draft is a release that stopped half way: nobody was offered its layer
    .filter((r) => !r.isDraft && r.tagName !== `v${version}`)
    .map((r) => r.tagName)
  const tmp = join(outDir, '.bases')
  mkdirSync(tmp, { recursive: true })
  const bases: { name: string; bytes: Buffer }[] = []
  for (const tag of tags) {
    if (bases.length >= DELTA_FROM_LAST) break
    const dir = join(tmp, tag)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const got = await $`gh release download ${tag} --pattern ${MANIFEST_NAME} --dir ${dir}`
      .quiet()
      .nothrow()
    if (got.exitCode !== 0) continue // a release from before layers
    const m = parseManifest(JSON.parse(readFileSync(join(dir, MANIFEST_NAME), 'utf8')))
    if (!m || m.shell !== shell) continue // another Electron: a Panes on it takes the installer, not a delta
    await gh('release', 'download', tag, '--pattern', m.full.file, '--dir', dir)
    const bytes = gunzipSync(readFileSync(join(dir, m.full.file)))
    if (sha256(bytes) !== m.full.sha256)
      fail(`the published layer of ${tag} does not match its manifest`)
    bases.push({ name: String(m.build), bytes })
  }
  rmSync(tmp, { recursive: true, force: true })
  return bases
}

async function main(): Promise<void> {
  if (!existsSync(asarPath)) fail(`no app.asar at ${asarPath}; build the release first`)
  const layer = readFileSync(asarPath)
  const pkg = JSON.parse(extractFile(asarPath, 'package.json').toString('utf8')) as {
    version?: string
    panesBuild?: unknown
  }
  const version = pkg.version ?? fail('the layer has no version')
  if (!Number.isSafeInteger(pkg.panesBuild) || (pkg.panesBuild as number) <= 0)
    fail('the layer has no panesBuild number; build it with scripts/release.ts')
  const build = pkg.panesBuild as number
  const outside = unpackedFiles(getRawHeader(asarPath).header)
  if (outside.length > 0)
    fail(`files are unpacked beside app.asar, which a layer cannot carry: ${outside.join(', ')}`)
  if (!targetPlatform || !targetArch) fail('--target is <platform>-<arch>, e.g. win32-x64')
  const shell = shellId(targetPlatform, targetArch, electronPackage.version)

  mkdirSync(outDir, { recursive: true })
  const fullName = `app-${build}.asar.gz`
  const gz = gzipSync(layer, { level: 9 })
  writeFileSync(join(outDir, fullName), gz)
  const layerHash = sha256(layer)

  const bases = localBases.length
    ? localBases.map((p) => {
        const bytes = readFileSync(p)
        return { name: sha256(bytes).slice(0, 12), bytes }
      })
    : publish
      ? await publishedBases(shell, version)
      : []
  const deltas: LayerManifest['deltas'] = []
  for (const base of bases) {
    const from = sha256(base.bytes)
    if (from === layerHash || deltas.some((d) => d.from === from)) continue
    const name = `app-${base.name}-${build}.delta.zst`
    const delta = makeDelta(base.bytes, layer)
    writeFileSync(join(outDir, name), delta)
    deltas.push({ from, file: name })
    console.log(`delta from ${base.name}: ${(delta.length / 1024).toFixed(0)} KB`)
  }

  const notes = publish
    ? (JSON.parse(await gh('release', 'view', `v${version}`, '--json', 'body')) as { body: string })
        .body
    : ''
  const manifest: LayerManifest = {
    schema: 1,
    version,
    build,
    shell,
    notes,
    full: { file: fullName, sha256: layerHash, size: layer.length },
    deltas
  }
  if (!parseManifest(manifest)) fail('the manifest would not pass the checks Panes makes')
  writeFileSync(join(outDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2))
  console.log(
    `layer ${version} (build ${build}, shell ${shell}): ${mb(layer.length)}, whole ${mb(
      gz.length
    )} gzip, ${deltas.length} delta(s) in ${outDir}`
  )

  if (!publish) return
  const tag = `v${version}`
  await gh(
    'release',
    'upload',
    tag,
    '--clobber',
    join(outDir, fullName),
    ...deltas.map((d) => join(outDir, d.file))
  )
  await gh('release', 'upload', tag, '--clobber', join(outDir, MANIFEST_NAME)) // last: see the header
  console.log(`uploaded to ${tag}`)
}

await main()
