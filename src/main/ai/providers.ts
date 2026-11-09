import { safeStorage } from 'electron'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { EmbeddingModel, LanguageModel } from 'ai'
import { randomUUID } from 'crypto'
import {
  CLOUD_EMBED_MODELS,
  KEY_PROVIDERS,
  SIGN_IN_PROVIDERS,
  OPENROUTER_URL,
  type AiKeyInfo,
  type AiSettings,
  type CloudProviderId,
  type Credential,
  type CredentialProvider,
  type OAuthMeta
} from '@shared/ai/types'
import { JsonStore } from '../store'
import type { Endpoint } from './runtime'

const MAX_SECRET = 4000

/**
 * Credentials, one per provider, in their own file (never in settings). Each is a small JSON document (an API key,
 * or the tokens of a sign-in) encrypted as a whole with the system's secure storage (DPAPI, Keychain, libsecret)
 * and kept as base64. They can be saved, removed and used here in the main process; a page is only ever told
 * whether one exists.
 */
export class KeyStore {
  private store = new JsonStore<{
    keys: Partial<Record<CredentialProvider, string>>
    /** Names this install to OpenAI's sign-in (ext_agent_host_id): made once, kept for good. */
    hostId?: string
    /** The client id OpenAI issued for this install. Not a secret, and kept after sign-out for the next sign-in. */
    chatgptClientId?: string
  }>('ai-keys', { keys: {} })

  hostId(): string {
    if (!this.store.value.hostId) {
      this.store.value.hostId = randomUUID()
      this.store.save()
    }
    return this.store.value.hostId
  }

  chatgptClientId(): string | null {
    return this.store.value.chatgptClientId ?? null
  }

  setChatgptClientId(id: string): void {
    this.store.value.chatgptClientId = id
    this.store.save()
  }

  private put(provider: CredentialProvider, cred: Credential): void {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('This system has no secure storage to keep the key in')
    const sealed = safeStorage.encryptString(JSON.stringify(cred))
    this.store.value.keys[provider] = sealed.toString('base64')
    this.store.save()
  }

  setApiKey(provider: CredentialProvider, key: string): void {
    const trimmed = key.trim()
    if (!trimmed || trimmed.length > MAX_SECRET) throw new Error('That key does not look right')
    this.put(provider, { kind: 'apiKey', key: trimmed })
  }

  setOAuth(
    provider: CredentialProvider,
    tokens: { accessToken: string; refreshToken: string; expiresAt: number },
    meta?: OAuthMeta
  ): void {
    this.put(provider, { kind: 'oauth', ...tokens, meta })
  }

  remove(provider: CredentialProvider): void {
    delete this.store.value.keys[provider]
    this.store.save()
  }

  has(provider: CredentialProvider): boolean {
    return typeof this.store.value.keys[provider] === 'string'
  }

  /** The credential in the clear. Never hand this to a page. */
  get(provider: CredentialProvider): Credential | undefined {
    const raw = this.store.value.keys[provider]
    if (!raw) return undefined
    try {
      const c = JSON.parse(safeStorage.decryptString(Buffer.from(raw, 'base64'))) as Credential
      return c.kind === 'apiKey' || c.kind === 'oauth' ? c : undefined
    } catch {
      return undefined // saved on another machine or user account: unreadable here
    }
  }

  /** What goes in an Authorization header: the key, or the current access token of a sign-in. */
  secret(provider: CredentialProvider): string | undefined {
    const c = this.get(provider)
    return c?.kind === 'apiKey' ? c.key : c?.accessToken
  }

  /** What a page may know: whether there is a key or sign-in, and the account name a sign-in gave. */
  info(): AiKeyInfo[] {
    const all = [...new Set([...KEY_PROVIDERS, ...SIGN_IN_PROVIDERS])]
    return all.map((provider) => {
      const c = this.has(provider) ? this.get(provider) : undefined
      const oauth = c?.kind === 'oauth'
      return {
        provider,
        hasKey: !!c,
        ...(oauth ? { signedIn: true, account: c.meta?.account, planUsage: c.meta?.planUsage } : {})
      }
    })
  }
}

export interface ModelChoice {
  chat: LanguageModel
  /** The endpoint takes a JSON schema (llama-server, OpenAI, Google); a user's own server or a router may not. */
  structured: boolean
  embed: EmbeddingModel | null
  /** Names what made an embedding, so vectors of different models are never compared. */
  embedSignature: string
}

/** The model for the llama-server Panes runs itself. */
export function localModels(ep: Endpoint, role: 'chat' | 'embed'): ModelChoice {
  const p = createOpenAICompatible({
    name: 'panes-local',
    baseURL: ep.baseURL,
    apiKey: ep.apiKey,
    supportsStructuredOutputs: true
  })
  return {
    chat: p.chatModel('local'),
    structured: true,
    embed: role === 'embed' ? p.embeddingModel('local') : null,
    embedSignature: role === 'embed' ? 'local:embeddinggemma-300m' : ''
  }
}

/** A server the person runs themselves (Ollama, LM Studio): their URL and model, their key if it wants one. */
export function compatibleModels(s: AiSettings, keys: KeyStore): ModelChoice {
  const p = createOpenAICompatible({
    name: 'user-server',
    baseURL: s.compatibleUrl,
    apiKey: keys.secret('openai-compatible')
  })
  const id = s.compatibleModel || 'default'
  return {
    chat: p.chatModel(id),
    structured: false,
    embed: p.embeddingModel(id),
    embedSignature: `compatible:${s.compatibleUrl}:${id}`
  }
}

/** The chosen online provider, or null when there is no key for it. */
export function cloudModels(
  provider: CloudProviderId,
  s: AiSettings,
  keys: KeyStore
): ModelChoice | null {
  const apiKey = keys.secret(provider)
  if (!apiKey) return null
  const id = s.cloudModels[provider]
  const embedId = CLOUD_EMBED_MODELS[provider]
  switch (provider) {
    case 'openai': {
      const p = createOpenAI({ apiKey })
      return {
        chat: p.languageModel(id),
        structured: true,
        embed: p.embeddingModel(embedId),
        embedSignature: `openai:${embedId}`
      }
    }
    case 'google': {
      const p = createGoogleGenerativeAI({ apiKey })
      return {
        chat: p.languageModel(id),
        structured: true,
        embed: p.embeddingModel(embedId),
        embedSignature: `google:${embedId}`
      }
    }
    case 'openrouter': {
      // OpenRouter speaks the OpenAI protocol; which models take a JSON schema varies, so ask for JSON in words
      const p = createOpenAICompatible({ name: 'openrouter', baseURL: OPENROUTER_URL, apiKey })
      return {
        chat: p.chatModel(id),
        structured: false,
        embed: p.embeddingModel(embedId),
        embedSignature: `openrouter:${embedId}`
      }
    }
  }
}

/**
 * Chat on the person's ChatGPT plan: the Responses API at api.openai.com/v1 with the sign-in's access token as the
 * bearer. The route needs store=false, takes system text as a developer message, and sets no temperature or
 * output cap (see developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
 */
export function chatgptChat(accessToken: string, modelId: string): LanguageModel {
  return createOpenAI({ apiKey: accessToken }).responses(modelId)
}

export const CHATGPT_PROVIDER_OPTIONS = {
  openai: { store: false, systemMessageMode: 'developer' }
} as const
