import { embedMany, generateText, jsonSchema, Output } from 'ai'
import { route, type Route } from '@shared/ai/policy'
import { parseJsonObject } from '@shared/ai/titles'
import type { AiContext, AiSettings, AiTask } from '@shared/ai/types'
import {
  cloudModels,
  compatibleModels,
  localModels,
  type KeyStore,
  type ModelChoice
} from './providers'
import type { LocalRuntime } from './runtime'

export const LOCAL_TIMEOUT_MS = 20_000
export const CLOUD_TIMEOUT_MS = 30_000
const QUEUE_MAX = 20
const WARM_EVERY_MS = 30_000

export type Priority = 'high' | 'low'

/** Runs one job at a time; at most QUEUE_MAX wait, and when more come the oldest waiting one is dropped. */
class Lane {
  private queue: Array<{ run: () => Promise<void>; drop: () => void }> = []
  private busy = false

  submit<T>(job: () => Promise<T>, priority: Priority): Promise<T | null> {
    return new Promise((resolve) => {
      const entry = {
        run: async () => {
          try {
            resolve(await job())
          } catch {
            resolve(null) // the caller logged it; a failed job is no answer
          }
        },
        drop: () => resolve(null)
      }
      if (priority === 'high') this.queue.unshift(entry)
      else this.queue.push(entry)
      while (this.queue.length > QUEUE_MAX) this.queue.pop()?.drop()
      void this.pump()
    })
  }

  private async pump(): Promise<void> {
    if (this.busy) return
    this.busy = true
    for (let next = this.queue.shift(); next; next = this.queue.shift()) await next.run()
    this.busy = false
  }
}

export interface GenerateRequest {
  task: AiTask
  ctx: AiContext
  system?: string
  prompt: string
  /** The one string field of the JSON the model answers with, e.g. "title". */
  field: string
  priority?: Priority
}

export interface Embedded {
  vectors: number[][]
  /** What made them: vectors with different signatures are not comparable. */
  signature: string
}

/**
 * The only way anything in Panes reaches a model. Every call first asks the policy (a private or Tor tab is
 * refused there, once, for every feature), then goes to the local servers, the person's own server, or the cloud
 * provider they chose. A call never throws: it gives an answer or null, and a failure is logged once.
 */
export class AiRouter {
  private chatLane = new Lane()
  private embedLane = new Lane()
  private warned = new Set<string>()
  private lastWarm = 0

  constructor(
    private deps: {
      settings: () => AiSettings
      runtime: LocalRuntime
      keys: KeyStore
    }
  ) {}

  settings(): AiSettings {
    return this.deps.settings()
  }

  private warn(key: string, err: unknown): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    console.warn(`[ai] ${key}:`, err instanceof Error ? err.message : err)
  }

  private localAvailable(s: AiSettings): boolean {
    return s.localProvider === 'openai-compatible'
      ? s.compatibleUrl !== ''
      : this.deps.runtime.available
  }

  /** The local provider (the runtime, or the person's own server) could answer right now. */
  localReady(): boolean {
    return this.localAvailable(this.deps.settings())
  }

  decide(task: AiTask, ctx: AiContext): Route {
    const s = this.deps.settings()
    return route(task, ctx, s, this.localAvailable(s))
  }

  /**
   * Whether the task is allowed at all for this context (private and Tor refused, switches on), whether or not a
   * model could answer now. For the parts of a feature that need no model, like trimming a title.
   */
  permits(task: AiTask, ctx: AiContext): boolean {
    return route(task, ctx, this.deps.settings(), true) !== 'deny'
  }

  /** Whether a call for this task would be answered by something running on this machine. */
  isLocal(task: AiTask, ctx: AiContext): boolean {
    return this.decide(task, ctx) === 'local'
  }

  private async model(
    r: Exclude<Route, 'deny'>,
    role: 'chat' | 'embed'
  ): Promise<ModelChoice | null> {
    const s = this.deps.settings()
    if (r === 'cloud')
      return s.cloudProvider ? cloudModels(s.cloudProvider, s, this.deps.keys) : null
    if (s.localProvider === 'openai-compatible') return compatibleModels(s, this.deps.keys)
    return localModels(await this.deps.runtime.ensure(role), role)
  }

  /** One short answer as the string field of a small JSON object, or null. */
  async generate(req: GenerateRequest): Promise<string | null> {
    const r = this.decide(req.task, req.ctx)
    if (r === 'deny') return null
    const timeout = r === 'cloud' ? CLOUD_TIMEOUT_MS : LOCAL_TIMEOUT_MS
    const job = async (): Promise<string | null> => {
      try {
        const m = await this.model(r, 'chat')
        if (!m) return null
        return await this.ask(m, req, timeout)
      } catch (err) {
        this.warn(`${req.task} (${r})`, err)
        return null
      }
    }
    return r === 'cloud' ? job() : this.chatLane.submit(job, req.priority ?? 'low')
  }

  private async ask(
    m: ModelChoice,
    req: GenerateRequest,
    timeoutMs: number
  ): Promise<string | null> {
    const abortSignal = AbortSignal.timeout(timeoutMs)
    const common = {
      model: m.chat,
      system: req.system,
      temperature: 0,
      maxOutputTokens: 120,
      maxRetries: 0,
      abortSignal
    }
    if (m.structured) {
      const schema = jsonSchema<Record<string, string>>({
        type: 'object',
        properties: { [req.field]: { type: 'string' } },
        required: [req.field],
        additionalProperties: false
      })
      const res = await generateText({
        ...common,
        prompt: req.prompt,
        output: Output.object({ schema })
      })
      const v = (res.output as Record<string, unknown> | undefined)?.[req.field]
      return typeof v === 'string' ? v : null
    }
    const res = await generateText({
      ...common,
      prompt: `${req.prompt}\n\nAnswer with JSON only, like {"${req.field}": "..."}`
    })
    const v = parseJsonObject(res.text)?.[req.field]
    return typeof v === 'string' ? v : null
  }

  /** Embeddings for the texts, in order, or null (refused, unavailable, too slow, or the provider has none). */
  async embed(
    texts: string[],
    ctx: AiContext,
    opts: { priority?: Priority; timeoutMs?: number } = {}
  ): Promise<Embedded | null> {
    if (texts.length === 0) return { vectors: [], signature: '' }
    const r = this.decide('embed', ctx)
    if (r === 'deny') return null
    const timeout = opts.timeoutMs ?? (r === 'cloud' ? CLOUD_TIMEOUT_MS : LOCAL_TIMEOUT_MS)
    const job = async (): Promise<Embedded | null> => {
      try {
        const m = await this.model(r, 'embed')
        if (!m?.embed) return null
        const res = await embedMany({
          model: m.embed,
          values: texts,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(timeout)
        })
        return { vectors: res.embeddings, signature: m.embedSignature }
      } catch (err) {
        this.warn(`embed (${r})`, err)
        return null
      }
    }
    return r === 'cloud' ? job() : this.embedLane.submit(job, opts.priority ?? 'low')
  }

  /**
   * Start the embedding server before it is needed (the command bar opened) and run one tiny embedding through it:
   * the first request after a pause is several times slower than the rest. Never throws, never waits.
   */
  warmEmbed(): void {
    const ctx = { private: false, tor: false }
    if (this.decide('embed', ctx) !== 'local' || this.deps.settings().localProvider !== 'local')
      return
    if (Date.now() - this.lastWarm < WARM_EVERY_MS) return
    this.lastWarm = Date.now()
    void this.embed(['warm up'], ctx, { priority: 'low' })
  }
}
