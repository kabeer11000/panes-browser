/**
 * A small Markdown reader for chat replies. It returns a tree, never HTML: the panel builds elements from it, so
 * nothing a model (or a page it read) writes can become markup. Handles what replies use: paragraphs, headings,
 * bullet and numbered lists, quotes, fenced and inline code, bold, italic and links. Half-written Markdown (a
 * reply that is still streaming) reads as plain text until it is closed, and a code fence left open runs to the end.
 */
import { safeWebUrl } from './chatTools'

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: 'strong'; children: Inline[] }
  | { t: 'em'; children: Inline[] }
  | { t: 'link'; href: string; children: Inline[] }

export type Block =
  | { t: 'p'; children: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3; children: Inline[] }
  | { t: 'quote'; children: Inline[] }
  | { t: 'list'; ordered: boolean; items: Inline[][] }
  | { t: 'code'; lang: string; text: string }

const MAX_DEPTH = 4

export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = (): void => {
    if (text) out.push({ t: 'text', text })
    text = ''
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ t: 'code', text: src.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (depth < MAX_DEPTH && (src.startsWith('**', i) || src.startsWith('__', i))) {
      const mark = src.slice(i, i + 2)
      const end = src.indexOf(mark, i + 2)
      if (end > i + 2) {
        flush()
        out.push({ t: 'strong', children: parseInline(src.slice(i + 2, end), depth + 1) })
        i = end + 2
        continue
      }
    }
    if (depth < MAX_DEPTH && (c === '*' || c === '_') && src[i + 1] !== ' ' && src[i + 1] !== c) {
      const end = src.indexOf(c, i + 1)
      const wordy = c === '_' ? /\w/.test(src[i - 1] ?? '') : false // snake_case is not emphasis
      if (end > i + 1 && src[end - 1] !== ' ' && !wordy) {
        flush()
        out.push({ t: 'em', children: parseInline(src.slice(i + 1, end), depth + 1) })
        i = end + 1
        continue
      }
    }
    if (depth < MAX_DEPTH && c === '[') {
      const close = src.indexOf('](', i)
      const end = close > i ? src.indexOf(')', close + 2) : -1
      if (close > i && end > close) {
        const href = safeWebUrl(src.slice(close + 2, end))
        flush()
        const label = parseInline(src.slice(i + 1, close), depth + 1)
        if (href) out.push({ t: 'link', href, children: label })
        else out.push(...label) // not a web address: the words, without the link
        i = end + 1
        continue
      }
    }
    text += c
    i++
  }
  flush()
  return out
}

const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBER = /^\s*\d+[.)]\s+(.*)$/

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  const endPara = (): void => {
    if (para.length) blocks.push({ t: 'p', children: parseInline(para.join(' ')) })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/)
    if (fence) {
      endPara()
      const body: string[] = []
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) body.push(lines[i])
      blocks.push({ t: 'code', lang: fence[1], text: body.join('\n') })
      continue
    }
    if (!line.trim()) {
      endPara()
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      endPara()
      blocks.push({
        t: 'h',
        level: Math.min(3, h[1].length) as 1 | 2 | 3,
        children: parseInline(h[2])
      })
      continue
    }
    const q = line.match(/^\s*>\s?(.*)$/)
    if (q) {
      endPara()
      blocks.push({ t: 'quote', children: parseInline(q[1]) })
      continue
    }
    const item = line.match(BULLET) ?? line.match(NUMBER)
    if (item) {
      endPara()
      const ordered = !BULLET.test(line)
      const items: Inline[][] = []
      for (; i < lines.length; i++) {
        const m = (ordered ? NUMBER : BULLET).exec(lines[i])
        if (!m) break
        items.push(parseInline(m[1]))
      }
      i--
      blocks.push({ t: 'list', ordered, items })
      continue
    }
    para.push(line.trim())
  }
  endPara()
  return blocks
}
