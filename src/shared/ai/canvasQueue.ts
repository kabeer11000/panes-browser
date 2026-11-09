/**
 * Messages typed while the assistant is still working wait in a queue and run one after another, each with the whole
 * conversation as it is by then. Pure: the queue is a plain list and every change returns a new one.
 */
export interface QueueItem {
  id: string
  text: string
}

export const QUEUE_MAX = 8
export const QUEUE_TEXT_MAX = 600

const clean = (t: string): string => t.replace(/\s+/g, ' ').trim().slice(0, QUEUE_TEXT_MAX)

export function enqueue(q: readonly QueueItem[], text: string, id: string): QueueItem[] {
  const t = clean(text)
  if (!t || q.length >= QUEUE_MAX) return q.slice()
  return [...q, { id, text: t }]
}

/** The next message to run, and what is left. */
export function dequeue(q: readonly QueueItem[]): { next: QueueItem | null; rest: QueueItem[] } {
  return q.length ? { next: q[0], rest: q.slice(1) } : { next: null, rest: [] }
}

/** Change a waiting message; an empty text removes it. */
export function editItem(q: readonly QueueItem[], id: string, text: string): QueueItem[] {
  const t = clean(text)
  if (!q.some((i) => i.id === id)) return q.slice()
  return t ? q.map((i) => (i.id === id ? { ...i, text: t } : i)) : q.filter((i) => i.id !== id)
}

export const removeItem = (q: readonly QueueItem[], id: string): QueueItem[] =>
  q.filter((i) => i.id !== id)

/** Move a waiting message to a place in the line (0 is next). */
export function reorder(q: readonly QueueItem[], id: string, to: number): QueueItem[] {
  const from = q.findIndex((i) => i.id === id)
  if (from < 0) return q.slice()
  const out = q.filter((i) => i.id !== id)
  out.splice(Math.max(0, Math.min(out.length, to)), 0, q[from])
  return out
}

export const clearQueue = (): QueueItem[] => []

/**
 * Stop cancels only the turn that is running: the queue is untouched and its first message runs next.
 * "Clear queue" is the way to drop the rest.
 */
export function afterStop(q: readonly QueueItem[]): { next: QueueItem | null; rest: QueueItem[] } {
  return dequeue(q)
}

/** A short line saying what waits. */
export const queueLabel = (n: number): string =>
  n === 0 ? '' : n === 1 ? '1 message waiting' : `${n} messages waiting`
