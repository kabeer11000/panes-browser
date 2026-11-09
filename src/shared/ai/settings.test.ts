import { describe, expect, test } from 'bun:test'
import { sanitizeAi } from './settings'
import { DEFAULT_AI_SETTINGS } from './types'

const base = DEFAULT_AI_SETTINGS

describe('sanitizeAi', () => {
  test('applies known fields of the right type', () => {
    const out = sanitizeAi(
      { enabled: true, titles: true, localProvider: 'openai-compatible' },
      base
    )
    expect(out.enabled).toBe(true)
    expect(out.titles).toBe(true)
    expect(out.localProvider).toBe('openai-compatible')
    expect(out.filenames).toBe(false)
  })

  test('ignores wrong types, unknown values and unknown fields', () => {
    const out = sanitizeAi(
      { enabled: 'yes', localProvider: 'x', cloudProvider: 'nope', extra: 1 },
      base
    )
    expect(out).toEqual(base)
  })

  test('urls must be http(s)', () => {
    expect(sanitizeAi({ compatibleUrl: 'http://127.0.0.1:11434/v1' }, base).compatibleUrl).toBe(
      'http://127.0.0.1:11434/v1'
    )
    expect(sanitizeAi({ compatibleUrl: 'file:///etc/passwd' }, base).compatibleUrl).toBe('')
    expect(sanitizeAi({ compatibleUrl: 'javascript:alert(1)' }, base).compatibleUrl).toBe('')
    expect(
      sanitizeAi({ compatibleUrl: '' }, { ...base, compatibleUrl: 'http://a' }).compatibleUrl
    ).toBe('')
  })

  test('cloud provider and per-provider model ids', () => {
    const out = sanitizeAi(
      { cloudProvider: 'openai', cloudModels: { openai: ' gpt-x ', google: 5 } },
      base
    )
    expect(out.cloudProvider).toBe('openai')
    expect(sanitizeAi({ cloudProvider: 'openrouter' }, base).cloudProvider).toBe('openrouter')
    expect(sanitizeAi({ cloudProvider: 'anthropic' }, base).cloudProvider).toBeNull()
    expect(sanitizeAi({ cloudProvider: 'chatgpt' }, base).cloudProvider).toBeNull()
    expect(out.cloudModels.openai).toBe('gpt-x')
    expect(out.cloudModels.google).toBe(base.cloudModels.google)
    expect(sanitizeAi({ cloudProvider: null }, out).cloudProvider).toBeNull()
  })

  test('an emptied model field goes back to the default', () => {
    expect(sanitizeAi({ cloudModels: { openrouter: '' } }, base).cloudModels.openrouter).toBe(
      base.cloudModels.openrouter
    )
  })

  test('garbage input leaves the current settings', () => {
    expect(sanitizeAi(null, base)).toEqual(base)
    expect(sanitizeAi('x', base)).toEqual(base)
  })

  test('does not change the object it was given', () => {
    const cur = { ...base, cloudModels: { ...base.cloudModels } }
    sanitizeAi({ cloudModels: { openai: 'z' } }, cur)
    expect(cur.cloudModels.openai).toBe(base.cloudModels.openai)
  })
})

describe('sanitizeAi chat fields', () => {
  test('chat provider must be a known choice', () => {
    expect(sanitizeAi({ chatProvider: 'chatgpt' }, base).chatProvider).toBe('chatgpt')
    expect(sanitizeAi({ chatProvider: 'anthropic' }, base).chatProvider).toBe('auto')
    expect(sanitizeAi({ chatgptModel: ' gpt-x ' }, base).chatgptModel).toBe('gpt-x')
  })
})
