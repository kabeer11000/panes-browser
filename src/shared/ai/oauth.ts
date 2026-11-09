/**
 * The pure parts of the sign-in flows: PKCE, the state check, the authorization URLs, reading a callback, and
 * deciding when a token is due for a refresh. Nothing here touches the network or Electron.
 * Values follow the vendors' own documentation:
 *   ChatGPT:     https://developers.openai.com/siwc/token-sharing-open-source/sign-in
 *   OpenRouter:  https://openrouter.ai/docs/use-cases/oauth-pkce
 */
import { createHash, randomBytes } from 'crypto'

// ---- PKCE (RFC 7636) ----

/** The characters a code verifier may hold (RFC 7636 section 4.1). */
export const VERIFIER_CHARS = /^[A-Za-z0-9\-._~]+$/

/** 32 random bytes as base64url: 43 characters, the minimum the RFC allows. */
export function newVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/** BASE64URL(SHA256(verifier)), no padding. */
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest().toString('base64url')
}

/** A fresh random value for `state` or `nonce`. */
export function newToken(): string {
  return randomBytes(24).toString('base64url')
}

// ---- Sign in with ChatGPT ----

export const CHATGPT_AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize'
export const CHATGPT_TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token'
export const CHATGPT_DISCOVERY_URL = 'https://auth.openai.com/.well-known/openid-configuration'
export const CHATGPT_ISSUER = 'https://auth.openai.com'
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1'
/** The open-source self-serve entry point. Not the id that is kept: the callback hands back the issued one. */
export const CHATGPT_DYNAMIC_CLIENT = 'dynamic_agent_client'
export const CHATGPT_AGENT_NAME = 'Panes'
export const CHATGPT_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'resource.invoke',
  'chatgpt.tokens.use.direct'
] as const
/** The scope that lets the token pay for inference from the person's ChatGPT plan. */
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct'
/** The callback path must not change between sign-ins (only the port may). */
export const CHATGPT_CALLBACK_PATH = '/auth/callback'

export interface ChatgptAuthInput {
  /** The issued client id of an earlier registration, or null for the first sign-in. */
  clientId: string | null
  hostId: string
  redirectUri: string
  state: string
  nonce: string
  challenge: string
  /** The ID token of the last sign-in (may be expired): skips account selection. */
  idTokenHint?: string
  loginHint?: string
}

export function chatgptAuthUrl(i: ChatgptAuthInput): string {
  const p = new URLSearchParams()
  p.set('client_id', i.clientId ?? CHATGPT_DYNAMIC_CLIENT)
  if (!i.clientId) p.set('agent_name_hint', CHATGPT_AGENT_NAME) // first registration only
  p.set('ext_agent_host_id', i.hostId)
  if (i.idTokenHint) p.set('id_token_hint', i.idTokenHint)
  if (i.loginHint) p.set('login_hint', i.loginHint)
  p.set('response_type', 'code')
  p.set('redirect_uri', i.redirectUri)
  p.set('scope', CHATGPT_SCOPES.join(' '))
  p.set('resource', CHATGPT_RESOURCE)
  p.set('state', i.state)
  p.set('nonce', i.nonce)
  p.set('code_challenge_method', 'S256')
  p.set('code_challenge', i.challenge)
  return `${CHATGPT_AUTHORIZE_URL}?${p.toString()}`
}

/** The body of the authorization-code exchange (form encoded). No client secret. */
export function chatgptCodeBody(i: {
  clientId: string
  code: string
  verifier: string
  redirectUri: string
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: i.clientId,
    code: i.code,
    code_verifier: i.verifier,
    redirect_uri: i.redirectUri,
    resource: CHATGPT_RESOURCE
  })
}

/** The refresh request. `scope` is left out so the existing grant is kept. */
export function chatgptRefreshBody(clientId: string, refreshToken: string): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
    resource: CHATGPT_RESOURCE
  })
}

/** Error codes that mean the refresh token can never work again: the person has to sign in again. */
const TERMINAL_REFRESH = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused'
])
export const isTerminalRefreshError = (code: string | undefined): boolean =>
  !!code && TERMINAL_REFRESH.has(code)

/** Whether a space separated scope string includes ChatGPT plan usage. */
export const hasPlanScope = (scope: string | undefined | null): boolean =>
  !!scope && scope.split(/\s+/).includes(PLAN_SCOPE)

// ---- OpenRouter ----

export const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth'
export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/api/v1/auth/keys'
export const OPENROUTER_CALLBACK_PATH = '/callback'

export function openrouterAuthUrl(i: {
  callbackUrl: string
  challenge: string
  state: string
}): string {
  const p = new URLSearchParams({
    callback_url: i.callbackUrl,
    code_challenge: i.challenge,
    code_challenge_method: 'S256',
    key_label: 'Panes',
    state: i.state
  })
  return `${OPENROUTER_AUTH_URL}?${p.toString()}`
}

export function openrouterExchangeBody(
  code: string,
  verifier: string
): { code: string; code_verifier: string; code_challenge_method: 'S256' } {
  return { code, code_verifier: verifier, code_challenge_method: 'S256' }
}

// ---- callbacks ----

export type CallbackResult =
  | { ok: true; code: string; clientId: string | null; scope: string | null }
  | { ok: false; reason: 'cancelled' | 'state' | 'error' | 'no-code'; message: string }

/** Constant-time comparison, so a guess cannot be timed. */
export function sameState(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * What came back on the redirect. The state is checked first: a callback that does not carry the state this
 * attempt made is not trusted and its code is never used. OpenRouter sends no state when the person denies, so
 * `stateOptionalOnDenial` lets a bare `error` through as a cancel.
 */
export function checkCallback(
  params: URLSearchParams,
  expectedState: string,
  opts: { stateOptionalOnDenial?: boolean } = {}
): CallbackResult {
  const err = params.get('error')
  const got = params.get('state')
  if (err && !got && opts.stateOptionalOnDenial)
    return { ok: false, reason: 'cancelled', message: 'Sign-in was cancelled.' }
  if (!got || !sameState(got, expectedState))
    return {
      ok: false,
      reason: 'state',
      message: 'The sign-in did not match this request. Try again.'
    }
  if (err === 'access_denied')
    return { ok: false, reason: 'cancelled', message: 'Sign-in was cancelled.' }
  if (err)
    return {
      ok: false,
      reason: 'error',
      message: `The provider refused the sign-in (${err.slice(0, 60)}).`
    }
  const code = params.get('code')
  if (!code) return { ok: false, reason: 'no-code', message: 'No sign-in code came back.' }
  return { ok: true, code, clientId: params.get('client_id'), scope: params.get('scope') }
}

// ---- token lifetime ----

/** Renew this long before the access token ends, so a request in flight never carries a dead one. */
export const REFRESH_MARGIN_MS = 5 * 60_000
export const REFRESH_TOKEN_LIFE_MS = 30 * 24 * 3600_000

export type TokenAction = 'use' | 'refresh' | 'sign-in'

/**
 * What to do with a stored sign-in before a request: use the access token, refresh it, or (the refresh token
 * itself is past its 30 days) ask the person to sign in again. `issuedAt` is when the current pair was stored.
 */
export function tokenAction(
  t: { expiresAt: number; issuedAt?: number },
  now: number,
  refreshLifeMs = REFRESH_TOKEN_LIFE_MS
): TokenAction {
  if (t.issuedAt !== undefined && now - t.issuedAt >= refreshLifeMs) return 'sign-in'
  return now >= t.expiresAt - REFRESH_MARGIN_MS ? 'refresh' : 'use'
}

/** The absolute expiry (ms) from a token response's `expires_in` (seconds); one hour when it is missing. */
export const expiresAtFrom = (now: number, expiresInSec: unknown): number =>
  now + (typeof expiresInSec === 'number' && expiresInSec > 0 ? expiresInSec : 3600) * 1000

// ---- ID token (OIDC) ----

export interface IdClaims {
  iss?: string
  aud?: string | string[]
  sub?: string
  exp?: number
  nonce?: string
  email?: string
  name?: string
}

/** The parts of a JWT, unverified (the signature is checked separately, in main). Null when malformed. */
export function decodeJwt(
  token: string
): { header: Record<string, unknown>; claims: IdClaims } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as IdClaims
    return claims && typeof claims === 'object' ? { header, claims } : null
  } catch {
    return null
  }
}

/** The checks after the signature: issuer, audience (the issued client id), expiry, and the nonce we made. */
export function checkIdClaims(
  c: IdClaims,
  want: { issuer: string; clientId: string; nonce: string; now: number }
): string | null {
  if (c.iss !== want.issuer) return 'The ID token is from an unexpected issuer'
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud]
  if (!aud.includes(want.clientId)) return 'The ID token is for another client'
  if (typeof c.exp !== 'number' || c.exp * 1000 <= want.now) return 'The ID token has expired'
  if (!c.nonce || !sameState(c.nonce, want.nonce)) return 'The ID token does not match this sign-in'
  if (!c.sub) return 'The ID token has no account'
  return null
}
