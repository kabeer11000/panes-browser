import type { SpaceIcon } from '../../../shared/spaceicons'

const PATHS: Record<SpaceIcon, string> = {
  home: 'M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10',
  work: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  code: 'M9 8l-5 4 5 4M15 8l5 4-5 4M13.5 5l-3 14',
  book: 'M5 4h13v14H7a2 2 0 0 0-2 2zM5 20h13v-2M9 8h5',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  game: 'M7 9h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5 2l-1-1H9l-1 1a3 3 0 0 1-5-2v-1a4 4 0 0 1 4-4zM8 11v3M6.5 12.5h3M16 12h.01M18 13.5h.01',
  music:
    'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-2.5-2.5A2.5 2.5 0 0 1 9 18zM19 16a2.5 2.5 0 1 1-2.5-2.5A2.5 2.5 0 0 1 19 16z',
  cart: 'M3 4h2l2 11h11l2-8H6.5M9 20h.01M17 20h.01',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  flask: 'M9 3h6M10 3v6L5 19a1.5 1.5 0 0 0 1.4 2h11.2A1.5 1.5 0 0 0 19 19l-5-10V3',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  leaf: 'M5 19c0-9 5-14 15-14 0 10-5 15-14 15M5 19l8-8',
  plane: 'M21 3 3 10l7 3 3 7zM10 13l11-10',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6z',
  moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z'
}

/** A bare glyph, for pickers. */
export function SpaceGlyph({ icon }: { icon: SpaceIcon }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[icon]} />
    </svg>
  )
}

interface Props {
  color: string
  color2: string | null
  icon: SpaceIcon
  size?: number
}

/**
 * The space's face: a soft squircle in its own colours with its glyph in white. With one colour the
 * gradient runs light to dark of that colour, so every avatar has depth.
 */
export function SpaceAvatar({ color, color2, icon, size = 28 }: Props): React.JSX.Element {
  const from = `color-mix(in srgb, ${color} 78%, white)`
  const to = color2 ?? `color-mix(in srgb, ${color} 78%, black)`
  return (
    <span
      className="sav"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        background: `linear-gradient(145deg, ${from}, ${to})`
      }}
    >
      <span style={{ width: size * 0.58, height: size * 0.58 }}>
        <SpaceGlyph icon={icon} />
      </span>
    </span>
  )
}
