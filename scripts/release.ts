/**
 * Releases Panes for Windows: the installer (for new installs and new Electron versions) and the app layer that every
 * existing Panes on the same Electron updates from (scripts/release-layer.ts).
 *
 *   bun run release:win [<bump>] [--preid beta] [--notes "<text>"] [--dry-run] [--layer-only]
 *
 * <bump>    patch | minor | major | prerelease | an exact version: bumps package.json, commits `chore(release):
 *           <version>` and pushes it before building. Left out, the version in package.json is released as it is
 *           (how a failed run is repeated).
 * --notes   replaces the generated release notes. Without it they are the feat, fix and perf commits since the last
 *           release tag that touch src/ (scripts/release-notes.ts, preview: `bun scripts/release-notes.ts`). Panes shows
 *           them next to the update, and the script does not pause: read the preview before a real run.
 * --dry-run build into dist/ and dist/layer with the current version, then stop before anything is changed or uploaded
 * --layer-only  no installer is built: the app alone and its layer (what every existing Panes updates from). Only a
 *           small latest.yml goes up, pointing at the release that has the installer (../<tag>/Panes-setup.exe), so
 *           an older Panes that needs the installer still finds it. Refused when Electron changed since (that needs
 *           a new installer). The default whenever Electron is the same as the last release's.
 * --full    build and upload the installer even though Electron did not change.
 *
 * The GitHub release is a draft until every file is on it, then published and marked latest in one step. Until then
 * /releases/latest still points at the previous release, and a failed run leaves only a draft that a rerun reuses.
 * The tag is made by GitHub when the draft is published, on the commit that was released. One run is one build: the
 * installer, latest.yml and the layer all come from the same bytes. The build is stamped with a build number, the
 * release time in seconds: it only goes up, and it is what Panes compares to decide that a layer is newer (never the
 * version string, where "beta.10" sorts before "beta.9").
 *
 * Needs a `gh auth login`, a clean working tree and HEAD pushed. A version that is already published is refused.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { parseArgs } from 'util'
import { $ } from 'bun'
import electronPackage from 'electron/package.json'
import { MANIFEST_NAME, manifestName, parseManifest, shellId } from '../src/shared/layers'
import { notesSinceLastTag } from './release-notes'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    notes: { type: 'string' },
    preid: { type: 'string', default: 'beta' },
    'dry-run': { type: 'boolean', default: false },
    'layer-only': { type: 'boolean', default: false },
    full: { type: 'boolean', default: false }
  }
})
const [bump] = positionals
const dryRun = values['dry-run']
const forceFull = values.full

function fail(message: string): never {
  console.error(`release: ${message}`)
  process.exit(1)
}

const ok = async (cmd: Promise<{ exitCode: number }>): Promise<boolean> =>
  (await cmd).exitCode === 0
const currentVersion = (): string => JSON.parse(readFileSync('package.json', 'utf8')).version

async function releaseState(tag: string): Promise<'new' | 'draft' | 'published'> {
  const releases = JSON.parse(
    await $`gh release list --limit 100 --json tagName,isDraft`.text()
  ) as { tagName: string; isDraft: boolean }[]
  const existing = releases.find((r) => r.tagName === tag)
  return !existing ? 'new' : existing.isDraft ? 'draft' : 'published'
}

/** Everything that can be known before the long build, so a mistake costs a second and not the whole build. */
async function preflight(): Promise<void> {
  if (!(await ok($`gh auth status`.quiet().nothrow()))) fail('not logged in. Run `gh auth login`.')
  if ((await $`git status --porcelain`.text()).trim()) fail('the working tree is not clean.')
  if (!(await ok($`git merge-base --is-ancestor HEAD ${'@{u}'}`.quiet().nothrow())))
    fail('HEAD is not pushed: the release tag would point at a commit nobody can fetch.')
}

/** package.json to the next version, committed and pushed. Returns the version. */
async function bumpVersion(increment: string): Promise<string> {
  await $`bun pm version ${increment} --preid ${values.preid} --no-git-tag-version`.quiet()
  const version = currentVersion()
  if ((await releaseState(`v${version}`)) === 'published') {
    await $`git checkout -- package.json`
    fail(`v${version} is already published.`)
  }
  await $`git add package.json`
  await $`git commit -m ${`chore(release): ${version}`}`.quiet()
  await $`git push`
  return version
}

/**
 * --layer-only: the release before this one, whose installer is carried over (it must be on the same shell, so a
 * Panes installed from it takes this release's layer). Known before the long build, like the rest of the preflight.
 */
async function installerSource(): Promise<{ tag: string } | { why: string }> {
  const prev = JSON.parse(await $`gh release view --json tagName`.text()) as { tagName: string }
  const manifest = parseManifest(
    JSON.parse(await $`gh release download ${prev.tagName} -p ${MANIFEST_NAME} -O -`.text())
  )
  const here = shellId('win32', 'x64', electronPackage.version)
  if (!manifest) return { why: `${prev.tagName} has no valid ${MANIFEST_NAME}` }
  if (manifest.shell !== here)
    return {
      why: `${prev.tagName} is on shell ${manifest.shell}, this build on ${here}: a new Electron`
    }
  return { tag: prev.tagName }
}

/**
 * The installer stays where it is: this release's latest.yml points at it, in the release that holds it
 * (electron-updater reads releases/download/<this tag>/<url>, and the URL's `..` takes it to that release). A
 * latest.yml that already points back (carried from a layer-only release) is kept as it is.
 */
function pointAtInstaller(yml: string, from: string): string {
  const to = (file: string): string => (file.startsWith('../') ? file : `../${from}/${file}`)
  return yml
    .replace(/^(\s*-?\s*url:\s*)(\S+)\s*$/gm, (_m, k: string, f: string) => `${k}${to(f)}`)
    .replace(/^(path:\s*)(\S+)\s*$/m, (_m, k: string, f: string) => `${k}${to(f)}`)
}

if (!dryRun) await preflight()
// Same Electron as the last release: no installer (139 MB) is built or uploaded, only the app's layers. A new
// Electron, or --full, builds the installer.
const source = forceFull || dryRun ? null : await installerSource()
if (values['layer-only'] && source && 'why' in source)
  fail(`--layer-only: ${source.why}. Make a full release.`)
const carryFrom = source && 'tag' in source ? source.tag : null
if (!forceFull && !carryFrom && source && 'why' in source)
  console.log(`release: with the installer (${source.why})`)
// Before the bump is pushed, so a release with nothing to say does not burn a version number.
const generated = await notesSinceLastTag()
const notes = values.notes ?? generated.notes
if (!notes) fail(`no user-facing changes since ${generated.since}. Pass --notes "<text>".`)
console.log(
  `release notes (${values.notes ? 'from --notes' : `since ${generated.since}`}):\n${notes}\n`
)

const version = !dryRun && bump ? await bumpVersion(bump) : currentVersion()
const tag = `v${version}`
const state = dryRun ? 'new' : await releaseState(tag)
if (state === 'published')
  fail(`${tag} is already published. Pass a bump (patch, prerelease, ...).`)

const build = Math.floor(Date.now() / 1000)

// the typecheck beside the build, not before it (it was a minute of waiting): a type error still stops the release
await Promise.all([$`bun run typecheck`, $`bun run build:app`])
if (carryFrom) {
  // the app alone (dist/win-unpacked, what the layer is made of): no installer is built
  await $`bunx electron-builder --win --dir --publish never ${`--config.extraMetadata.panesBuild=${build}`}`
  // the installer stays in its release; only latest.yml comes along, pointing back at it
  const yml = await $`gh release download ${carryFrom} -p latest.yml -O -`.text()
  writeFileSync('dist/latest.yml', pointAtInstaller(yml, carryFrom))
  console.log(`release: layer only, latest.yml points at the installer from ${carryFrom}'s chain`)
} else {
  // --publish never still writes latest.yml and app-update.yml; the files are uploaded below, once the build is whole.
  await $`bunx electron-builder --win --publish never ${`--config.extraMetadata.panesBuild=${build}`}`
}

const installer = (
  carryFrom ? ['latest.yml'] : ['Panes-setup.exe', 'Panes-setup.exe.blockmap', 'latest.yml']
).map((f) => `dist/${f}`)
const missing = installer.filter((f) => !existsSync(f))
if (missing.length) fail(`electron-builder did not produce ${missing.join(', ')}`)

/**
 * The Mac layers, made here from the Windows build (scripts/mac-layer.ts), once the Mac shell has been built
 * (.github/workflows/mac.yml keeps its native modules on the mac-shell release). Returns the platforms made.
 */
const MAC_ARCHES = ['arm64', 'x64'] as const
async function macLayers(publish: boolean): Promise<string[]> {
  // both at once (each has its own work, out and cache files): they were the slowest part of a release, in turn
  const made = await Promise.all(
    MAC_ARCHES.map(async (arch) => {
      const asar = `dist/mac/app-darwin-${arch}.asar`
      const built = await $`bun scripts/mac-layer.ts --arch ${arch} --out ${asar}`.nothrow()
      if (built.exitCode !== 0) {
        console.log(`release: no Mac layer for ${arch} (scripts/mac-layer.ts said why, above)`)
        return null
      }
      const out = `dist/layer-darwin-${arch}`
      await $`bun scripts/release-layer.ts --asar ${asar} --target darwin-${arch} --out ${out} ${publish ? ['--publish'] : []}`
      return `darwin-${arch}`
    })
  )
  return made.filter((m): m is string => m !== null)
}

if (dryRun) {
  await $`bun scripts/release-layer.ts`
  await macLayers(false)
  console.log('release: dry run done, nothing was created or uploaded.')
  process.exit(0)
}

if (state === 'new') {
  // --target: a draft has no tag yet, and the tag is made at publish time on whatever the default branch is then.
  const head = (await $`git rev-parse HEAD`.text()).trim()
  await $`gh release create ${tag} --draft --target ${head} --title ${tag} --notes ${notes}`
} else {
  // before the layer step: its manifest carries the release body
  await $`gh release edit ${tag} --notes ${notes}`
}
await $`gh release upload ${tag} --clobber ${installer}`
await $`bun scripts/release-layer.ts --publish`

// A release without app-layer.json gives existing users no update at all: check before anyone can see it.
// Windows goes live as soon as its layer is up and checked; the Mac layers follow into the published release (a Mac
// sees no update for those minutes, then its manifest is there). A release used to wait for both Mac layers first.
const assets = (
  JSON.parse(await $`gh release view ${tag} --json assets`.text()) as { assets: { name: string }[] }
).assets.map((a) => a.name)
const manifest = JSON.parse(readFileSync('dist/layer/app-layer.json', 'utf8')) as {
  full: { file: string }
  deltas: { file: string }[]
}
const layerFiles = [manifest.full.file, ...manifest.deltas.map((d) => d.file)]
const expected = [...installer.map((f) => f.slice('dist/'.length)), 'app-layer.json', ...layerFiles]
const absent = expected.filter((name) => !assets.includes(name))
if (absent.length) fail(`${tag} stays a draft: missing ${absent.join(', ')}.`)

// A reused draft still holds the layer files of the earlier attempt, which this manifest does not name (Mac files
// of an earlier attempt are replaced as the Mac layers upload with --clobber).
const stale = assets.filter(
  (n) =>
    /^app-.*(\.asar\.gz|\.delta\.zst)$/.test(n) && !n.includes('darwin') && !layerFiles.includes(n)
)
for (const name of stale) await $`gh release delete-asset ${tag} ${name} --yes`

await $`gh release edit ${tag} --draft=false --latest`
console.log(`release: ${tag} is live for Windows. Mac layers next.`)

const macs = await macLayers(true)
const after = (
  JSON.parse(await $`gh release view ${tag} --json assets`.text()) as { assets: { name: string }[] }
).assets.map((a) => a.name)
for (const target of macs) {
  const [platform, arch] = target.split('-')
  const name = manifestName(platform, arch)
  const m = JSON.parse(readFileSync(`dist/layer-${target}/${name}`, 'utf8')) as typeof manifest
  const missingMac = [name, m.full.file, ...m.deltas.map((d) => d.file)].filter(
    (f) => !after.includes(f)
  )
  if (missingMac.length)
    console.log(`release: ${target} incomplete, missing ${missingMac.join(', ')}`)
}
console.log(`release: ${tag} is live (Mac: ${macs.join(', ') || 'none'}).`)
