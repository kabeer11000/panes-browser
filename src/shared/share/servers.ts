/**
 * Shared spaces on servers other than Panes' own (share/server is one file anyone can run): which server a new space
 * goes to, whether a link to someone else's may be joined, and a TURN server of the person's own. Pure: main/share.ts
 * and the settings page use it.
 */

/** A server address as typed: its origin (https, or http on this computer for testing); null for anything else. */
export function serverOrigin(raw: string): string | null {
  let u: URL
  try {
    u = new URL(raw.trim().includes('://') ? raw.trim() : `https://${raw.trim()}`)
  } catch {
    return null
  }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null
  if (u.username || u.password || !u.hostname) return null
  return u.origin
}

/** What to do with a link to a space on a server not added here: ask once, join, or only join added ones. */
export type ServerPolicy = 'ask' | 'any' | 'listed'

/**
 * Whether a space on `server` (an origin) may be joined: at once, after asking, or not. Panes' own server and ones
 * added here (or said yes to) are always fine.
 */
export function joinVerdict(
  server: string,
  o: { own: string; known: readonly string[]; policy: ServerPolicy }
): 'join' | 'ask' | 'refuse' {
  if (server === o.own || o.known.includes(server)) return 'join'
  return o.policy === 'any' ? 'join' : o.policy === 'ask' ? 'ask' : 'refuse'
}

/** A TURN server of the person's own, as set: checked; null when it is not one. */
export interface OwnTurn {
  url: string
  username: string
  credential: string
}
export function turnServer(t: OwnTurn | null | undefined): RTCIceServer | null {
  if (!t || typeof t.url !== 'string') return null
  const url = t.url.trim()
  if (!/^turns?:[^\s/?#]+(:\d{1,5})?(\?transport=(udp|tcp))?$/i.test(url)) return null
  const username = typeof t.username === 'string' ? t.username.slice(0, 200) : ''
  const credential = typeof t.credential === 'string' ? t.credential.slice(0, 200) : ''
  return { urls: url, username, credential }
}

/**
 * panes://join/<room>?s=<server>#<secret> (a web board's Open in Panes) as the invite link it stands for, on that
 * server; with no `s` (older pages), on Panes' own (`own`). Any other link as it is.
 */
export function fromJoin(link: string, own: string): string {
  const m = /^panes:\/\/join\/([A-Za-z0-9_-]{16,64})(?:\?s=([^#]{1,300}))?(#.*)?$/i.exec(
    link.trim()
  )
  if (!m) return link.trim()
  let server = own
  if (m[2]) {
    let raw: string
    try {
      raw = decodeURIComponent(m[2])
    } catch {
      return ''
    }
    const o = serverOrigin(raw)
    if (!o) return ''
    server = o
  }
  return `${server}/s/${m[1]}${m[3] ?? ''}`
}

/** The panes:// link a web board on `server` offers as Open in Panes. */
export const joinLink = (server: string, room: string, secret: string): string =>
  `panes://join/${room}?s=${encodeURIComponent(server)}#${secret}`
