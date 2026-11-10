/**
 * A long page cut for a small context: its opening (the same whatever is asked, so a model server can keep it read
 * between questions) plus the passages further down that match the question best (BM25 on words; no model, a few
 * milliseconds even for a long article). A question with no telling words ("summarise this") gets passages spread
 * evenly over the rest instead.
 */

const CHUNK = 600
const K1 = 1.2
const B = 0.75

// words that say nothing about where the answer is, in the languages people most often ask in
const STOP = new Set(
  (
    'a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those ' +
    'what which who whom whose when where why how do does did can could should would will shall may might must ' +
    'i me my you your we our they them their he him his she her about into than then there here so not no yes ' +
    'tell say says said page article tab text post site please summarise summarize summary explain mean means ' +
    'der die das und ist ein eine le la les et est un une el los las es y que de du des'
  ).split(' ')
)

export const words = (s: string): string[] =>
  (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOP.has(w))

/** Where to end a piece of `s`: after its last line or sentence end in the second half, else at its end. */
function breakAt(s: string): number {
  const half = Math.floor(s.length / 2)
  const tail = s.slice(half)
  const para = tail.lastIndexOf('\n')
  if (para >= 0) return half + para + 1
  const sentence = Math.max(tail.lastIndexOf('. '), tail.lastIndexOf('? '), tail.lastIndexOf('! '))
  return sentence >= 0 ? half + sentence + 2 : s.length
}

/** The text in pieces of about `size` characters, broken at line or sentence ends where there is one. */
export function chunks(text: string, size = CHUNK): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length;) {
    const window = text.slice(i, i + size)
    const end = i + (i + size < text.length ? breakAt(window) : window.length)
    const piece = text.slice(i, end).trim()
    if (piece) out.push(piece)
    i = end
  }
  return out
}

/** BM25 score of each chunk for the question's words. */
export function scores(pieces: readonly string[], question: string): number[] {
  const q = [...new Set(words(question))]
  if (q.length === 0) return pieces.map(() => 0)
  const docs = pieces.map((p) => {
    const tf = new Map<string, number>()
    const ws = words(p)
    for (const w of ws) tf.set(w, (tf.get(w) ?? 0) + 1)
    return { tf, len: ws.length }
  })
  const avg = docs.reduce((n, d) => n + d.len, 0) / Math.max(1, docs.length) || 1
  const idf = new Map(
    q.map((w) => {
      const n = docs.filter((d) => d.tf.has(w)).length
      return [w, Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))]
    })
  )
  return docs.map((d) =>
    q.reduce((sum, w) => {
      const f = d.tf.get(w) ?? 0
      return f
        ? sum + (idf.get(w) ?? 0) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avg)))
        : sum
    }, 0)
  )
}

export interface PageCut {
  /** The opening, cut at a paragraph or sentence end. The whole text when it fits `cap`. */
  lead: string
  /** Passages from after the opening, in page order, joined by "\n...\n". Empty when the page fits. */
  extra: string
  cut: boolean
}

/**
 * Cut `text` to about `cap` characters: `leadShare` of it is the opening, the rest the best passages for `question`
 * from what follows.
 */
export function cutPage(text: string, question: string, cap: number, leadShare = 0.7): PageCut {
  const t = text.trim()
  if (t.length <= cap) return { lead: t, extra: '', cut: false }
  const end = breakAt(t.slice(0, Math.floor(cap * leadShare)))
  const lead = t.slice(0, end).trim()
  const room = cap - lead.length
  // pieces no bigger than half the room, so a small share (several tabs attached) still gets passages
  const size = Math.max(120, Math.min(CHUNK, Math.floor(room / 2)))
  const rest = chunks(t.slice(end), size)
  const s = scores(rest, question)
  const matched = s.some((x) => x > 0)
  // no telling words: spread over the page, so a summary sees its middle and end too
  const order = matched
    ? rest
        .map((_, i) => i)
        .sort((a, b) => s[b] - s[a] || a - b)
        .filter((i) => s[i] > 0)
    : spread(rest.length, Math.max(1, Math.floor(room / size)))
  const picked: number[] = []
  let used = 0
  for (const i of order) {
    if (used + rest[i].length + 5 > room) continue
    picked.push(i)
    used += rest[i].length + 5
  }
  picked.sort((a, b) => a - b)
  return { lead, extra: picked.map((i) => rest[i]).join('\n...\n'), cut: true }
}

/** `n` indexes spread evenly over `length` items. */
function spread(length: number, n: number): number[] {
  if (length <= n) return [...Array(length).keys()]
  return [...Array(n).keys()].map((k) => Math.floor(((k + 0.5) * length) / n))
}
