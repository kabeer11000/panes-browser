/** A named, coloured run of tabs in the sidebar that can be folded away. Belongs to one space. */
export interface TabGroup {
  id: number
  name: string
  color: string
  collapsed: boolean
}

export const GROUP_COLORS = [
  '#7a8cff',
  '#3fc1b0',
  '#f08a5d',
  '#e26aa8',
  '#a98bf5',
  '#e0b64a',
  '#5fc77a',
  '#e46b6b'
] as const

export const GROUP_COLOR_NAMES = [
  'Blue',
  'Teal',
  'Orange',
  'Pink',
  'Purple',
  'Yellow',
  'Green',
  'Red'
]

const MAX_NAME = 32
const HEX = /^#[0-9a-f]{6}$/i

/** The colour for a new group: the first one not already in use here, then round again. */
export function nextGroupColor(used: readonly string[]): string {
  const free = GROUP_COLORS.find((c) => !used.includes(c))
  return free ?? GROUP_COLORS[used.length % GROUP_COLORS.length]
}

/** Untrusted input (it can come from the renderer): a well-formed edit, or nothing. */
export function sanitizeGroupPatch(
  raw: unknown
): Partial<Pick<TabGroup, 'name' | 'color' | 'collapsed'>> {
  const out: Partial<Pick<TabGroup, 'name' | 'color' | 'collapsed'>> = {}
  if (!raw || typeof raw !== 'object') return out
  const p = raw as Record<string, unknown>
  if (typeof p.name === 'string') out.name = p.name.trim().slice(0, MAX_NAME)
  if (typeof p.color === 'string' && HEX.test(p.color)) out.color = p.color
  if (typeof p.collapsed === 'boolean') out.collapsed = p.collapsed
  return out
}

/**
 * Put `id` directly after the last other member of `groupId`, so a group is always one unbroken
 * run. With no other member yet it stays where it is.
 */
export function placeInGroup(
  order: readonly number[],
  groupOf: (id: number) => number | null,
  id: number,
  groupId: number
): number[] {
  const rest = order.filter((i) => i !== id)
  let last = -1
  rest.forEach((i, k) => {
    if (groupOf(i) === groupId) last = k
  })
  if (last === -1) return [...order]
  rest.splice(last + 1, 0, id)
  return rest
}

/**
 * Which group a tab belongs to after it was dragged to a new spot: the one on both sides of it,
 * or the one it already had if it still touches that group, else none.
 */
export function groupAfterMove(
  order: readonly number[],
  groupOf: (id: number) => number | null,
  id: number
): number | null {
  const at = order.indexOf(id)
  if (at === -1) return null
  const before = at > 0 ? groupOf(order[at - 1]) : null
  const after = at < order.length - 1 ? groupOf(order[at + 1]) : null
  if (before !== null && before === after) return before
  const own = groupOf(id)
  return own !== null && (before === own || after === own) ? own : null
}
