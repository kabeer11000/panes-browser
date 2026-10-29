import { hexToHsl } from './color'
import type { SiteTheme } from './types'

export const MAX_SITES_PER_SPACE = 300
export const DEFAULT_STRENGTH = 0.6
export const MAX_CSS_CHARS = 20_000
export const MAX_ZAPS = 50

/** Typefaces a boost can put on a page: a name for the picker, and the stack it applies. */
export const BOOST_FONTS: Record<string, { label: string; stack: string }> = {
  sans: {
    label: 'Clean sans',
    stack: "'Segoe UI Variable Text', 'Segoe UI', system-ui, Roboto, sans-serif"
  },
  serif: { label: 'Book serif', stack: "Georgia, 'Iowan Old Style', 'Times New Roman', serif" },
  mono: { label: 'Monospace', stack: "'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace" },
  rounded: {
    label: 'Rounded',
    stack: "'Segoe UI Variable Display', 'Nunito', 'Trebuchet MS', sans-serif"
  },
  readable: { label: 'Easy reading', stack: "Verdana, 'Atkinson Hyperlegible', Tahoma, sans-serif" }
}

export const DEFAULT_THEME: SiteTheme = {
  dark: false,
  tint: null,
  strength: DEFAULT_STRENGTH,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  font: null,
  zap: [],
  css: ''
}

const HEX = /^#[0-9a-f]{6}$/i

/** What a site is called in a space's list of site themes: lowercase host without a leading www. Null for non-web pages. */
export function siteKey(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Nothing to inject: the boost changes no colour, font, element or style. */
export const isPlain = (t: SiteTheme): boolean =>
  !t.dark &&
  !(t.tint && t.strength > 0) &&
  t.brightness === 1 &&
  t.contrast === 1 &&
  t.saturation === 1 &&
  !t.font &&
  t.zap.length === 0 &&
  t.css.trim() === ''

const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

/**
 * A selector that can only select: no braces, semicolons, at-rules, comments or URLs, so a hidden element
 * can never become a way to write other CSS.
 */
export const isSafeSelector = (s: string): boolean =>
  s.length > 0 && s.length <= 200 && !/[{};@<]|\/\*|url\s*\(|\\0/i.test(s)

/** Untrusted input (it can come from the site panel): a well-formed boost, or null when it changes nothing. */
export function sanitizeSiteTheme(raw: unknown): SiteTheme | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const zap = Array.isArray(r.zap)
    ? [
        ...new Set(
          r.zap
            .filter((s): s is string => typeof s === 'string' && isSafeSelector(s.trim()))
            .map((s) => s.trim())
        )
      ].slice(0, MAX_ZAPS)
    : []
  const theme: SiteTheme = {
    dark: r.dark === true,
    tint: typeof r.tint === 'string' && HEX.test(r.tint) ? r.tint.toLowerCase() : null,
    strength: num(r.strength, 0, 1, DEFAULT_STRENGTH),
    brightness: num(r.brightness, 0.6, 1.4, 1),
    contrast: num(r.contrast, 0.6, 1.4, 1),
    saturation: num(r.saturation, 0, 2, 1),
    font: typeof r.font === 'string' && r.font in BOOST_FONTS ? r.font : null,
    zap,
    css: typeof r.css === 'string' ? r.css.slice(0, MAX_CSS_CHARS) : ''
  }
  return isPlain(theme) ? null : theme
}

/** The light and dark ends of a tint's gradient: pages are mapped from near-black to near-white along it. */
export function tintShades(tint: string): { dark: string; light: string } {
  const { h, s } = hexToHsl(tint)
  // Keep the hue and most of the saturation, and pin the lightness so text stays readable at every strength.
  const chroma = Math.min(1, s * 1.05)
  return {
    dark: hslShade(h, chroma, 0.1),
    light: hslShade(h, Math.min(1, chroma * 0.9), 0.93)
  }
}

/**
 * The colour a light page is washed with: the tint, darker as `strength` rises. It is multiplied over the
 * page, so white becomes this colour and dark text stays dark, while pictures and links keep their own hues.
 */
export function washColor(tint: string, strength: number): string {
  const { h, s } = hexToHsl(tint)
  const k = Math.min(1, Math.max(0, strength))
  return hslShade(h, Math.min(1, s * 0.8), 0.97 - 0.36 * k)
}

function hslShade(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  const hex = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

const channel = (hex: string, shift: number): string =>
  (((parseInt(hex.slice(1), 16) >> shift) & 255) / 255).toFixed(4)

/**
 * A "gradient map": the page goes to greyscale, then every shade of grey is looked up along a line from the
 * dark shade of the tint to its light shade (so white backgrounds become the light tint and black text
 * the dark one), then blended with the original by `strength`. That is a real theme, where hue-rotating
 * a sepia filter only shifts colours around.
 */
export function gradientMapSvg(tint: string, strength: number): string {
  const { dark, light } = tintShades(tint)
  const s = Math.min(1, Math.max(0, strength))
  const table = (shift: number): string => `${channel(dark, shift)} ${channel(light, shift)}`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"><filter id="m" color-interpolation-filters="sRGB">` +
    `<feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0"/>` +
    `<feComponentTransfer result="map"><feFuncR type="table" tableValues="${table(16)}"/><feFuncG type="table" tableValues="${table(8)}"/><feFuncB type="table" tableValues="${table(0)}"/></feComponentTransfer>` +
    `<feComposite in="map" in2="SourceGraphic" operator="arithmetic" k1="0" k2="${s.toFixed(3)}" k3="${(1 - s).toFixed(3)}" k4="0"/>` +
    `</filter></svg>`
  )
}

const TEXT_TAGS =
  'p, h1, h2, h3, h4, h5, h6, a, li, td, th, label, blockquote, figcaption, button, input, textarea, select, small, strong, em, b, dt, dd'
const FLIP = 'invert(1) hue-rotate(180deg)'

/**
 * CSS for a boost. Colour changes are one filter chain on the root (dark mode, then the theme's gradient
 * map, then brightness, contrast and saturation), so nothing depends on the page's own markup. Dark mode
 * inverts the page and turns the hues back, then puts pictures and video the right way round again. A font
 * covers text elements only, so icon fonts survive. Hidden elements get one rule each, so a selector that
 * does not parse costs only itself. Your own CSS goes last.
 */
export function siteThemeCss(t: SiteTheme): string {
  if (isPlain(t)) return ''
  const chain: string[] = []
  if (t.dark) chain.push(FLIP)
  // A dark page is re-mapped through the tint's gradient; a light one is washed with it (see washColor).
  if (t.tint && t.strength > 0 && t.dark) {
    chain.push(
      `url("data:image/svg+xml,${encodeURIComponent(gradientMapSvg(t.tint, t.strength))}#m")`
    )
  }
  if (t.brightness !== 1) chain.push(`brightness(${t.brightness.toFixed(2)})`)
  if (t.contrast !== 1) chain.push(`contrast(${t.contrast.toFixed(2)})`)
  if (t.saturation !== 1) chain.push(`saturate(${t.saturation.toFixed(2)})`)

  const out: string[] = []
  if (chain.length > 0) {
    out.push(`html { filter: ${chain.join(' ')} !important; ${t.dark ? 'background: #fff;' : ''} }`)
    if (t.dark) {
      out.push(
        `img, picture, video, canvas, iframe, embed, object, [style*="background-image"] { filter: ${FLIP} !important; }`
      )
    }
  }
  if (t.tint && t.strength > 0 && !t.dark) {
    out.push(
      `html::after { content: ''; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; ` +
        `background: ${washColor(t.tint, t.strength)}; mix-blend-mode: multiply; }`,
      // full-screen video is left alone
      'html:has(:fullscreen)::after { display: none !important; }'
    )
  }
  if (t.font && BOOST_FONTS[t.font]) {
    out.push(`body, ${TEXT_TAGS} { font-family: ${BOOST_FONTS[t.font].stack} !important; }`)
  }
  for (const selector of t.zap) {
    if (isSafeSelector(selector)) out.push(`${selector} { display: none !important; }`)
  }
  if (t.css.trim()) out.push(t.css)
  return out.join('\n')
}

/** The theme with only the given fields changed, for editors that edit one control at a time. */
export const withTheme = (t: SiteTheme | null, patch: Partial<SiteTheme>): SiteTheme => ({
  ...(t ?? DEFAULT_THEME),
  ...patch
})
