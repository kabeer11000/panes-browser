import {
  dialog,
  ipcMain,
  net,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { quickAction, siteSearchUrl, type QuickAction } from '@shared/ai/sites'
import { quickCommand, type Command } from '@shared/ai/commands'
import { displayHost } from '@shared/url'
import { randomUUID } from 'crypto'
import { generateText, stepCountIs, streamText, type ModelMessage, type ToolSet } from 'ai'
import { type ChatTarget } from '@shared/ai/policy'
import { chatState, localUsable, type LocalFacts } from '@shared/ai/chatState'
import { MODELS } from '@shared/ai/models'
import { CONTEXT_TOKENS } from '@shared/ai/server'
import {
  chatSystem,
  CLOUD_HISTORY_CHARS,
  DOC_CAP,
  LOCAL_DOC_CAP,
  type ChatMode,
  LOCAL_PAGE_CAP,
  PAGE_CAP,
  localBudget,
  isOverflow,
  LOCAL_STEPS,
  couldBeCall,
  leakedCall,
  isLookup,
  tabsBlock,
  type ToolInput
} from '@shared/ai/chatTools'
import { cleanLead } from '@shared/ai/replyLead'
import { assemblePrompt, promptMessages, type PromptPage } from '@shared/ai/chatPrompt'
import {
  describeChatError,
  sanitizeConversation,
  namingPrompt,
  CHAT_TITLE_SYSTEM,
  toModelHistory,
  upsertConversation,
  type ChatMessage,
  type ChatPart,
  type Conversation
} from '@shared/ai/chatConv'
import { CHAT_CHOICES, CLOUD_LABEL, CLOUD_PROVIDERS, type ChatChoice } from '@shared/ai/types'
import type {
  ChatAction,
  ChatInfo,
  ChatModelOption,
  ChatSendRequest,
  ChatStreamEvent
} from '@shared/types'
import { JsonStore } from '../store'
import { boardTools } from './canvasAssistant'
import { buildTools, playQuick, readTabText, visibleTabs, type ChatHost } from './chatActions'
import { fileText, type DocText } from './docText'
import { PICKER_EXTENSIONS, wrapDoc } from '@shared/ai/docs'
import type { ChatFile } from '@shared/ai/chatConv'
import { sanitizeModelTitle } from '@shared/ai/titles'
import {
  CHATGPT_PROVIDER_OPTIONS,
  chatgptChat,
  cloudModels,
  compatibleModels,
  localModels,
  type KeyStore
} from './providers'
import type { AiRouter } from './router'
import type { LocalRuntime } from './runtime'
import type { SignIn } from './signin'

const MAX_TEXT = 8000
const ATTACH_MAX = 30
const ATTACH_TEXT = 400_000
const MODEL_LIST_MS = 10 * 60_000
/** How much of an attached tab is read; assemblePrompt picks what goes to the model. */
const READ_ALL = 200_000

export type { ChatInfo }

type DistributiveOmit<T, K extends string> = T extends unknown ? Omit<T, K> : never
type ChatEvent = DistributiveOmit<ChatStreamEvent, 'turnId'>

interface Run {
  ctrl: AbortController
  confirms: Map<string, (ok: boolean) => void>
}

export type SendRequest = ChatSendRequest

/** Where a turn's stream goes: a window, or anything that takes the same messages (the ask-about-selection card). */
export interface ChatSink {
  isDestroyed(): boolean
  webContents: { send(channel: string, ...args: unknown[]): void }
}

/**
 * The chat panel's backend: where a turn goes (the policy decides), the model for it, the page text and tools
 * it gets, and the stream back to the panel. A private or Tor tab is never read, listed or closable from here:
 * every tab goes through canShareTab first (see chatActions).
 */

/** What to say after carrying out a call the small model wrote out instead of making. */
function saidFor(call: ToolInput): string {
  if (call.name === 'search_on_site')
    return `Searching ${siteSearchUrl(call.site, call.query).name} for “${call.query}”.`
  if (call.name === 'open_tab') return `Opened ${displayHost(call.url) || call.url}.`
  if (call.name === 'scroll_to') return `Scrolled to “${call.target}”.`
  if (call.name === 'scroll_page') return `Scrolled ${call.direction}.`
  if (call.name === 'switch_to_tab') return 'Switched to that tab.'
  if (call.name === 'find_in_page') return `Highlighted “${call.text}”.`
  return 'Done.'
}

export class ChatService {
  private runs = new Map<string, Run>()
  private store = new JsonStore<{ list: Conversation[] }>('ai-chats', { list: [] })
  private win: BrowserWindow | null = null
  private pushTimer: NodeJS.Timeout | null = null
  private models: { at: number; list: Array<{ slug: string; name: string }> } | null = null
  /** Files attached this session, by id: their text stays here, the panel holds only the id and name. */
  private files = new Map<string, DocText>()

  constructor(
    private d: {
      router: AiRouter
      keys: KeyStore
      runtime: LocalRuntime
      signin: SignIn
      host: ChatHost
      /** What the local runtime is doing. */
      local: () => LocalFacts
      act: (action: ChatAction) => void
      setModel: (choice: ChatChoice, chatgptModel?: string) => void
    }
  ) {}

  // ---- where chat goes ----

  private online(): ChatTarget[] {
    const { keys } = this.d
    const out: ChatTarget[] = []
    const gpt = keys.get('chatgpt')
    if (gpt?.kind === 'oauth' && gpt.meta?.planUsage !== false) out.push('chatgpt')
    for (const p of ['openai', 'google', 'openrouter'] as const) if (keys.has(p)) out.push(p)
    return out
  }

  /** The model in use, as the header names it. */
  private modelLabel(target: ChatTarget): string {
    const s = this.d.router.settings()
    if (target === 'local')
      return s.localProvider === 'openai-compatible'
        ? `Your server · ${s.compatibleModel || 'default'}`
        : `Local · ${MODELS.chat.name}`
    if (target === 'chatgpt')
      return `ChatGPT · ${s.chatgptModel || this.models?.list[0]?.name || 'your plan'}`
    return `${CLOUD_LABEL[target]} · ${s.cloudModels[target]}`
  }

  /** Everything the picker can offer: unavailable ones are listed too, with what is missing. */
  private options(
    current: ChatTarget | null,
    online: ChatTarget[],
    local: LocalFacts
  ): ChatModelOption[] {
    const s = this.d.router.settings()
    const usable = localUsable(s, local)
    const mark = (choice: ChatChoice, chatgptModel?: string): boolean =>
      s.chatProvider === choice &&
      (choice !== 'chatgpt' ||
        !chatgptModel ||
        (s.chatgptModel || this.models?.list[0]?.slug) === chatgptModel)
    const out: ChatModelOption[] = [
      {
        id: 'auto',
        choice: 'auto',
        group: '',
        label: 'Automatic',
        available: true,
        hint: current ? this.modelLabel(current) : 'Nothing set up yet',
        current: s.chatProvider === 'auto'
      }
    ]
    const localHint = usable
      ? ''
      : local.download
        ? 'Downloading'
        : !local.installed
          ? 'Not downloaded'
          : local.error
            ? 'Stopped'
            : 'Not available'
    out.push({
      id: 'local',
      choice: 'local',
      group: s.localProvider === 'openai-compatible' ? 'Your server' : 'This computer',
      label: this.modelLabel('local').replace(/^[^·]*· /, ''),
      available: usable || s.localProvider === 'local',
      hint: localHint,
      current: mark('local')
    })
    if (online.includes('chatgpt')) {
      const list = this.models?.list ?? []
      if (!this.models)
        void this.chatgptModels()
          .then(() => this.changed())
          .catch(() => undefined)
      for (const m of list)
        out.push({
          id: `chatgpt:${m.slug}`,
          choice: 'chatgpt',
          chatgptModel: m.slug,
          group: 'ChatGPT plan',
          label: m.name,
          available: true,
          hint: '',
          current: mark('chatgpt', m.slug)
        })
      if (list.length === 0)
        out.push({
          id: 'chatgpt',
          choice: 'chatgpt',
          group: 'ChatGPT plan',
          label: 'Your plan',
          available: true,
          hint: '',
          current: mark('chatgpt')
        })
    } else {
      out.push({
        id: 'chatgpt',
        choice: 'chatgpt',
        group: 'ChatGPT plan',
        label: 'Not signed in',
        available: false,
        hint: 'Continue with ChatGPT in Settings',
        current: false
      })
    }
    for (const p of CLOUD_PROVIDERS) {
      const has = online.includes(p)
      out.push({
        id: p,
        choice: p,
        group: CLOUD_LABEL[p],
        label: s.cloudModels[p],
        available: has,
        hint: has
          ? ''
          : p === 'openrouter'
            ? 'Sign in or add a key in Settings'
            : 'Add a key in Settings',
        current: mark(p)
      })
    }
    return out
  }

  info(): ChatInfo {
    const s = this.d.router.settings()
    const online = this.online()
    const local = this.d.local()
    const st = chatState(s, { local, online, reauth: this.d.signin.reauth })
    return {
      enabled: s.enabled,
      target: st.target,
      label: st.target ? this.modelLabel(st.target) : '',
      weak: st.target === 'local' && s.localProvider === 'local',
      limited: this.d.signin.limited,
      reauth: this.d.signin.reauth,
      block: st.block,
      starting: st.starting,
      models: this.options(st.target, online, local)
    }
  }

  /** Tell the panel that something deciding where chat goes changed. Coalesced: runtime progress is chatty. */
  changed(): void {
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      if (this.win && !this.win.isDestroyed()) this.win.webContents.send('ai:chat-changed')
    }, 120)
  }

  /** The models the ChatGPT plan lists for this account (slug to pass, name to show). */
  async chatgptModels(): Promise<Array<{ slug: string; name: string }>> {
    if (this.models && Date.now() - this.models.at < MODEL_LIST_MS) return this.models.list
    const token = await this.d.signin.chatgptToken()
    const res = await net.fetch('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) throw new Error('Could not load the model list')
    const body = (await res.json()) as {
      models?: Array<{ slug?: string; display_name?: string; visibility?: string }>
    }
    const list = (body.models ?? [])
      .filter((m) => m.visibility === 'list' && typeof m.slug === 'string')
      .map((m) => ({ slug: m.slug as string, name: m.display_name || (m.slug as string) }))
    this.models = { at: Date.now(), list }
    return list
  }

  private async modelFor(
    target: ChatTarget
  ): Promise<{ model: ReturnType<typeof chatgptChat>; gpt: boolean }> {
    const { router, keys, runtime, signin } = this.d
    const s = router.settings()
    if (target === 'local') {
      const m =
        s.localProvider === 'openai-compatible'
          ? compatibleModels(s, keys)
          : localModels(await runtime.ensure('chat'), 'chat')
      return { model: m.chat, gpt: false }
    }
    if (target === 'chatgpt') {
      const token = await signin.chatgptToken()
      const id = s.chatgptModel || (await this.chatgptModels())[0]?.slug
      if (!id) throw new Error('This ChatGPT account lists no models for Panes.')
      return { model: chatgptChat(token, id), gpt: true }
    }
    const m = cloudModels(target, s, keys)
    if (!m) throw new Error(`Add a ${CLOUD_LABEL[target]} key in Settings first.`)
    return { model: m.chat, gpt: false }
  }

  // ---- a turn ----

  /** Start a turn and return at once; the answer streams to the panel as ai:chat-event. */
  async send(win: ChatSink, req: SendRequest): Promise<{ dropped: number[] }> {
    const info = this.info()
    const emit = (e: ChatEvent): void => {
      if (!win.isDestroyed()) win.webContents.send('ai:chat-event', { turnId: req.turnId, ...e })
    }
    // A plain command ("search piano covers on youtube", "open github") is carried out at once, by any model or none:
    // a small model is unreliable at building the address, and nothing needs thinking about.
    const quick = req.mode === 'popover' || (req.files ?? []).length ? null : this.quick(req)
    if (quick?.kind === 'play') {
      const part = { type: 'tool' as const, id: randomUUID(), name: 'find_and_open' as const }
      const detail = `${quick.site}: ${quick.query}`
      emit({ kind: 'tool', part: { ...part, state: 'running', detail } })
      const r = await playQuick(this.d.host, quick)
      emit({ kind: 'tool', part: { ...part, state: 'done', detail } })
      const ok = await r.playing
      emit({
        kind: 'text',
        text: !r.found
          ? `I could not find “${quick.query}” on ${quick.site}, so I opened its search for it.`
          : ok
            ? quick.say
            : `Opened it on ${quick.site}. Press play if it has not started.`
      })
      emit({ kind: 'done', stopped: false })
      return { dropped: [] }
    }
    if (quick) {
      this.d.host.open(quick.url)
      emit({
        kind: 'tool',
        part: {
          type: 'tool',
          id: randomUUID(),
          name: quick.kind === 'search' ? 'search_on_site' : 'open_tab',
          state: 'done',
          detail: quick.kind === 'search' ? `${quick.site}: ${quick.query}` : quick.site
        }
      })
      emit({ kind: 'text', text: quick.say })
      emit({ kind: 'done', stopped: false })
      return { dropped: [] }
    }
    // The same for the person's own tabs ("scroll down", "pause the video", "go to my youtube tab"): exact and
    // instant, where a small model sometimes says it did without doing it.
    const cmd = req.mode === 'popover' || (req.files ?? []).length ? null : this.command(req)
    if (cmd) {
      const { name, ...input } = cmd.call
      const tools = buildTools({
        host: this.d.host,
        weak: false,
        mode: 'panel',
        turn: { opened: 0, shown: new Set() },
        newId: () => randomUUID(),
        emit: (part) => emit({ kind: 'tool', part }),
        confirm: async () => false
      })
      void (async () => {
        try {
          // runs and shows itself like a model's call, with the same checks
          const out: unknown = await tools[name]?.execute?.(
            input as never,
            {
              toolCallId: randomUUID(),
              messages: []
            } as never
          )
          const failed = typeof out === 'string' && out.startsWith('Error:')
          emit({ kind: 'text', text: failed ? out.replace(/^Error:\s*/, 'Could not: ') : cmd.say })
        } catch (err) {
          emit({
            kind: 'text',
            text: `Could not: ${err instanceof Error ? err.message : 'it failed'}`
          })
        }
        emit({ kind: 'done', stopped: false })
      })()
      return { dropped: [] }
    }
    if (!info.target) {
      emit({
        kind: 'error',
        message: info.enabled
          ? 'Pick a model for chat in Settings.'
          : 'Turn on AI in Settings first.',
        retry: false
      })
      return { dropped: [] }
    }
    const target = info.target
    const run: Run = { ctrl: new AbortController(), confirms: new Map() }
    this.runs.set(req.turnId, run)
    const visible = new Set(visibleTabs(this.d.host).map((t) => t.id))
    const chips = [...new Set(req.chips)].filter((id) => visible.has(id)).slice(0, 6)
    const dropped = req.chips.filter((id) => !chips.includes(id))
    void this.stream(req, chips, target, info.weak, run, emit).finally(() =>
      this.runs.delete(req.turnId)
    )
    return { dropped }
  }

  private priming: AbortController | null = null

  /**
   * Have the local server read the start of the next turn's prompt now (instructions, tools, attached pages, the
   * conversation so far), while the person is still typing: when they send, only the question is left to read. Only
   * for the built-in local model, where reading is the slow part; a newer prime replaces an older one.
   */
  async prime(req: Pick<SendRequest, 'messages' | 'chips' | 'files' | 'mode'>): Promise<void> {
    const info = this.info()
    if (info.target !== 'local' || !info.weak || req.mode === 'canvas' || this.runs.size > 0) return
    this.priming?.abort()
    const ctrl = new AbortController()
    this.priming = ctrl
    try {
      const visible = new Set(visibleTabs(this.d.host).map((t) => t.id))
      const chips = [...new Set(req.chips)].filter((id) => visible.has(id)).slice(0, 6)
      const p = await this.prepare(req, req.messages, '', chips, 'local', true, 1)
      if (ctrl.signal.aborted) return
      // the same tool definitions as a turn (they are part of the prompt), with nothing to run
      const tools: ToolSet = {}
      for (const [name, t] of Object.entries(
        buildTools({
          host: this.d.host,
          weak: true,
          mode: p.mode,
          turn: { opened: 0, shown: new Set() },
          newId: () => '',
          emit: () => undefined,
          confirm: async () => false
        })
      ))
        tools[name] = { ...t, execute: undefined }
      await generateText({
        model: p.model,
        system: p.system,
        messages: p.messages,
        tools,
        temperature: 0.4,
        maxOutputTokens: 1,
        maxRetries: 0,
        abortSignal: ctrl.signal
      })
    } catch {
      // a prime is only a head start: the turn reads whatever it did not
    } finally {
      if (this.priming === ctrl) this.priming = null
    }
  }

  /** The last message as typed, if it is a plain command about the person's tabs. */
  private command(req: SendRequest): Command | null {
    const last = req.messages[req.messages.length - 1]
    if (!last || last.role !== 'user') return null
    const text = last.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
    return quickCommand(text, visibleTabs(this.d.host))
  }

  /** The last message as typed, if it is a plain command the browser can carry out itself. */
  private quick(req: SendRequest): QuickAction | null {
    const last = req.messages[req.messages.length - 1]
    if (!last || last.role !== 'user') return null
    const text = last.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
    return quickAction(text)
  }

  /**
   * The model and the prompt for a turn (see assemblePrompt for the order). `asked` is '' when priming: the start of
   * the prompt comes out the same as it will for the real question.
   */
  private async prepare(
    req: Pick<SendRequest, 'messages' | 'files' | 'mode' | 'context'>,
    history: SendRequest['messages'],
    asked: string,
    chips: number[],
    target: ChatTarget,
    weak: boolean,
    scale: number
  ): Promise<{
    model: Awaited<ReturnType<ChatService['modelFor']>>['model']
    gpt: boolean
    mode: ChatMode
    system: string
    messages: ModelMessage[]
  }> {
    const { model, gpt } = await this.modelFor(target)
    // the local model's small context is shared out so a long page or paste is cut to fit, never refused
    const fit = weak ? localBudget(CONTEXT_TOKENS, asked.length, scale) : null
    const typed =
      fit && asked.length > fit.typed ? `${asked.slice(0, fit.typed)}\n[cut to fit]` : asked
    const prior = toModelHistory(history, fit ? fit.history : CLOUD_HISTORY_CHARS)
    const mode: ChatMode = req.mode === 'popover' || req.mode === 'canvas' ? req.mode : 'panel'
    const both = (req.files ?? []).length > 0 && chips.length > 0
    // reading is the slow part on a laptop CPU (~60-80 tokens a second): pages get less than would fit
    const content = fit ? Math.min(fit.content, LOCAL_PAGE_CAP) : undefined
    const share = content !== undefined ? Math.floor(content / (both ? 2 : 1)) : undefined
    // the canvas's view of the board and tabs, cut to what the local model can take; it lists the tabs itself
    const ctxCap = fit ? Math.max(800, Math.floor(fit.content * 0.5)) : 16_000
    const out = assemblePrompt({
      system: chatSystem({ weak, mode, today: new Date().toISOString().slice(0, 10) }),
      docs: this.docs(req.files ?? [], weak, share),
      pages: await this.pages(chips),
      pageCap: share ?? PAGE_CAP,
      context: req.context?.trim().slice(0, ctxCap),
      tabs: mode === 'canvas' ? '' : tabsBlock(visibleTabs(this.d.host)),
      typed
    })
    return {
      model,
      gpt,
      mode,
      system: out.system,
      messages: promptMessages<ModelMessage>(out, prior)
    }
  }

  private async stream(
    req: SendRequest,
    chips: number[],
    target: ChatTarget,
    weak: boolean,
    run: Run,
    emit: (e: ChatEvent) => void,
    scale = 1
  ): Promise<void> {
    let said = false // text has reached the panel: a second try would repeat it
    try {
      const last = req.messages[req.messages.length - 1]
      if (!last || last.role !== 'user') throw new Error('Nothing to answer.')
      const asked = last.parts
        .map((p) => (p.type === 'text' ? p.text : ''))
        .join('')
        .slice(0, MAX_TEXT)
      const { model, gpt, mode, system, messages } = await this.prepare(
        req,
        req.messages.slice(0, -1),
        asked,
        chips,
        target,
        weak,
        scale
      )
      const tools: ToolSet = {
        ...(mode === 'canvas'
          ? boardTools({
              weak,
              newId: () => randomUUID(),
              emit: (part) => emit({ kind: 'tool', part }),
              signal: run.ctrl.signal
            })
          : {}),
        ...buildTools({
          host: this.d.host,
          weak,
          mode,
          turn: { opened: 0, shown: new Set() },
          newId: () => randomUUID(),
          emit: (part) => emit({ kind: 'tool', part }),
          confirm: (part) =>
            new Promise<boolean>((resolve) => {
              if (run.ctrl.signal.aborted) return resolve(false)
              run.confirms.set(part.id, resolve)
              emit({ kind: 'tool', part })
            })
        })
      }
      const result = streamText({
        model,
        system,
        messages,
        tools,
        // driving a site takes many small steps: look, click, look, type...
        stopWhen: stepCountIs(
          weak ? LOCAL_STEPS : mode === 'popover' ? 10 : mode === 'canvas' ? 20 : 30
        ),
        abortSignal: run.ctrl.signal,
        maxRetries: 1,
        // the ChatGPT plan route takes neither a temperature nor an output cap
        ...(gpt ? { providerOptions: CHATGPT_PROVIDER_OPTIONS } : { temperature: 0.4 }),
        ...(weak ? { maxOutputTokens: 1024 } : {})
      })
      // A small model sometimes writes its call out ("search_on_site {...}") instead of making it. Its reply is held
      // back while it could still be one; a whole reply that is one is carried out, anything else shown as it was.
      let held = ''
      let holding = weak
      const names = Object.keys(tools)
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          if (holding) {
            held += part.text
            if (couldBeCall(held, names)) continue
            // nor a sentence narrating the request ("The user is asking me to...") or a reasoning block: dropped
            const lead = cleanLead(held)
            if (lead.open) continue
            holding = false
            part.text = lead.text
            held = ''
            if (!part.text) continue
          }
          said = true
          emit({ kind: 'text', text: part.text })
        } else if (part.type === 'error') throw part.error
      }
      held = cleanLead(held).text
      if (held) {
        const current = visibleTabs(this.d.host).find((t) => t.active)?.id
        const call = leakedCall(held, names, current)
        const run1 = call ? tools[call.name]?.execute : undefined
        if (call && run1) {
          // the tool checks its own input again, as for a call the model made
          const toolCallId = randomUUID()
          const { name, ...input } = call
          const output: unknown = await run1(call as never, { toolCallId, messages: [] } as never)
          if (!isLookup(name)) emit({ kind: 'text', text: saidFor(call) })
          else {
            // a lookup is only useful with its result: hand it back as a real call and let the model answer
            const steps = (await result.response).messages
            const again = streamText({
              model,
              system,
              messages: [
                ...messages,
                ...steps,
                {
                  role: 'assistant',
                  content: [{ type: 'tool-call', toolCallId, toolName: name, input }]
                },
                {
                  role: 'tool',
                  content: [
                    {
                      type: 'tool-result',
                      toolCallId,
                      toolName: name,
                      output: { type: 'text', value: String(output) }
                    }
                  ]
                }
              ],
              // the same tools as the first round: they are part of the prompt the server has cached
              tools,
              stopWhen: stepCountIs(2),
              abortSignal: run.ctrl.signal,
              maxRetries: 1,
              temperature: 0.4,
              maxOutputTokens: 1024
            })
            for await (const part of again.fullStream) {
              if (part.type === 'text-delta') emit({ kind: 'text', text: part.text })
              else if (part.type === 'error') throw part.error
            }
          }
        } else emit({ kind: 'text', text: held })
        said = true
      }
      if (target === 'chatgpt') this.d.signin.limited = false
      emit({ kind: 'done', stopped: false })
    } catch (err) {
      if (run.ctrl.signal.aborted) return emit({ kind: 'done', stopped: true })
      // still too long for the local model: try once more with half the text and no earlier turns
      if (weak && scale === 1 && !said && isOverflow(err))
        return this.stream(req, chips, target, weak, run, emit, 0.5)
      const info = describeChatError(err, target)
      if (info.kind === 'limit' && target === 'chatgpt') this.d.signin.limited = true
      if (info.kind === 'reauth' && target === 'chatgpt') this.d.signin.reauth = true
      console.warn('[ai] chat:', err instanceof Error ? err.message : err)
      emit({ kind: 'error', message: info.message, retry: info.retry })
    } finally {
      for (const resolve of run.confirms.values()) resolve(false)
      run.confirms.clear()
    }
  }

  /** The attached tabs' whole text (assemblePrompt cuts it to fit, keeping what matches the question). */
  private async pages(chips: number[]): Promise<PromptPage[]> {
    const out: PromptPage[] = []
    for (const id of chips) {
      const t = visibleTabs(this.d.host).find((x) => x.id === id)
      const r = t ? await readTabText(this.d.host, id, READ_ALL) : null
      if (t && r) out.push({ tabId: t.id, title: t.title, url: t.url, text: r.text, pdf: r.pdf })
    }
    return out
  }

  /** The attached files as delimited documents, sharing one budget. */
  private docs(ids: string[], weak: boolean, budget?: number): string {
    const list = ids.map((id) => this.files.get(id)).filter((d): d is DocText => !!d)
    if (list.length === 0) return ''
    const cap = Math.floor((budget ?? (weak ? LOCAL_DOC_CAP : DOC_CAP)) / list.length)
    return list.map((d) => wrapDoc(d, cap)).join('\n\n')
  }

  /** Read files from disk into the session's attachments. Ones that are not documents come back in `failed`. */
  async attachFiles(paths: string[]): Promise<{ files: ChatFile[]; failed: string[] }> {
    const files: ChatFile[] = []
    const failed: string[] = []
    for (const path of paths.slice(0, 10)) {
      const doc = await fileText(path, ATTACH_TEXT)
      const name = path.split(/[\\/]/).pop() || path
      if (!doc || !doc.text.trim()) {
        failed.push(name)
        continue
      }
      const id = randomUUID()
      this.files.set(id, doc)
      while (this.files.size > ATTACH_MAX)
        this.files.delete(this.files.keys().next().value as string)
      files.push({ id, name: doc.name, kind: doc.kind, pages: doc.pages })
    }
    return { files, failed }
  }

  stop(turnId: string): void {
    this.runs.get(turnId)?.ctrl.abort()
  }

  answer(turnId: string, callId: string, ok: boolean): void {
    const resolve = this.runs.get(turnId)?.confirms.get(callId)
    if (resolve) {
      this.runs.get(turnId)?.confirms.delete(callId)
      resolve(ok)
    }
  }

  // ---- saved conversations ----

  list(): Array<{ id: string; title: string; updated: number }> {
    // conversations kept before they were named get their names now, in the background
    for (const c of this.store.value.list) if (!c.aiTitle) this.queueName(c.id)
    return this.store.value.list.map(({ id, title, aiTitle, updated }) => ({
      id,
      title: aiTitle || title,
      updated
    }))
  }

  // ---- naming conversations ----

  private naming: string[] = []
  private nameTried = new Set<string>()
  private namingNow = false

  /** Name a kept conversation once it has an answer (each is asked once per run; one at a time). */
  private queueName(id: string): void {
    if (this.nameTried.has(id) || this.naming.includes(id)) return
    this.naming.push(id)
    void this.nameNext()
  }

  private async nameNext(): Promise<void> {
    if (this.namingNow) return
    this.namingNow = true
    try {
      for (let id = this.naming.shift(); id !== undefined; id = this.naming.shift()) {
        const conv = this.store.value.list.find((c) => c.id === id)
        const prompt = conv && !conv.aiTitle ? namingPrompt(conv.messages) : null
        if (!prompt) continue
        this.nameTried.add(id)
        const raw = await this.d.router.generate({
          task: 'title',
          ctx: { private: false, tor: false },
          system: CHAT_TITLE_SYSTEM,
          prompt,
          field: 'title'
        })
        const name = sanitizeModelTitle(raw)
        const now = this.store.value.list.find((c) => c.id === id)
        if (!name || name.length > 60 || !now) continue
        now.aiTitle = name
        this.store.save()
        if (this.win && !this.win.isDestroyed()) this.win.webContents.send('ai:chat-named', id)
      }
    } finally {
      this.namingNow = false
    }
  }

  load(id: string): Conversation | null {
    return this.store.value.list.find((c) => c.id === id) ?? null
  }

  /** Keep a conversation (the last 20). `ephemeral` is one started on a private or Tor tab: never kept. */
  save(raw: unknown, ephemeral: boolean): void {
    const conv = sanitizeConversation(raw)
    if (!conv) return
    if (ephemeral) {
      this.remove(conv.id)
      return
    }
    if (conv.messages.length === 0) return
    // the name the model gave it stays (the page sends the messages only)
    const prev = this.store.value.list.find((c) => c.id === conv.id)
    if (prev?.aiTitle) conv.aiTitle = prev.aiTitle
    this.store.value.list = upsertConversation(this.store.value.list, conv)
    this.store.save()
    if (!conv.aiTitle) this.queueName(conv.id)
  }

  remove(id: string): void {
    this.store.value.list = this.store.value.list.filter((c) => c.id !== id)
    this.store.save()
  }

  clearAll(): void {
    this.store.value.list = []
    this.store.save()
  }

  /** The panel's IPC. Only the main window's own page may call it. */
  attach(win: BrowserWindow): void {
    this.win = win
    const mine = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => e.sender === win.webContents
    const ACTIONS = ['enable-ai', 'download', 'cancel-download', 'retry', 'settings']
    ipcMain.on('ai:chat-action', (e, a: unknown) => {
      if (mine(e) && typeof a === 'string' && ACTIONS.includes(a)) this.d.act(a as ChatAction)
    })
    ipcMain.on('ai:chat-set-model', (e, choice: unknown, slug: unknown) => {
      if (mine(e) && (CHAT_CHOICES as readonly unknown[]).includes(choice))
        this.d.setModel(choice as ChatChoice, typeof slug === 'string' ? slug : undefined)
    })
    ipcMain.handle('ai:chat-info', (e) => (mine(e) ? this.info() : null))
    ipcMain.handle('ai:chat-pick-files', async (e) => {
      if (!mine(e)) return { files: [], failed: [] }
      const r = await dialog.showOpenDialog(win, {
        title: 'Attach files to the chat',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Documents', extensions: PICKER_EXTENSIONS },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      return r.canceled ? { files: [], failed: [] } : this.attachFiles(r.filePaths)
    })
    // files dropped on the panel: the paths come from the preload (webUtils), only for files the person dragged in
    ipcMain.handle('ai:chat-attach', (e, paths: unknown) =>
      mine(e) && Array.isArray(paths)
        ? this.attachFiles(
            paths.filter((p): p is string => typeof p === 'string' && p.length < 1000)
          )
        : { files: [], failed: [] }
    )
    ipcMain.handle('ai:chat-send', (e, req: SendRequest) =>
      mine(e) && req && typeof req.turnId === 'string'
        ? this.send(win, {
            turnId: req.turnId.slice(0, 80),
            messages: (sanitizeConversation({ id: 'x', messages: req.messages })?.messages ??
              []) as ChatMessage[],
            chips: Array.isArray(req.chips) ? req.chips.filter((n) => Number.isInteger(n)) : [],
            files: Array.isArray(req.files)
              ? req.files.filter((f): f is string => typeof f === 'string').slice(0, 10)
              : [],
            mode: req.mode === 'popover' || req.mode === 'canvas' ? req.mode : 'panel',
            context: typeof req.context === 'string' ? req.context.slice(0, 16_000) : undefined
          })
        : { dropped: [] }
    )
    ipcMain.on('ai:chat-prime', (e, req: Partial<SendRequest> | null) => {
      if (!mine(e) || !req) return
      void this.prime({
        messages: (sanitizeConversation({ id: 'x', messages: req.messages ?? [] })?.messages ??
          []) as ChatMessage[],
        chips: Array.isArray(req.chips) ? req.chips.filter((n) => Number.isInteger(n)) : [],
        files: Array.isArray(req.files)
          ? req.files.filter((f): f is string => typeof f === 'string').slice(0, 10)
          : [],
        mode: req.mode === 'popover' ? 'popover' : 'panel'
      })
    })
    ipcMain.on('ai:chat-stop', (e, turnId: unknown) => {
      if (mine(e) && typeof turnId === 'string') this.stop(turnId)
    })
    ipcMain.on('ai:chat-answer', (e, turnId: unknown, callId: unknown, ok: unknown) => {
      if (mine(e) && typeof turnId === 'string' && typeof callId === 'string')
        this.answer(turnId, callId, ok === true)
    })
    ipcMain.handle('ai:chat-list', (e) => (mine(e) ? this.list() : []))
    ipcMain.handle('ai:chat-load', (e, id: unknown) =>
      mine(e) && typeof id === 'string' ? this.load(id) : null
    )
    ipcMain.on('ai:chat-save', (e, conv: unknown, ephemeral: unknown) => {
      if (mine(e)) this.save(conv, ephemeral === true)
    })
    ipcMain.on('ai:chat-delete', (e, id: unknown) => {
      if (mine(e) && typeof id === 'string') this.remove(id)
    })
  }
}

export type { ChatPart }
