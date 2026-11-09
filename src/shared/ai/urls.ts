const MAX_TEXT = 1500

/**
 * One key per page for the embedding index: http(s) only, no fragment, lower-case host, no bare trailing slash.
 * Null for anything that is not a web page (panes://, about:, file:, data:).
 */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    u.hash = ''
    const s = u.toString()
    return u.pathname === '/' && !u.search ? s.replace(/\/$/, '') : s
  } catch {
    return null
  }
}

/** What a page is embedded from: its title, its description, and the start of its text. */
export function documentText(title: string, description: string, body: string): string {
  const parts = [title, description, body].map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  return parts.join('\n').slice(0, MAX_TEXT)
}

/** The search text for EmbeddingGemma (it is trained with these task prefixes); other models get it plain. */
export const gemmaDocument = (title: string, text: string): string =>
  `title: ${title.trim() || 'none'} | text: ${text}`
export const gemmaQuery = (q: string): string => `task: search result | query: ${q}`
