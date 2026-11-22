/**
 * The relay's messages (share/server and the clients in Panes and the web board). Binary frames: one type byte, then
 * the payload. Everything a person writes is sealed (crypto.ts) before it gets here: the relay sees sizes and times,
 * never contents.
 *
 * Joining: a WebSocket to /sync/<room>?token=<room token>; its first message is the text `have:<n>`, the last log
 * number this client holds.
 *   relay -> WELCOME { you, peers }, then each LOG entry after `have`, then SYNCED.
 * After that:
 *   client -> UPDATE <sealed change>           relay stores it as the next LOG entry, sends it to everyone else,
 *                                              and ACK <its number> to the sender
 *   client -> AWARE <sealed cursor/presence>   relay passes it on as AWARE <from> <...>, never stores it
 *   client -> SNAPSHOT <upTo> <sealed state>   relay puts it in place of the log up to upTo (the relay cannot
 *                                              compact what it cannot read)
 *   client -> SIGNAL <to> <sealed>             relay passes it to that one person as SIGNAL <from> <...> (WebRTC)
 *   relay  -> PEER { join | leave }            someone came or went
 *   relay  -> COMPACT                          the log is long: whoever can, send a SNAPSHOT
 */

export const T = {
  UPDATE: 1,
  AWARE: 2,
  SNAPSHOT: 3,
  ACK: 4,
  SIGNAL: 5,
  WELCOME: 6,
  SYNCED: 7,
  PEER: 8,
  COMPACT: 9,
  LOG: 10
} as const
export type MsgType = (typeof T)[keyof typeof T]

/** Bigger than any one change of a board (pictures go up as blobs, not in the log). */
export const MAX_MESSAGE = 2 * 1024 * 1024
/** A picture, sealed. */
export const MAX_BLOB = 5 * 1024 * 1024 + 64
/** Past this many log entries the relay asks for a snapshot. */
export const COMPACT_AFTER = 400
/** People in one room at once. */
export const MAX_PEERS = 32

export interface Welcome {
  you: number
  peers: number[]
}
export interface PeerEvent {
  join?: number
  leave?: number
}

/** A frame: its type byte, then numbers (u32, big-endian) if any, then the rest. */
export function frame(type: MsgType, nums: readonly number[], rest?: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + nums.length * 4 + (rest?.length ?? 0))
  out[0] = type
  const v = new DataView(out.buffer)
  nums.forEach((n, i) => v.setUint32(1 + i * 4, n >>> 0))
  if (rest) out.set(rest, 1 + nums.length * 4)
  return out
}

/** A frame read back: its type, `count` numbers, and the rest; null when it is too short to hold them. */
export function unframe(
  data: Uint8Array,
  count = 0
): { type: number; nums: number[]; rest: Uint8Array } | null {
  if (data.length < 1 + count * 4) return null
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const nums: number[] = []
  for (let i = 0; i < count; i++) nums.push(v.getUint32(1 + i * 4))
  return { type: data[0], nums, rest: data.subarray(1 + count * 4) }
}

const te = new TextEncoder()
const td = new TextDecoder()
export const jsonFrame = (type: MsgType, value: unknown): Uint8Array =>
  frame(type, [], te.encode(JSON.stringify(value)))
export function jsonOf<V>(rest: Uint8Array): V | null {
  try {
    return JSON.parse(td.decode(rest)) as V
  } catch {
    return null
  }
}

/** How many numbers each type carries ahead of its payload. */
export const NUMS: Record<number, number> = {
  [T.UPDATE]: 0,
  [T.AWARE]: 1, // from (relay -> client); a client sends 0 and the relay adds it
  [T.SNAPSHOT]: 1, // upTo
  [T.ACK]: 1, // log number
  [T.SIGNAL]: 1, // to (client -> relay) or from (relay -> client)
  [T.WELCOME]: 0,
  [T.SYNCED]: 0,
  [T.PEER]: 0,
  [T.COMPACT]: 0,
  [T.LOG]: 1 // log number
}
