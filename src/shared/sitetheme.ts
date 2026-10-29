import { hexToHsl } from './color'
import type { SiteTheme } from './types'

export const MAX_SITES_PER_SPACE = 300
export const DEFAULT_STRENGTH = 0.45

const HEX = /^#[0-9a-f]{6}$/i
// The hue the CSS sepia() filter pushes toward, so a tint can rotate from there to the colour it wants.
const SEPIA_HUE = 50

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

/** Nothing to inject: no dark mode and no tint. */
export const isPlain = (t: SiteTheme): boolean => !t.dark && t.tint === null

/** Untrusted input (it can come from a popover view): a well-formed theme, or null for nothing worth keeping. */
export function sanitizeSiteTheme(raw: unknown): SiteTheme | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const tint = typeof r.tint === 'string' && HEX.test(r.tint) ? r.tint.toLowerCase() : null
  const strength =
    typeof r.strength === 'number' && Number.isFinite(r.strength)
      ? Math.min(1, Math.max(0, r.strength))
      : DEFAULT_STRENGTH
  const theme: SiteTheme = { dark: r.dark === true, tint, strength }
  return isPlain(theme) ? null : theme
}

/**
 * CSS that recolours a whole page with one filter chain on the root, so dark mode and a tint compose
 * and nothing about the page's own layout or scripts has to cooperate. Dark mode inverts the page and
 * turns the hues back, then puts pictures and video the right way round again.
 */
export function siteThemeCss(t: SiteTheme): string {
  const chain: string[] = []
  if (t.dark) chain.push('invert(1)', 'hue-rotate(180deg)')
  if (t.tint) {
    const s = Math.min(1, Math.max(0, t.strength))
    const hue = Math.round(hexToHsl(t.tint).h - SEPIA_HUE)
    chain.push(
      `sepia(${(0.15 + 0.65 * s).toFixed(2)})`,
      `saturate(${(1 + 1.5 * s).toFixed(2)})`,
      `hue-rotate(${hue}deg)`
    )
  }
  if (chain.length === 0) return ''
  const flip = t.dark
    ? 'img, picture, video, canvas, iframe, embed, object, [style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; }'
    : ''
  return `html { filter: ${chain.join(' ')} !important; ${t.dark ? 'background: #fff;' : ''} }\n${flip}`
}
