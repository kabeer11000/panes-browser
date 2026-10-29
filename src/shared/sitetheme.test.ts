import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_THEME,
  gradientMapSvg,
  isPlain,
  isSafeSelector,
  sanitizeSiteTheme,
  siteKey,
  siteThemeCss,
  tintShades,
  washColor,
  withTheme
} from './sitetheme'

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
  test('keeps a valid boost and lowercases the tint', () => {
    const t = sanitizeSiteTheme({ dark: true, tint: '#FF8800', strength: 0.5, font: 'serif' })
    expect(t).toMatchObject({ dark: true, tint: '#ff8800', strength: 0.5, font: 'serif' })
  })

  test('fills what an older saved boost lacks', () => {
    const t = sanitizeSiteTheme({ dark: true, tint: null, strength: 0.45 })!
    expect(t.brightness).toBe(1)
    expect(t.zap).toEqual([])
    expect(t.css).toBe('')
  })

  test('clamps every number into its range', () => {
    const t = sanitizeSiteTheme({
      dark: true,
      strength: 9,
      brightness: 5,
      contrast: -3,
      saturation: 7
    })!
    expect([t.strength, t.brightness, t.contrast, t.saturation]).toEqual([1, 1.4, 0.6, 2])
  })

  test('drops a tint or font it does not know, so neither can smuggle CSS', () => {
    for (const tint of ['red', '#fff', 'url(x)', '#12345; x', 5, {}]) {
      expect(sanitizeSiteTheme({ dark: true, tint })?.tint).toBeNull()
    }
    expect(sanitizeSiteTheme({ dark: true, font: 'comic; x' })?.font).toBeNull()
  })

  test('keeps only safe, unique selectors to hide', () => {
    const t = sanitizeSiteTheme({
      zap: ['.ad', '.ad', ' #banner ', 'a{color:red}', 'x; y', '@import', 'div > p', 5]
    })!
    expect(t.zap).toEqual(['.ad', '#banner', 'div > p'])
  })

  test('returns null for a boost that changes nothing, and for junk', () => {
    expect(sanitizeSiteTheme({ ...DEFAULT_THEME })).toBeNull()
    expect(sanitizeSiteTheme({ tint: '#ff0000', strength: 0 })).toBeNull() // a tint at no strength is nothing
    for (const v of [null, undefined, 3, 'x']) expect(sanitizeSiteTheme(v)).toBeNull()
  })

  test('custom CSS is capped', () => {
    expect(sanitizeSiteTheme({ css: 'a{}'.repeat(10000) })!.css.length).toBe(20000)
  })
})

describe('isSafeSelector', () => {
  test('accepts selectors and refuses anything that could write other CSS', () => {
    for (const s of ['.ad', '#top > .bar:not(.x)', 'a[href^="http"]'])
      expect(isSafeSelector(s)).toBe(true)
    for (const s of ['', 'a{b}', 'a;b', '@media', 'a/*x*/', 'a[x=url(y)]', '<script>'])
      expect(isSafeSelector(s)).toBe(false)
  })
})

describe('siteThemeCss', () => {
  test('is empty when there is nothing to do', () => {
    expect(isPlain(DEFAULT_THEME)).toBe(true)
    expect(siteThemeCss(DEFAULT_THEME)).toBe('')
  })

  test('dark mode inverts the page and puts media back', () => {
    const css = siteThemeCss(withTheme(null, { dark: true }))
    expect(css).toContain('html { filter: invert(1) hue-rotate(180deg) !important;')
    expect(css).toContain('img, picture, video')
  })

  test('a light page is washed with the tint, never filtered, so pictures keep their colours', () => {
    const css = siteThemeCss(withTheme(null, { tint: '#3b82f6', strength: 0.7 }))
    expect(css).toContain('mix-blend-mode: multiply')
    expect(css).toContain(`background: ${washColor('#3b82f6', 0.7)}`)
    expect(css).not.toContain('filter')
    expect(css).not.toContain('sepia')
    expect(css).not.toContain('img, picture')
  })

  test('the wash darkens as strength rises and is plain white-ish at none', () => {
    const light = (c: string): number => parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16)
    expect(light(washColor('#3b82f6', 0))).toBeGreaterThan(light(washColor('#3b82f6', 1)))
  })

  test('a dark page is mapped through the tint gradient', () => {
    const css = siteThemeCss(withTheme(null, { dark: true, tint: '#3b82f6', strength: 0.7 }))
    expect(css).toContain('url("data:image/svg+xml,')
    expect(css).not.toContain('mix-blend-mode')
  })

  test('brightness, contrast and saturation only appear when changed', () => {
    expect(siteThemeCss(withTheme(null, { dark: true }))).not.toContain('brightness')
    const css = siteThemeCss(withTheme(null, { brightness: 1.2, contrast: 0.9, saturation: 1.5 }))
    expect(css).toContain('brightness(1.20) contrast(0.90) saturate(1.50)')
  })

  test('a font only covers text elements, hidden elements get a rule each, and your CSS comes last', () => {
    const css = siteThemeCss(
      withTheme(null, { font: 'serif', zap: ['.a', '.b'], css: 'body{margin:0}' })
    )
    expect(css).toContain('font-family: Georgia')
    expect(css).toContain('.a { display: none !important; }')
    expect(css).toContain('.b { display: none !important; }')
    expect(css.trim().endsWith('body{margin:0}')).toBe(true)
  })
})

describe('gradient map', () => {
  test('shades run from a dark to a light end in the tint hue', () => {
    const { dark, light } = tintShades('#3b82f6')
    expect(parseInt(dark.slice(1, 3), 16)).toBeLessThan(0x30)
    expect(parseInt(light.slice(1, 3), 16)).toBeGreaterThan(0xd0)
    expect(parseInt(light.slice(5, 7), 16)).toBeGreaterThan(parseInt(light.slice(1, 3), 16)) // still blue
  })

  test('strength blends the map with the original page', () => {
    expect(gradientMapSvg('#3b82f6', 0.25)).toContain('k2="0.250" k3="0.750"')
    expect(gradientMapSvg('#3b82f6', 9)).toContain('k2="1.000" k3="0.000"')
  })
})
