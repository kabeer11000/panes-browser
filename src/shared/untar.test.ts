import { describe, expect, test } from 'bun:test'
import { readTar } from './untar'

/** A tar archive built by hand: one 512-byte header per entry, data padded to 512, two empty blocks at the end. */
function tar(
  entries: Array<{ name: string; data?: string; kind?: string; mode?: number }>
): Uint8Array {
  const blocks: Uint8Array[] = []
  for (const e of entries) {
    const head = new Uint8Array(512)
    const enc = new TextEncoder()
    head.set(enc.encode(e.name).subarray(0, 100), 0)
    head.set(enc.encode((e.mode ?? 0o644).toString(8).padStart(7, '0')), 100)
    const body = enc.encode(e.data ?? '')
    head.set(enc.encode(body.length.toString(8).padStart(11, '0')), 124)
    head[156] = (e.kind ?? '0').charCodeAt(0)
    blocks.push(head)
    const padded = new Uint8Array(Math.ceil(body.length / 512) * 512)
    padded.set(body)
    blocks.push(padded)
  }
  blocks.push(new Uint8Array(1024))
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0))
  let at = 0
  for (const b of blocks) {
    out.set(b, at)
    at += b.length
  }
  return out
}

describe('readTar', () => {
  test('lists folders and files with their bytes and modes', () => {
    const entries = readTar(
      tar([
        { name: 'tor/', kind: '5' },
        { name: 'tor/tor.exe', data: 'MZ binary', mode: 0o755 },
        { name: './data/geoip', data: 'x'.repeat(700) }
      ])
    )
    expect(entries.map((e) => [e.path, e.type])).toEqual([
      ['tor', 'dir'],
      ['tor/tor.exe', 'file'],
      ['data/geoip', 'file']
    ])
    expect(new TextDecoder().decode(entries[1].data)).toBe('MZ binary')
    expect(entries[1].mode).toBe(0o755)
    expect(entries[2].data.length).toBe(700)
  })
  test('takes a GNU long name for the entry after it', () => {
    const long = 'tor/pluggable_transports/' + 'a'.repeat(120) + '.txt'
    const entries = readTar(
      tar([
        { name: '././@LongLink', kind: 'L', data: long },
        { name: 'short', data: 'hi' }
      ])
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe(long)
  })
  test('refuses an archive with a path that leaves its folder', () => {
    expect(() => readTar(tar([{ name: '../evil.dll', data: 'x' }]))).toThrow()
    expect(() => readTar(tar([{ name: '/etc/passwd', data: 'x' }]))).toThrow()
    expect(() => readTar(tar([{ name: 'C:/Windows/x', data: 'x' }]))).toThrow()
  })
})
