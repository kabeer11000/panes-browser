import { describe, expect, test } from 'bun:test'
import {
  describeError,
  errorPageUrl,
  kindOf,
  noteQuicFailure,
  parseErrorParams,
  parseSpaceTheme,
  QUIC_WINDOW_MS,
  quicLooksBlocked,
  retryTarget
} from './errors'

describe('kindOf', () => {
  test('groups Chromium error names into families', () => {
    expect(kindOf('ERR_INTERNET_DISCONNECTED')).toBe('offline')
    expect(kindOf('ERR_NAME_NOT_RESOLVED')).toBe('dns')
    expect(kindOf('ERR_CONNECTION_REFUSED')).toBe('refused')
    expect(kindOf('ERR_CONNECTION_TIMED_OUT')).toBe('timeout')
    expect(kindOf('ERR_CERT_AUTHORITY_INVALID')).toBe('cert')
    expect(kindOf('ERR_SSL_PROTOCOL_ERROR')).toBe('cert')
    expect(kindOf('ERR_BLOCKED_BY_CLIENT')).toBe('blocked')
    expect(kindOf('PAGE_CRASHED')).toBe('crashed')
    expect(parseErrorParams('?desc=PAGE_CRASHED').desc).toBe('PAGE_CRASHED')
    expect(kindOf('ERR_SOMETHING_NEW')).toBe('generic')
  })

  test('describeError carries the family and friendly copy', () => {
    const info = describeError('ERR_NAME_NOT_RESOLVED')
    expect(info.kind).toBe('dns')
    expect(info.title.length).toBeGreaterThan(0)
    expect(info.tips.length).toBeGreaterThan(0)
  })
})

describe('error page address', () => {
  test('round-trips through the query string', () => {
    const url = errorPageUrl('https://a.test/?q=1&x=2', -105, 'ERR_NAME_NOT_RESOLVED', true)
    expect(url.startsWith('panes://error/?')).toBe(true)
    expect(parseErrorParams(new URL(url).search)).toEqual({
      url: 'https://a.test/?q=1&x=2',
      code: -105,
      desc: 'ERR_NAME_NOT_RESOLVED',
      back: true,
      quicBlocked: false
    })
  })

  test('hand-written addresses fall back safely', () => {
    expect(parseErrorParams('?desc=<script>&code=abc')).toEqual({
      url: '',
      code: 0,
      desc: 'ERR_FAILED',
      back: false,
      quicBlocked: false
    })
    expect(parseErrorParams('')).toEqual({
      url: '',
      code: 0,
      desc: 'ERR_FAILED',
      back: false,
      quicBlocked: false
    })
  })

  test('retryTarget only offers web addresses', () => {
    expect(retryTarget('https://example.com/a')).toBe('https://example.com/a')
    expect(retryTarget('javascript:alert(1)')).toBeNull()
    expect(retryTarget('file:///c:/x')).toBeNull()
    expect(retryTarget('not a url')).toBeNull()
  })
})

describe('space theme on the error page', () => {
  test('round-trips and rejects junk', () => {
    const url = errorPageUrl('https://a.test/', -105, 'ERR_NAME_NOT_RESOLVED', false, {
      color: '#e5754c',
      tint: 0.4
    })
    expect(parseSpaceTheme(new URL(url).search)).toEqual({ color: '#e5754c', tint: 0.4 })
    expect(parseSpaceTheme('?sc=red&st=0.4')).toBeNull()
    expect(parseSpaceTheme('?sc=%23e5754c&st=9')).toEqual({ color: '#e5754c', tint: 1 })
    expect(parseSpaceTheme('')).toBeNull()
  })
})

describe('QUIC errors: one site failing is not the network blocking QUIC', () => {
  test('a lone QUIC error: the site is not answering, QUIC only as the last tip', () => {
    const info = describeError('ERR_QUIC_PROTOCOL_ERROR')
    expect(info.title).toBe("That site isn't answering")
    expect(info.tips.at(-1)).toContain('QUIC')
  })
  test('QUIC failing on several sites: put down to the network', () => {
    expect(describeError('ERR_QUIC_PROTOCOL_ERROR', true).title).toBe(
      "This network doesn't allow QUIC"
    )
    // the flag says nothing about other errors
    expect(describeError('ERR_CONNECTION_REFUSED', true).title).toBe("That site isn't answering")
  })
  test('two different sites within the window, not one site twice, not long apart', () => {
    let r = noteQuicFailure([], 'a.com', 0)
    expect(quicLooksBlocked(r, 0)).toBe(false)
    r = noteQuicFailure(r, 'a.com', 1000)
    expect(quicLooksBlocked(r, 1000)).toBe(false)
    r = noteQuicFailure(r, 'b.com', 2000)
    expect(quicLooksBlocked(r, 2000)).toBe(true)
    expect(quicLooksBlocked(r, 2000 + QUIC_WINDOW_MS)).toBe(false)
    const late = noteQuicFailure([{ host: 'a.com', at: 0 }], 'b.com', QUIC_WINDOW_MS + 1)
    expect(quicLooksBlocked(late, QUIC_WINDOW_MS + 1)).toBe(false)
  })
  test('the flag goes through the error page address and back', () => {
    const u = errorPageUrl(
      'https://x.com/',
      -356,
      'ERR_QUIC_PROTOCOL_ERROR',
      false,
      undefined,
      true
    )
    expect(parseErrorParams(new URL(u).search).quicBlocked).toBe(true)
    const v = errorPageUrl('https://x.com/', -356, 'ERR_QUIC_PROTOCOL_ERROR')
    expect(parseErrorParams(new URL(v).search).quicBlocked).toBe(false)
  })
})
