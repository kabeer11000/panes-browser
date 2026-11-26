import * as Y from 'yjs'
import { MAX_SEND, safeFileName } from './transfer'

/**
 * A shared space's chat (tasks/shared-spaces.md, phase 8): messages in the room's document, so sealed end to end like
 * the board, kept by everyone in it and by the relay's log. Panes and the web board read and write it the same way.
 */
export interface ChatMessage {
  id: string
  name: string
  color: string
  text: string
  /** When it was written (ms, the writer's clock). */
  at: number
  /** The writer's document id (their session): a run of messages from one person is drawn as one. */
  by: number
  /**
   * A file they offer (renderer/fileSend.ts): fetched straight from their Panes while it is open (`by` finds them in
   * the room), never kept in the room. `text` says the same in words, for where files are not taken (the web board).
   */
  file?: ChatFile
}

export interface ChatFile {
  /** The offer's id, as its sender knows it. */
  id: string
  name: string
  size: number
}

/** A file offered in a message, checked; null for anything else. */
function cleanFile(v: unknown): ChatFile | null {
  const f = v as Record<string, unknown> | null
  if (!f || typeof f !== 'object') return null
  if (typeof f.id !== 'string' || !/^[0-9a-f-]{8,40}$/.test(f.id)) return null
  if (typeof f.name !== 'string' || !Number.isSafeInteger(f.size)) return null
  const size = f.size as number
  if (size < 0 || size > MAX_SEND) return null
  return { id: f.id, name: safeFileName(f.name), size }
}

/** How many a room keeps (older ones go as new ones come), and how long one may be. */
export const CHAT_KEEP = 500
export const CHAT_TEXT_MAX = 2000
/** How many are read out at a time (the latest). */
export const CHAT_SHOWN = 200

const chatArray = (doc: Y.Doc): Y.Array<unknown> => doc.getArray('chat')

/** One message from the document, checked (anyone in the room may write anything there); null for anything else. */
export function cleanMessage(v: unknown): ChatMessage | null {
  const o = v as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  if (typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{6,40}$/.test(o.id)) return null
  if (typeof o.text !== 'string' || !o.text.trim()) return null
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return null
  const file = o.file === undefined ? null : cleanFile(o.file)
  return {
    ...(file ? { file } : {}),
    id: o.id,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.slice(0, 40) : 'Someone',
    color: typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#888888',
    text: o.text.slice(0, CHAT_TEXT_MAX),
    at: o.at,
    by: typeof o.by === 'number' && Number.isSafeInteger(o.by) ? o.by : 0
  }
}

/** The latest messages, oldest first. */
export function chatOf(doc: Y.Doc, shown = CHAT_SHOWN): ChatMessage[] {
  const all = chatArray(doc).toArray()
  const out: ChatMessage[] = []
  for (let i = Math.max(0, all.length - shown); i < all.length; i++) {
    const m = cleanMessage(all[i])
    if (m) out.push(m)
  }
  return out
}

const newId = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(9))
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

/** Say something in the room: added in one transaction, the oldest dropped past CHAT_KEEP. Null when it was empty. */
export function sayIn(
  doc: Y.Doc,
  who: { name: string; color: string },
  text: string,
  origin?: unknown,
  now = Date.now(),
  file?: ChatFile
): ChatMessage | null {
  const t = text.trim().slice(0, CHAT_TEXT_MAX)
  if (!t) return null
  const f = file ? cleanFile(file) : null
  if (file && !f) return null
  const msg: ChatMessage = {
    ...(f ? { file: f } : {}),
    id: newId(),
    name: who.name.slice(0, 40) || 'Someone',
    color: who.color,
    text: t,
    at: now,
    by: doc.clientID
  }
  const arr = chatArray(doc)
  doc.transact(() => {
    arr.push([msg])
    if (arr.length > CHAT_KEEP) arr.delete(0, arr.length - CHAT_KEEP)
  }, origin)
  return msg
}

/** How many messages came after `seen` (a message id) from others; all of theirs when `seen` is not among them. */
export function unreadAfter(messages: ChatMessage[], seen: string | null, me: number): number {
  const i = seen ? messages.findIndex((m) => m.id === seen) : -1
  return messages.slice(i + 1).filter((m) => m.by !== me).length
}

/** Watch a room's chat: called with the latest messages now and after every change. */
export function watchChat(doc: Y.Doc, cb: (messages: ChatMessage[]) => void): () => void {
  const arr = chatArray(doc)
  const on = (): void => cb(chatOf(doc))
  arr.observe(on)
  on()
  return () => arr.unobserve(on)
}
