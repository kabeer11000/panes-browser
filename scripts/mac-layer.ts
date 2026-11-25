/**
 * Makes a Mac app layer on this (Windows) machine from the Windows one: app.asar is the same JavaScript on every
 * platform, so only its native modules are exchanged for the Mac's.
 *
 *   bun scripts/mac-layer.ts --arch arm64|x64 [--asar dist/win-unpacked/resources/app.asar] [--out <file>]
 *
 * - @napi-rs/canvas: its Mac package, from npm (the same version as the Windows one)
 * - adblock-rs: built from its Rust sources, so it cannot be fetched or cross-built here. Its Mac build comes from
 *   .github/workflows/mac.yml, which keeps it on the `mac-shell` release named by its version; when adblock-rs
 *   changes, `gh workflow run mac.yml -f native_only=true` builds just that (minutes, no app build).
 * - koffi: Windows only (the touchpad, memory trimming); a Mac never loads it, so it is left as it is.
 *
 * Writes dist/mac/app-darwin-<arch>.asar (or --out). Downloads are kept in dist/mac-native.
 */
import { createPackage, extractAll } from '@electron/asar'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import { $ } from 'bun'

const args = process.argv.slice(2)
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const arch = option('--arch', '')
const asarPath = resolve(option('--asar', 'dist/win-unpacked/resources/app.asar'))
const outPath = resolve(option('--out', `dist/mac/app-darwin-${arch}.asar`))
const cache = resolve('dist/mac-native')

/** The release the Mac shell build keeps its native modules on (never the latest release). */
export const MAC_SHELL_TAG = 'mac-shell'
/** The adblock-rs version in node_modules: the Mac build taken must be the same one (its JavaScript is in the asar). */
const adblockVersion = (
  JSON.parse(readFileSync('node_modules/adblock-rs/package.json', 'utf8')) as { version: string }
).version
/**
 * Its Mac build's name on the mac-shell release, by version, so a new adblock-rs can never be paired with the old
 * native module (they were once kept under one name, downloaded once and reused for good).
 */
export const adblockAsset = (a: string): string => `adblock-rs-darwin-${a}-${adblockVersion}.node`

function fail(message: string): never {
  console.error(`mac-layer: ${message}`)
  process.exit(1)
}

if (arch !== 'arm64' && arch !== 'x64') fail('--arch is arm64 or x64')
if (!existsSync(asarPath)) fail(`no app.asar at ${asarPath}; build the Windows app first`)

/** adblock-rs for the Mac, from the Mac shell build (downloaded once). */
async function adblockNode(): Promise<string> {
  const file = join(cache, adblockAsset(arch))
  if (existsSync(file)) return file
  mkdirSync(cache, { recursive: true })
  const got =
    await $`gh release download ${MAC_SHELL_TAG} -p ${adblockAsset(arch)} -D ${cache} --clobber`
      .quiet()
      .nothrow()
  if (got.exitCode !== 0 || !existsSync(file))
    fail(
      `no ${adblockAsset(arch)} on the ${MAC_SHELL_TAG} release: build it for this adblock-rs once ` +
        '(gh workflow run mac.yml -f native_only=true)'
    )
  return file
}

/** @napi-rs/canvas's Mac package, the version the Windows one has, from npm (downloaded once). */
async function canvasPackage(): Promise<string> {
  const version = (
    JSON.parse(readFileSync('node_modules/@napi-rs/canvas/package.json', 'utf8')) as {
      optionalDependencies?: Record<string, string>
    }
  ).optionalDependencies?.[`@napi-rs/canvas-darwin-${arch}`]
  if (!version) fail(`@napi-rs/canvas names no darwin-${arch} package`)
  const dir = join(cache, `canvas-darwin-${arch}-${version}`)
  if (existsSync(join(dir, 'package.json'))) return dir
  mkdirSync(dir, { recursive: true })
  const url = `https://registry.npmjs.org/@napi-rs/canvas-darwin-${arch}/-/canvas-darwin-${arch}-${version}.tgz`
  const res = await fetch(url)
  if (!res.ok) fail(`npm answered ${res.status} for ${url}`)
  const tgz = join(cache, `canvas-darwin-${arch}-${version}.tgz`)
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()))
  // the tarball holds package/...: unpacked straight into the package's own folder
  // relative paths, run inside the folder: GNU tar reads a path with a drive letter as a remote host
  await $`tar -xzf ../${basename(tgz)} --strip-components=1`.cwd(dir).quiet()
  rmSync(tgz)
  return dir
}

const adblock = await adblockNode()
const canvas = await canvasPackage()

const work = resolve(`dist/mac/.work-${arch}`)
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
extractAll(asarPath, work)

const nm = join(work, 'node_modules')
// the Windows canvas binary out, the Mac one in
for (const pkg of ['canvas-win32-x64-msvc', 'canvas-win32-arm64-msvc'])
  rmSync(join(nm, '@napi-rs', pkg), { recursive: true, force: true })
cpSync(canvas, join(nm, '@napi-rs', `canvas-darwin-${arch}`), { recursive: true })
// the ad blocker's Mac build in place of the Windows one
const adblockDest = join(nm, 'adblock-rs', 'js', 'index.node')
if (!existsSync(adblockDest)) fail('the Windows app has no adblock-rs/js/index.node to replace')
cpSync(adblock, adblockDest)

mkdirSync(dirname(outPath), { recursive: true })
rmSync(outPath, { force: true })
await createPackage(work, outPath)
rmSync(work, { recursive: true, force: true })
console.log(`mac-layer: ${outPath}`)
