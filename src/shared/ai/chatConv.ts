/**
 * Conversations of the chat panel: their shape, how they are kept (last 20, nothing from private or Tor tabs),
 * how history is cut to fit a model, how tool steps read, and the words for errors. Pure.
 */
import { TOOL_NAMES, type ToolName } from './chatTools'
import type { CloudProviderId } from './types'

export interface ChatChip {
  tabId: number
  title: string
  /** The tab the panel was opened on, attached by default. */
  current?: boolean
}

/** A file attached to the chat: a PDF or text file from disk. */
export interface ChatFile {
  id: string
  name: string
  kind: 'pdf' | 'text'
  pages: number
}

export type ToolState = 'running' | 'done' | 'error' | 'confirm' | 'denied'

export type ToolPart = {
  type: 'tool'
  id: string
  name: ToolName
  state: ToolState
  detail: string
}
export type ChatPart = { type: 'text'; text: string } | ToolPart

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  parts: ChatPart[]
  chips?: ChatChip[]
  /** Files attached to this message (their text stays in main for the session). */
  files?: ChatFile[]
  /** The turn failed: shown inline with a Retry. */
  error?: string
}

export interface Conversation {
  id: string
  title: string
  /** A short name the model gave it after its first answer (kept by main; the list shows it over `title`). */
  aiTitle?: string
  updated: number
  messages: ChatMessage[]
}

export const MAX_CONVERSATIONS = 20
export const MAX_MESSAGES = 200

export const messageText = (m: ChatMessage): string =>
  m.parts
    .filter((p): p is Extract<ChatPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')

/** The first question and the first answer, for naming a conversation; null until there is an answer. */
export function namingPrompt(messages: ChatMessage[]): string | null {
  const q = messages.find((m) => m.role === 'user')
  const a = messages.find((m) => m.role === 'assistant' && !m.error && messageText(m).trim())
  if (!q || !a) return null
  const clip = (t: string): string => t.replace(/\s+/g, ' ').trim().slice(0, 500)
  return `Question: ${clip(messageText(q))}\nAnswer: ${clip(messageText(a))}`
}

export const CHAT_TITLE_SYSTEM = `You name a conversation for a list of past chats. Answer with JSON: {"title": "..."}.
Use 2 to 5 words naming what it is about, the way a person would label it, in the language of the question.
No quotes and no full stop. Never start with "Chat", "Question", "Help with" or "Conversation".
Examples: a question on cheap flights to Tokyo -> {"title": "Cheap flights to Tokyo"}; how to undo a git commit -> {"title": "Undoing a git commit"}.`

export function conversationTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user')
  const t = first ? messageText(first).replace(/\s+/g, ' ').trim() : ''
  return t.length > 60 ? `${t.slice(0, 57)}...` : t || 'New chat'
}

/** Add or replace one conversation, newest first, and keep only the last MAX_CONVERSATIONS. */
export function upsertConversation(
  list: readonly Conversation[],
  conv: Conversation,
  max = MAX_CONVERSATIONS
): Conversation[] {
  const trimmed: Conversation = { ...conv, messages: conv.messages.slice(-MAX_MESSAGES) }
  return [trimmed, ...list.filter((c) => c.id !== conv.id)]
    .sort((a, b) => b.updated - a.updated)
    .slice(0, max)
}

export interface ModelTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * The history sent to the model: the words of each turn (tool steps and page text of earlier turns are not
 * repeated), the newest turns that fit maxChars, starting on a user turn. The last message is always kept.
 */
export function toModelHistory(messages: readonly ChatMessage[], maxChars: number): ModelTurn[] {
  const turns = messages
    .map((m) => ({ role: m.role, content: messageText(m).trim() }))
    .filter((t) => t.content)
  const out: ModelTurn[] = []
  let used = 0
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = turns[i].content.length
    if (out.length > 0 && used + cost > maxChars) break
    out.unshift(turns[i])
    used += cost
  }
  while (out.length > 1 && out[0].role !== 'user') out.shift()
  return out
}

// ---- how steps read ----

const VERB: Record<ToolName, [one: string, many: string]> = {
  list_tabs: ['Looked at the open tabs', 'Looked at the open tabs'],
  read_tab: ['Read 1 tab', 'Read {n} tabs'],
  search_history: ['Searched history', 'Searched history {n} times'],
  open_tab: ['Opened 1 tab', 'Opened {n} tabs'],
  search_on_site: ['Searched a site', 'Searched {n} sites'],
  find_and_open: ['Found and opened 1 result', 'Found and opened {n} results'],
  switch_to_tab: ['Switched tab', 'Switched tabs {n} times'],
  close_tabs: ['Closed tabs', 'Closed tabs'],
  find_in_page: ['Searched a page', 'Searched pages {n} times'],
  filter_page: ['Filtered a page', 'Filtered pages {n} times'],
  list_downloads: ['Looked at your downloads', 'Looked at your downloads'],
  read_download: ['Read a downloaded file', 'Read {n} downloaded files'],
  search_web: ['Searched the web', 'Searched the web {n} times'],
  read_web_page: ['Read a web page', 'Read {n} web pages'],
  look_at_page: ['Looked at the page', 'Looked at the page {n} times'],
  click: ['Clicked', 'Clicked {n} times'],
  type_text: ['Typed', 'Typed {n} times'],
  press_key: ['Pressed a key', 'Pressed {n} keys'],
  scroll_page: ['Scrolled', 'Scrolled {n} times'],
  select_option: ['Chose an option', 'Chose {n} options'],
  navigate: ['Went to a page', 'Went to {n} pages'],
  go_back: ['Went back', 'Went back {n} times'],
  scroll_to: ['Scrolled to a part of the page', 'Scrolled to {n} parts of the page'],
  media_control: ['Controlled the video', 'Controlled the video {n} times']
}

export interface StepGroup {
  name: ToolName
  label: string
  state: ToolState
  steps: ToolPart[]
}

const ORDER: ToolState[] = ['confirm', 'running', 'error', 'denied', 'done']
const worst = (steps: ToolPart[]): ToolState =>
  ORDER.find((s) => steps.some((p) => p.state === s)) ?? 'done'

/** Consecutive calls of the same tool become one row (Read 3 tabs); a call waiting to be confirmed stays alone. */
export function groupSteps(parts: readonly ChatPart[]): Array<ChatPart | StepGroup> {
  const out: Array<ChatPart | StepGroup> = []
  for (const p of parts) {
    if (p.type !== 'tool') {
      out.push(p)
      continue
    }
    const last = out[out.length - 1]
    if (last && 'steps' in last && last.name === p.name && p.state !== 'confirm') last.steps.push(p)
    else out.push({ name: p.name, label: '', state: p.state, steps: [p] })
  }
  for (const g of out) {
    if (!('steps' in g)) continue
    const n = g.steps.length
    g.state = worst(g.steps)
    g.label = VERB[g.name][n === 1 ? 0 : 1].replace('{n}', String(n))
    if (g.state === 'denied')
      g.label = g.name === 'close_tabs' ? 'Tabs not closed' : 'Not done: you said no'
  }
  return out
}

/** Three starting points for an empty panel, from the page it was opened on. */
export function suggestionsFor(page: { title: string; url: string } | null): string[] {
  if (!page)
    return ['What tabs do I have open?', 'Find a page I visited about...', 'Help me plan something']
  let host = ''
  try {
    host = new URL(page.url).hostname.replace(/^www\./, '')
  } catch {
    // no host: the general suggestions below
  }
  if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/.test(host))
    return ['What is this video about?', 'List the main points', 'What should I watch next?']
  if (/(^|\.)(github\.com|gitlab\.com|stackoverflow\.com)$/.test(host))
    return [
      'Explain what this page is about',
      'Summarize the key points',
      'What would I do next here?'
    ]
  return ['Summarize this page', 'List the key points', 'Explain this in simple terms']
}

// ---- errors ----

export interface ChatErrorInfo {
  kind: 'limit' | 'reauth' | 'unavailable' | 'unsupported' | 'network' | 'other'
  message: string
  /** Trying the same request again may work. */
  retry: boolean
}

type Provider = 'chatgpt' | CloudProviderId | 'local'

/** What went wrong with a turn, in words that say what to do. err is an AI SDK error or anything thrown. */
export function describeChatError(err: unknown, provider: Provider): ChatErrorInfo {
  const e = (err && typeof err === 'object' ? err : {}) as {
    statusCode?: number
    responseBody?: string
    message?: string
    name?: string
  }
  const body = typeof e.responseBody === 'string' ? e.responseBody : ''
  const msg = typeof e.message === 'string' ? e.message : ''
  const code = (body.match(/"code"\s*:\s*"([a-z0-9_]+)"/i)?.[1] ?? '').toLowerCase()
  const status = e.statusCode
  const fail = (kind: ChatErrorInfo['kind'], message: string, retry: boolean): ChatErrorInfo => ({
    kind,
    message,
    retry
  })
  if (/context size|context length|too long|maximum context/i.test(`${msg} ${body}`))
    return fail(
      'unsupported',
      'This is more text than the model can read at once. Start a new chat, attach less, or pick a larger model.',
      false
    )
  if (code === 'subscription_sharing_usage_limit_exceeded' || /usage_limit_exceeded/.test(msg))
    return fail(
      'limit',
      'Your ChatGPT plan has reached its usage limit for now. Check Usage in your ChatGPT settings.',
      false
    )
  if (code === 'subscription_sharing_user_not_eligible')
    return fail('unavailable', 'Your ChatGPT plan cannot be used here.', false)
  if (code === 'subscription_sharing_unsupported_capability' || status === 400)
    return fail(
      'unsupported',
      'That model or request is not supported here. Try another model.',
      false
    )
  if (status === 401 || /sign in again/i.test(msg))
    return fail(
      'reauth',
      provider === 'chatgpt'
        ? 'ChatGPT needs you to sign in again.'
        : 'The provider did not accept your key. Check it in Settings.',
      false
    )
  if (status === 429)
    return fail('limit', 'The provider is limiting requests. Wait a moment and try again.', true)
  if (status === 403) return fail('unavailable', 'The provider refused this request.', false)
  if (status !== undefined && status >= 500)
    return fail('unavailable', 'The provider is not available right now.', true)
  if (/fetch failed|ECONN|ENOTFOUND|network|timed? ?out|aborted/i.test(`${msg} ${e.name ?? ''}`))
    return fail(
      'network',
      provider === 'local' ? 'The local model did not answer.' : 'Could not reach the provider.',
      true
    )
  return fail('other', msg ? msg.slice(0, 200) : 'Something went wrong.', true)
}

// ---- what comes back from a page ----

const STATES: readonly string[] = ['running', 'done', 'error', 'confirm', 'denied']
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

function cleanPart(p: unknown): ChatPart | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  if (o.type === 'text') return { type: 'text', text: str(o.text, 60_000) }
  if (o.type === 'tool' && (TOOL_NAMES as readonly string[]).includes(o.name as string)) {
    // a step that was still running or waiting when the panel closed cannot be resumed
    const state = STATES.includes(o.state as string) ? (o.state as ToolState) : 'done'
    return {
      type: 'tool',
      id: str(o.id, 80),
      name: o.name as ToolName,
      state: state === 'running' || state === 'confirm' ? 'error' : state,
      detail: str(o.detail, 300)
    }
  }
  return null
}

/** A conversation from a page, rebuilt field by field so nothing unexpected is stored. Null when it is not one. */
export function sanitizeConversation(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = str(o.id, 80)
  if (!id || !Array.isArray(o.messages)) return null
  const messages: ChatMessage[] = []
  for (const m of o.messages.slice(-MAX_MESSAGES)) {
    if (!m || typeof m !== 'object') continue
    const r = m as Record<string, unknown>
    if (r.role !== 'user' && r.role !== 'assistant') continue
    const parts = (Array.isArray(r.parts) ? r.parts : [])
      .map(cleanPart)
      .filter((p): p is ChatPart => p !== null)
    const chips = Array.isArray(r.chips)
      ? r.chips
          .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
          .slice(0, 10)
          .map((c) => ({ tabId: Number(c.tabId) || 0, title: str(c.title, 120) }))
      : undefined
    const files = Array.isArray(r.files)
      ? r.files
          .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
          .slice(0, 10)
          .map((c) => ({
            id: str(c.id, 80),
            name: str(c.name, 200),
            kind: c.kind === 'pdf' ? ('pdf' as const) : ('text' as const),
            pages: Math.max(0, Math.floor(Number(c.pages) || 0))
          }))
      : undefined
    messages.push({
      id: str(r.id, 80),
      role: r.role,
      parts,
      ...(chips?.length ? { chips } : {}),
      ...(files?.length ? { files } : {}),
      ...(typeof r.error === 'string' ? { error: r.error.slice(0, 300) } : {})
    })
  }
  return {
    id,
    title: conversationTitle(messages),
    updated: typeof o.updated === 'number' ? o.updated : Date.now(),
    messages
  }
}
