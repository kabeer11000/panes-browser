import { describe, expect, test } from 'bun:test'
import { chatState, type LocalFacts } from './chatState'
import { DEFAULT_AI_SETTINGS, type AiSettings } from './types'

const on: AiSettings = { ...DEFAULT_AI_SETTINGS, enabled: true }
const installed: LocalFacts = {
  supported: true,
  installed: true,
  download: null,
  starting: false,
  error: null,
  installBytes: 1_400_000_000
}
const none = { online: [] as const, reauth: false }

describe('chatState', () => {
  test('AI on, local model installed, nothing signed in, automatic: chat uses the local model', () => {
    const r = chatState(on, { local: installed, ...none })
    expect(on.chatProvider).toBe('auto')
    expect(r).toEqual({ target: 'local', block: null, starting: false })
  })

  test('the same with chat set to local, and while the chat server starts', () => {
    expect(chatState({ ...on, chatProvider: 'local' }, { local: installed, ...none }).target).toBe(
      'local'
    )
    const r = chatState(on, { local: { ...installed, starting: true }, ...none })
    expect(r).toEqual({ target: 'local', block: null, starting: true })
  })

  test('a signed-in provider wins over the local model on automatic only', () => {
    expect(chatState(on, { local: installed, online: ['openai'], reauth: false }).target).toBe(
      'openai'
    )
    const s = { ...on, chatProvider: 'local' as const }
    expect(chatState(s, { local: installed, online: ['openai'], reauth: false }).target).toBe(
      'local'
    )
  })

  test('AI off says so', () => {
    expect(chatState(DEFAULT_AI_SETTINGS, { local: installed, ...none }).block).toEqual({
      kind: 'off'
    })
  })

  test('not downloaded offers the download with its size, and progress while it runs', () => {
    const l = { ...installed, installed: false }
    expect(chatState(on, { local: l, ...none }).block).toEqual({
      kind: 'download',
      bytes: 1_400_000_000
    })
    const d = { ...l, download: { received: 5, total: 10 } }
    expect(chatState(on, { local: d, ...none }).block).toEqual({
      kind: 'downloading',
      received: 5,
      total: 10
    })
  })

  test('local servers that stopped say why', () => {
    const r = chatState(on, { local: { ...installed, error: 'crashed' }, ...none })
    expect(r.block).toEqual({ kind: 'local-error', message: 'crashed' })
  })

  test('a lapsed ChatGPT sign-in asks to sign in again', () => {
    const s = { ...on, chatProvider: 'chatgpt' as const }
    expect(chatState(s, { local: installed, online: [], reauth: true }).block).toEqual({
      kind: 'reauth'
    })
  })

  test('a named provider that is not set up is no model, never a silent switch', () => {
    const s = { ...on, chatProvider: 'google' as const }
    expect(chatState(s, { local: installed, online: ['openai'], reauth: false }).block).toEqual({
      kind: 'no-model'
    })
  })

  test('unsupported systems and a custom server without an address', () => {
    expect(chatState(on, { local: { ...installed, supported: false }, ...none }).block).toEqual({
      kind: 'unsupported'
    })
    const own = { ...on, localProvider: 'openai-compatible' as const }
    expect(chatState(own, { local: installed, ...none }).block).toEqual({ kind: 'no-model' })
    expect(
      chatState({ ...own, compatibleUrl: 'http://127.0.0.1:1/v1' }, { local: installed, ...none })
        .target
    ).toBe('local')
  })
})
