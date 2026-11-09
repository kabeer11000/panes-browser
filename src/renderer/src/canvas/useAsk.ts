import { useCallback, useEffect, useRef, useState } from 'react'
import { answerLinks, guessIntent, tabHits } from '@shared/ai/canvasFind'
import {
  afterStop,
  clearQueue,
  editItem,
  enqueue,
  removeItem,
  reorder,
  type QueueItem
} from '@shared/ai/canvasQueue'
import type { ChatMessage, ToolPart } from '@shared/ai/chatConv'
import type { TabInfo } from '@shared/types'

const uid = (): string => crypto.randomUUID()
const MAX_CHIPS = 3
const MIN_CHIP = 0.34
const KEEP_TURNS = 20

export interface AskTurn {
  id: string
  q: string
  text: string
  steps: ToolPart[]
  error?: string
  done: boolean
  /** The open tabs given to the model with this question. */
  tabs: number[]
  /** What the assistant did to the board during this turn ("Rearranged 14 cards"), in order. */
  did: string[]
}

export interface ContextChip {
  tab: number
  title: string
  /** It came from the selection (else it was mentioned or matched the words). */
  selected: boolean
}

export interface AskApi {
  open: boolean
  turns: AskTurn[]
  streaming: boolean
  ask: (q: string) => void
  stop: () => void
  close: () => void
  show: () => void
  /** Start a new conversation: the thread is cleared, anything still running is stopped. */
  reset: () => void
  queue: QueueItem[]
  editQueued: (id: string, text: string) => void
  removeQueued: (id: string) => void
  moveQueued: (id: string, to: number) => void
  clearQueued: () => void
  /** Tabs attached to the next question: the selected cards and any @mentions, minus those taken off. */
  chips: ContextChip[]
  mention: (tab: number) => void
  dropChip: (tab: number) => void
  /** Record what the assistant did to the board in the turn that is running. */
  did: (said: string) => void
  /** Links in the answers and the tabs they used, newest first, for the source chips. */
  sources: Array<{ url: string; title: string; tab?: number }>
}

const storeKey = (space: number): string => `panes.canvas.chat.${space}`

function load(space: number): AskTurn[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(space)) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.slice(-KEEP_TURNS).flatMap((r) => {
      const o = (r ?? {}) as Record<string, unknown>
      if (typeof o.id !== 'string' || typeof o.q !== 'string' || typeof o.text !== 'string')
        return []
      return [
        {
          id: o.id,
          q: o.q.slice(0, 600),
          text: o.text.slice(0, 20000),
          steps: [],
          done: true,
          tabs: Array.isArray(o.tabs) ? o.tabs.filter((n): n is number => Number.isInteger(n)) : [],
          did: Array.isArray(o.did)
            ? o.did.filter((d): d is string => typeof d === 'string').slice(0, 20)
            : []
        }
      ]
    })
  } catch {
    return []
  }
}

/**
 * The canvas prompt as one conversation per space, on the chat backend (canvas mode: it can read the browser, and
 * work the board through the board tools). Replies stream into the dock. Questions typed while a turn runs wait in a
 * queue and run in order, each with the conversation as it is by then. Nothing is kept for a private window.
 */
export function useAsk(env: {
  space: number
  tabs: TabInfo[]
  selected: number[]
  /** Text of the selected cards that are not tabs (documents, notes), as context. */
  extra: () => string
  /** A private or Tor window: nothing is kept. */
  ephemeral: boolean
}): AskApi {
  const envRef = useRef(env)
  useEffect(() => {
    envRef.current = env
  }, [env])
  const [turns, setTurns] = useState<AskTurn[]>(() => (env.ephemeral ? [] : load(env.space)))
  const [open, setOpen] = useState(false)
  const [live, setLive] = useState<string | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [mentions, setMentions] = useState<number[]>([])
  const [dropped, setDropped] = useState<number[]>([])
  const turnsRef = useRef(turns)
  const queueRef = useRef(queue)
  const pending = useRef('')
  const raf = useRef(0)
  const liveRef = useRef<string | null>(null)
  const sendRef = useRef<(q: string) => void>(() => undefined)

  useEffect(() => {
    turnsRef.current = turns
    if (env.ephemeral) return
    const t = window.setTimeout(() => {
      try {
        const keep = turns.filter((x) => x.done).slice(-KEEP_TURNS)
        localStorage.setItem(
          storeKey(env.space),
          JSON.stringify(keep.map(({ id, q, text, tabs, did }) => ({ id, q, text, tabs, did })))
        )
      } catch {
        // a full store just means the thread is not kept
      }
    }, 400)
    return () => clearTimeout(t)
  }, [turns, env.space, env.ephemeral])
  const setQ = useCallback((next: QueueItem[]) => {
    queueRef.current = next
    setQueue(next)
  }, [])

  const patch = useCallback((id: string, fn: (t: AskTurn) => AskTurn) => {
    setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)))
  }, [])

  const flush = useCallback(() => {
    raf.current = 0
    const id = liveRef.current
    const text = pending.current
    pending.current = ''
    if (id && text) patch(id, (t) => ({ ...t, text: t.text + text }))
  }, [patch])

  /** The turn is over (answered, failed or stopped): the next waiting message runs. */
  const finished = useCallback(() => {
    liveRef.current = null
    setLive(null)
    const { next, rest } = afterStop(queueRef.current)
    if (next) {
      setQ(rest)
      window.setTimeout(() => sendRef.current(next.text), 60)
    }
  }, [setQ])

  useEffect(
    () =>
      window.api.onChatEvent((e) => {
        const id = liveRef.current
        if (!id || e.turnId !== id) return
        if (e.kind === 'text') {
          pending.current += e.text
          if (!raf.current) raf.current = requestAnimationFrame(flush)
          return
        }
        if (raf.current) cancelAnimationFrame(raf.current)
        flush()
        if (e.kind === 'tool') {
          patch(id, (t) => {
            const i = t.steps.findIndex((s) => s.id === e.part.id)
            const steps = [...t.steps]
            if (i >= 0) steps[i] = e.part
            else steps.push(e.part)
            return { ...t, steps }
          })
          return
        }
        patch(id, (t) => ({
          ...t,
          done: true,
          ...(e.kind === 'error' ? { error: e.message } : {})
        }))
        finished()
      }),
    [flush, patch, finished]
  )

  const stop = useCallback(() => {
    const id = liveRef.current
    if (id) window.api.chatStop(id)
  }, [])

  // ---- what goes along with a question ----
  const e0 = env
  const normal = e0.tabs.filter((t) => !t.private && !t.tor && /^(https?|file):/i.test(t.url))
  const chipIds = [...new Set([...e0.selected, ...mentions])].filter(
    (id) => normal.some((t) => t.id === id) && !dropped.includes(id)
  )
  const chips: ContextChip[] = chipIds.map((id) => {
    const t = normal.find((x) => x.id === id)!
    return { tab: id, title: t.aiTitle ?? t.title ?? t.url, selected: e0.selected.includes(id) }
  })
  const chipsRef = useRef(chips)
  useEffect(() => {
    chipsRef.current = chips
  })

  const send = useCallback((raw: string) => {
    const q = raw.replace(/\s+/g, ' ').trim()
    if (!q) return
    const e = envRef.current
    const ok = e.tabs.filter((t) => !t.private && !t.tor && /^(https?|file):/i.test(t.url))
    const attached = chipsRef.current.map((c) => c.tab)
    const words = tabHits(guessIntent(q).terms, ok)
      .filter((h) => h.relevance >= MIN_CHIP)
      .sort((a, b) => b.relevance - a.relevance)
      .flatMap((h) => (h.tab !== undefined ? [h.tab] : []))
    const picked = [...new Set([...attached, ...words])].slice(
      0,
      Math.max(MAX_CHIPS, attached.length)
    )
    // the conversation so far, as plain text turns
    const history: ChatMessage[] = []
    for (const t of turnsRef.current) {
      if (!t.text && !t.done) continue
      history.push({ id: uid(), role: 'user', parts: [{ type: 'text', text: t.q }] })
      if (t.text)
        history.push({ id: uid(), role: 'assistant', parts: [{ type: 'text', text: t.text }] })
    }
    const context = e.extra()
    history.push({ id: uid(), role: 'user', parts: [{ type: 'text', text: q }] })
    const id = `ask-${uid()}`
    liveRef.current = id
    setLive(id)
    setOpen(true)
    setDropped([])
    setTurns((ts) => [
      ...ts.slice(-(KEEP_TURNS - 1)),
      { id, q, text: '', steps: [], done: false, tabs: picked, did: [] }
    ])
    void window.api.chatSend({
      turnId: id,
      messages: history,
      chips: picked,
      mode: 'canvas',
      context: context || undefined
    })
  }, [])
  useEffect(() => {
    sendRef.current = send
  }, [send])

  const ask = useCallback(
    (raw: string) => {
      const q = raw.replace(/\s+/g, ' ').trim()
      if (!q) return
      if (liveRef.current) setQ(enqueue(queueRef.current, q, uid()))
      else send(q)
    },
    [send, setQ]
  )

  const close = useCallback(() => setOpen(false), [])
  const show = useCallback(() => setOpen(true), [])
  const reset = useCallback(() => {
    stop()
    liveRef.current = null
    setLive(null)
    setQ(clearQueue())
    setTurns([])
    setMentions([])
    setDropped([])
    try {
      localStorage.removeItem(storeKey(envRef.current.space))
    } catch {
      // nothing kept
    }
  }, [stop, setQ])

  // a space of its own: its thread, not the last one's
  const spaceRef = useRef(env.space)
  useEffect(() => {
    if (spaceRef.current === env.space) return
    spaceRef.current = env.space
    stop()
    liveRef.current = null
    setLive(null)
    setQ([])
    setTurns(env.ephemeral ? [] : load(env.space))
  }, [env.space, env.ephemeral, stop, setQ])

  const sources: AskApi['sources'] = []
  const seen = new Set<string>()
  for (const t of [...turns].reverse()) {
    for (const l of answerLinks(t.text, 8))
      if (!seen.has(l.url)) {
        seen.add(l.url)
        sources.push(l)
      }
    for (const id of t.tabs) {
      const tab = env.tabs.find((x) => x.id === id)
      if (tab && !seen.has(tab.url)) {
        seen.add(tab.url)
        sources.push({ url: tab.url, title: tab.aiTitle ?? tab.title, tab: tab.id })
      }
    }
  }

  return {
    open,
    turns,
    streaming: live !== null,
    ask,
    stop,
    close,
    show,
    reset,
    queue,
    editQueued: (id, text) => setQ(editItem(queueRef.current, id, text)),
    removeQueued: (id) => setQ(removeItem(queueRef.current, id)),
    moveQueued: (id, to) => setQ(reorder(queueRef.current, id, to)),
    clearQueued: () => setQ(clearQueue()),
    chips,
    mention: (tab) => {
      setDropped((d) => d.filter((x) => x !== tab))
      setMentions((m) => (m.includes(tab) ? m : [...m, tab]))
    },
    dropChip: (tab) => {
      setMentions((m) => m.filter((x) => x !== tab))
      setDropped((d) => (d.includes(tab) ? d : [...d, tab]))
    },
    did: (said) => {
      const id = liveRef.current
      if (id && said) patch(id, (t) => ({ ...t, did: [...t.did, said].slice(-20) }))
    },
    sources: sources.slice(0, 10)
  }
}
