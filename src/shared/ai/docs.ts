/**
 * Documents the chat can read: which files count, and how their text is shown to a model. Pure.
 */

export type DocKind = 'pdf' | 'text'

const TEXT_EXT = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'xml',
  'html',
  'htm',
  'yaml',
  'yml',
  'toml',
  'ini',
  'log',
  'rtf',
  'tex',
  'srt',
  'vtt',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'swift',
  'sh',
  'ps1',
  'bat',
  'sql',
  'css',
  'scss',
  'vue',
  'svelte'
])

/** What a file is to the chat, by its name: a PDF, a text file, or nothing it can read (null). */
export function docKind(name: string): DocKind | null {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim())
  if (!m) return null
  const ext = m[1].toLowerCase()
  if (ext === 'pdf') return 'pdf'
  return TEXT_EXT.has(ext) ? 'text' : null
}

/** An address that is a PDF by its path (the viewer tab of a PDF has the PDF's own address). */
export function looksLikePdf(url: string): boolean {
  try {
    const u = new URL(url)
    return /\.pdf$/i.test(decodeURIComponent(u.pathname))
  } catch {
    return false
  }
}

/** The extensions the file picker offers. */
export const PICKER_EXTENSIONS = ['pdf', ...TEXT_EXT]

const esc = (s: string): string => s.replace(/<\/?\s*(document|page)\b/gi, '< $1')
const attr = (s: string): string => s.replace(/["<>\r\n]/g, ' ').slice(0, 200)

/** A document's text as a model sees it: delimited, cut to `cap`, and unable to close its own tag. */
export function wrapDoc(
  d: { name: string; pages: number; text: string; cut?: boolean },
  cap: number
): string {
  const full = d.text.trim()
  const more = full.length > cap || d.cut ? '\n[the rest of the document is cut here]' : ''
  const pages = d.pages ? ` pages="${d.pages}"` : ''
  return `<document name="${attr(d.name)}"${pages}>\n${esc(full.slice(0, cap))}${more}\n</document>`
}
