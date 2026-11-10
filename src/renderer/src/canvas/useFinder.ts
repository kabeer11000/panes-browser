import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addResultFrame,
  addVirtual,
  finishFrame,
  removeVirtual,
  setItem,
  type Box,
  type CanvasState
} from '@shared/ai/canvas'
import {
  answerLinks,
  frameLabel,
  guessIntent,
  pickResults,
  tabHits,
  type CanvasFoundEvent,
  type Hit
} from '@shared/ai/canvasFind'
import { itemFor, type CanvasItem } from '@shared/ai/canvasItems'
import { suggestPlacement } from '@shared/ai/canvasPlace'
import type { ChatMessage } from '@shared/ai/chatConv'
import type { TabInfo } from '@shared/types'

/** Slots a results frame starts with: one shimmering card each, until the answers arrive. */
const PLACEHOLDERS = 6
const MAX_CHIPS = 3
const MIN_CHIP = 0.34

const uid = (): string => crypto.randomUUID()

export interface FinderEnv {
  spaceId: number
  getState: () => CanvasState | null
  edit: (fn: (s: CanvasState) => CanvasState, o?: { flip?: boolean }) => boolean
  tabs: () => TabInfo[]
  /** The window is private or Tor: the open tabs, by words, and nothing else. */
  privateMode: () => boolean
  /** Where a new frame should land: the middle of what the person is looking at, in board coordinates. */
  anchor: () => { x: number; y: number }
  /** New cards to fly out of the prompt. */
  fly: (ids: number[]) => void
  show: (box: Box) => void
  select: (ids: number[]) => void
  say: (text: string) => void
}

export interface PendingConfirm {
  turnId: string
  callId: string
  detail: string
}

const itemFromHit = (h: Hit): CanvasItem => {
  const item = itemFor(h.url, h.title, {
    source: h.source,
    text: h.snippet,
    image: h.image,
    file: h.file,
    tab: h.tab,
    mime: h.mime
  })
  // how it is placed is suggested at once, by rules; the board may ask a model about an unsure page
  return { ...item, placement: suggestPlacement({ kind: item.kind, url: item.url }).placement }
}

/**
 * The canvas prompt's flow, from the box to the board. A find makes a labelled frame with a shimmering card for
 * each place, and fills them as each source reports; a question starts the chat backend and streams into an answer
 * card with the pages it used beside it. In a private window only open tabs are matched, and the board is not
 * touched (nothing of a private tab is written into the saved board).
 */
export function useFinder(env: FinderEnv): {
  run: (query: string) => void
  busy: boolean
  confirm: PendingConfirm | null
  answerConfirm: (ok: boolean) => void
  /** A link in an answer: it opens as a card of its own, in a small frame of its own. */
  /** Put a link on the board as a card; its id, or null. */
  openLink: (href: string) => number | null
  /** Milliseconds from asking to the first card that had something in it (for measuring). */
  firstMs: number | null
  /** An answer from the popover, put on the board: an answer card and its sources, in a frame of their own. */
  pinAnswer: (
    query: string,
    text: string,
    sources: Array<{ url: string; title: string; tab?: number }>
  ) => void
} {
  const envRef = useRef(env)
  useEffect(() => {
    envRef.current = env
  }, [env])
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const [firstMs, setFirstMs] = useState<number | null>(null)
  const cur = useRef<{ id: string; stop: () => void } | null>(null)
  const confirmRef = useRef<PendingConfirm | null>(null)

  const cancel = useCallback((): void => {
    cur.current?.stop()
    cur.current = null
    setBusy(false)
  }, [])
  useEffect(() => cancel, [cancel])

  // ---- a question ----
  const ask = useCallback((query: string, started: number): void => {
    const e = envRef.current
    const guess = guessIntent(query)
    const normal = e.tabs().filter((t) => !t.private && !t.tor && /^https?:/i.test(t.url))
    const chips = tabHits(guess.terms, normal)
      .filter((h) => h.relevance >= MIN_CHIP)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, MAX_CHIPS)
      .flatMap((h) => (h.tab !== undefined ? [h.tab] : []))
    const s = e.getState()
    if (!s) return
    const made = addResultFrame(s, frameLabel(query), 1, e.anchor())
    e.edit(() => made.state, { flip: true })
    const answerId = made.ids[0]
    const base: CanvasItem = {
      kind: 'answer',
      url: '',
      title: query,
      site: '',
      text: '',
      source: 'answer',
      placement: 'note'
    }
    e.edit((st) => setItem(st, answerId, base))
    e.fly(made.ids)
    const turnId = `cv-${uid()}`
    let text = ''
    let raf = 0
    const flush = (): void => {
      raf = 0
      envRef.current.edit((st) => setItem(st, answerId, { ...base, text }))
    }
    let first = false
    const finish = (message?: string): void => {
      if (raf) cancelAnimationFrame(raf)
      const f = envRef.current
      if (message) text = message
      f.edit((st) => setItem(st, answerId, { ...base, text }))
      // the pages the answer used, and the links in it, as cards beside it
      const used = chips.flatMap((id) => {
        const t = normal.find((x) => x.id === id)
        return t ? [itemFor(t.url, t.title, { tab: t.id, source: 'tab' })] : []
      })
      const links = message
        ? []
        : answerLinks(text).map((l) => itemFor(l.url, l.title, { source: 'web' }))
      const seen = new Set<string>()
      for (const it of [...used, ...links]) {
        if (seen.has(it.url)) continue
        seen.add(it.url)
        f.edit((st) => addVirtual(st, made.frameId, it).state, { flip: true })
      }
      f.edit((st) => finishFrame(st, made.frameId), { flip: true })
      const fs = f.getState()?.frames.find((x) => x.id === made.frameId)
      if (fs) f.show(fs)
      cleanup()
    }
    let off: () => void = () => undefined
    let cleanup: () => void = () => undefined
    off = window.api.onChatEvent((ev) => {
      if (ev.turnId !== turnId) return
      if (ev.kind === 'text') {
        text += ev.text
        if (!first) {
          first = true
          setFirstMs(Math.round(performance.now() - started))
        }
        if (!raf) raf = requestAnimationFrame(flush)
      } else if (ev.kind === 'tool') {
        if (ev.part.state === 'confirm') {
          const c = { turnId, callId: ev.part.id, detail: ev.part.detail }
          confirmRef.current = c
          setConfirm(c)
        } else if (confirmRef.current?.callId === ev.part.id) {
          confirmRef.current = null
          setConfirm(null)
        }
      } else if (ev.kind === 'done') {
        finish()
      } else if (ev.kind === 'error') {
        finish(ev.message)
      }
    })
    cleanup = (): void => {
      off()
      confirmRef.current = null
      setConfirm(null)
      cur.current = null
      setBusy(false)
    }
    cur.current = {
      id: turnId,
      stop: () => {
        window.api.chatStop(turnId)
        if (raf) cancelAnimationFrame(raf)
        off()
        confirmRef.current = null
        setConfirm(null)
      }
    }
    const message: ChatMessage = { id: uid(), role: 'user', parts: [{ type: 'text', text: query }] }
    void window.api.chatSend({ turnId, messages: [message], chips })
  }, [])

  // ---- a find ----
  const find = useCallback(
    (query: string, started: number, classify: boolean): void => {
      const e = envRef.current
      const s = e.getState()
      if (!s) return
      const made = addResultFrame(s, frameLabel(query), PLACEHOLDERS, e.anchor())
      e.edit(() => made.state, { flip: true })
      e.fly(made.ids)
      const queryId = `f-${uid()}`
      const lists: Hit[][] = []
      const shown: string[] = []
      const cards = [...made.ids]
      let first = false
      let off: () => void = () => undefined
      const apply = (): void => {
        const picks = pickResults(lists, Date.now())
        const f = envRef.current
        f.edit((st) => {
          let next = st
          picks.forEach((h, i) => {
            if (shown[i] === h.url) return
            const id = cards[i]
            if (id === undefined) {
              const r = addVirtual(next, made.frameId, itemFromHit(h))
              next = r.state
              cards[i] = r.id
              shown[i] = h.url
              return
            }
            next = setItem(next, id, itemFromHit(h))
            shown[i] = h.url
          })
          return next
        })
        if (picks.length > 0 && !first) {
          first = true
          setFirstMs(Math.round(performance.now() - started))
        }
      }
      const finish = (): void => {
        off()
        const f = envRef.current
        f.edit((st) => finishFrame(st, made.frameId), { flip: true })
        const fr = f.getState()?.frames.find((x) => x.id === made.frameId)
        if (fr) f.show(fr)
        else f.say(`Nothing found for "${frameLabel(query)}".`)
        cur.current = null
        setBusy(false)
      }
      off = window.api.canvas.onFound((ev: CanvasFoundEvent) => {
        if (ev.queryId !== queryId) return
        if (ev.kind === 'intent') {
          if (ev.intent === 'ask') {
            // the words said find, the model says it is a question: take the frame back and answer instead
            off()
            envRef.current.edit((st) => removeVirtual(st, made.ids))
            envRef.current.edit((st) => finishFrame(st, made.frameId))
            window.api.canvas.cancelFind(queryId)
            ask(query, started)
          }
        } else if (ev.kind === 'hits') {
          lists.push(ev.hits)
          apply()
        } else if (ev.kind === 'done') finish()
        else if (ev.kind === 'error') {
          envRef.current.say(ev.message)
          finish()
        }
      })
      cur.current = {
        id: queryId,
        stop: () => {
          window.api.canvas.cancelFind(queryId)
          off()
        }
      }
      window.api.canvas.find(queryId, query, e.spaceId, classify)
    },
    [ask]
  )

  const run = useCallback(
    (raw: string): void => {
      const query = raw.replace(/\s+/g, ' ').trim()
      if (!query) return
      const e = envRef.current
      cancel()
      setFirstMs(null)
      const started = performance.now()
      const guess = guessIntent(query)
      if (e.privateMode()) {
        // open tabs by words, shown where they are; nothing is made, nothing is sent anywhere
        const hits = tabHits(
          guess.terms,
          e.tabs().filter((t) => /^https?:/i.test(t.url))
        )
        const ids = hits.map((h) => h.tab).filter((x): x is number => x !== undefined)
        e.select(ids)
        const st = e.getState()
        const boxes = (st?.cards ?? []).filter((c) => ids.includes(c.id))
        if (boxes.length === 0) e.say('No open tab matches.')
        else {
          const x0 = Math.min(...boxes.map((c) => c.x))
          const y0 = Math.min(...boxes.map((c) => c.y))
          const x1 = Math.max(...boxes.map((c) => c.x + 240))
          const y1 = Math.max(...boxes.map((c) => c.y + 300))
          e.show({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
        }
        return
      }
      setBusy(true)
      if (guess.intent === 'ask' && guess.confident) ask(query, started)
      else find(query, started, !guess.confident)
    },
    [ask, find, cancel]
  )

  const answerConfirm = useCallback((ok: boolean): void => {
    const c = confirmRef.current
    if (!c) return
    window.api.chatAnswer(c.turnId, c.callId, ok)
    confirmRef.current = null
    setConfirm(null)
  }, [])

  const openLink = useCallback((href: string): number | null => {
    if (!/^https?:\/\//i.test(href)) return null
    const e = envRef.current
    const s = e.getState()
    if (!s) return null
    const item = itemFor(href, '', { source: 'web' })
    const made = addResultFrame(s, item.site || 'Link', 1, e.anchor())
    e.edit(() => made.state, { flip: true })
    e.edit((st) => setItem(st, made.ids[0], item))
    e.fly(made.ids)
    const fr = e.getState()?.frames.find((x) => x.id === made.frameId)
    if (fr) e.show(fr)
    return made.ids[0] ?? null
  }, [])

  const pinAnswer = useCallback(
    (
      query: string,
      text: string,
      sources: Array<{ url: string; title: string; tab?: number }>
    ): void => {
      const e = envRef.current
      const s = e.getState()
      if (!s || !text) return
      const made = addResultFrame(s, frameLabel(query), 1, e.anchor())
      e.edit(() => made.state, { flip: true })
      e.edit((st) =>
        setItem(st, made.ids[0], {
          kind: 'answer',
          url: '',
          title: query,
          site: '',
          text,
          source: 'answer',
          placement: 'note'
        })
      )
      for (const src of sources.slice(0, 8))
        e.edit(
          (st) =>
            addVirtual(
              st,
              made.frameId,
              itemFor(src.url, src.title, {
                source: src.tab !== undefined ? 'tab' : 'web',
                tab: src.tab
              })
            ).state,
          { flip: true }
        )
      e.edit((st) => finishFrame(st, made.frameId), { flip: true })
      e.fly(made.ids)
      const fr = e.getState()?.frames.find((x) => x.id === made.frameId)
      if (fr) e.show(fr)
    },
    []
  )

  return { run, busy, confirm, answerConfirm, openLink, firstMs, pinAnswer }
}
