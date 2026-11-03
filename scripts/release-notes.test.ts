import { expect, test } from 'bun:test'
import { releaseNotes } from './release-notes'

test('keeps feat, fix and perf, drops the rest, cleans the text', () => {
  expect(
    releaseNotes([
      'fix(tabs): tab strip no longer flickers.',
      'docs: how to drive Panes',
      'refactor: loader imports through @shared',
      'feat!: new window picker',
      'chore(release): 0.1.0',
      'perf: faster startup',
      'fixed a thing'
    ])
  ).toBe('Tab strip no longer flickers\nNew window picker\nFaster startup')
})

test('nothing user-facing gives an empty string', () => {
  expect(releaseNotes(['docs: x', 'test: y'])).toBe('')
})
