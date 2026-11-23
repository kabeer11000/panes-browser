import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { emptyState, type CanvasState } from '@shared/ai/canvas'
import { sayIn, watchChat, type ChatMessage } from '@shared/share/chat'
import { ShareClient, type ShareStatus } from '@shared/share/client'
import { readInto, sharedSeq, writeDiff } from '@shared/share/doc'

/** Someone else in the room, as the web board shows them. */
export interface Person {
  id: number
  name: string
  color: string
  /** Their pointer on the board (board coordinates), or null. */
  cursor: { x: number; y: number } | null
  /** Their address at the relay, for a live tab's signals. */
  rtc: number
  /** The tab they show live, if they do. */
  live: { title: string; url: string } | null
}

export const COLORS = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#eab308']

/** The guest's name and colour, kept in this browser. */
export function loadMe(): { name: string; color: string } {
  try {
    const raw = JSON.parse(localStorage.getItem('panes-guest') ?? 'null') as {
      name?: unknown
      color?: unknown
    } | null
    if (raw && typeof raw.name === 'string' && typeof raw.color === 'string')
      return { name: raw.name.slice(0, 40) || 'Guest', color: raw.color }
  } catch {
    // storage off: a fresh guest each time
  }
  return { name: 'Guest', color: COLORS[Math.floor(Math.random() * COLORS.length)] }
}

type SignalListener = (from: number, data: string) => void

export interface Room {
  status: ShareStatus
  state: CanvasState
  people: Person[]
  meta: { name: string; color: string }
  /** The room's chat, oldest first, and this guest's id among the writers. */
  chat: ChatMessage[]
  meId: number
  say: (text: string) => void
  /** Change the board (a note added or edited): written to the room as one update. */
  edit: (fn: (s: CanvasState) => CanvasState) => void
  /** This guest's pointer on the board (board coordinates), or null when it left. */
  point: (at: { x: number; y: number } | null) => void
  setMe: (me: { name: string; color: string }) => void
  /** WebRTC signals for watching a live tab (sealed by the relay like everything else). */
  signal: (to: number, data: string) => void
  onSignal: (cb: SignalListener) => () => void
  iceServers: () => Promise<RTCIceServer[] | null>
}

const people = (client: ShareClient, me: number): Person[] => {
  const out: Person[] = []
  client.awareness.getStates().forEach((st, id) => {
    if (id === me) return
    const s = st as {
      user?: { name?: string; color?: string }
      cursor?: { x: number; y: number } | null
      rtc?: unknown
      live?: { title?: unknown; url?: unknown } | null
    }
    if (!s.user) return
    out.push({
      id,
      name: String(s.user.name ?? 'Someone').slice(0, 40),
      color: /^#[0-9a-f]{6}$/i.test(s.user.color ?? '') ? (s.user.color as string) : COLORS[0],
      cursor:
        s.cursor && Number.isFinite(s.cursor.x) && Number.isFinite(s.cursor.y)
          ? { x: s.cursor.x, y: s.cursor.y }
          : null,
      rtc: typeof s.rtc === 'number' && Number.isSafeInteger(s.rtc) ? s.rtc : 0,
      live:
        s.live && typeof s.live.url === 'string' && s.live.url.length > 0
          ? { url: s.live.url.slice(0, 2000), title: String(s.live.title ?? '').slice(0, 200) }
          : null
    })
  })
  return out
}

/** One room, joined from the web: the board kept live, who is here, and this guest seen by the others. */
export function useRoom(room: string, secret: string, me: { name: string; color: string }): Room {
  const [status, setStatus] = useState<ShareStatus>('connecting')
  const [state, setState] = useState<CanvasState>(() => emptyState())
  const [who, setWho] = useState<Person[]>([])
  const [meta, setMeta] = useState({ name: 'Shared space', color: '' })
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [meId, setMeId] = useState(0)
  const conn = useRef<{ doc: Y.Doc; client: ShareClient } | null>(null)
  /** What this guest's own board holds besides the room's (its id counter): kept across edits. */
  const base = useRef<CanvasState>(emptyState())
  const pics = useRef(new Map<string, string | null>())
  const listeners = useRef(new Set<SignalListener>())
  const meRef = useRef(me)

  useEffect(() => {
    const doc = new Y.Doc()
    base.current = { ...emptyState(), seq: sharedSeq(0, doc.clientID) }
    let frame = 0
    let alive = true
    const client: ShareClient = new ShareClient({
      relay: location.origin,
      room,
      secret,
      doc,
      onStatus: (s) => {
        setStatus(s)
        // once welcomed, the others can call this guest back (watching a live tab)
        if (s === 'live' && client.me) client.awareness.setLocalStateField('rtc', client.me)
      },
      onSignal: (from, data) => {
        const text = new TextDecoder().decode(data)
        listeners.current.forEach((l) => l(from, text))
      }
    })
    conn.current = { doc, client }
    // a picture from the room's store, opened here: an object address once it has come
    const picOf = (id: string): string | undefined => {
      const have = pics.current.get(id)
      if (have !== undefined) return have ?? undefined
      pics.current.set(id, null)
      void client.getBlob(id).then((bytes) => {
        if (!alive || !bytes) return
        pics.current.set(
          id,
          URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }))
        )
        redraw()
      })
      return undefined
    }
    const redraw = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setState(readInto(doc, base.current, undefined, picOf))
        const m = doc.getMap<string>('meta')
        setMeta({ name: m.get('name') || 'Shared space', color: m.get('color') ?? '' })
      })
    }
    doc.on('update', redraw)
    const stopChat = watchChat(doc, setChat)
    setMeId(doc.clientID)
    const onAware = (): void => setWho(people(client, doc.clientID))
    client.awareness.on('change', onAware)
    client.awareness.setLocalStateField('user', meRef.current)
    redraw()
    return () => {
      alive = false
      cancelAnimationFrame(frame)
      doc.off('update', redraw)
      stopChat()
      client.awareness.off('change', onAware)
      client.destroy()
      conn.current = null
      for (const url of pics.current.values()) if (url) URL.revokeObjectURL(url)
      pics.current.clear()
    }
  }, [room, secret])

  // the pointer goes at most once a frame
  const pending = useRef<{ x: number; y: number } | null | undefined>(undefined)
  const raf = useRef(0)
  return useMemo<Room>(
    () => ({
      status,
      state,
      people: who,
      meta,
      chat,
      meId,
      say: (text) => {
        const c = conn.current
        if (c) sayIn(c.doc, meRef.current, text)
      },
      edit: (fn) => {
        const c = conn.current
        if (!c) return
        const prev = readInto(c.doc, base.current)
        const next = fn(prev)
        base.current = { ...base.current, seq: Math.max(base.current.seq, next.seq) }
        writeDiff(c.doc, prev, next)
      },
      point: (at) => {
        pending.current = at
        if (raf.current) return
        raf.current = requestAnimationFrame(() => {
          raf.current = 0
          if (pending.current !== undefined)
            conn.current?.client.awareness.setLocalStateField('cursor', pending.current)
          pending.current = undefined
        })
      },
      setMe: (m) => {
        meRef.current = m
        try {
          localStorage.setItem('panes-guest', JSON.stringify(m))
        } catch {
          // storage off: kept for this visit
        }
        conn.current?.client.awareness.setLocalStateField('user', m)
      },
      signal: (to, data) => void conn.current?.client.signal(to, new TextEncoder().encode(data)),
      onSignal: (cb) => {
        listeners.current.add(cb)
        return () => listeners.current.delete(cb)
      },
      iceServers: async () => (await conn.current?.client.iceServers()) ?? null
    }),
    [status, state, who, meta, chat, meId]
  )
}
