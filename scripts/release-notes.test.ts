import { expect, test } from 'bun:test'
import { releaseNotes, type Commit } from './release-notes'

const c = (subject: string, ...notes: string[]): Commit => ({ subject, notes })

test('a Notes trailer wins over the subject and works for any type', () => {
  expect(
    releaseNotes([
      c(
        'fix(tabs): restore strip height after resize',
        'The tab strip no longer jumps.',
        'Faster.'
      ),
      c('refactor: split the dock', 'Dock opens quicker.')
    ])
  ).toBe('The tab strip no longer jumps\nFaster\nDock opens quicker')
})

test('without a trailer keeps feat, fix and perf subjects and drops the rest', () => {
  expect(
    releaseNotes([
      c('fix(tabs): tab strip no longer flickers.'),
      c('docs: how to drive Panes'),
      c('refactor: loader imports through @shared'),
      c('feat!: new window picker'),
      c('chore(release): 0.1.0'),
      c('perf: faster startup'),
      c('fixed a thing')
    ])
  ).toBe('Tab strip no longer flickers\nNew window picker\nFaster startup')
})

test('nothing user-facing gives an empty string', () => {
  expect(releaseNotes([c('docs: x'), c('test: y')])).toBe('')
})
