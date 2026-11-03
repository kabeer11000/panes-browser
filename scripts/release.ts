/**
 * Releases Panes for Windows: the installer (for new installs and new Electron versions) and the app layer that every
 * existing Panes on the same Electron updates from (scripts/release-layer.ts).
 *
 *   bun run release:win
 *
 * Create the GitHub release first (`gh release create v<version> --latest`, see tasks/lessons.md). The build is stamped
 * with a build number, the release time in seconds: it only goes up, and it is what Panes compares to decide that a
 * layer is newer (never the version string, where "beta.10" sorts before "beta.9").
 *
 * Uploads use the GitHub CLI's login: electron-builder reads its token from GH_TOKEN, which is taken from `gh auth
 * token` when it is not already set, so one `gh auth login` covers both the installer and the layer.
 */
import { spawnSync } from 'child_process'

const build = Math.floor(Date.now() / 1000)

function githubToken(): string {
  if (process.env['GH_TOKEN']) return process.env['GH_TOKEN']
  const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' })
  const token = r.status === 0 ? r.stdout.trim() : ''
  if (!token) {
    console.error(
      'release: not logged in to GitHub. Run `gh auth login` (or set GH_TOKEN) and try again.'
    )
    process.exit(1)
  }
  return token
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  console.log(`> ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env })
  if (r.status !== 0) {
    console.error(`release: ${cmd} failed`)
    process.exit(r.status ?? 1)
  }
}

// Checked before the build, so a missing login fails in a second, not after the whole build.
const env = { ...process.env, GH_TOKEN: githubToken() }

run('bun', ['run', 'build'])
run(
  'bunx',
  [
    'electron-builder',
    '--win',
    '--publish',
    'always',
    `--config.extraMetadata.panesBuild=${build}`
  ],
  env
)
run('bun', ['scripts/release-layer.ts', '--publish'], env)
