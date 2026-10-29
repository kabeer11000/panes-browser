import type { PromptAnchor } from './types'

const COLOUR = /^#[0-9a-f]{3,8}$/i
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** The anchor comes from IPC, so check its shape before it reaches layout or becomes CSS. */
export function parseAnchor(raw: unknown): PromptAnchor | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Partial<PromptAnchor>
  const t = a.theme
  if (!finite(a.x) || !finite(a.y) || !finite(a.width) || !finite(a.height) || !t) return null
  if (t.scheme !== 'dark' && t.scheme !== 'light') return null
  if (!COLOUR.test(t.color) || !COLOUR.test(t.color2)) return null
  return { x: a.x, y: a.y, width: a.width, height: a.height, theme: t }
}
