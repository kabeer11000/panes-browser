import { isVirtual, type CanvasState } from './canvas'
import { checkLines, marksOf, parseTable, type CanvasMark } from './canvasMarks'

/**
 * The board as a Markdown digest: each section with its pages (as links) and notes, then what is loose, then the
 * text of the drawings (headings, labels, checklists, tables, code). Private tabs are left out. Pure.
 */
export interface DigestTab {
  id: number
  url: string
  title: string
  private: boolean
}

const oneLine = (t: string): string => t.replace(/\s+/g, ' ').trim()
const cell = (t: string): string => oneLine(t).replace(/\|/g, '\\|')
/** Brackets in a link's text would end it early. */
const linkText = (t: string): string => oneLine(t).replace(/[[\]]/g, '')

function markText(m: CanvasMark): string[] {
  const t = m.text ?? ''
  if (!t.trim()) return []
  if (m.kind === 'checklist') return checkLines(t).map((l) => `- [${l.done ? 'x' : ' '}] ${l.text}`)
  if (m.kind === 'code') return ['```', ...t.split('\n'), '```']
  if (m.kind === 'table') {
    const rows = parseTable(t)
    const line = (r: string[]): string => `| ${r.map(cell).join(' | ')} |`
    return [line(rows[0]), `|${rows[0].map(() => ' --- ').join('|')}|`, ...rows.slice(1).map(line)]
  }
  if (m.kind === 'text' && (m.size ?? 20) >= 24) return [`### ${oneLine(t)}`]
  return [oneLine(t)]
}

export function boardDigest(s: CanvasState, tabs: readonly DigestTab[], title: string): string {
  const byId = new Map(tabs.map((t) => [t.id, t]))
  const cardLine = (id: number): string | null => {
    if (isVirtual(id)) {
      const it = s.items[String(id)]
      if (!it) return null
      if (!it.url)
        return it.text ? `- ${oneLine(it.title ? `${it.title}: ${it.text}` : it.text)}` : null
      if (/^file:/i.test(it.url))
        return `- ${linkText(it.title || it.url)} (a file on this computer)`
      return `- [${linkText(it.title || it.site || it.url)}](${it.url})`
    }
    const t = byId.get(id)
    if (!t || t.private || !t.url) return null
    return `- [${linkText(t.title || t.url)}](${t.url})`
  }
  const out: string[] = [`# ${oneLine(title) || 'Board'}`, '']
  const section = (name: string, lines: string[]): void => {
    if (lines.length === 0) return
    out.push(`## ${oneLine(name)}`, '', ...lines, '')
  }
  for (const f of s.frames) {
    if (f.kind === 'private') continue
    const lines = s.cards
      .filter((c) => c.frame === f.id && !c.private)
      .flatMap((c) => cardLine(c.id) ?? [])
    for (const n of s.notes)
      if (n.frame === f.id && n.text.trim()) lines.push(`- Note: ${oneLine(n.text)}`)
    section(f.name, lines)
  }
  section(
    'On the board',
    s.cards.filter((c) => !c.frame && !c.private).flatMap((c) => cardLine(c.id) ?? [])
  )
  section(
    'Notes',
    s.notes.filter((n) => !n.frame && n.text.trim()).map((n) => `- ${oneLine(n.text)}`)
  )
  const drawn = marksOf(s).flatMap((m) => {
    const t = markText(m)
    return t.length ? [...t, ''] : []
  })
  section('Drawings', drawn.slice(0, -1))
  return (
    out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  )
}
