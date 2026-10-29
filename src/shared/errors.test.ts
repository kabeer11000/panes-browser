import { describe, expect, test } from 'bun:test'
import {
  describeError,
  errorPageUrl,
  kindOf,
  parseErrorParams,
  parseSpaceTheme,
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
      back: true
    })
  })

  test('hand-written addresses fall back safely', () => {
    expect(parseErrorParams('?desc=<script>&code=abc')).toEqual({
      url: '',
      code: 0,
      desc: 'ERR_FAILED',
      back: false
    })
    expect(parseErrorParams('')).toEqual({ url: '', code: 0, desc: 'ERR_FAILED', back: false })
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
