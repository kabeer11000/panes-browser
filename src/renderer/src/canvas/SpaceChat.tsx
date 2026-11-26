import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { SpaceChat as Chat, SharePerson } from '@shared/types'
import { unreadAfter, type ChatMessage } from '@shared/share/chat'
import { formatBytes } from '@shared/downloads'
import { useShareState } from '@renderer/components/useShare'
import { cancelFetch, fetchFile, holds, postFile, useFetching } from '@renderer/fileSend'

/**
 * A shared space's chat on the board (tasks/shared-spaces.md, phase 8): a side panel like Ask's, tucked away into a
 * lip on the board's right edge (with what is unread, and a new message peeking out of it). The messages are in the
 * room's document (sealed end to end); people on the web board see and write the same ones.
 */

const NOBODY: SharePerson[] = []
const seenKey = (spaceId: number): string => `panes:chat-seen:${spaceId}`
const readSeen = (spaceId: number): string | null => {
  try {
    return localStorage.getItem(seenKey(spaceId))
  } catch {
    return null
  }
}
const time = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** How long a new message peeks out of the lip before it tucks back in. */
const PEEK_MS = 4500
/** The panel's motion, Ask's (AskDock.tsx). */
const SPRING = { type: 'spring', stiffness: 420, damping: 36, mass: 0.9 } as const

function useChat(spaceId: number, shared: boolean): Chat | null {
  const [got, setGot] = useState<{ id: number; chat: Chat } | null>(null)
  useEffect(() => {
    const share = window.api.share
    if (!shared || !share?.chat) return
    let alive = true
    void share.chat(spaceId).then((c) => alive && c && setGot({ id: spaceId, chat: c }))
    const off = share.onChat((id, c) => id === spaceId && setGot({ id, chat: c }))
    return () => {
      alive = false
      off()
    }
  }, [spaceId, shared])
  return shared && got?.id === spaceId ? got.chat : null
}

const extOf = (name: string): string =>
  (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? 'file').toUpperCase().slice(0, 4)

/**
 * A file offered in the chat: fetched straight from the Panes of whoever offered it (renderer/fileSend.ts), while it
 * is open. Their own: whether this Panes still holds it.
 */
function FileMsg({
  m,
  mine,
  spaceId,
  people
}: {
  m: ChatMessage
  mine: boolean
  spaceId: number
  people: SharePerson[]
}): React.JSX.Element {
  const f = m.file!
  const got = useFetching()[f.id]
  const from = people.find((p) => p.id === m.by && p.files && p.rtc)
  const pct = got && f.size ? Math.min(100, Math.round((got.got / f.size) * 100)) : 0
  let status: string
  let action: React.JSX.Element | null = null
  if (mine)
    status = holds(f.id) ? 'Others can download it while Panes is open' : 'No longer available'
  else if (got?.state === 'getting') {
    status = `${formatBytes(got.got)} of ${formatBytes(f.size)}`
    action = (
      <button type="button" className="cv-file-act quiet" onClick={() => cancelFetch(f.id)}>
        Cancel
      </button>
    )
  } else if (got?.state === 'saved') status = 'Saved to your downloads'
  else if (!from) status = `${m.name.split(' ')[0]} has left: ask them to send it again`
  else {
    status =
      got?.state === 'gone'
        ? 'No longer available: ask them to send it again'
        : got?.state === 'failed'
          ? 'Could not connect directly. Try again'
          : got?.state === 'cancelled'
            ? 'Cancelled'
            : formatBytes(f.size)
    if (got?.state !== 'gone')
      action = (
        <button
          type="button"
          className="cv-file-act"
          onClick={() => void fetchFile(spaceId, from.rtc, f)}
        >
          {got ? 'Try again' : 'Download'}
        </button>
      )
  }
  return (
    <div className={'cv-file' + (got?.state === 'saved' ? ' saved' : '')}>
      <span className="cv-file-ext" aria-hidden="true">
        {extOf(f.name)}
      </span>
      <span className="cv-file-text">
        <b title={f.name}>{f.name}</b>
        <small>{status}</small>
        {got?.state === 'getting' && (
          <span className="cv-file-bar" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </span>
        )}
      </span>
      {action}
    </div>
  )
}

function Messages({
  messages,
  me,
  spaceId,
  people
}: {
  messages: ChatMessage[]
  me: number
  spaceId: number
  people: SharePerson[]
}): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null)
  const atEnd = useRef(true)
  // stays at the newest unless the person scrolled up to read
  useLayoutEffect(() => {
    const el = list.current
    if (el && atEnd.current) el.scrollTop = el.scrollHeight
  }, [messages])
  return (
    <div
      ref={list}
      className="cv-chat-list"
      onScroll={(e) => {
        const el = e.currentTarget
        atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
    >
      {messages.length === 0 && (
        <p className="cv-chat-empty">Say something to everyone in this space.</p>
      )}
      {messages.map((m, i) => {
        const prev = messages[i - 1]
        const first = !prev || prev.by !== m.by || m.at - prev.at > 5 * 60_000
        const mine = m.by === me
        return (
          <div
            key={m.id}
            className={'cv-chat-msg' + (mine ? ' mine' : '') + (first ? ' first' : '')}
          >
            {first && (
              <div className="cv-chat-who">
                {!mine && <b style={{ color: m.color }}>{m.name}</b>}
                <time>{time(m.at)}</time>
              </div>
            )}
            {m.file ? (
              <FileMsg m={m} mine={mine} spaceId={spaceId} people={people} />
            ) : (
              <p>{m.text}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ChatGlyph(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </svg>
  )
}

export function SpaceChat({
  spaceId,
  shared,
  open,
  onOpen,
  onClose,
  onResize
}: {
  spaceId: number
  shared: boolean
  /** The panel is out (the board keeps one side panel at a time: this or Ask, see Canvas.tsx). */
  open: boolean
  onOpen: () => void
  onClose: () => void
  /** Its width, shared with Ask's (dragged from its left edge). */
  onResize: (w: number) => void
}): React.JSX.Element | null {
  const chat = useChat(spaceId, shared)
  const people = useShareState(spaceId, shared)?.people ?? NOBODY
  const [dropping, setDropping] = useState(false)
  const pick = useRef<HTMLInputElement>(null)
  const [seen, setSeen] = useState(() => readSeen(spaceId))
  const [draft, setDraft] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const reduced = useReducedMotion()
  const last = chat?.messages.at(-1) ?? null
  const lastId = last?.id ?? null
  // what is on screen while open is read (kept for the next time Panes opens)
  useEffect(() => {
    if (!open || !lastId) return
    try {
      localStorage.setItem(seenKey(spaceId), lastId)
    } catch {
      // storage off: unread counts again next time
    }
  }, [open, lastId, spaceId])
  useEffect(() => {
    if (open) box.current?.focus()
  }, [open])
  // a new message from someone else, while tucked away: it peeks out of the lip for a moment
  const [peek, setPeek] = useState<ChatMessage | null>(null)
  const peeked = useRef(lastId)
  useEffect(() => {
    if (!last || last.id === peeked.current) return
    peeked.current = last.id
    if (open || last.by === chat?.me) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a message arrived from elsewhere: show it now
    setPeek(last)
    const t = window.setTimeout(() => setPeek(null), PEEK_MS)
    return () => window.clearTimeout(t)
  }, [last, open, chat?.me])
  if (!shared || !chat) return null
  const unread = open ? 0 : unreadAfter(chat.messages, seen, chat.me)
  const close = (): void => {
    setSeen(lastId) // what was shown counts as read
    onClose()
  }
  /** Files into the chat: offered to everyone here, fetched from this Panes by whoever wants them. */
  const offer = (files: Iterable<File> | null): void => {
    for (const f of files ?? []) postFile(spaceId, f)
  }
  const send = (): void => {
    const t = draft.trim()
    if (!t) return
    window.api.share?.say(spaceId, t)
    setDraft('')
  }
  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            key="lip"
            type="button"
            className={'cv-dock-handle cv-chat-lip' + (unread ? ' unread' : '')}
            aria-label={unread ? `Chat, ${unread} unread` : 'Chat'}
            title="Chat with everyone in this space"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            onClick={onOpen}
          >
            <ChatGlyph />
            {unread > 0 && <span className="cv-chat-count">{unread > 99 ? '99+' : unread}</span>}
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {!open && peek && (
          <motion.button
            key={peek.id}
            type="button"
            className="cv-chat-peek"
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 16, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 16, scale: 0.96 }}
            transition={reduced ? { duration: 0.12 } : SPRING}
            onClick={onOpen}
          >
            <b style={{ color: peek.color }}>{peek.name.split(' ')[0]}</b>
            <span>{peek.text}</span>
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.aside
            key="dock"
            className="cv-dock cv-chat-dock"
            aria-label="Chat"
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 40, transition: { duration: 0.18 } }}
            transition={reduced ? { duration: 0.12 } : SPRING}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('Files')) return
              e.preventDefault()
              e.stopPropagation()
              e.dataTransfer.dropEffect = 'copy'
              setDropping(true)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.files.length) return
              // the chat's, not the board's (which would make a card of it)
              e.preventDefault()
              e.stopPropagation()
              setDropping(false)
              offer(e.dataTransfer.files)
            }}
          >
            {dropping && (
              <div className="cv-chat-drop" aria-hidden="true">
                <b>Drop to share with everyone here</b>
                <span>Sent straight from your computer, never stored online</span>
              </div>
            )}
            <div
              className="cv-dock-rz"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the chat"
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                e.stopPropagation()
                const el = e.currentTarget
                const right = el.parentElement!.getBoundingClientRect().right
                el.setPointerCapture(e.pointerId)
                el.classList.add('on')
                const move = (ev: PointerEvent): void => onResize(Math.round(right - ev.clientX))
                const up = (): void => {
                  el.classList.remove('on')
                  el.removeEventListener('pointermove', move)
                  el.removeEventListener('pointerup', up)
                  el.removeEventListener('pointercancel', up)
                }
                el.addEventListener('pointermove', move)
                el.addEventListener('pointerup', up)
                el.addEventListener('pointercancel', up)
              }}
            />
            <header className="cv-dock-head">
              <strong>Chat</strong>
              <span className="cv-dock-sp" />
              <button type="button" title="Hide (Esc)" aria-label="Hide the chat" onClick={close}>
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <path
                    d="M6 3l5 5-5 5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </header>
            <p className="cv-chat-sub">Everyone in this space sees it, on Panes and on the web.</p>
            <Messages messages={chat.messages} me={chat.me} spaceId={spaceId} people={people} />
            <form
              className="cv-chat-say"
              onSubmit={(e) => {
                e.preventDefault()
                send()
              }}
            >
              <input
                ref={pick}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  offer(e.target.files)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className="cv-chat-attach"
                title="Share a file with everyone here"
                aria-label="Share a file"
                onClick={() => pick.current?.click()}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
                </svg>
              </button>
              <textarea
                ref={box}
                onPaste={(e) => {
                  if (!e.clipboardData.files.length) return
                  e.preventDefault()
                  offer(e.clipboardData.files)
                }}
                rows={1}
                value={draft}
                maxLength={2000}
                placeholder="Message"
                aria-label="Message"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    send()
                  } else if (e.key === 'Escape') close()
                }}
              />
              <button type="submit" disabled={!draft.trim()} aria-label="Send">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  )
}
