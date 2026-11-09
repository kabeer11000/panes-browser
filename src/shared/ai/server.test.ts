import { describe, expect, test } from 'bun:test'
import { serverArgs } from './server'

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

  test('the embed server embeds, the chat server does not and has an 8192 context with an 8-bit KV cache', () => {
    const e = serverArgs({ ...base, role: 'embed', gpu: false })
    const c = serverArgs({ ...base, role: 'chat', gpu: false })
    expect(e).toContain('--embeddings')
    expect(c).not.toContain('--embeddings')
    expect(after(c, '-c')).toBe('8192')
    expect(after(c, '-ctk')).toBe('q8_0')
    expect(after(c, '-ctv')).toBe('q8_0')
    expect(after(c, '-fa')).toBe('on')
    expect(e).not.toContain('-ctk')
  })

  test('the chat server runs the jinja template so that tool calls work', () => {
    expect(serverArgs({ ...base, role: 'chat', gpu: false })).toContain('--jinja')
    expect(serverArgs({ ...base, role: 'embed', gpu: false })).not.toContain('--jinja')
  })
})
