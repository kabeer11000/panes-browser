import { createPublicKey, verify } from 'crypto'
import { net, shell } from 'electron'
import {
  CHATGPT_CALLBACK_PATH,
  CHATGPT_DISCOVERY_URL,
  CHATGPT_ISSUER,
  CHATGPT_TOKEN_URL,
  OPENROUTER_CALLBACK_PATH,
  OPENROUTER_KEYS_URL,
  challengeFor,
  chatgptAuthUrl,
  chatgptCodeBody,
  chatgptRefreshBody,
  checkCallback,
  checkIdClaims,
  decodeJwt,
  expiresAtFrom,
  hasPlanScope,
  isTerminalRefreshError,
  newToken,
  newVerifier,
  openrouterAuthUrl,
  openrouterExchangeBody,
  tokenAction
} from '@shared/ai/oauth'
import type { SignInStatus } from '@shared/ai/types'
import { listenOnce, type Loopback } from './loopback'
import type { KeyStore } from './providers'

const SIGN_IN_TIMEOUT_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 20_000

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

const fetchJson = async <T>(
  url: string,
  init: RequestInit
): Promise<{ ok: boolean; status: number; body: T }> => {
  const res = await net.fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  const body = (await res.json().catch(() => ({}))) as T
  return { ok: res.ok, status: res.status, body }
}

/**
 * The sign-ins. Each flow opens the provider's own page in the system browser, waits for the redirect on a
 * loopback listener, and keeps the result in the KeyStore. Tokens never leave main: callers get an access token
 * for a request (refreshed first when it is due) or an error that says to sign in again.
 */
export class SignIn {
  status: SignInStatus | null = null
  /** The ChatGPT plan's usage limit was hit; cleared by the next good reply or a new sign-in. */
  limited = false
  /** The ChatGPT sign-in cannot be refreshed any more. */
  reauth = false
  private active: Loopback | null = null
  private refreshing: Promise<string> | null = null

  constructor(
    private keys: KeyStore,
    private changed: () => void
  ) {}

  private set(status: SignInStatus | null): void {
    this.status = status
    this.changed()
  }

  cancel(): void {
    this.active?.cancel()
    this.active = null
  }

  /** Open the provider's sign-in and wait for it. Resolves when it ends; never throws (failure is in `status`). */
  async start(provider: 'chatgpt' | 'openrouter'): Promise<void> {
    this.cancel()
    try {
      this.set({ provider, state: 'waiting', message: 'Finish signing in in your browser.' })
      if (provider === 'chatgpt') await this.chatgptFlow()
      else await this.openrouterFlow()
      this.set(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in failed.'
      // a cancel is not a failure to show
      this.set(/cancelled/i.test(message) ? null : { provider, state: 'failed', message })
    } finally {
      this.active = null
    }
  }

  // ---- ChatGPT ----

  private async chatgptFlow(): Promise<void> {
    const lis = await listenOnce(CHATGPT_CALLBACK_PATH, SIGN_IN_TIMEOUT_MS)
    this.active = lis
    const redirectUri = `http://127.0.0.1:${lis.port}${CHATGPT_CALLBACK_PATH}`
    const verifier = newVerifier()
    const state = newToken()
    const nonce = newToken()
    const known = this.keys.chatgptClientId()
    const prior = this.keys.get('chatgpt')
    const url = chatgptAuthUrl({
      clientId: known,
      hostId: this.keys.hostId(),
      redirectUri,
      state,
      nonce,
      challenge: challengeFor(verifier),
      idTokenHint: prior?.kind === 'oauth' ? prior.meta?.idToken : undefined
    })
    await shell.openExternal(url)
    const cb = checkCallback(await lis.result, state)
    if (!cb.ok) throw new Error(cb.message)
    // a registration is bound to its client id: a callback naming a different one is not ours
    if (known && cb.clientId && cb.clientId !== known)
      throw new Error('The sign-in came back for another app.')
    const clientId = known ?? cb.clientId
    if (!clientId) throw new Error('OpenAI did not issue a client for Panes. Try again.')
    this.set({ provider: 'chatgpt', state: 'waiting', message: 'Finishing sign-in...' })
    const res = await fetchJson<TokenResponse>(CHATGPT_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: chatgptCodeBody({ clientId, code: cb.code, verifier, redirectUri })
    })
    const t = res.body
    if (!res.ok || !t.access_token || !t.refresh_token)
      throw new Error(`OpenAI did not accept the sign-in (${t.error ?? res.status}).`)
    const claims = await this.verifyIdToken(t.id_token, clientId, nonce)
    const scope = t.scope ?? cb.scope ?? ''
    this.keys.setChatgptClientId(clientId)
    const now = Date.now()
    this.keys.setOAuth(
      'chatgpt',
      {
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt: expiresAtFrom(now, t.expires_in)
      },
      {
        clientId,
        idToken: t.id_token,
        account: claims.email ?? claims.name ?? undefined,
        planUsage: hasPlanScope(scope),
        issuedAt: now
      }
    )
    this.limited = false
    this.reauth = false
  }

  /** The signature against OpenAI's published keys, then issuer, audience, expiry and nonce. */
  private async verifyIdToken(
    idToken: string | undefined,
    clientId: string,
    nonce: string
  ): Promise<{ email?: string; name?: string; sub?: string }> {
    const jwt = idToken ? decodeJwt(idToken) : null
    if (!idToken || !jwt) throw new Error('OpenAI sent no readable ID token.')
    const alg = jwt.header.alg
    if (alg !== 'RS256' && alg !== 'ES256')
      throw new Error('The ID token uses an unsupported signature.')
    const disco = await fetchJson<{ jwks_uri?: string }>(CHATGPT_DISCOVERY_URL, {})
    if (!disco.body.jwks_uri) throw new Error('Could not load the keys to check the sign-in.')
    const jwks = await fetchJson<{ keys?: Array<Record<string, unknown>> }>(disco.body.jwks_uri, {})
    const jwk = jwks.body.keys?.find((k) => k.kid === jwt.header.kid && (!k.alg || k.alg === alg))
    if (!jwk) throw new Error('The ID token was signed with an unknown key.')
    const [h, p, s] = idToken.split('.')
    const key = createPublicKey({ key: jwk as never, format: 'jwk' })
    const ok = verify(
      'sha256',
      Buffer.from(`${h}.${p}`),
      alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key,
      Buffer.from(s, 'base64url')
    )
    if (!ok) throw new Error('The ID token signature did not check out.')
    const bad = checkIdClaims(jwt.claims, {
      issuer: CHATGPT_ISSUER,
      clientId,
      nonce,
      now: Date.now()
    })
    if (bad) throw new Error(bad)
    return jwt.claims
  }

  /**
   * An access token for a request: the stored one while it is good, a refreshed one when it is due. Refreshes are
   * serialized (the refresh token is replaced on every use, so two at once would break the second).
   */
  chatgptToken(): Promise<string> {
    const c = this.keys.get('chatgpt')
    if (c?.kind !== 'oauth') return Promise.reject(new Error('Sign in again to use ChatGPT.'))
    const action = tokenAction({ expiresAt: c.expiresAt, issuedAt: c.meta?.issuedAt }, Date.now())
    if (action === 'use') return Promise.resolve(c.accessToken)
    if (action === 'sign-in') return this.lapse()
    this.refreshing ??= this.refresh().finally(() => (this.refreshing = null))
    return this.refreshing
  }

  /** The sign-in can no longer be renewed: forget the tokens (the client id stays) and say so. */
  private lapse(): Promise<string> {
    this.keys.remove('chatgpt')
    this.reauth = true
    this.changed()
    return Promise.reject(new Error('Sign in again to use ChatGPT.'))
  }

  private async refresh(): Promise<string> {
    const c = this.keys.get('chatgpt')
    const clientId = c?.kind === 'oauth' ? (c.meta?.clientId ?? this.keys.chatgptClientId()) : null
    if (c?.kind !== 'oauth' || !clientId) return this.lapse()
    let res: Awaited<ReturnType<typeof fetchJson<TokenResponse>>>
    try {
      res = await fetchJson<TokenResponse>(CHATGPT_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: chatgptRefreshBody(clientId, c.refreshToken)
      })
    } catch {
      // offline or slow: the tokens are fine, this request just cannot go out
      throw new Error('Could not reach OpenAI to renew the sign-in.')
    }
    const t = res.body
    if (!res.ok || !t.access_token) {
      if (isTerminalRefreshError(t.error)) return this.lapse()
      throw new Error('Could not renew the ChatGPT sign-in right now.')
    }
    const now = Date.now()
    this.keys.setOAuth(
      'chatgpt',
      {
        accessToken: t.access_token,
        refreshToken: t.refresh_token ?? c.refreshToken, // the new one replaces the old
        expiresAt: expiresAtFrom(now, t.expires_in)
      },
      {
        ...c.meta,
        idToken: t.id_token ?? c.meta?.idToken,
        planUsage: t.scope ? hasPlanScope(t.scope) : c.meta?.planUsage,
        issuedAt: now
      }
    )
    return t.access_token
  }

  /** Revoke at OpenAI (best effort), then forget the tokens. The client id and host id stay for the next sign-in. */
  async signOutChatgpt(): Promise<void> {
    const c = this.keys.get('chatgpt')
    this.keys.remove('chatgpt')
    this.limited = false
    this.reauth = false
    this.changed()
    if (c?.kind !== 'oauth') return
    try {
      const disco = await fetchJson<{ revocation_endpoint?: string }>(CHATGPT_DISCOVERY_URL, {})
      const url = disco.body.revocation_endpoint
      const clientId = c.meta?.clientId ?? this.keys.chatgptClientId()
      if (!url || !clientId) return
      await net.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: c.refreshToken,
          token_type_hint: 'refresh_token',
          client_id: clientId
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch {
      // the tokens are gone from here; the person can also disconnect Panes in ChatGPT settings
    }
  }

  // ---- OpenRouter ----

  private async openrouterFlow(): Promise<void> {
    const lis = await listenOnce(OPENROUTER_CALLBACK_PATH, SIGN_IN_TIMEOUT_MS)
    this.active = lis
    const verifier = newVerifier()
    const state = newToken()
    const url = openrouterAuthUrl({
      callbackUrl: `http://localhost:${lis.port}${OPENROUTER_CALLBACK_PATH}`,
      challenge: challengeFor(verifier),
      state
    })
    await shell.openExternal(url)
    const cb = checkCallback(await lis.result, state, { stateOptionalOnDenial: true })
    if (!cb.ok) throw new Error(cb.message)
    const res = await fetchJson<{ key?: string }>(OPENROUTER_KEYS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(openrouterExchangeBody(cb.code, verifier))
    })
    if (!res.ok || !res.body.key) throw new Error('OpenRouter did not give a key. Try again.')
    this.keys.setApiKey('openrouter', res.body.key)
  }
}

/** One cheap request with the key: whether Google accepts it. Throws a sentence for the settings page. */
export async function checkGeminiKey(key: string): Promise<void> {
  let status: number
  try {
    const res = await net.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
      {
        headers: { 'x-goog-api-key': key.trim() },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      }
    )
    status = res.status
  } catch {
    throw new Error('Could not reach Google to check the key. Check your connection and try again.')
  }
  if (status === 200) return
  if (status === 400 || status === 401 || status === 403)
    throw new Error('Google did not accept that key. Copy it again from AI Studio.')
  throw new Error(`Google could not check the key right now (${status}).`)
}
