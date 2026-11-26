/**
 * Sending a file straight to someone in a shared space (WebRTC, nothing kept at the relay): what travels between the
 * two, checked where it lands. The signals go through the room's relay, sealed like everything else, beside a live
 * tab's (k 'f' keeps them apart: a live tab's side ignores it).
 */

/** Signals for one file, `id` made by the sender. */
export type FileSignal =
  /** The sender offers a file: its name and size in bytes. */
  | { k: 'f'; id: string; o: 'ask'; name: string; size: number }
  /** Fetch a file offered in the chat (`file`, the offer's id) as this transfer (`id`). */
  | { k: 'f'; id: string; o: 'get'; file: string }
  /** The person asked said yes or no; either side gave up (`cancel`). */
  | { k: 'f'; id: string; o: 'yes' | 'no' | 'cancel' }
  | { k: 'f'; id: string; o: 'sdp'; sdp: { type: 'offer' | 'answer'; sdp: string } }
  | {
      k: 'f'
      id: string
      o: 'ice'
      c: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }
    }

/** One piece of the file on the data channel (SCTP takes up to 256 KB; this is safe everywhere). */
export const CHUNK = 64 * 1024
/** The biggest file offered or taken. */
export const MAX_SEND = 64 * 1024 ** 3
/** How long an offer waits for its answer. */
export const ASK_MS = 120_000

const ID = /^[0-9a-f-]{8,40}$/

/** A file signal from the wire, checked; null for anything else (a live tab's signals, junk). */
export function parseFileSignal(v: unknown): FileSignal | null {
  const o = v as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || o.k !== 'f' || typeof o.id !== 'string' || !ID.test(o.id))
    return null
  const id = o.id
  if (o.o === 'ask') {
    if (typeof o.name !== 'string' || !Number.isSafeInteger(o.size)) return null
    const size = o.size as number
    if (size < 0 || size > MAX_SEND) return null
    return { k: 'f', id, o: 'ask', name: safeFileName(o.name), size }
  }
  if (o.o === 'get')
    return typeof o.file === 'string' && ID.test(o.file)
      ? { k: 'f', id, o: 'get', file: o.file }
      : null
  if (o.o === 'yes' || o.o === 'no' || o.o === 'cancel') return { k: 'f', id, o: o.o }
  if (o.o === 'sdp') {
    const sdp = o.sdp as Record<string, unknown> | null
    if (!sdp || (sdp.type !== 'offer' && sdp.type !== 'answer') || typeof sdp.sdp !== 'string')
      return null
    return { k: 'f', id, o: 'sdp', sdp: { type: sdp.type, sdp: sdp.sdp } }
  }
  if (o.o === 'ice') {
    const c = o.c as Record<string, unknown> | null
    if (!c || typeof c.candidate !== 'string') return null
    return {
      k: 'f',
      id,
      o: 'ice',
      c: {
        candidate: c.candidate,
        sdpMid: typeof c.sdpMid === 'string' ? c.sdpMid : null,
        sdpMLineIndex: typeof c.sdpMLineIndex === 'number' ? c.sdpMLineIndex : null
      }
    }
  }
  return null
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

/**
 * A name from the other side made safe to save under: no folders (only the last part of a path), no characters a file
 * system refuses or that hide what it is (controls, bidi overrides), no trailing dots or spaces, not a device name,
 * and not too long (the extension is kept). "file" when nothing is left.
 */
export function safeFileName(raw: string): string {
  let name = raw.split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f<>:"|?*\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
  name = name.trim().replace(/[. ]+$/, '')
  if (!name || /^\.+$/.test(name)) return 'file'
  if (RESERVED.test(name)) name = '_' + name
  if (name.length > 120) {
    const ext = /\.[a-z0-9]{1,8}$/i.exec(name)?.[0] ?? ''
    name = name.slice(0, 120 - ext.length) + ext
  }
  return name
}
