/**
 * Releases Panes for Windows: the installer (for new installs and new Electron versions) and the app layer that every
 * existing Panes on the same Electron updates from (scripts/release-layer.ts).
 *
 *   bun run release:win
 *
 * Create the GitHub release first (`gh release create v<version> --latest`, see tasks/lessons.md). The build is stamped
 * with a build number, the release time in seconds: it only goes up, and it is what Panes compares to decide that a
 * layer is newer (never the version string, where "beta.10" sorts before "beta.9").
 */
import { spawnSync } from 'child_process'

const build = Math.floor(Date.now() / 1000)

function run(cmd: string, args: string[]): void {
  console.log(`> ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) {
    console.error(`release: ${cmd} failed`)
    process.exit(r.status ?? 1)
  }
}

run('bun', ['run', 'build'])
run('bunx', [
  'electron-builder',
  '--win',
  '--publish',
  'always',
  `--config.extraMetadata.panesBuild=${build}`
])
run('bun', ['scripts/release-layer.ts', '--publish'])
