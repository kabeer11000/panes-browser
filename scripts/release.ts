/**
 * Releases Panes for Windows: the installer (for new installs and new Electron versions) and the app layer that every
 * existing Panes on the same Electron updates from (scripts/release-layer.ts).
 *
 *   bun run release:win [<bump>] [--preid beta] [--notes "<text>"] [--dry-run]
 *
 * <bump>    patch | minor | major | prerelease | an exact version: bumps package.json, commits `chore(release):
 *           <version>` and pushes it before building. Left out, the version in package.json is released as it is
 *           (how a failed run is repeated).
 * --notes   replaces the generated release notes. Without it they are the feat, fix and perf commits since the last
 *           release tag that touch src/ (scripts/release-notes.ts, preview: `bun scripts/release-notes.ts`). Panes shows
 *           them next to the update, and the script does not pause: read the preview before a real run.
 * --dry-run build into dist/ and dist/layer with the current version, then stop before anything is changed or uploaded
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
import { existsSync, readFileSync } from 'fs'
import { parseArgs } from 'util'
import { $ } from 'bun'
import { notesSinceLastTag } from './release-notes'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    notes: { type: 'string' },
    preid: { type: 'string', default: 'beta' },
    'dry-run': { type: 'boolean', default: false }
  }
})
const [bump] = positionals
const dryRun = values['dry-run']

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

if (!dryRun) await preflight()
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

await $`bun run build`
// --publish never still writes latest.yml and app-update.yml; the files are uploaded below, once the build is whole.
await $`bunx electron-builder --win --publish never ${`--config.extraMetadata.panesBuild=${build}`}`

const installer = ['Panes-setup.exe', 'Panes-setup.exe.blockmap', 'latest.yml'].map(
  (f) => `dist/${f}`
)
const missing = installer.filter((f) => !existsSync(f))
if (missing.length) fail(`electron-builder did not produce ${missing.join(', ')}`)

if (dryRun) {
  await $`bun scripts/release-layer.ts`
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

// A reused draft still holds the layer files of the earlier attempt, which this manifest does not name.
const stale = assets.filter(
  (n) => /^app-.*(\.asar\.gz|\.delta\.zst)$/.test(n) && !layerFiles.includes(n)
)
for (const name of stale) await $`gh release delete-asset ${tag} ${name} --yes`

await $`gh release edit ${tag} --draft=false --latest`
console.log(`release: ${tag} is live.`)
