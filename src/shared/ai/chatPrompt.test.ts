import { describe, expect, test } from 'bun:test'
import { assemblePrompt, promptMessages, type PromptInput } from './chatPrompt'

const long = Array.from({ length: 80 }, (_, i) =>
  i === 60 ? 'The bridge reopened in 1987 after repairs.' : `Paragraph ${i} about the old town.`
).join('\n')

const input = (typed: string, over: Partial<PromptInput> = {}): PromptInput => ({
  system: 'SYSTEM',
  docs: '',
  pages: [{ tabId: 3, title: 'Town', url: 'https://town.example/', text: long }],
  pageCap: 1200,
  tabs: '<tabs>\n3: Town (https://town.example/) - current tab\n</tabs>',
  typed,
  ...over
})

describe('assemblePrompt', () => {
  test('everything before the question is the same for any question, and for a prime', () => {
    const a = assemblePrompt(input('when did the bridge reopen?'))
    const b = assemblePrompt(input('what is paragraph 3 about?'))
    const prime = assemblePrompt(input(''))
    expect(a.system).toBe('SYSTEM')
    expect(a.attached).toBe(b.attached)
    expect(a.attached).toBe(prime.attached)
    expect(a.last.startsWith(prime.last)).toBe(true)
  })

  test('a long page: its opening is attached, the passage matching the question comes with the question', () => {
    const a = assemblePrompt(input('when did the bridge reopen?'))
    expect(a.attached).toContain('Paragraph 0')
    expect(a.attached).not.toContain('1987')
    expect(a.last).toContain('1987')
    expect(a.last.endsWith('when did the bridge reopen?')).toBe(true)
  })

  test('pages stay out of the system message, so the tools after it stay cached', () => {
    const a = assemblePrompt(input('q'))
    expect(a.system).not.toContain('Paragraph')
  })

  test('nothing attached: no attached message', () => {
    const a = assemblePrompt(input('hi', { pages: [] }))
    expect(a.attached).toBe('')
    expect(promptMessages(a, [])).toEqual([{ role: 'user', content: a.last }])
  })

  test('order: attached pages, earlier turns, the question', () => {
    const a = assemblePrompt(input('q'))
    const prior = [
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'reply' }
    ]
    const m = promptMessages(a, prior)
    expect(m.map((x) => x.content)).toEqual([a.attached, 'earlier', 'reply', a.last])
  })
})
