import { describe, expect, test } from 'bun:test'
import {
  chatgptAuthUrl,
  chatgptCodeBody,
  chatgptRefreshBody,
  challengeFor,
  checkCallback,
  checkIdClaims,
  decodeJwt,
  expiresAtFrom,
  hasPlanScope,
  isTerminalRefreshError,
  newToken,
  newVerifier,
  openrouterAuthUrl,
  REFRESH_MARGIN_MS,
  sameState,
  tokenAction,
  VERIFIER_CHARS
} from './oauth'

describe('PKCE', () => {
  test('the verifier uses only unreserved characters and is 43 to 128 long', () => {
    for (let i = 0; i < 20; i++) {
      const v = newVerifier()
      expect(VERIFIER_CHARS.test(v)).toBe(true)
      expect(v.length).toBeGreaterThanOrEqual(43)
      expect(v.length).toBeLessThanOrEqual(128)
    }
  })

  test('the challenge is S256 of the verifier (RFC 7636 appendix B vector)', () => {
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    )
  })

  test('verifiers and tokens are fresh each time', () => {
    expect(newVerifier()).not.toBe(newVerifier())
    expect(newToken()).not.toBe(newToken())
  })
})

describe('ChatGPT request', () => {
  const base = {
    hostId: 'host-1',
    redirectUri: 'http://127.0.0.1:5555/auth/callback',
    state: 's',
    nonce: 'n',
    challenge: 'c'
  }

  test('the first sign-in registers through the dynamic client', () => {
    const u = new URL(chatgptAuthUrl({ ...base, clientId: null }))
    expect(u.origin + u.pathname).toBe('https://auth.openai.com/api/accounts/authorize')
    const p = u.searchParams
    expect(p.get('client_id')).toBe('dynamic_agent_client')
    expect(p.get('agent_name_hint')).toBe('Panes')
    expect(p.get('ext_agent_host_id')).toBe('host-1')
    expect(p.get('response_type')).toBe('code')
    expect(p.get('redirect_uri')).toBe(base.redirectUri)
    expect(p.get('scope')).toBe(
      'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
    )
    expect(p.get('resource')).toBe('https://api.openai.com/v1')
    expect(p.get('code_challenge_method')).toBe('S256')
    expect(p.get('code_challenge')).toBe('c')
    expect(p.get('state')).toBe('s')
    expect(p.get('nonce')).toBe('n')
  })

  test('a returning sign-in uses the issued client and drops the name hint', () => {
    const u = new URL(
      chatgptAuthUrl({ ...base, clientId: 'oaiapp_x', idTokenHint: 'jwt', loginHint: 'a@b.c' })
    )
    expect(u.searchParams.get('client_id')).toBe('oaiapp_x')
    expect(u.searchParams.has('agent_name_hint')).toBe(false)
    expect(u.searchParams.get('id_token_hint')).toBe('jwt')
    expect(u.searchParams.get('login_hint')).toBe('a@b.c')
  })

  test('the code exchange carries the verifier, redirect and resource', () => {
    const b = chatgptCodeBody({
      clientId: 'oaiapp_x',
      code: 'abc',
      verifier: 'v',
      redirectUri: base.redirectUri
    })
    expect(b.get('grant_type')).toBe('authorization_code')
    expect(b.get('code_verifier')).toBe('v')
    expect(b.get('resource')).toBe('https://api.openai.com/v1')
    expect(b.has('client_secret')).toBe(false)
  })

  test('the refresh keeps the grant: no scope', () => {
    const b = chatgptRefreshBody('oaiapp_x', 'r1')
    expect(b.get('grant_type')).toBe('refresh_token')
    expect(b.get('refresh_token')).toBe('r1')
    expect(b.has('scope')).toBe(false)
  })

  test('refresh errors that are final versus passing', () => {
    for (const c of ['invalid_grant', 'refresh_token_reused', 'token_expired'])
      expect(isTerminalRefreshError(c)).toBe(true)
    expect(isTerminalRefreshError('temporarily_unavailable')).toBe(false)
    expect(isTerminalRefreshError(undefined)).toBe(false)
  })

  test('plan scope is detected as a whole word', () => {
    expect(hasPlanScope('openid chatgpt.tokens.use.direct')).toBe(true)
    expect(hasPlanScope('openid chatgpt.tokens.use.directx')).toBe(false)
    expect(hasPlanScope(null)).toBe(false)
  })
})

describe('OpenRouter request', () => {
  test('carries the callback, S256 challenge and state', () => {
    const u = new URL(
      openrouterAuthUrl({
        callbackUrl: 'http://localhost:4000/callback',
        challenge: 'c',
        state: 's'
      })
    )
    expect(u.origin + u.pathname).toBe('https://openrouter.ai/auth')
    expect(u.searchParams.get('callback_url')).toBe('http://localhost:4000/callback')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('code_challenge')).toBe('c')
    expect(u.searchParams.get('state')).toBe('s')
  })
})

describe('callback', () => {
  const q = (s: string): URLSearchParams => new URLSearchParams(s)

  test('state comparison', () => {
    expect(sameState('abc', 'abc')).toBe(true)
    expect(sameState('abc', 'abd')).toBe(false)
    expect(sameState('abc', 'ab')).toBe(false)
    expect(sameState('', '')).toBe(false)
  })

  test('a good callback gives the code, the issued client and the scope', () => {
    const r = checkCallback(q('code=C&state=S&client_id=oaiapp_1&scope=a+b'), 'S')
    expect(r).toEqual({ ok: true, code: 'C', clientId: 'oaiapp_1', scope: 'a b' })
  })

  test('a state mismatch is refused and the code is not used', () => {
    const r = checkCallback(q('code=C&state=other'), 'S')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('state')
  })

  test('a missing state is refused', () => {
    const r = checkCallback(q('code=C'), 'S')
    expect(r.ok).toBe(false)
  })

  test('access_denied is a cancel, after the state is checked', () => {
    const r = checkCallback(q('error=access_denied&state=S'), 'S')
    expect(r.ok === false && r.reason).toBe('cancelled')
    const forged = checkCallback(q('error=access_denied&state=nope'), 'S')
    expect(forged.ok === false && forged.reason).toBe('state')
  })

  test('OpenRouter denial without a state counts as a cancel only when allowed', () => {
    expect(checkCallback(q('error=denied'), 'S', { stateOptionalOnDenial: true })).toMatchObject({
      reason: 'cancelled'
    })
    expect(checkCallback(q('error=denied'), 'S')).toMatchObject({ reason: 'state' })
  })

  test('other errors and a missing code', () => {
    expect(checkCallback(q('error=server_error&state=S'), 'S')).toMatchObject({ reason: 'error' })
    expect(checkCallback(q('state=S'), 'S')).toMatchObject({ reason: 'no-code' })
  })
})

describe('token lifetime', () => {
  const now = 1_000_000_000
  test('a fresh token is used', () => {
    expect(tokenAction({ expiresAt: now + 3600_000 }, now)).toBe('use')
  })
  test('refresh starts a few minutes before expiry', () => {
    expect(tokenAction({ expiresAt: now + REFRESH_MARGIN_MS + 1 }, now)).toBe('use')
    expect(tokenAction({ expiresAt: now + REFRESH_MARGIN_MS }, now)).toBe('refresh')
    expect(tokenAction({ expiresAt: now - 10 }, now)).toBe('refresh')
  })
  test('a refresh token past its 30 days means sign in again', () => {
    const day = 24 * 3600_000
    expect(tokenAction({ expiresAt: now - 1, issuedAt: now - 29 * day }, now)).toBe('refresh')
    expect(tokenAction({ expiresAt: now - 1, issuedAt: now - 31 * day }, now)).toBe('sign-in')
  })
  test('expires_in turns into an absolute time', () => {
    expect(expiresAtFrom(now, 3600)).toBe(now + 3600_000)
    expect(expiresAtFrom(now, undefined)).toBe(now + 3600_000)
  })
})

describe('ID token', () => {
  const enc = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url')
  const jwt = (claims: object): string => `${enc({ alg: 'RS256' })}.${enc(claims)}.sig`
  const want = {
    issuer: 'https://auth.openai.com',
    clientId: 'oaiapp_1',
    nonce: 'N',
    now: 1000 * 1000
  }
  const good = { iss: 'https://auth.openai.com', aud: 'oaiapp_1', sub: 'u', exp: 2000, nonce: 'N' }

  test('decodes and rejects malformed tokens', () => {
    expect(decodeJwt(jwt({ sub: 'u' }))?.claims.sub).toBe('u')
    expect(decodeJwt('a.b')).toBeNull()
    expect(decodeJwt('x.y.z')).toBeNull()
  })

  test('accepts good claims, refuses each wrong one', () => {
    expect(checkIdClaims(good, want)).toBeNull()
    expect(checkIdClaims({ ...good, iss: 'https://evil' }, want)).not.toBeNull()
    expect(checkIdClaims({ ...good, aud: 'other' }, want)).not.toBeNull()
    expect(checkIdClaims({ ...good, aud: ['x', 'oaiapp_1'] }, want)).toBeNull()
    expect(checkIdClaims({ ...good, exp: 999 }, want)).not.toBeNull()
    expect(checkIdClaims({ ...good, nonce: 'bad' }, want)).not.toBeNull()
    expect(checkIdClaims({ ...good, sub: undefined }, want)).not.toBeNull()
  })
})
