import { describe, expect, test } from 'bun:test'
import { cachedIcon, iconAddress, iconMime } from './favicon'

const bytes = (...v: number[]): Uint8Array => new Uint8Array(v)
const text = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('favicon cache addresses', () => {
  test('web icons go through the cache and come back the same', () => {
    const url = 'https://www.example.com/favicon.ico?v=2&x=a%20b'
    const via = cachedIcon(url)
    expect(via.startsWith('panes-icon://i/')).toBe(true)
    expect(iconAddress(via)).toBe(url)
    // Chromium may add a trailing slash to a standard scheme's address
    expect(iconAddress(via + '/')).toBe(url)
  })

  test('anything that is not a web address is left alone, and never asked of the cache', () => {
    for (const src of ['data:image/png;base64,AAAA', 'file:///C:/x.png', 'panes://x', 'blob:abc'])
      expect(cachedIcon(src)).toBe(src)
    for (const bad of [
      'panes-icon://i/' + encodeURIComponent('file:///C:/secret.png'),
      'panes-icon://i/' + encodeURIComponent('javascript:alert(1)'),
      'panes-icon://i/%E0%A4%A',
      'panes-icon://x/' + encodeURIComponent('https://a.example/i.png'),
      'https://a.example/i.png'
    ])
      expect(iconAddress(bad)).toBeNull()
  })
})

describe('iconMime', () => {
  test('pictures icons come as', () => {
    expect(iconMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d))).toBe('image/png')
    expect(iconMime(bytes(0, 0, 1, 0, 1))).toBe('image/x-icon')
    expect(iconMime(text('GIF89a'))).toBe('image/gif')
    expect(iconMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(iconMime(text('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(iconMime(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml')
    expect(iconMime(text('\uFEFF  <?xml version="1.0"?>\n<!-- x --><svg>'))).toBe('image/svg+xml')
  })

  test('not a picture: an error page, a script, nothing', () => {
    expect(iconMime(text('<!doctype html><html>404</html>'))).toBeNull()
    expect(iconMime(text('alert(1)'))).toBeNull()
    expect(iconMime(new Uint8Array())).toBeNull()
  })
})
