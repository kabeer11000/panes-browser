import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  messageText,
  type ChatChip,
  type ChatFile,
  type ChatMessage,
  type ChatPart,
  type Conversation
} from '@shared/ai/chatConv'
import type { ChatInfo, ChatStreamEvent, TabInfo } from '@shared/types'

const uid = (): string => crypto.randomUUID()

/** A web page, or a document opened from disk (a PDF tab): what the chat can read. */
const isWeb = (url: string): boolean => /^(https?|file):/i.test(url)

export interface Mention {
  tabId: number
  title: string
}

/** Tabs the panel may offer: normal ones with a web page. A private or Tor tab is never offered or sent. */
export const shareable = (t: TabInfo): boolean => !t.private && !t.tor && isWeb(t.url)

export interface ChatState {
  info: ChatInfo | null
  messages: ChatMessage[]
  streaming: boolean
  /** Whether the Current page chip is on. */
  currentOn: boolean
  mentions: Mention[]
  /** The tab the panel is looking at is private or Tor: nothing of it is shared and the chat is not kept. */
  hiddenPage: boolean
  page: TabInfo | null
  saved: Array<{ id: string; title: string; updated: number }>
}

/**
 * The chat panel's state: the conversation, the stream of events for the turn in flight, the context chips and the
 * saved conversations. Text deltas are batched to one update per frame, so a fast stream does not flood React.
 */
export interface ChatApi {
  info: ChatInfo | null
  messages: ChatMessage[]
  streaming: boolean
  currentOn: boolean
  setCurrentOn: (on: boolean) => void
  mentions: Mention[]
  setMentions: (m: Mention[]) => void
  hiddenPage: boolean
  page: TabInfo | null
  saved: ChatState['saved']
  lastText: string
  /** Files attached to the conversation: they stay with every message until removed. */
  files: ChatFile[]
  attachNote: string
  pickFiles: () => void
  dropFiles: (files: File[]) => void
  removeFile: (id: string) => void
  send: (text: string) => void
  stop: () => void
  retry: () => void
  answer: (callId: string, ok: boolean) => void
  reset: () => void
  open: (id: string) => void
  remove: (id: string) => void
  refreshInfo: () => void
}

export function useChat(active: TabInfo | null): ChatApi {
  const [info, setInfo] = useState<ChatInfo | null>(null)
  const [chatId, setChatId] = useState(uid)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [turnId, setTurnId] = useState<string | null>(null)
  const [currentOn, setCurrentOn] = useState(true)
  const [mentions, setMentions] = useState<Mention[]>([])
  const [saved, setSaved] = useState<ChatState['saved']>([])
  const [files, setFiles] = useState<ChatFile[]>([])
  const [attachNote, setAttachNote] = useState('')
  const ephemeral = useRef(false)
  const live = useRef({ chatId, messages, turnId })
  const pending = useRef('')
  const raf = useRef(0)

  const page = active && shareable(active) ? active : null
  const hiddenPage = !!active && (active.private || active.tor)

  const refreshInfo = useCallback(() => void window.api.chatInfo().then(setInfo), [])
  const refreshSaved = useCallback(() => void window.api.chatList().then(setSaved), [])
  useEffect(() => {
    refreshInfo()
    refreshSaved()
    // sign-in, key and model changes happen on the settings page: look again when this window is shown
    window.addEventListener('focus', refreshInfo)
    // main says when settings, a download or a sign-in change where chat goes (the settings page is another tab)
    const off = window.api.onChatChanged(refreshInfo)
    return () => {
      window.removeEventListener('focus', refreshInfo)
      off()
    }
  }, [refreshInfo, refreshSaved])

  useEffect(() => {
    live.current = { chatId, messages, turnId }
  })

  const patchLast = useCallback((fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((ms) => (ms.length ? [...ms.slice(0, -1), fn(ms[ms.length - 1])] : ms))
  }, [])

  const flushText = useCallback(() => {
    raf.current = 0
    const text = pending.current
    pending.current = ''
    if (!text) return
    patchLast((m) => {
      const parts: ChatPart[] = [...m.parts]
      const last = parts[parts.length - 1]
      if (last?.type === 'text') parts[parts.length - 1] = { type: 'text', text: last.text + text }
      else parts.push({ type: 'text', text })
      return { ...m, parts }
    })
  }, [patchLast])

  const persist = useCallback(
    (ms: ChatMessage[], id: string) => {
      window.api.chatSave({ id, title: '', updated: Date.now(), messages: ms }, ephemeral.current)
      window.setTimeout(refreshSaved, 150)
    },
    [refreshSaved]
  )

  const finish = useCallback(
    (patch: (m: ChatMessage) => ChatMessage) => {
      if (raf.current) cancelAnimationFrame(raf.current)
      flushText()
      patchLast(patch)
      setTurnId(null)
    },
    [flushText, patchLast]
  )

  // a turn just ended: keep the conversation (unless it began on a private or Tor tab)
  const wasStreaming = useRef(false)
  useEffect(() => {
    if (wasStreaming.current && turnId === null) persist(messages, chatId)
    wasStreaming.current = turnId !== null
  }, [turnId, messages, chatId, persist])

  useEffect(
    () =>
      window.api.onChatEvent((e: ChatStreamEvent) => {
        if (e.turnId !== live.current.turnId) return
        if (e.kind === 'text') {
          pending.current += e.text
          if (!raf.current) raf.current = requestAnimationFrame(flushText)
        } else if (e.kind === 'tool') {
          if (raf.current) cancelAnimationFrame(raf.current)
          flushText()
          patchLast((m) => {
            const i = m.parts.findIndex((p) => p.type === 'tool' && p.id === e.part.id)
            const parts = [...m.parts]
            if (i >= 0) parts[i] = e.part
            else parts.push(e.part)
            return { ...m, parts }
          })
        } else if (e.kind === 'done') {
          finish((m) => m)
        } else {
          finish((m) => ({ ...m, error: e.message }))
        }
      }),
    [flushText, patchLast, finish]
  )

  const run = useCallback((history: ChatMessage[], chips: number[], fileIds: string[]) => {
    const id = uid()
    const assistant: ChatMessage = { id: uid(), role: 'assistant', parts: [] }
    setMessages([...history, assistant])
    setTurnId(id)
    live.current = { ...live.current, turnId: id }
    void window.api.chatSend({
      turnId: id,
      messages: history,
      chips,
      files: fileIds,
      mode: 'panel'
    })
  }, [])

  const took = useCallback((r: { files: ChatFile[]; failed: string[] }) => {
    if (r.files.length)
      setFiles((fs) => [...fs, ...r.files.filter((f) => !fs.some((x) => x.name === f.name))])
    setAttachNote(
      r.failed.length ? `Could not read ${r.failed.join(', ')}. PDFs and text files work.` : ''
    )
  }, [])
  const pickFiles = useCallback(() => void window.api.chatPickFiles().then(took), [took])
  const dropFiles = useCallback(
    (list: File[]) => {
      if (list.length) void window.api.chatAttach(list).then(took)
    },
    [took]
  )
  const removeFile = useCallback(
    (id: string) => setFiles((fs) => fs.filter((f) => f.id !== id)),
    []
  )

  const send = useCallback(
    (text: string) => {
      const t = text.trim()
      if (!t || live.current.turnId) return
      if (hiddenPage) ephemeral.current = true
      const chips: ChatChip[] = []
      if (currentOn && page)
        chips.push({ tabId: page.id, title: page.aiTitle ?? page.title, current: true })
      for (const m of mentions) if (!chips.some((c) => c.tabId === m.tabId)) chips.push(m)
      const user: ChatMessage = {
        id: uid(),
        role: 'user',
        parts: [{ type: 'text', text: t }],
        ...(chips.length ? { chips } : {}),
        ...(files.length ? { files } : {})
      }
      setMentions([])
      setAttachNote('')
      run(
        [...live.current.messages.filter((m) => !m.error || m.role === 'user'), user],
        chips.map((c) => c.tabId),
        files.map((f) => f.id)
      )
    },
    [currentOn, hiddenPage, mentions, page, run, files]
  )

  const stop = useCallback(() => {
    const id = live.current.turnId
    if (id) window.api.chatStop(id)
  }, [])

  /** Ask the same thing again after a failed turn. */
  const retry = useCallback(() => {
    const ms = live.current.messages
    const lastUser = [...ms].reverse().find((m) => m.role === 'user')
    if (!lastUser || live.current.turnId) return
    const upto = ms.lastIndexOf(lastUser)
    run(
      ms.slice(0, upto + 1),
      (lastUser.chips ?? []).map((c) => c.tabId),
      (lastUser.files ?? []).map((f) => f.id)
    )
  }, [run])

  const answer = useCallback((callId: string, ok: boolean) => {
    const id = live.current.turnId
    if (id) window.api.chatAnswer(id, callId, ok)
  }, [])

  const reset = useCallback(() => {
    const { turnId: t } = live.current
    if (t) window.api.chatStop(t)
    setTurnId(null)
    setMessages([])
    setMentions([])
    setFiles([])
    setAttachNote('')
    setChatId(uid())
    ephemeral.current = false
  }, [])

  const open = useCallback(
    (id: string) => {
      void window.api.chatLoad(id).then((c: Conversation | null) => {
        if (!c) return
        reset()
        setChatId(c.id)
        setMessages(c.messages)
      })
    },
    [reset]
  )

  const remove = useCallback(
    (id: string) => {
      window.api.chatDelete(id)
      if (id === live.current.chatId) reset()
      window.setTimeout(refreshSaved, 100)
    },
    [refreshSaved, reset]
  )

  const lastText = useMemo(() => {
    const m = messages[messages.length - 1]
    return m && m.role === 'assistant' ? messageText(m) : ''
  }, [messages])

  return {
    info,
    messages,
    streaming: turnId !== null,
    currentOn,
    setCurrentOn,
    mentions,
    setMentions,
    hiddenPage,
    page,
    saved,
    lastText,
    files,
    attachNote,
    pickFiles,
    dropFiles,
    removeFile,
    send,
    stop,
    retry,
    answer,
    reset,
    open,
    remove,
    refreshInfo
  }
}
