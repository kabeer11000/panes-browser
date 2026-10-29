/** The glyphs a space can wear on its avatar. Drawing lives in the renderer; main only needs the names. */
export const SPACE_ICONS = [
  'home',
  'work',
  'code',
  'book',
  'heart',
  'game',
  'music',
  'cart',
  'globe',
  'star',
  'flask',
  'camera',
  'leaf',
  'plane',
  'bolt',
  'moon'
] as const

export type SpaceIcon = (typeof SPACE_ICONS)[number]

export const isSpaceIcon = (v: unknown): v is SpaceIcon =>
  typeof v === 'string' && (SPACE_ICONS as readonly string[]).includes(v)

/** A new space's icon: spread around the set so neighbours differ. */
export const defaultSpaceIcon = (index: number): SpaceIcon =>
  SPACE_ICONS[((index % SPACE_ICONS.length) * 5) % SPACE_ICONS.length]
