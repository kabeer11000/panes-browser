import { describe, expect, test } from 'bun:test'
import { isPlain, sanitizeSiteTheme, siteKey, siteThemeCss } from './sitetheme'

describe('siteKey', () => {
  test('lowercases the host and drops www', () => {
    expect(siteKey('https://WWW.Example.com/a?b=1')).toBe('example.com')
    expect(siteKey('http://sub.example.com:8080/')).toBe('sub.example.com')
  })

  test('is null for anything that is not a web page', () => {
    for (const u of ['panes://settings', 'about:blank', 'file:///c:/x.html', 'not a url', '']) {
      expect(siteKey(u)).toBeNull()
    }
  })
})

describe('sanitizeSiteTheme', () => {
  test('keeps a valid theme and lowercases the tint', () => {
    expect(sanitizeSiteTheme({ dark: true, tint: '#FF8800', strength: 0.5 })).toEqual({
      dark: true,
      tint: '#ff8800',
      strength: 0.5
    })
  })

  test('clamps strength and defaults it when missing or not a number', () => {
    expect(sanitizeSiteTheme({ dark: true, tint: null, strength: 9 })?.strength).toBe(1)
    expect(sanitizeSiteTheme({ dark: true, tint: null, strength: -2 })?.strength).toBe(0)
    expect(sanitizeSiteTheme({ dark: true, tint: null, strength: 'x' })?.strength).toBe(0.45)
    expect(sanitizeSiteTheme({ dark: true })?.strength).toBe(0.45)
  })

  test('drops a tint that is not a six digit hex colour, so it can never smuggle CSS', () => {
    for (const tint of ['red', '#fff', 'url(x)', '#12345; x', 5, {}]) {
      expect(sanitizeSiteTheme({ dark: true, tint, strength: 0.5 })?.tint).toBeNull()
    }
  })

  test('returns null for a theme that changes nothing, and for junk', () => {
    expect(sanitizeSiteTheme({ dark: false, tint: null, strength: 0.5 })).toBeNull()
    expect(sanitizeSiteTheme({ dark: 'yes', tint: 'nope' })).toBeNull()
    for (const v of [null, undefined, 3, 'x']) expect(sanitizeSiteTheme(v)).toBeNull()
  })
})

describe('siteThemeCss', () => {
  test('is empty when there is nothing to do', () => {
    expect(isPlain({ dark: false, tint: null, strength: 0.5 })).toBe(true)
    expect(siteThemeCss({ dark: false, tint: null, strength: 0.5 })).toBe('')
  })

  test('dark mode inverts the page and puts media back', () => {
    const css = siteThemeCss({ dark: true, tint: null, strength: 0.5 })
    expect(css).toContain('html { filter: invert(1) hue-rotate(180deg) !important;')
    expect(css).toContain('img, picture, video')
  })

  test('a tint is a sepia and hue rotation toward its hue, without touching media', () => {
    const css = siteThemeCss({ dark: false, tint: '#0000ff', strength: 1 })
    expect(css).toContain('sepia(0.80)')
    expect(css).toContain('saturate(2.50)')
    expect(css).toContain('hue-rotate(190deg)') // blue is 240 degrees, sepia sits near 50
    expect(css).not.toContain('invert')
  })

  test('dark mode and a tint share one filter chain, dark first', () => {
    const css = siteThemeCss({ dark: true, tint: '#ff0000', strength: 0 })
    expect(css.indexOf('invert(1)')).toBeLessThan(css.indexOf('sepia('))
  })

  test('a tint with strength 0 still produces a mild wash, and out of range strength is clamped', () => {
    expect(siteThemeCss({ dark: false, tint: '#ff0000', strength: 0 })).toContain('sepia(0.15)')
    expect(siteThemeCss({ dark: false, tint: '#ff0000', strength: 5 })).toContain('sepia(0.80)')
  })
})
