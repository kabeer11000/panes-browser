/**
 * Where a model call goes. `local` is Panes' own llama.cpp servers; `openai-compatible` is a server the person runs
 * (Ollama, LM Studio). `chatgpt` is a placeholder for signing in with a ChatGPT account (a later phase): it is not
 * offered anywhere yet, but its credentials can already be stored.
 */
export type ProviderId =
  'local' | 'openai-compatible' | 'openai' | 'google' | 'openrouter' | 'chatgpt'

/** The providers that live in the cloud and are chosen in Settings. */
export type CloudProviderId = 'openai' | 'google' | 'openrouter'
export const CLOUD_PROVIDERS: readonly CloudProviderId[] = ['openai', 'google', 'openrouter']

/** Providers a credential can be kept for. */
export type CredentialProvider = Exclude<ProviderId, 'local'>

/** The ones the settings page may save a plain API key for (chatgpt signs in instead, later). */
export const KEY_PROVIDERS: readonly CredentialProvider[] = [
  'openai',
  'google',
  'openrouter',
  'openai-compatible'
]

export const CLOUD_LABEL: Record<CloudProviderId, string> = {
  openai: 'OpenAI',
  google: 'Google',
  openrouter: 'OpenRouter'
}

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1'

/** Small, fast model each provider is set to until the person picks another. */
export const DEFAULT_CLOUD_MODELS: Record<CloudProviderId, string> = {
  openai: 'gpt-5.4-mini',
  google: 'gemini-3.5-flash-lite',
  openrouter: 'openai/gpt-4.1-mini'
}

/** Embedding model used when a cloud provider is asked to embed. */
export const CLOUD_EMBED_MODELS: Record<CloudProviderId, string> = {
  openai: 'text-embedding-3-small',
  google: 'gemini-embedding-001',
  openrouter: 'openai/text-embedding-3-small'
}

/** What is kept for a provider: a plain API key, or the tokens of a sign-in. Main only; a page never sees either. */
export type Credential =
  | { kind: 'apiKey'; key: string }
  | {
      kind: 'oauth'
      accessToken: string
      refreshToken: string
      expiresAt: number
      meta?: OAuthMeta
    }

/** What a sign-in keeps beside its tokens. Main only, except the account name which the settings page shows. */
export interface OAuthMeta {
  /** The client id issued at registration (ChatGPT): reused for every later sign-in and refresh. */
  clientId?: string
  /** The last ID token, sent back as a hint so the account picker is skipped. */
  idToken?: string
  account?: string
  /** The token may pay from the person's plan (the plan-usage scope was granted). */
  planUsage?: boolean
  /** When this pair was stored: the refresh token lives 30 days from here. */
  issuedAt?: number
}

/** Providers that can be signed in to (rather than given a key). */
export const SIGN_IN_PROVIDERS: readonly CredentialProvider[] = ['chatgpt', 'openrouter']

/** Where chat is answered. `auto` is the signed-in cloud provider if there is one, else local. */
export type ChatChoice = 'auto' | 'local' | 'chatgpt' | CloudProviderId
export const CHAT_CHOICES: readonly ChatChoice[] = ['auto', 'local', 'chatgpt', ...CLOUD_PROVIDERS]

/** What a model call is for. `chat` and `agent` are reserved for later phases. */
export type AiTask = 'title' | 'filename' | 'group-name' | 'embed' | 'chat' | 'agent'

/** The tab or page a call is about. Private and Tor ones are never sent to a model. */
export interface AiContext {
  private: boolean
  tor: boolean
}

export const NORMAL_CONTEXT: AiContext = { private: false, tor: false }

export interface AiSettings {
  /** Master switch. Everything below does nothing while it is off. */
  enabled: boolean
  localProvider: 'local' | 'openai-compatible'
  /** Base URL of an OpenAI-compatible server (Ollama, LM Studio), e.g. http://127.0.0.1:11434/v1 */
  compatibleUrl: string
  /** Model name to ask that server for. */
  compatibleModel: string
  cloudProvider: CloudProviderId | null
  cloudModels: Record<CloudProviderId, string>
  /** Let background features use the cloud provider when the local one cannot answer. */
  cloudForBackground: boolean
  /** Which model the chat panel talks to. */
  chatProvider: ChatChoice
  /** The model slug used when chat runs on the ChatGPT plan; empty picks the first one the account lists. */
  chatgptModel: string
  titles: boolean
  filenames: boolean
  grouping: boolean
  /** The canvas view groups tabs into named frames by meaning (separate from tab-group suggestions). */
  canvas: boolean
  semanticHistory: boolean
  /** A chip beside selected text offers Ask, Explain, Translate and Summarise. */
  selectionAsk: boolean
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  localProvider: 'local',
  compatibleUrl: '',
  compatibleModel: '',
  cloudProvider: null,
  cloudModels: { ...DEFAULT_CLOUD_MODELS },
  cloudForBackground: false,
  chatProvider: 'auto',
  chatgptModel: '',
  titles: false,
  filenames: false,
  grouping: false,
  canvas: false,
  semanticHistory: false,
  selectionAsk: true
}

export type ServerState = 'off' | 'needs-download' | 'downloading' | 'starting' | 'ready' | 'error'

export interface ServerStatus {
  state: ServerState
  message: string
  modelName: string
  modelSize: number
}

/** What the renderer is told about an API key: never the key itself. */
export interface AiKeyInfo {
  provider: CredentialProvider
  hasKey: boolean
  /** Signed in rather than a pasted key. */
  signedIn?: boolean
  /** The account name or email a sign-in returned. */
  account?: string
  /** ChatGPT: the sign-in may use the person's plan. False means it was signed in without that permission. */
  planUsage?: boolean
}

/** A sign-in that is under way or just ended, for the settings page. */
export interface SignInStatus {
  provider: 'chatgpt' | 'openrouter'
  state: 'waiting' | 'failed'
  message: string
}

export interface AiStatus {
  enabled: boolean
  /** False on a system there is no llama.cpp build for. */
  supported: boolean
  /** The local runtime and both models are on disk. */
  installed: boolean
  embed: ServerStatus
  chat: ServerStatus
  /** Bytes of the local runtime and models still to fetch (or being fetched), and how many have arrived. */
  download: { received: number; total: number } | null
  /** Total size on disk of everything the local setup needs, for the card. */
  installBytes: number
  /** The runtime flavour in use: GPU (Vulkan) or CPU. Null before the first start. */
  accel: 'gpu' | 'cpu' | null
  /** The last failure, for a retry prompt. */
  error: string | null
  keys: AiKeyInfo[]
  signIn: SignInStatus | null
  /** The ChatGPT plan's usage limit was reached (cleared by the next successful reply). */
  chatgptLimited: boolean
  /** The ChatGPT sign-in can no longer be refreshed: it needs a new sign-in. */
  chatgptReauth: boolean
  /** Bytes the AI folder takes in the data folder, plus the models when they live in a folder of their own. */
  dataBytes: number
  /** Where the model files are kept. */
  modelsDir: string
  /** The user picked that folder (it is not the one in the data folder). */
  modelsDirCustom: boolean
  /** The models are being moved to another folder; local AI waits until they are in place. */
  moving: boolean
}
