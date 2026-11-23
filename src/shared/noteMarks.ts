/**
 * Bold, italic and struck-through words in a board note (Ctrl+B, Ctrl+I, Ctrl+Shift+X while writing, as in Figma),
 * kept as plain text with markdown's markers (**bold**, _italic_, ~~struck~~): the note stays text everywhere it goes
 * (the shared board, the web board, a copy to the clipboard), and reads as itself where the markers are not drawn.
 */

export interface Run {
  t: string
  b?: true
  i?: true
  s?: true
}

const MARKS: Array<{ m: string; k: 'b' | 'i' | 's' }> = [
  { m: '**', k: 'b' },
  { m: '~~', k: 's' },
  { m: '_', k: 'i' }
]

/**
 * The note's text as runs of plain, bold, italic and struck text. A marker counts only when it is closed later in
 * the text and holds something that does not start or end with a space; anything else is shown as typed.
 */
export function parseInline(text: string): Run[] {
  const out: Run[] = []
  const style = { b: false, i: false, s: false }
  let buf = ''
  const flush = (): void => {
    if (!buf) return
    const r: Run = { t: buf }
    if (style.b) r.b = true
    if (style.i) r.i = true
    if (style.s) r.s = true
    out.push(r)
    buf = ''
  }
  let i = 0
  while (i < text.length) {
    let took = false
    for (const { m, k } of MARKS) {
      if (!text.startsWith(m, i)) continue
      if (style[k]) {
        // a closing marker: after something that is not a space
        if (i > 0 && text[i - 1] !== ' ') {
          flush()
          style[k] = false
          i += m.length
          took = true
        }
        break
      }
      // an opening marker: something not a space follows, and it is closed before the line ends
      const end = text.indexOf(m, i + m.length)
      const nl = text.indexOf('\n', i)
      const inner = end > i + m.length ? text.slice(i + m.length, end) : ''
      if (
        end > 0 &&
        (nl === -1 || end < nl) &&
        inner.trim() === inner &&
        inner.length > 0 &&
        // "_" inside a word (snake_case) is not italic
        !(m === '_' && i > 0 && /\w/.test(text[i - 1]))
      ) {
        flush()
        style[k] = true
        i += m.length
        took = true
      }
      break
    }
    if (!took) {
      buf += text[i]
      i++
    }
  }
  flush()
  return out
}

/** Whether a note has anything to draw beyond its plain text. */
export const hasMarks = (text: string): boolean => parseInline(text).some((r) => r.b || r.i || r.s)

/**
 * Ctrl+B (Ctrl+I, Ctrl+Shift+X) on the note being written: the selection wrapped in the marker, or unwrapped when it
 * already is (markers just inside or just outside it). With nothing selected, a pair is put in with the caret
 * between, ready to type into. Returns the new text and selection.
 */
export function toggleMark(
  value: string,
  start: number,
  end: number,
  marker: '**' | '_' | '~~'
): { value: string; start: number; end: number } {
  const n = marker.length
  const sel = value.slice(start, end)
  // the selection holds the markers itself
  if (sel.length >= 2 * n && sel.startsWith(marker) && sel.endsWith(marker))
    return {
      value: value.slice(0, start) + sel.slice(n, sel.length - n) + value.slice(end),
      start,
      end: end - 2 * n
    }
  // the markers sit just outside the selection
  if (value.slice(start - n, start) === marker && value.slice(end, end + n) === marker)
    return {
      value: value.slice(0, start - n) + sel + value.slice(end + n),
      start: start - n,
      end: end - n
    }
  // spaces at the selection's edges stay outside the markers (a double-clicked word takes its space)
  const lead = sel.length - sel.trimStart().length
  const trail = sel.length - sel.trimEnd().length
  const s = start + lead
  const e = Math.max(s, end - trail)
  return {
    value: value.slice(0, s) + marker + value.slice(s, e) + marker + value.slice(e),
    start: s + n,
    end: e + n
  }
}
