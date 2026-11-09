import { normalizeUrl } from './urls'

/**
 * The canvas prompt, as pure logic: is the person looking for something or asking something, what the web search
 * should say, how results from different places are merged, de-duplicated and put in order. No Electron here, and
 * nothing that learns: habits are read from the history that is already kept.
 */

export type Intent = 'find' | 'ask'

export interface IntentGuess {
  intent: Intent
  /** The words alone settle it; when false, a model may be asked. */
  confident: boolean
  wantsDocs: boolean
  wantsImages: boolean
  /** The query without a leading command ("open", "find me"). */
  terms: string
}

const ASK_START =
  /^(what|whats|what's|why|how|when|where|who|whom|whose|which|explain|summari[sz]e|compare|tell me|define|describe|can you|could you|should|is|are|was|were|does|do|did|will|would|give me an? (?:overview|summary))\b/i
const FIND_START =
  /^(open|find|show|show me|search|search for|look up|look for|go to|get|pull up|bring up|fetch)\b[\s:]*/i
const DOCS =
  /\b(pdf|pdfs|paper|papers|report|reports|whitepaper|datasheet|manual|ebook|slides|handout)\b/i
const IMAGES = /\b(image|images|photo|photos|picture|pictures|wallpaper|wallpapers)\b/i
const URL_LIKE = /^(https?:\/\/\S+|(?:[\w-]+\.)+[a-z]{2,}(?:\/\S*)?)$/i

const words = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean)

/** A first guess from the words themselves. Cheap, offline, and good enough when it says it is confident. */
export function guessIntent(raw: string): IntentGuess {
  const q = raw.replace(/\s+/g, ' ').trim()
  const wantsDocs = DOCS.test(q)
  const wantsImages = IMAGES.test(q)
  const cmd = FIND_START.exec(q)
  const terms = (cmd ? q.slice(cmd[0].length) : q).trim() || q
  const base = { wantsDocs, wantsImages, terms }
  if (q === '') return { ...base, intent: 'find', confident: true }
  if (URL_LIKE.test(q)) return { ...base, intent: 'find', confident: true }
  if (cmd) return { ...base, intent: 'find', confident: true }
  if (q.endsWith('?')) return { ...base, intent: 'ask', confident: true }
  const n = words(q).length
  if (ASK_START.test(q)) return { ...base, intent: 'ask', confident: n >= 4 }
  if (n <= 3) return { ...base, intent: 'find', confident: true }
  // a longer phrase with no question word: more likely a topic to look up than a question, but not certain
  return { ...base, intent: 'find', confident: false }
}

/** What a model said about the intent ({"intent": "ask"} or just a word), or null when it is unusable. */
export function parseModelIntent(raw: string | null | undefined): Intent | null {
  if (!raw) return null
  const m =
    /"?intent"?\s*:\s*"?(find|ask)/i.exec(raw) ?? /^\W*(find|ask|question|search|open)\b/i.exec(raw)
  if (!m) return null
  const w = m[1].toLowerCase()
  return w === 'ask' || w === 'question' ? 'ask' : 'find'
}

/** The text to send to a web search: the terms, with a file type when the query asks for documents. */
export function webQuery(g: IntentGuess): string {
  const t = g.terms.slice(0, 200)
  if (g.wantsDocs && !/filetype:/i.test(t)) return `${t} filetype:pdf`
  return t
}

// ---- hits ----

export type FindSource = 'tab' | 'history' | 'download' | 'web'

export interface Hit {
  url: string
  title: string
  source: FindSource
  /** How well it matches the words, 0 to 1. */
  relevance: number
  snippet?: string
  image?: string
  tab?: number
  /** A downloaded file: its path. */
  file?: string
  mime?: string
  visits?: number
  lastVisit?: number
}

export const MAX_RESULTS = 12
const SOURCE_ORDER: Record<FindSource, number> = { tab: 0, history: 1, download: 2, web: 3 }
const DAY = 86_400_000

const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)

/** How much of the query a text covers: the share of query words that are in it (a word may be the start of one). */
export function termScore(query: string, text: string): number {
  const q = tokens(query)
  if (q.length === 0) return 0
  const t = tokens(text)
  let hit = 0
  for (const w of q) if (t.some((x) => x === w || (w.length >= 3 && x.startsWith(w)))) hit++
  return hit / q.length
}

/**
 * How much a page has been part of the person's life: how often they visited (log scaled, so a hundred visits is
 * not a hundred times one) and how recently, half and half. 0 for a page never visited.
 */
export function habit(visits: number, lastVisit: number, now: number): number {
  if (visits <= 0) return 0
  const freq = Math.min(1, Math.log2(1 + visits) / 5)
  const age = Math.max(0, now - lastVisit)
  const recent = Math.exp(-age / (14 * DAY))
  return 0.5 * freq + 0.5 * recent
}

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|ref_)/i

/** One key per page: no fragment, no tracking parameters, no www, no trailing slash. */
export function hitKey(url: string): string {
  if (/^file:/i.test(url)) return url.toLowerCase()
  const n = normalizeUrl(url)
  if (!n) return url
  try {
    const u = new URL(n)
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k)
    u.hostname = u.hostname.replace(/^www\./, '')
    u.pathname = u.pathname.replace(/\/+$/, '') || '/'
    return u.toString().replace(/\/$/, '')
  } catch {
    return n
  }
}

/** Add `incoming` hits to `have`: a page already there is kept (in its place) and given what the newcomer knows. */
export function mergeHits(have: Hit[], incoming: Hit[]): Hit[] {
  const out = have.map((h) => ({ ...h }))
  const at = new Map(out.map((h, i) => [hitKey(h.url), i]))
  for (const h of incoming) {
    const k = hitKey(h.url)
    const i = at.get(k)
    if (i === undefined) {
      at.set(k, out.length)
      out.push({ ...h })
      continue
    }
    const cur = out[i]
    out[i] = {
      ...cur,
      title: cur.title.length >= h.title.length ? cur.title : h.title,
      snippet: (cur.snippet?.length ?? 0) >= (h.snippet?.length ?? 0) ? cur.snippet : h.snippet,
      image: cur.image ?? h.image,
      tab: cur.tab ?? h.tab,
      file: cur.file ?? h.file,
      mime: cur.mime ?? h.mime,
      visits: Math.max(cur.visits ?? 0, h.visits ?? 0) || undefined,
      lastVisit: Math.max(cur.lastVisit ?? 0, h.lastVisit ?? 0) || undefined,
      relevance: Math.max(cur.relevance, h.relevance)
    }
  }
  return out
}

/** The blended score inside one source: what it says matters most, what the person keeps coming back to next. */
export function blend(h: Hit, now: number): number {
  return 0.6 * h.relevance + 0.4 * habit(h.visits ?? 0, h.lastVisit ?? 0, now)
}

/**
 * The order results appear in: sources in the order they are searched (open tabs, history, downloads, the web),
 * each source best first. A page found in more than one place is shown where it was first found.
 */
export function orderHits(hits: Hit[], now: number): Hit[] {
  return hits
    .map((h, i) => ({ h, i }))
    .sort(
      (a, b) =>
        SOURCE_ORDER[a.h.source] - SOURCE_ORDER[b.h.source] ||
        blend(b.h, now) - blend(a.h, now) ||
        a.i - b.i
    )
    .map((x) => x.h)
}

/** Merge, order and cut to what a results frame shows. */
export function pickResults(lists: Hit[][], now: number, max = MAX_RESULTS): Hit[] {
  let all: Hit[] = []
  for (const l of lists) all = mergeHits(all, l)
  return orderHits(all, now).slice(0, max)
}

// ---- local sources ----

export const MIN_MATCH = 0.5

/** Open tabs that match the words; the title counts more than the address. */
export function tabHits(
  query: string,
  tabs: ReadonlyArray<{ id: number; url: string; title: string }>
): Hit[] {
  const out: Hit[] = []
  for (const t of tabs) {
    const r = Math.max(termScore(query, t.title), 0.9 * termScore(query, t.url))
    if (r >= MIN_MATCH)
      out.push({ url: t.url, title: t.title, source: 'tab', relevance: r, tab: t.id })
  }
  return out
}

/** History matched by words: pages counted by visits, with their last visit. */
export function historyHits(
  query: string,
  entries: ReadonlyArray<{ url: string; title: string; time: number }>
): Hit[] {
  const by = new Map<string, Hit>()
  for (const e of entries) {
    if (!/^https?:/i.test(e.url)) continue
    const r = Math.max(termScore(query, e.title), 0.9 * termScore(query, e.url))
    if (r < MIN_MATCH) continue
    const k = hitKey(e.url)
    const h = by.get(k)
    if (h) {
      h.visits = (h.visits ?? 1) + 1
      h.lastVisit = Math.max(h.lastVisit ?? 0, e.time)
    } else
      by.set(k, {
        url: e.url,
        title: e.title,
        source: 'history',
        relevance: r,
        visits: 1,
        lastVisit: e.time
      })
  }
  return [...by.values()]
}

/** Downloaded files whose name (or address) matches the words. */
export function downloadHits(
  query: string,
  files: ReadonlyArray<{
    filename: string
    savePath: string
    url: string
    mime?: string
    time: number
  }>
): Hit[] {
  const out: Hit[] = []
  for (const f of files) {
    const stem = f.filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
    const r = Math.max(termScore(query, stem), 0.8 * termScore(query, f.url))
    if (r < MIN_MATCH) continue
    const url = 'file:///' + f.savePath.replace(/\\/g, '/').replace(/^\/+/, '')
    out.push({
      url,
      title: stem,
      source: 'download',
      relevance: r,
      file: f.savePath,
      mime: f.mime,
      lastVisit: f.time,
      visits: 1
    })
  }
  return out
}

/** The links in an answer written in Markdown (and bare addresses), once each, for cards that open them. */
export function answerLinks(text: string, max = 6): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = []
  const seen = new Set<string>()
  const add = (title: string, url: string): void => {
    const clean = url.replace(/[).,;]+$/, '')
    const k = hitKey(clean)
    if (seen.has(k) || out.length >= max || !/^https?:\/\//i.test(clean)) return
    seen.add(k)
    out.push({ title: title.trim() || clean, url: clean })
  }
  for (const m of text.matchAll(/\[([^\]]{1,120})\]\((https?:\/\/[^)\s]+)\)/g)) add(m[1], m[2])
  for (const m of text.matchAll(/(?<![(\]])\bhttps?:\/\/[^\s<>"')\]]+/g)) add('', m[0])
  return out
}

/** A short label for a frame made for a query. */
export function frameLabel(query: string, max = 32): string {
  const q = query.replace(/\s+/g, ' ').trim()
  const t = q.length > max ? q.slice(0, max - 1).replace(/\s+\S*$/, '') + '...' : q
  return t || 'Results'
}

/** What main tells the board while a search runs. */
export type CanvasFoundEvent = { queryId: string } & (
  | { kind: 'intent'; intent: Intent; docs: boolean }
  | { kind: 'hits'; source: FindSource; hits: Hit[] }
  | { kind: 'done' }
  | { kind: 'error'; message: string }
)
