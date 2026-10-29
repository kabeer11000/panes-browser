import { describe, expect, test } from 'bun:test'
import { loginsFromCsv, loginsToCsv, parseCsv, toCsv } from './csv'
import {
  classify,
  generatePassword,
  loginOutcome,
  normalizeOrigin,
  usernameFieldIndex
} from './passwords'

describe('classify', () => {
  const saved = [{ username: 'ana', password: 'pw1' }]
  test('a new account is saved', () => expect(classify(saved, 'bob', 'x')).toBe('save'))
  test('the same login changes nothing', () => expect(classify(saved, 'ana', 'pw1')).toBe('same'))
  test('a new password for a known account is an update', () =>
    expect(classify(saved, 'ana', 'pw2')).toBe('update'))
  test('nothing saved yet', () => expect(classify([], 'ana', 'pw1')).toBe('save'))
})

describe('normalizeOrigin', () => {
  test('reduces a page address to its site', () => {
    expect(normalizeOrigin('https://Example.com/login?x=1#top')).toBe('https://example.com')
    expect(normalizeOrigin('http://localhost:3000/a')).toBe('http://localhost:3000')
  })
  test('adds https to a bare domain', () =>
    expect(normalizeOrigin('github.com')).toBe('https://github.com'))
  test('only web addresses qualify', () => {
    expect(normalizeOrigin('')).toBeNull()
    expect(normalizeOrigin('chrome://settings')).toBeNull()
    expect(normalizeOrigin('file:///a/b')).toBeNull()
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull()
  })
  test('different ports are different sites', () =>
    expect(normalizeOrigin('http://a.test:1')).not.toBe(normalizeOrigin('http://a.test:2')))
})

describe('generatePassword', () => {
  // a small deterministic source: fine for checking shape, never used for real passwords
  const seeded = (seed: number) => {
    let s = seed
    return (max: number): number => {
      s = (s * 1664525 + 1013904223) >>> 0
      return s % max
    }
  }
  test('has the requested length and every kind of character', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const p = generatePassword(seeded(seed), 20)
      expect(p).toHaveLength(20)
      expect(p).toMatch(/[a-z]/)
      expect(p).toMatch(/[A-Z]/)
      expect(p).toMatch(/[0-9]/)
      expect(p).toMatch(/[^A-Za-z0-9]/)
    }
  })
  test('avoids look-alike characters', () => {
    for (let seed = 1; seed <= 50; seed++)
      expect(generatePassword(seeded(seed))).not.toMatch(/[lIO01]/)
  })
  test('different randomness gives different passwords', () => {
    expect(generatePassword(seeded(1))).not.toBe(generatePassword(seeded(2)))
  })
})

describe('csv', () => {
  test('parses quotes, commas, doubled quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x,y","he said ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x,y', 'he said "hi"']
    ])
  })
  test('keeps newlines inside quotes and drops blank lines', () => {
    expect(parseCsv('a,b\n\n"l1\nl2",c')).toEqual([
      ['a', 'b'],
      ['l1\nl2', 'c']
    ])
  })
  test('toCsv round-trips through parseCsv', () => {
    const rows = [
      ['n', 'v'],
      ['a,b', 'q"r'],
      ['', 'x\ny']
    ]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
})

describe('loginsFromCsv', () => {
  test('reads a Chrome export', () => {
    const { rows, skipped } = loginsFromCsv(
      'name,url,username,password,note\nGitHub,https://github.com/login,ana,s3cret,\n'
    )
    expect(rows).toEqual([{ origin: 'https://github.com', username: 'ana', password: 's3cret' }])
    expect(skipped).toBe(0)
  })
  test('reads Bitwarden and 1Password style headers', () => {
    expect(
      loginsFromCsv('login_uri,login_username,login_password\nexample.com,bob,pw\n').rows[0]
    ).toEqual({ origin: 'https://example.com', username: 'bob', password: 'pw' })
    expect(loginsFromCsv('Title,URL,Username,Password\nT,https://a.test,u,p\n').rows).toHaveLength(
      1
    )
  })
  test('skips rows with no site or no password, and unrecognised files', () => {
    const r = loginsFromCsv(
      'url,username,password\nnot a site,u,p\nhttps://a.test,u,\nhttps://b.test,u,p\n'
    )
    expect(r.rows).toHaveLength(1)
    expect(r.skipped).toBe(2)
    expect(loginsFromCsv('foo,bar\n1,2\n').rows).toHaveLength(0)
  })
  test('export then import keeps every login', () => {
    const rows = [
      { origin: 'https://a.test', username: 'u,1', password: 'p"1' },
      { origin: 'http://b.test:8080', username: '', password: 'p2' }
    ]
    expect(loginsFromCsv(loginsToCsv(rows)).rows).toEqual(rows)
  })
})

describe('usernameFieldIndex', () => {
  const f = (type: string, autocomplete = ''): { type: string; autocomplete: string } => ({
    type,
    autocomplete
  })
  test('takes the closest text field before the password', () =>
    expect(usernameFieldIndex([f('text'), f('email'), f('password')], 2)).toBe(1))
  test('skips checkboxes and hidden inputs', () =>
    expect(usernameFieldIndex([f('email'), f('checkbox'), f('hidden'), f('password')], 3)).toBe(0))
  test('ignores fields after the password', () =>
    expect(usernameFieldIndex([f('password'), f('text')], 0)).toBe(-1))
  test('prefers a field marked as the username', () =>
    expect(usernameFieldIndex([f('text', 'username'), f('text', 'off'), f('password')], 2)).toBe(0))
  test('a lone password field has no username', () =>
    expect(usernameFieldIndex([f('password')], 0)).toBe(-1))
})

describe('loginOutcome', () => {
  test('a password box that is gone means the login took', () => {
    expect(loginOutcome({ password: false, error: false }, false)).toBe('success')
  })
  test('a complaint on the page fails at once, even with the box gone', () => {
    expect(loginOutcome({ password: true, error: true }, false)).toBe('failed')
    expect(loginOutcome({ password: false, error: true }, false)).toBe('failed')
  })
  test('a box still showing is given time, then counts as a failure', () => {
    expect(loginOutcome({ password: true, error: false }, false)).toBe('pending')
    expect(loginOutcome({ password: true, error: false }, true)).toBe('failed')
  })
})
