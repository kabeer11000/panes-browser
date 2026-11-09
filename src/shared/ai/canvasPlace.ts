import { kindOf, siteOf, type CanvasItem, type ItemKind, type Placement } from './canvasItems'
import { excerpt } from './canvasItems'

export type { Placement }

/**
 * How a thing put on the board should be placed: as a note (text), as a document (its content shown inline, no tab),
 * or as a live page (a real tab, only once it is opened live). Deterministic first; a model only settles the few
 * pages the rules cannot call.
 */
export const PLACEMENTS: readonly Placement[] = ['note', 'document', 'live']

export const PLACEMENT_LABEL: Record<Placement, string> = {
  note: 'note',
  document: 'document',
  live: 'live page'
}

/** Sites that are tools, not articles: mail, editors, dashboards, chat. They need the real page. */
const LIVE_HOSTS =
  /^(?:mail\.google\.com|outlook\.(?:live|office)\.com|calendar\.google\.com|web\.whatsapp\.com|app\.slack\.com|(?:[\w-]+\.)?slack\.com|notion\.so|www\.notion\.so|figma\.com|www\.figma\.com|linear\.app|trello\.com|asana\.com|app\.[\w.-]+|console\.[\w.-]+|dashboard\.[\w.-]+|admin\.[\w.-]+|(?:[\w-]+\.)?atlassian\.net|miro\.com|canva\.com|www\.canva\.com)$/i
const LIVE_PATH =
  /^\/(?:dashboard|inbox|admin|console|app|editor|workspace|settings|account|login|signin)(?:\/|$)/i
const EDITOR_PATH = /^https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation|forms)\//i
const KNOWN_ARTICLE_HOSTS =
  /(?:wikipedia\.org|medium\.com|substack\.com|github\.io|bbc\.com|nytimes\.com|theguardian\.com|reuters\.com|arxiv\.org|stackoverflow\.com|developer\.mozilla\.org|docs\.rs|dev\.to|hackernoon\.com)$/i

export interface PlaceInput {
  kind: ItemKind
  url: string
  /** What was asked, if this came from the prompt. */
  query?: string
  /** The page reads like an app (few paragraphs). */
  app?: boolean
}

export interface PlaceGuess {
  placement: Placement
  /** The rules settle it; when false, a model may be asked. */
  confident: boolean
}

/** What kind of answer a question asks for (all of them are notes: this only names it). */
export function answerShape(q: string): 'definition' | 'comparison' | 'howto' | 'question' {
  const s = q.trim().toLowerCase()
  if (/\b(vs\.?|versus|compare|difference between|better than)\b/.test(s)) return 'comparison'
  if (/^(how (do|to|can|should)|steps to|guide to)\b/.test(s)) return 'howto'
  if (/^(what is|what's|what are|define|meaning of|who is)\b/.test(s)) return 'definition'
  return 'question'
}

export function suggestPlacement(i: PlaceInput): PlaceGuess {
  if (i.kind === 'answer') return { placement: 'note', confident: true }
  if (i.kind === 'pdf' || i.kind === 'image' || i.kind === 'video')
    return { placement: 'document', confident: true }
  let u: URL
  try {
    u = new URL(i.url)
  } catch {
    return { placement: 'document', confident: false }
  }
  const host = u.hostname
  const path = u.pathname
  if (EDITOR_PATH.test(i.url) || LIVE_HOSTS.test(host) || LIVE_PATH.test(path))
    return { placement: 'live', confident: true }
  if (KNOWN_ARTICLE_HOSTS.test(host)) return { placement: 'document', confident: true }
  // an ordinary page with a real path is an article; a bare front page or an app-like page is a question mark
  if (i.app) return { placement: 'live', confident: false }
  const deep = path.split('/').filter(Boolean).length >= 2
  return { placement: 'document', confident: deep }
}

/** A model's choice ({"placement": "note"} or the bare word), or null when unusable. */
export function parsePlacement(raw: string | null | undefined): Placement | null {
  if (!raw) return null
  const m = /\b(note|document|live)\b/i.exec(raw)
  return m ? (m[1].toLowerCase() as Placement) : null
}

/** The bullets of a page shown as a note when no model could summarise it: its first sentences. */
export function fallbackSummary(text: string, max = 4): string {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 30)
    .slice(0, max)
  return sentences.length
    ? sentences.map((s) => `- ${excerpt(s, 200)}`).join('\n')
    : excerpt(text, 300)
}

/**
 * The item as it is once placed. A note keeps the address it came from (the note links back to it) and holds text;
 * a document or live page goes back to what the address is. Nothing here makes a tab.
 */
export function placeItem(item: CanvasItem, to: Placement, summary?: string): CanvasItem {
  if (to === 'note') {
    if (item.kind === 'answer') return { ...item, placement: 'note' }
    const body = (summary ?? item.text ?? '').trim()
    const link = item.url
      ? `\n\nSource: [${item.site || siteOf(item.url) || item.url}](${item.url})`
      : ''
    return {
      ...item,
      kind: 'answer',
      placement: 'note',
      text: (body || item.title) + link,
      image: undefined
    }
  }
  const back = item.kind === 'answer' && item.url ? kindOf(item.url) : item.kind
  return { ...item, kind: back === 'answer' ? 'page' : back, placement: to }
}

/**
 * An answer cut into the parts someone may want to put on the board: paragraphs, headings, lists and code blocks.
 * Blank lines separate them, except inside a code fence; a list stays in one piece.
 */
export function splitBlocks(text: string): string[] {
  const out: string[] = []
  let cur: string[] = []
  let fence = false
  const flush = (): void => {
    const t = cur.join('\n').trim()
    if (t) out.push(t)
    cur = []
  }
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fence = !fence
      cur.push(line)
      if (!fence) flush()
      continue
    }
    if (!fence && line.trim() === '') flush()
    else cur.push(line)
  }
  flush()
  return out
}

/** Three things worth asking, from what is on the board: they name real titles, and fall back to plain ones. */
export function exampleAsks(titles: readonly string[]): string[] {
  const t = titles
    .map((x) =>
      x
        .replace(/\s+/g, ' ')
        .replace(/\s[-|–—]\s.*$/, '')
        .trim()
    )
    .filter((x) => x.length >= 3)
    .map((x) => (x.length > 38 ? x.slice(0, 36).replace(/\s+\S*$/, '') + '...' : x))
  const out: string[] = []
  if (t.length >= 2) out.push(`Compare ${t[0]} with ${t[1]}`)
  else if (t.length === 1) out.push(`Summarise ${t[0]}`)
  if (titles.length >= 4) out.push('Group these tabs by topic')
  if (t.length >= 3) out.push(`What do ${t[1]} and ${t[2]} have in common?`)
  out.push('Find a PDF about this topic', 'Find what I read about this last week')
  return [...new Set(out)].slice(0, 3)
}
