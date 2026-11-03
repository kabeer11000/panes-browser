/**
 * Releases Panes for Windows: the installer (for new installs and new Electron versions) and the app layer that every
 * existing Panes on the same Electron updates from (scripts/release-layer.ts).
 *
 *   bun run release:win [--notes "<text>"] [--dry-run]
 *
 * The GitHub release is a draft until every file is on it, then published and marked latest in one step. Until then
 * /releases/latest still points at the previous release, and a failed run leaves only a draft that a rerun reuses.
 * One run is one build: the installer, latest.yml and the layer all come from the same bytes. The build is stamped with
 * a build number, the release time in seconds: it only goes up, and it is what Panes compares to decide that a layer
 * is newer (never the version string, where "beta.10" sorts before "beta.9").
 *
 * --notes   the release notes, required for a new release; Panes shows them next to the update
 * --dry-run build everything into dist/ and dist/layer, then stop before anything is created or uploaded
 *
 * Needs a `gh auth login`, a clean working tree and HEAD pushed. A version that is already published is refused:
 * bump package.json first.
 */
import { existsSync } from 'fs'
import { $ } from 'bun'
import pkg from '../package.json'

const tag = `v${pkg.version}`
const dryRun = process.argv.includes('--dry-run')
const notesAt = process.argv.indexOf('--notes')
const notes = notesAt >= 0 ? process.argv[notesAt + 1] : undefined

function fail(message: string): never {
  console.error(`release: ${message}`)
  process.exit(1)
}

const ok = async (cmd: Promise<{ exitCode: number }>): Promise<boolean> =>
  (await cmd).exitCode === 0

/** Everything that can be known before the long build, so a mistake costs a second and not the whole build. */
async function preflight(): Promise<'new' | 'draft'> {
  if (dryRun) return 'new'
  if (!(await ok($`gh auth status`.quiet().nothrow()))) fail('not logged in. Run `gh auth login`.')
  if ((await $`git status --porcelain`.text()).trim()) fail('the working tree is not clean.')
  if (!(await ok($`git merge-base --is-ancestor HEAD ${'@{u}'}`.quiet().nothrow())))
    fail('HEAD is not pushed: the release tag would point at a commit nobody can fetch.')
  const releases = JSON.parse(
    await $`gh release list --limit 100 --json tagName,isDraft`.text()
  ) as {
    tagName: string
    isDraft: boolean
  }[]
  const existing = releases.find((r) => r.tagName === tag)
  if (existing && !existing.isDraft) fail(`${tag} is already published. Bump the version first.`)
  if (!existing && !notes) fail('pass --notes "<text>": users read them next to the update.')
  return existing ? 'draft' : 'new'
}

const state = await preflight()
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
  await $`gh release create ${tag} --draft --target ${head} --title ${tag} --notes ${notes!}`
}
await $`gh release upload ${tag} --clobber ${installer}`
await $`bun scripts/release-layer.ts --publish`

// A release without app-layer.json gives existing users no update at all: check before anyone can see it.
const assets = (
  JSON.parse(await $`gh release view ${tag} --json assets`.text()) as { assets: { name: string }[] }
).assets.map((a) => a.name)
const expected = [...installer.map((f) => f.slice('dist/'.length)), 'app-layer.json']
const absent = expected.filter((name) => !assets.includes(name))
if (absent.length || !assets.some((n) => n.endsWith('.asar.gz')))
  fail(`${tag} stays a draft: missing ${absent.join(', ') || 'the layer'}.`)

await $`gh release edit ${tag} --draft=false --latest`
console.log(`release: ${tag} is live.`)
