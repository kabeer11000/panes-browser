import { expect, test } from 'bun:test'
import { releaseNotes, type Commit } from './release-notes'

const c = (subject: string, ...notes: string[]): Commit => ({ subject, notes })

test('a Notes trailer wins over the subject; any type is allowed', () => {
  expect(
    releaseNotes([
      c('fix(tabs): restore strip height', 'the tab strip no longer jumps', 'Opens faster.'),
      c('refactor: split the dock', 'Dock opens quicker.')
    ])
  ).toBe(
    'Improved\n- Dock opens quicker.\n\nFixed\n- The tab strip no longer jumps.\n- Opens faster.'
  )
})

test('subjects: grouped, capitalised, full stop, split at semicolons; the rest dropped', () => {
  expect(
    releaseNotes([
      c('fix(tabs): tab strip no longer flickers.'),
      c('docs: how to drive Panes'),
      c('refactor: loader imports through @shared'),
      c('feat!: drag downloads out; retry and pause'),
      c('chore(release): 0.1.0'),
      c('perf: faster startup'),
      c('fixed a thing')
    ])
  ).toBe(
    'New\n- Drag downloads out.\n- Retry and pause.\n\nFaster\n- Faster startup.\n\nFixed\n- Tab strip no longer flickers.'
  )
})

test('nothing user-facing gives an empty string', () => {
  expect(releaseNotes([c('docs: x'), c('test: y')])).toBe('')
})
