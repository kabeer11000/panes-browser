import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SpaceChat as Chat } from '@shared/types'
import { unreadAfter, type ChatMessage } from '@shared/share/chat'

/**
 * A shared space's chat on the board (tasks/shared-spaces.md, phase 8): a button in the top bar with what is unread,
 * and a panel under it. The messages are in the room's document (sealed end to end); people on the web board see and
 * write the same ones.
 */

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

function Messages({ messages, me }: { messages: ChatMessage[]; me: number }): React.JSX.Element {
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
            <p>{m.text}</p>
          </div>
        )
      })}
    </div>
  )
}

export function SpaceChat({
  spaceId,
  shared
}: {
  spaceId: number
  shared: boolean
}): React.JSX.Element | null {
  const chat = useChat(spaceId, shared)
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(() => readSeen(spaceId))
  const [draft, setDraft] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const last = chat?.messages.at(-1)?.id ?? null
  // what is on screen while open is read (kept for the next time Panes opens)
  useEffect(() => {
    if (!open || !last) return
    try {
      localStorage.setItem(seenKey(spaceId), last)
    } catch {
      // storage off: unread counts again next time
    }
  }, [open, last, spaceId])
  /** Open or close; closing counts everything shown as read. */
  const toggle = (on: boolean): void => {
    if (!on && open) setSeen(last)
    setOpen(on)
  }
  useEffect(() => {
    if (open) box.current?.focus()
  }, [open])
  if (!shared || !chat) return null
  const unread = open ? 0 : unreadAfter(chat.messages, seen, chat.me)
  const send = (): void => {
    const t = draft.trim()
    if (!t) return
    window.api.share?.say(spaceId, t)
    setDraft('')
  }
  return (
    <div className="cv-chat-host">
      <button
        type="button"
        className={'cv-chat-btn' + (open ? ' on' : '')}
        aria-expanded={open}
        aria-label={unread ? `Chat, ${unread} unread` : 'Chat'}
        title="Chat with everyone in this space"
        onClick={() => toggle(!open)}
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
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </svg>
        {unread > 0 && <span className="cv-chat-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="cv-chat" role="dialog" aria-label="Chat">
          <header>
            <b>Chat</b>
            <span>Everyone in this space sees it, on Panes and on the web.</span>
          </header>
          <Messages messages={chat.messages} me={chat.me} />
          <form
            className="cv-chat-say"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <textarea
              ref={box}
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
                } else if (e.key === 'Escape') toggle(false)
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
        </div>
      )}
    </div>
  )
}
