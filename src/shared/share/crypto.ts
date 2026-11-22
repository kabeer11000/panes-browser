/**
 * End-to-end encryption for shared spaces (tasks/shared-spaces.md). The invite link carries a secret after its `#`
 * (never sent to any server). From it come two keys: one encrypts every change and every cursor move (AES-GCM), one
 * proves to the relay that a person may be in the room. The relay keeps and passes on ciphertext only.
 *
 * WebCrypto only: the same code runs in Panes (main and pages) and in the web board.
 */

const enc = new TextEncoder()

/** base64url, no padding: what goes in a link. */
export function toB64u(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64u(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** A new room: its id (public, in the path) and its secret (private, after the #). */
export function newRoom(): { room: string; secret: string } {
  const r = crypto.getRandomValues(new Uint8Array(16))
  const s = crypto.getRandomValues(new Uint8Array(32))
  return { room: toB64u(r), secret: toB64u(s) }
}

/** The invite link for a room on a relay. */
export function inviteLink(relay: string, room: string, secret: string): string {
  return `${relay.replace(/\/+$/, '')}/s/${room}#${secret}`
}

/** A link's room and secret, or null when it is not an invite. */
export function parseInvite(link: string): { relay: string; room: string; secret: string } | null {
  let u: URL
  try {
    u = new URL(link.trim())
  } catch {
    return null
  }
  const m = /^\/s\/([A-Za-z0-9_-]{16,64})\/?$/.exec(u.pathname)
  const secret = u.hash.slice(1)
  if (!m || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null
  if (
    u.protocol !== 'https:' &&
    !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))
  )
    return null
  return { relay: u.origin, room: m[1], secret }
}

export interface RoomKeys {
  /** Encrypts and decrypts every message of the room. */
  key: CryptoKey
  /** Shown to the relay to be let in (it cannot decrypt anything with it). */
  token: string
}

/** The room's keys from its secret: the same for everyone with the link. */
export async function roomKeys(room: string, secret: string): Promise<RoomKeys> {
  const ikm = await crypto.subtle.importKey('raw', fromB64u(secret), 'HKDF', false, [
    'deriveKey',
    'deriveBits'
  ])
  const info = (what: string): BufferSource => enc.encode(`panes-share/${what}/${room}`)
  const salt = enc.encode('panes-share/v1')
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: info('key') },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: info('token') },
    ikm,
    256
  )
  return { key, token: toB64u(new Uint8Array(bits)) }
}

/** One message sealed: a fresh 12-byte nonce, then the ciphertext with its tag. */
export async function seal(key: CryptoKey, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain.slice())
  )
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return out
}

/** A sealed message opened, or null when it was not made with this room's key (or was changed on the way). */
export async function open(key: CryptoKey, sealed: Uint8Array): Promise<Uint8Array | null> {
  if (sealed.length < 12 + 16) return null
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.slice(0, 12) },
      key,
      sealed.slice(12)
    )
    return new Uint8Array(plain)
  } catch {
    return null
  }
}
