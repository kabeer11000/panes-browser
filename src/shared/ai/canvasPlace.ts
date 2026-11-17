import { kindOf, siteOf, type CanvasItem, type ItemKind, type Placement } from './canvasItems'
import { excerpt } from './canvasItems'

export type { Placement }

/**
 * How a thing put on the board should be placed: as a note (text), as a document (its content shown inline, no tab),
 * or as a live page (a real tab, only once it is opened live).
 */
export const PLACEMENTS: readonly Placement[] = ['note', 'document', 'live']

export const PLACEMENT_LABEL: Record<Placement, string> = {
  note: 'note',
  document: 'document',
  live: 'live page'
}

export interface PlaceInput {
  kind: ItemKind
  url: string
  /** What was asked, if this came from the prompt. */
  query?: string
  /** The page reads like an app (few paragraphs). */
  app?: boolean
}

/** What kind of answer a question asks for (all of them are notes: this only names it). */
export function answerShape(q: string): 'definition' | 'comparison' | 'howto' | 'question' {
  const s = q.trim().toLowerCase()
  if (/\b(vs\.?|versus|compare|difference between|better than)\b/.test(s)) return 'comparison'
  if (/^(how (do|to|can|should)|steps to|guide to)\b/.test(s)) return 'howto'
  if (/^(what is|what's|what are|define|meaning of|who is)\b/.test(s)) return 'definition'
  return 'question'
}

/**
 * How a thing goes on the board: an answer as a note; a PDF, picture or video as itself; a web page as the page (its
 * picture, live once opened). Pages used to be split into "documents" (their text inline, a reader) and live pages;
 * with the reader off, a document page read as a reader mode nobody asked for.
 */
export function suggestPlacement(i: PlaceInput): Placement {
  if (i.kind === 'answer') return 'note'
  if (i.kind === 'pdf' || i.kind === 'image' || i.kind === 'video') return 'document'
  return 'live'
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
 * A note of a page, for a new card beside the page's own: its key points (`summary`), or with `pending` the empty
 * note that shows as being written. It never holds the page's tab: a card holding a tab stands for that tab, and the
 * tab's own card would leave the board (the "make a note of it" bug). It links back by address instead.
 */
export function noteOf(item: CanvasItem, summary?: string, pending = false): CanvasItem {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tab, ...rest } = item
  const note = placeItem(rest, 'note', summary)
  return pending ? { ...note, text: '' } : note
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

/**
 * A board saved when web pages could be "documents" (their text inline, as a reader): those pages are the page
 * again. PDFs, pictures and videos keep showing as themselves.
 */
export function pagesNotDocuments<S extends { items: Record<string, CanvasItem> }>(s: S): S {
  let changed = false
  const items: Record<string, CanvasItem> = {}
  for (const [k, it] of Object.entries(s.items)) {
    const doc = it.kind === 'page' && it.placement === 'document'
    if (doc) changed = true
    items[k] = doc ? { ...it, placement: 'live' } : it
  }
  return changed ? { ...s, items } : s
}
