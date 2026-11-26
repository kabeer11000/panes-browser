import { describe, expect, test } from 'bun:test'
import { fromJoin, joinLink, joinVerdict, serverOrigin, turnServer } from './servers'

describe('serverOrigin', () => {
  test('https addresses, with or without the scheme, as their origin', () => {
    expect(serverOrigin('https://share.example.com/s/abc')).toBe('https://share.example.com')
    expect(serverOrigin(' share.example.com ')).toBe('https://share.example.com')
    expect(serverOrigin('https://share.example.com:8443')).toBe('https://share.example.com:8443')
  })
  test('plain http only on this computer', () => {
    expect(serverOrigin('http://localhost:8787')).toBe('http://localhost:8787')
    expect(serverOrigin('http://share.example.com')).toBeNull()
  })
  test('refuses junk and addresses with a login in them', () => {
    expect(serverOrigin('')).toBeNull()
    expect(serverOrigin('ftp://x.com')).toBeNull()
    expect(serverOrigin('https://user:pw@x.com')).toBeNull()
    expect(serverOrigin('javascript:alert(1)')).toBeNull()
  })
})

describe('joinVerdict', () => {
  const own = 'https://panes-share.onrender.com'
  const known = ['https://mine.example.com']
  test("Panes' own and known servers join at once, whatever the policy", () => {
    for (const policy of ['ask', 'any', 'listed'] as const) {
      expect(joinVerdict(own, { own, known, policy })).toBe('join')
      expect(joinVerdict(known[0]!, { own, known, policy })).toBe('join')
    }
  })
  test('another server: as the policy says', () => {
    const s = 'https://other.example.com'
    expect(joinVerdict(s, { own, known, policy: 'ask' })).toBe('ask')
    expect(joinVerdict(s, { own, known, policy: 'any' })).toBe('join')
    expect(joinVerdict(s, { own, known, policy: 'listed' })).toBe('refuse')
  })
})

describe('turnServer', () => {
  test('a turn: or turns: address with its login', () => {
    expect(
      turnServer({ url: 'turn:turn.example.com:3478', username: 'u', credential: 'p' })
    ).toEqual({
      urls: 'turn:turn.example.com:3478',
      username: 'u',
      credential: 'p'
    })
    expect(
      turnServer({ url: 'turns:t.example.com:5349?transport=tcp', username: '', credential: '' })
        ?.urls
    ).toBe('turns:t.example.com:5349?transport=tcp')
  })
  test('anything else is not one', () => {
    expect(turnServer(null)).toBeNull()
    expect(turnServer({ url: 'https://x.com', username: 'u', credential: 'p' })).toBeNull()
    expect(turnServer({ url: 'turn:x.com/../y', username: 'u', credential: 'p' })).toBeNull()
  })
})

describe('fromJoin', () => {
  const own = 'https://panes-share.onrender.com'
  const room = 'a'.repeat(22)
  const secret = 'b'.repeat(43)
  test('an older Open in Panes link is on Panes own server', () => {
    expect(fromJoin(`panes://join/${room}#${secret}`, own)).toBe(`${own}/s/${room}#${secret}`)
  })
  test('one from a web board on another server is on that server', () => {
    const link = joinLink('https://share.example.com', room, secret)
    expect(fromJoin(link, own)).toBe(`https://share.example.com/s/${room}#${secret}`)
  })
  test('a server that is not one gives no link', () => {
    expect(
      fromJoin(`panes://join/${room}?s=${encodeURIComponent('http://evil.com')}#${secret}`, own)
    ).toBe('')
    expect(fromJoin(`panes://join/${room}?s=%E0%A4%A#${secret}`, own)).toBe('')
  })
  test('other links pass through', () => {
    expect(fromJoin(' https://x.com/s/abc ', own)).toBe('https://x.com/s/abc')
  })
})
