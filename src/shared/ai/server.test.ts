import { describe, expect, test } from 'bun:test'
import { aiThreads, chatContextTokens, chatIdleMs, serverArgs } from './server'

const base = { modelPath: '/m/x.gguf', port: 5123, apiKey: 'k'.repeat(64) }
const after = (a: string[], flag: string): string => a[a.indexOf(flag) + 1]

describe('serverArgs', () => {
  test('binds the loopback address with a key and the chosen port', () => {
    for (const role of ['embed', 'chat'] as const) {
      const a = serverArgs({ ...base, role, gpu: false })
      expect(after(a, '--host')).toBe('127.0.0.1')
      expect(after(a, '--api-key')).toBe(base.apiKey)
      expect(after(a, '--port')).toBe('5123')
      expect(after(a, '-m')).toBe(base.modelPath)
      expect(a).not.toContain('0.0.0.0')
    }
  })

  test('GPU flags only for GPU builds', () => {
    expect(serverArgs({ ...base, role: 'chat', gpu: true })).toContain('-ngl')
    expect(serverArgs({ ...base, role: 'chat', gpu: false })).not.toContain('-ngl')
    expect(after(serverArgs({ ...base, role: 'chat', gpu: true }), '-ngl')).toBe('99')
  })

  test('the embed server embeds, the chat server does not and has an 8192 context with a 16-bit KV cache', () => {
    const e = serverArgs({ ...base, role: 'embed', gpu: false })
    const c = serverArgs({ ...base, role: 'chat', gpu: false })
    expect(e).toContain('--embeddings')
    expect(c).not.toContain('--embeddings')
    expect(after(c, '-c')).toBe('8192')
    expect(c).not.toContain('-ctk')
    expect(c).not.toContain('-ctv')
    expect(after(c, '-fa')).toBe('on')
    expect(e).not.toContain('-ctk')
  })

  test('threads leave CPUs free for the person; the prompt cache in RAM is bounded', () => {
    const c = serverArgs({ ...base, role: 'chat', gpu: false, cpus: 8 })
    expect(after(c, '-t')).toBe('3')
    expect(after(c, '-tb')).toBe('6')
    expect(aiThreads(4)).toEqual({ generate: 1, read: 2 })
    expect(aiThreads(2)).toEqual({ generate: 1, read: 1 })
    expect(aiThreads(16)).toEqual({ generate: 7, read: 14 })
    expect(Number(after(c, '--cache-ram'))).toBeLessThanOrEqual(1024)
    expect(after(serverArgs({ ...base, role: 'embed', gpu: false }), '--cache-ram')).toBe('0')
    expect(serverArgs({ ...base, role: 'chat', gpu: false })).not.toContain('-tb')
  })

  test('the chat server runs the jinja template so that tool calls work', () => {
    expect(serverArgs({ ...base, role: 'chat', gpu: false })).toContain('--jinja')
    expect(serverArgs({ ...base, role: 'embed', gpu: false })).not.toContain('--jinja')
  })
})

describe('small machines', () => {
  const GB = 1024 ** 3
  test('8 GB or less: half the chat context and a shorter stay', () => {
    expect(chatContextTokens(8 * GB)).toBe(4096)
    expect(chatContextTokens(16 * GB)).toBe(8192)
    expect(chatIdleMs(8 * GB)).toBeLessThan(chatIdleMs(16 * GB))
  })
  test('the chat server gets the context it is given', () => {
    const c = serverArgs({
      role: 'chat',
      modelPath: 'm',
      port: 1,
      apiKey: 'k',
      gpu: false,
      contextTokens: 4096
    })
    expect(c[c.indexOf('-c') + 1]).toBe('4096')
  })
})
