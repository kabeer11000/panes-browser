import { describe, expect, test } from 'bun:test'
import { fromB64u, inviteLink, newRoom, open, parseInvite, roomKeys, seal, toB64u } from './crypto'

describe('shared space encryption', () => {
  test('base64url round trip, any bytes', () => {
    for (const n of [0, 1, 2, 3, 31, 32, 33, 255]) {
      const b = crypto.getRandomValues(new Uint8Array(n))
      expect(fromB64u(toB64u(b))).toEqual(b)
      expect(toB64u(b)).not.toMatch(/[+/=]/)
    }
  })

  test('an invite link carries the room in its path and the secret after the #', () => {
    const { room, secret } = newRoom()
    const link = inviteLink('https://share.example.com/', room, secret)
    expect(link).toBe(`https://share.example.com/s/${room}#${secret}`)
    expect(parseInvite(link)).toEqual({ relay: 'https://share.example.com', room, secret })
  })

  test('what is not an invite is refused', () => {
    const { room, secret } = newRoom()
    expect(parseInvite('not a link')).toBeNull()
    expect(parseInvite(`https://x.example/s/${room}`)).toBeNull() // no secret
    expect(parseInvite(`https://x.example/s/${room}#short`)).toBeNull()
    expect(parseInvite(`http://x.example/s/${room}#${secret}`)).toBeNull() // plain http, not local
    expect(parseInvite(`http://localhost:8787/s/${room}#${secret}`)).not.toBeNull() // a relay run here
  })

  test('everyone with the link gets the same keys; another room or secret does not', async () => {
    const { room, secret } = newRoom()
    const a = await roomKeys(room, secret)
    const b = await roomKeys(room, secret)
    expect(a.token).toBe(b.token)
    const msg = new TextEncoder().encode('hello board')
    expect(await open(b.key, await seal(a.key, msg))).toEqual(msg)
    const other = await roomKeys(newRoom().room, secret)
    expect(other.token).not.toBe(a.token)
    expect(await open(other.key, await seal(a.key, msg))).toBeNull()
  })

  test('a changed byte is caught; the same message seals differently each time', async () => {
    const { room, secret } = newRoom()
    const { key } = await roomKeys(room, secret)
    const msg = new TextEncoder().encode('note: buy milk')
    const s1 = await seal(key, msg)
    const s2 = await seal(key, msg)
    expect(toB64u(s1)).not.toBe(toB64u(s2))
    const bad = s1.slice()
    bad[bad.length - 1] ^= 1
    expect(await open(key, bad)).toBeNull()
    expect(await open(key, new Uint8Array(5))).toBeNull()
  })
})
