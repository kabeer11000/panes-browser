/**
 * The release notes users read in Settings > Software: one line per user-facing change since the last release tag, from
 * the commit subjects. A change counts when its type is feat, fix or perf AND it touches src/ beyond tests, so release
 * tooling and docs never reach users even when they are committed as fix. Plain text, no markdown: Panes shows the body
 * as it is.
 *
 *   bun scripts/release-notes.ts      prints the notes the next release would carry
 */
import { $ } from 'bun'

const USER_FACING = /^(?:feat|fix|perf)(?:\([^)]*\))?!?: (.+)$/

/** Commit subjects (newest first) to notes: the user-facing ones, without the `type(scope): ` prefix. */
export function releaseNotes(subjects: string[]): string {
  return subjects
    .flatMap((subject) => {
      const text = USER_FACING.exec(subject)?.[1].trim().replace(/\.$/, '')
      return text ? [text[0].toUpperCase() + text.slice(1)] : []
    })
    .join('\n')
}

/** The notes for everything on HEAD since the newest release tag. */
export async function notesSinceLastTag(): Promise<{ since: string; notes: string }> {
  await $`git fetch --tags --quiet` // GitHub makes the tag at publish, so this machine does not have the last one yet
  const since = (await $`git describe --tags --abbrev=0 --match ${'v*'}`.text()).trim()
  const log =
    await $`git log ${`${since}..HEAD`} ${'--format=%s'} -- src ${':(exclude)src/**/*.test.ts'}`.text()
  return { since, notes: releaseNotes(log.split('\n').filter(Boolean)) }
}

if (import.meta.main) {
  const { since, notes } = await notesSinceLastTag()
  console.log(notes ? `since ${since}:\n${notes}` : `no user-facing changes since ${since}`)
}
