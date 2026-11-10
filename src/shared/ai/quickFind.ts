// Finding a card on the canvas board as you type (Ctrl+F), and noticing an address that is already on it.
// Local and instant: no model.

export interface FindItem {
  id: number
  title: string
  site: string
  url: string
  /** The page's words, when the board has read them. */
  text?: string
}

/**
 * The cards matching what is typed, best first. Every word typed must be somewhere in the title, site, address or
 * page text; a word found in the title (most of all at the start of a word there) ranks the card higher.
 */
export function quickFind(items: FindItem[], q: string): number[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const scored: Array<{ id: number; score: number; i: number }> = []
  items.forEach((it, i) => {
    const title = it.title.toLowerCase()
    const where = `${it.site} ${it.url}`.toLowerCase()
    const body = (it.text ?? '').toLowerCase()
    let score = 0
    for (const w of words) {
      const at = title.indexOf(w)
      if (at >= 0) score += at === 0 || /\W/.test(title[at - 1]) ? 4 : 3
      else if (where.includes(w)) score += 2
      else if (body.includes(w)) score += 1
      else return
    }
    scored.push({ id: it.id, score, i })
  })
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.id)
}

/** An address in a form to compare by: no scheme, no www., no #part, no trailing slash. Null if it is not one. */
export function addressKey(input: string): string | null {
  const t = input.trim()
  if (!t || /\s/.test(t)) return null
  let u: URL
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`)
  } catch {
    return null
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null
  const path = u.pathname.replace(/\/+$/, '')
  return `${u.hostname.replace(/^www\./, '').toLowerCase()}${path}${u.search}`
}

/** The card whose address is the one being opened, if any. */
export function alreadyOpen(items: FindItem[], input: string): number | null {
  const key = addressKey(input)
  if (!key) return null
  return items.find((it) => addressKey(it.url) === key)?.id ?? null
}
