import { tableText } from './canvasMarks'

/**
 * What something pasted or dropped onto the canvas board becomes. Pure: the renderer reads the clipboard or the files
 * and asks here, so the same text always lands as the same kind of card.
 */
export type PasteAs =
  { kind: 'link'; url: string } | { kind: 'table' | 'checklist' | 'code' | 'note'; text: string }

const URL_RE = /^(https?:\/\/\S+|www\.\S+|[\w-]+(\.[\w-]+)*\.[a-z]{2,}(\/\S*)?)$/i
const CHECK_RE = /^\s*(?:[-*+]\s*)?\[( |x|X)\]\s*(.*)$/
const CODE_LINE =
  /[{};]\s*$|^\s{2,}\S|^\t|^\s*(import|export|const|let|var|function|def|class|return|if|for|while|public|private|#include|SELECT|FROM)\b|=>|\)\s*\{/

/** A full address for something that looks like one ("example.com/x" gets https). */
export const asUrl = (t: string): string => (/^https?:\/\//i.test(t) ? t : `https://${t}`)

export function classifyPaste(raw: string): PasteAs {
  const text = raw.replace(/\r\n?/g, '\n').trim()
  if (!text.includes('\n') && !/\s/.test(text) && URL_RE.test(text)) {
    return { kind: 'link', url: asUrl(text) }
  }
  const lines = text.split('\n').filter((l) => l.trim())
  if (lines.length >= 2) {
    // rows of tab-separated cells, as copied from a spreadsheet
    const cells = lines.map((l) => l.split('\t').length)
    if (cells.every((n) => n >= 2) && Math.max(...cells) - Math.min(...cells) <= 1)
      return { kind: 'table', text: tableText(lines.map((l) => l.split('\t'))) }
  }
  if (lines.length >= 1 && lines.every((l) => CHECK_RE.test(l)))
    return {
      kind: 'checklist',
      text: lines
        .map((l) => {
          const m = CHECK_RE.exec(l)!
          return `[${m[1].toLowerCase()}] ${m[2]}`
        })
        .join('\n')
    }
  if (lines.length >= 2 && lines.filter((l) => CODE_LINE.test(l)).length / lines.length >= 0.5)
    return { kind: 'code', text: raw.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '') }
  return { kind: 'note', text }
}

/** What a file dropped on the board becomes, by its name and type; null: it has no card. */
export type FileAs = 'image' | 'pdf' | 'table' | 'code' | 'note'

const CODE_EXT =
  /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cc|cpp|hpp|cs|swift|php|sh|ps1|bat|sql|css|scss|html|xml|yaml|yml|toml|ini|json|lua|r|dart|vue|svelte)$/i
export function classifyFile(name: string, mime: string): FileAs | null {
  const n = name.toLowerCase()
  if (
    /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/.test(mime) ||
    /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(n)
  )
    return 'image'
  if (mime === 'application/pdf' || n.endsWith('.pdf')) return 'pdf'
  if (/\.(csv|tsv)$/.test(n) || mime === 'text/csv' || mime === 'text/tab-separated-values')
    return 'table'
  if (CODE_EXT.test(n)) return 'code'
  if (/\.(txt|md|markdown|log|rtf)$/.test(n) || mime.startsWith('text/')) return 'note'
  return null
}

/** Rows of a CSV (quotes, doubled quotes and commas or line breaks inside quotes), or of a TSV. */
export function csvRows(
  text: string,
  sep = text.includes('\t') && !text.includes(',') ? '\t' : ','
): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const t = text.replace(/\r\n?/g, '\n')
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim()))
}
