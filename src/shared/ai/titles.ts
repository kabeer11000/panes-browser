/** Titles longer than this after cleaning are worth asking the model about. */
export const TITLE_MODEL_ABOVE = 48
/** What the model is asked to stay within, and the most a model's answer may keep (rule: output is untrusted). */
export const TITLE_TARGET = 40
export const TITLE_MAX = 60

// hyphen, bar, en dash, em dash, middle dot, bullet, double colon: each with a space on both sides
const SEPARATORS = /\s+(?:-|\||–|—|·|•|::)\s+/
const COUNTER = /^\s*\(\s*\d+\+?\s*\)\s*/
const COUNTER_BRACKET = /^\s*\[\s*\d+\+?\s*\]\s*/
const QUOTES = /^["'`“”‘’]+|["'`“”‘’]+$/g

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()
const alnum = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** The name-like labels of a host: "en.wikipedia.org" gives wikipedia, en; "www.github.com" gives github. */
function hostLabels(url: string): string[] {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return []
  }
  const parts = host.replace(/^www\./, '').split('.')
  if (parts.length > 1) parts.pop() // the last label is the domain ending
  return parts.filter((p) => p.length >= 3)
}

/** Whether a title segment is just the site's name, going by the host ("YouTube" on youtube.com). */
function isSiteName(segment: string, labels: string[]): boolean {
  const s = alnum(segment)
  if (s.length < 3) return false
  return labels.some((l) => {
    const label = alnum(l)
    return s === label || (s.length >= 4 && (label.includes(s) || s.includes(label)))
  })
}

export interface CleanedTitle {
  title: string
  /** Still long after the cheap rules: worth a model's help. */
  needsModel: boolean
}

/**
 * The tab's title without the noise a page adds: a trailing site name after a dash, bar or em dash, a leading
 * unread counter, extra white space. Display only: the real title is untouched (the attention system reads it).
 * Short titles are returned as they are.
 */
export function cleanTitle(title: string, url: string): CleanedTitle {
  let out = squash(title).replace(COUNTER, '').replace(COUNTER_BRACKET, '')
  const parts = out.split(SEPARATORS)
  if (parts.length > 1 && isSiteName(parts[parts.length - 1], hostLabels(url))) {
    const rest = parts.slice(0, -1).join(' - ')
    if (rest.length > 0) out = rest
  }
  out = squash(out)
  if (out.length === 0) out = squash(title)
  return { title: out, needsModel: out.length > TITLE_MODEL_ABOVE }
}

/**
 * A title from a model, made safe to show: first line only, quotes and a trailing full stop dropped, white
 * space collapsed, at most TITLE_MAX characters. Null when nothing usable is left.
 */
export function sanitizeModelTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const line = (raw.split(/\r?\n/).find((l) => l.trim()) ?? '').replace(/\p{Cc}/gu, ' ')
  let t = squash(line).replace(QUOTES, '')
  t = t.replace(/\.$/, '').trim()
  if (t.length > TITLE_MAX) t = t.slice(0, TITLE_MAX).trimEnd()
  return t || null
}

/** The first JSON object in a model's reply (they sometimes wrap it in prose or a code fence), or null. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const v: unknown = JSON.parse(text.slice(start, end + 1))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
