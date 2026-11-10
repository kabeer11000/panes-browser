/**
 * "Find X and open it": which web search result to open. Pure, so it is tested; the search itself is main's.
 *
 * Asked for a PDF ("dragon book of compilers pdf"), a result that is a PDF file wins over pages about it; otherwise
 * the result naming most of the words wins, the search engine's order breaking ties. Sites that show nothing without
 * a sign-in or bury files under ads lose to the rest.
 */

export interface WebResult {
  url: string
  title: string
  snippet: string
}

/** Words that say what to do or what form, not what to find. */
const FILLER = new Set([
  'find',
  'search',
  'for',
  'look',
  'up',
  'get',
  'me',
  'open',
  'it',
  'and',
  'then',
  'the',
  'a',
  'an',
  'of',
  'on',
  'to',
  'in',
  'pdf',
  'free',
  'download',
  'online',
  'copy',
  'version',
  'file',
  'please'
])

/** Sites whose result is rarely the thing itself (a sign-in wall, a pin, a listing). */
const WEAK_HOSTS =
  /(^|\.)(pinterest\.[a-z.]+|scribd\.com|coursehero\.com|studocu\.com|facebook\.com|quora\.com)$/

/** Asked for a PDF: the word itself, or "pdf" anywhere in the words. */
export const wantsPdf = (query: string): boolean => /\bpdf\b/i.test(query)

/** The words that name the thing, lowercased. */
export const keyWords = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !FILLER.has(w))

const host = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Whether a result is the PDF itself (its address ends in .pdf, before any query or fragment). */
export const isPdfUrl = (url: string): boolean => /\.pdf(?:$|[?#])/i.test(url)

/** The best result to open, or null when there is none worth opening. */
export function pickResult(results: readonly WebResult[], query: string): WebResult | null {
  const words = keyWords(query)
  const pdf = wantsPdf(query)
  let best: { r: WebResult; score: number } | null = null
  results.forEach((r, i) => {
    if (!/^https?:\/\//i.test(r.url)) return
    const hay = `${r.title} ${r.url} ${r.snippet}`.toLowerCase()
    const hits = words.filter((w) => hay.includes(w)).length
    // most of the words, or none of them is no match at all
    if (words.length && hits === 0) return
    let score = words.length ? (hits / words.length) * 4 : 0
    if (pdf) score += isPdfUrl(r.url) ? 5 : /\bpdf\b/i.test(r.title) ? 1.5 : 0
    if (WEAK_HOSTS.test(host(r.url))) score -= 3
    score -= i * 0.15
    if (!best || score > best.score) best = { r, score }
  })
  return best ? (best as { r: WebResult }).r : null
}

/** The search to run: a PDF is asked for as a file when the engine understands it. */
export const searchFor = (query: string): string =>
  wantsPdf(query) ? `${query.replace(/\s+/g, ' ').trim()} filetype:pdf` : query.trim()
