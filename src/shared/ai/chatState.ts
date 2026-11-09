/**
 * Why chat can or cannot answer right now, and what the person can do about it. One pure function, so the panel
 * never has to guess and every "cannot chat" state has its own words and one primary action.
 */
import { resolveChatTarget, type ChatTarget } from './policy'
import type { AiSettings } from './types'

/** What the local runtime is doing, as far as chat cares. */
export interface LocalFacts {
  /** There is a llama.cpp build for this system. */
  supported: boolean
  /** The runtime and both models are on disk. */
  installed: boolean
  download: { received: number; total: number } | null
  /** The chat server is starting (it starts on first use and stays up for a while). */
  starting: boolean
  /** The local servers stopped (crashed too often, or failed to start). */
  error: string | null
  /** Bytes a full local setup weighs. */
  installBytes: number
}

export type ChatBlock =
  | { kind: 'off' }
  | { kind: 'download'; bytes: number }
  | { kind: 'downloading'; received: number; total: number }
  | { kind: 'local-error'; message: string }
  | { kind: 'reauth' }
  | { kind: 'unsupported' }
  | { kind: 'no-model' }

export interface ChatState {
  /** Where a message would go now, or null when chat cannot answer. */
  target: ChatTarget | null
  /** Why it cannot (null when it can). */
  block: ChatBlock | null
  /** The local model is warming up: a quiet note, and the message waits for it. */
  starting: boolean
}

export interface ChatFacts {
  local: LocalFacts
  /** Online providers with a key or a working sign-in. */
  online: readonly ChatTarget[]
  /** The ChatGPT sign-in ended and needs a new one. */
  reauth: boolean
}

/** Whether the local provider could answer: the person's own server has an address, or the runtime is installed and not stopped. */
export function localUsable(s: AiSettings, l: LocalFacts): boolean {
  if (s.localProvider === 'openai-compatible') return s.compatibleUrl !== ''
  return l.supported && l.installed && !l.error
}

export function chatState(s: AiSettings, f: ChatFacts): ChatState {
  if (!s.enabled) return { target: null, block: { kind: 'off' }, starting: false }
  const local = localUsable(s, f.local)
  const target = resolveChatTarget(s, { local, online: f.online })
  if (target) {
    const own = target === 'local' && s.localProvider === 'local'
    return { target, block: null, starting: own && f.local.starting }
  }
  const none = (block: ChatBlock): ChatState => ({ target: null, block, starting: false })
  const wantsGpt = s.chatProvider === 'chatgpt' || s.chatProvider === 'auto'
  if (f.reauth && wantsGpt) return none({ kind: 'reauth' })
  const wantsLocal = s.chatProvider === 'local' || s.chatProvider === 'auto'
  if (wantsLocal && s.localProvider === 'local') {
    const l = f.local
    if (!l.supported) return none({ kind: 'unsupported' })
    if (l.download) return none({ kind: 'downloading', ...l.download })
    if (!l.installed) return none({ kind: 'download', bytes: l.installBytes })
    if (l.error) return none({ kind: 'local-error', message: l.error })
  }
  return none({ kind: 'no-model' })
}
