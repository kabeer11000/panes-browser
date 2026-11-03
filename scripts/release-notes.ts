/**
 * The release notes users read in Settings > Software: one line per user-facing change since the last release tag.
 * Plain text, no markdown: Panes shows the body as it is.
 *
 * A commit says what users should read with a `Notes:` trailer in its message (several allowed, one line each):
 *
 *     fix(tabs): restore the strip height after a sidebar resize
 *
 *     Notes: The tab strip no longer jumps when you open the sidebar.
 *
 * Without one, a feat, fix or perf subject is used as it is. Either way the commit has to touch src/ beyond tests, so
 * release tooling and docs never reach users even when they are committed as fix.
 *
 *   bun scripts/release-notes.ts      prints the notes the next release would carry
 */
import { $ } from 'bun'

const SUBJECT = /^(\w+)(?:\([^)]*\))?!?: (.+)$/

export type Commit = { subject: string; notes: string[] }

/** Section titles in the order users read them; a Notes trailer on any other type goes under Improved. */
const SECTIONS: Record<string, string> = { feat: 'New', fix: 'Fixed', perf: 'Faster' }
const ORDER = ['New', 'Improved', 'Faster', 'Fixed']

/** "drag files out; retry, pause" to ["Drag files out.", "Retry, pause."] */
const sentences = (text: string): string[] =>
  text
    .split(/;\s+/)
    .map((s) => s.trim().replace(/[.;]$/, ''))
    .filter(Boolean)
    .map((s) => `${s[0].toUpperCase()}${s.slice(1)}.`)

/**
 * Commits to notes, as the plain text Panes shows (and a list GitHub renders): a title per kind of change, one
 * "- " line per change. A commit's Notes trailers are used, else the subject of a feat, fix or perf.
 */
export function releaseNotes(commits: Commit[]): string {
  const groups = new Map<string, string[]>()
  for (const { subject, notes } of commits) {
    const [, type = '', text = ''] = SUBJECT.exec(subject) ?? []
    const lines = notes.length ? notes.flatMap(sentences) : type in SECTIONS ? sentences(text) : []
    if (!lines.length) continue
    const title = SECTIONS[type] ?? 'Improved'
    groups.set(title, [...(groups.get(title) ?? []), ...lines])
  }
  return ORDER.filter((title) => groups.has(title))
    .map(
      (title) =>
        `${title}\n${groups
          .get(title)!
          .map((line) => `- ${line}`)
          .join('\n')}`
    )
    .join('\n\n')
}

// Field and record separators: a subject or a note can hold anything else.
const FIELD = '\x1f'
const RECORD = '\x1e'

/** The notes for everything on HEAD since the newest release tag. */
export async function notesSinceLastTag(): Promise<{ since: string; notes: string }> {
  await $`git fetch --tags --quiet` // GitHub makes the tag at publish, so this machine does not have the last one yet
  const since = (await $`git describe --tags --abbrev=0 --match ${'v*'}`.text()).trim()
  const format = `--format=%s%x1f%(trailers:key=Notes,valueonly,unfold)%x1e`
  const log =
    await $`git log ${`${since}..HEAD`} ${format} -- src ${':(exclude)src/**/*.test.ts'}`.text()
  const commits = log
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [subject, trailers = ''] = record.split(FIELD)
      return {
        subject,
        notes: trailers
          .split('\n')
          .map((n) => n.trim())
          .filter(Boolean)
      }
    })
  return { since, notes: releaseNotes(commits) }
}

if (import.meta.main) {
  const { since, notes } = await notesSinceLastTag()
  console.log(notes ? `since ${since}:\n${notes}` : `no user-facing changes since ${since}`)
}
