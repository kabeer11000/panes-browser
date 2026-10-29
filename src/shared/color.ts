/** Hue 0-360, saturation and lightness 0-1. */
export interface Hsl {
  h: number
  s: number
  l: number
}

export function hexToHsl(hex: string): Hsl {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60
  return { h, s, l }
}

export function hslToHex({ h, s, l }: Hsl): string {
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

/** Blend two #rrggbb colours; `t` is how much of `a` (0 to 1). */
export function mixHex(a: string, b: string, t: number): string {
  const k = Math.min(1, Math.max(0, t))
  const ch = (hex: string, shift: number): number => (parseInt(hex.slice(1), 16) >> shift) & 255
  const part = (shift: number): string =>
    Math.round(ch(a, shift) * k + ch(b, shift) * (1 - k))
      .toString(16)
      .padStart(2, '0')
  return `#${part(16)}${part(8)}${part(0)}`
}

/** How much of a space's colour reaches the page background, per unit of its intensity. Mirrors --stage-bg in styles.css. */
export const STAGE_SHARE = 0.28
export const STAGE_BASE = { dark: '#121216', light: '#ffffff' } as const

/** The page area's background (new tab, panes:// pages, error pages) in a space: its colour, softly. */
export function stageBackground(color: string, tint: number, dark: boolean): string {
  return mixHex(color, dark ? STAGE_BASE.dark : STAGE_BASE.light, tint * STAGE_SHARE)
}

export type Scheme = 'single' | 'analogous' | 'complementary' | 'triad' | 'split' | 'free'

/** Hue offset of the second colour for each harmony. */
export const SCHEME_OFFSETS: Record<Exclude<Scheme, 'single' | 'free'>, number> = {
  analogous: 35,
  complementary: 180,
  triad: 120,
  split: 150
}

// Saturation range the picker allows: no greys, no neon.
export const S_MIN = 0.4
export const S_MAX = 0.84

/** Perceived brightness differs by hue, so blues are lifted a little and yellows deepened. */
function lightnessFor(h: number): number {
  const blue = Math.cos(((h - 250) * Math.PI) / 180) // 1 at blue, -1 at yellow
  return 0.56 + 0.06 * blue
}

/** A pleasant colour for a wheel position: hue in degrees, t = distance from centre (0 to 1). */
export function tasteful(h: number, t: number): string {
  const hue = ((h % 360) + 360) % 360
  const k = Math.min(1, Math.max(0, t))
  return hslToHex({ h: hue, s: S_MIN + (S_MAX - S_MIN) * k, l: lightnessFor(hue) })
}

/** Inverse of `tasteful` for placing a puck: how far from the centre a colour sits, 0 to 1. */
export function wheelDistance(hex: string): number {
  const { s } = hexToHsl(hex)
  return Math.min(1, Math.max(0, (s - S_MIN) / (S_MAX - S_MIN)))
}

/** The partner colour for a harmony, kept inside the tasteful band. */
export function harmonize(hex: string, scheme: Exclude<Scheme, 'single' | 'free'>): string {
  const { h, s } = hexToHsl(hex)
  const t = Math.min(1, Math.max(0, (s - S_MIN) / (S_MAX - S_MIN)))
  return tasteful(h + SCHEME_OFFSETS[scheme], Math.min(1, t + 0.1))
}
