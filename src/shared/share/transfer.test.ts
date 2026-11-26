import { describe, expect, test } from 'bun:test'
import { MAX_SEND, parseFileSignal, safeFileName } from './transfer'
import { runsCode } from '../downloads'

const id = '0f8e2c1a-1b2c-4d5e-8f90-123456789abc'

describe('parseFileSignal', () => {
  test('takes an offer, its name made safe', () => {
    expect(parseFileSignal({ k: 'f', id, o: 'ask', name: '../../x/report.pdf', size: 12 })).toEqual(
      { k: 'f', id, o: 'ask', name: 'report.pdf', size: 12 }
    )
  })
  test('answers and cancels', () => {
    for (const o of ['yes', 'no', 'cancel'] as const)
      expect(parseFileSignal({ k: 'f', id, o })).toEqual({ k: 'f', id, o })
  })
  test('sdp and ice keep only their fields', () => {
    expect(
      parseFileSignal({ k: 'f', id, o: 'sdp', sdp: { type: 'offer', sdp: 'v=0', x: 1 } })
    ).toEqual({ k: 'f', id, o: 'sdp', sdp: { type: 'offer', sdp: 'v=0' } })
    expect(parseFileSignal({ k: 'f', id, o: 'ice', c: { candidate: 'c', sdpMid: 5 } })).toEqual({
      k: 'f',
      id,
      o: 'ice',
      c: { candidate: 'c', sdpMid: null, sdpMLineIndex: null }
    })
  })
  test('refuses live-tab signals, bad ids, sizes and junk', () => {
    for (const bad of [
      null,
      'x',
      { k: 'hello' },
      { k: 'sdp', sdp: { type: 'offer', sdp: '' } },
      { k: 'f', id: 'NOT AN ID!', o: 'yes' },
      { k: 'f', id, o: 'ask', name: 'a', size: -1 },
      { k: 'f', id, o: 'ask', name: 'a', size: 1.5 },
      { k: 'f', id, o: 'ask', name: 'a', size: MAX_SEND + 1 },
      { k: 'f', id, o: 'ask', name: 5, size: 1 },
      { k: 'f', id, o: 'sdp', sdp: { type: 'rollback', sdp: '' } },
      { k: 'f', id, o: 'ice', c: {} },
      { k: 'f', id, o: 'what' }
    ])
      expect(parseFileSignal(bad)).toBeNull()
  })
})

describe('safeFileName', () => {
  test('keeps an ordinary name', () => expect(safeFileName('Notes 2.txt')).toBe('Notes 2.txt'))
  test('drops folders, both slashes', () => {
    expect(safeFileName('C:\\Windows\\evil.dll')).toBe('evil.dll')
    expect(safeFileName('/etc/passwd')).toBe('passwd')
    expect(safeFileName('..')).toBe('file')
  })
  test('drops characters that hide what a file is', () => {
    // right-to-left override: "invoice\u202Efdp.exe" shows as invoice exe.pdf
    expect(safeFileName('invoice\u202Efdp.exe')).toBe('invoicefdp.exe')
    expect(safeFileName('a\u0000b<>:"|?*.txt')).toBe('ab.txt')
  })
  test('no trailing dots or spaces, no device names, nothing empty', () => {
    expect(safeFileName('run.exe. . ')).toBe('run.exe')
    expect(safeFileName('CON.txt')).toBe('_CON.txt')
    expect(safeFileName('   ')).toBe('file')
  })
  test('long names keep their extension', () => {
    const n = safeFileName('a'.repeat(300) + '.pdf')
    expect(n).toHaveLength(120)
    expect(n.endsWith('.pdf')).toBe(true)
  })
})

describe('runsCode', () => {
  test('programs and pages, not documents', () => {
    expect(runsCode('setup.EXE')).toBe(true)
    expect(runsCode('page.html')).toBe(true)
    expect(runsCode('report.pdf')).toBe(false)
    expect(runsCode('noext')).toBe(false)
  })
})
