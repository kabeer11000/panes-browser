import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { chatRows, recentWriters, type ChatMessage } from '@shared/share/chat'
import type { ChatState } from './chatState'
import { Face } from './Face'
import { formatBytes } from '@shared/downloads'

/**
 * The space's chat on the web board: the same messages as in Panes (the room's document, sealed end to end). One
 * chat for the page (`useChat`): its button in the top bar and in a live tab's bar, its panel on the board's right
 * edge, or inside the live view (so it is there in full screen too).
 */

const time = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function ChatButton({
  chat,
  className = 'wb-chat-btn'
}: {
  chat: ChatState
  className?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={className + (chat.open ? ' on' : '')}
      aria-expanded={chat.open}
      aria-label={chat.unread ? `Chat, ${chat.unread} unread` : 'Chat'}
      title="Chat"
      onClick={() => chat.toggle(!chat.open)}
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
      {chat.unread > 0 && (
        <span className="wb-chat-count">{chat.unread > 99 ? '99+' : chat.unread}</span>
      )}
    </button>
  )
}

export function ChatPanel({
  messages,
  me,
  onSay,
  join,
  chat,
  docked
}: {
  messages: ChatMessage[]
  me: number
  onSay: (text: string) => void
  /** Open this space in Panes (a file offered in the chat is downloaded there). */
  join: string
  chat: ChatState
  /** Inside the live view, beside the picture (not over the board). */
  docked?: boolean
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const atEnd = useRef(true)
  const box = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = list.current
    if (el && atEnd.current) el.scrollTop = el.scrollHeight
  }, [messages])
  useEffect(() => box.current?.focus(), [])
  const send = (): void => {
    const t = draft.trim()
    if (!t) return
    onSay(t)
    setDraft('')
    atEnd.current = true
  }
  return (
    <div className={'wb-chat' + (docked ? ' docked' : '')} role="dialog" aria-label="Chat">
      <header className="wb-dock-head wb-chat-head">
        <div className="wb-chat-title">
          <strong>Chat</strong>
          <span>Everyone here sees it · end-to-end encrypted</span>
        </div>
        <button
          type="button"
          title="Hide (Esc)"
          aria-label="Hide the chat"
          onClick={() => chat.toggle(false)}
        >
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
      <div
        ref={list}
        className="wb-chat-list"
        onScroll={(e) => {
          const el = e.currentTarget
          atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {messages.length === 0 && (
          <div className="wb-chat-empty">
            <b>No messages yet</b>
            <span>Say hello to everyone in this space.</span>
          </div>
        )}
        {chatRows(messages, me).map((r) =>
          r.kind === 'day' ? (
            <div key={r.key} className="wb-chat-day">
              <span>{r.label}</span>
            </div>
          ) : (
            <div
              key={r.m.id}
              className={
                'wb-chat-msg' +
                (r.mine ? ' mine' : '') +
                (r.first ? ' first' : '') +
                (r.last ? ' last' : '')
              }
            >
              {!r.mine && (
                <span className="wb-chat-avatar" aria-hidden="true">
                  {r.first && <Face name={r.m.name} color={r.m.color} size={26} />}
                </span>
              )}
              <div className="wb-chat-body">
                {r.first && (
                  <div className="wb-chat-who">
                    {!r.mine && <b style={{ color: r.m.color }}>{r.m.name}</b>}
                    <time>{time(r.m.at)}</time>
                  </div>
                )}
                {r.m.file ? (
                  <div className="wb-file">
                    <span className="wb-file-ext" aria-hidden="true">
                      {(/\.([a-z0-9]{1,5})$/i.exec(r.m.file.name)?.[1] ?? 'file')
                        .toUpperCase()
                        .slice(0, 4)}
                    </span>
                    <span className="wb-file-words">
                      <b title={r.m.file.name}>{r.m.file.name}</b>
                      <small>
                        {formatBytes(r.m.file.size)} &middot;{' '}
                        <a href={join}>Open in Panes to download</a>
                      </small>
                    </span>
                  </div>
                ) : (
                  <p title={r.first ? undefined : time(r.m.at)}>{r.m.text}</p>
                )}
              </div>
            </div>
          )
        )}
      </div>
      <form
        className="wb-chat-say"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <div className="wb-chat-field">
          <textarea
            ref={box}
            rows={1}
            value={draft}
            maxLength={2000}
            placeholder="Message everyone"
            aria-label="Message"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // the live view's keys go to the page being driven: typing here is the chat's
              e.stopPropagation()
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              } else if (e.key === 'Escape') chat.toggle(false)
            }}
          />
          <button type="submit" className="wb-chat-send" disabled={!draft.trim()} aria-label="Send">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  )
}

/** How long a new message peeks out of the lip before it tucks back in (Panes' SpaceChat). */
const PEEK_MS = 4500

/**
 * The chat tucked away: a lip on the right edge, as on Panes' board, with who wrote last and what is unread; new
 * messages from someone else peek out of it as a card for a moment, with Reply.
 */
export function ChatLip({
  chat,
  messages,
  me
}: {
  chat: ChatState
  messages: ChatMessage[]
  me: number
}): React.JSX.Element | null {
  const last = messages.at(-1) ?? null
  const [peek, setPeek] = useState<{ m: ChatMessage; more: number } | null>(null)
  const peeked = useRef(last?.id ?? null)
  useEffect(() => {
    if (!last || last.id === peeked.current) return
    peeked.current = last.id
    if (chat.open || last.by === me) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a message arrived from elsewhere: show it now
    setPeek((p) => ({ m: last, more: p ? p.more + 1 : 0 }))
    const t = window.setTimeout(() => setPeek(null), PEEK_MS)
    return () => window.clearTimeout(t)
  }, [last, chat.open, me])
  if (chat.open) return null
  const writers = recentWriters(messages, me)
  const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation() }
  return (
    <>
      <button
        type="button"
        className={'wb-lip' + (chat.unread ? ' unread' : '')}
        aria-label={chat.unread ? `Chat, ${chat.unread} unread` : 'Chat'}
        title="Chat with everyone in this space"
        {...stop}
        onClick={() => chat.toggle(true)}
      >
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
        {writers.length > 0 && (
          <span className="wb-lip-faces" aria-hidden="true">
            {writers.map((p) => (
              <Face key={p.name + p.color} name={p.name} color={p.color} size={18} />
            ))}
          </span>
        )}
        {chat.unread > 0 && (
          <span className="wb-lip-count">{chat.unread > 99 ? '99+' : chat.unread}</span>
        )}
      </button>
      {peek && (
        <div key={peek.m.id} className="wb-peek" role="status" {...stop}>
          <Face name={peek.m.name} color={peek.m.color} size={30} />
          <div className="wb-peek-body">
            <div className="wb-peek-who">
              <b>{peek.m.name.split(' ')[0]}</b>
              {peek.more > 0 && <span>+{peek.more} more</span>}
              <time>{time(peek.m.at)}</time>
            </div>
            <p>{peek.m.file ? `Shared ${peek.m.file.name}` : peek.m.text}</p>
            <button
              type="button"
              className="wb-peek-reply"
              onClick={() => {
                setPeek(null)
                chat.toggle(true)
              }}
            >
              Reply
            </button>
          </div>
          <button
            type="button"
            className="wb-peek-x"
            aria-label="Dismiss"
            onClick={() => setPeek(null)}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path
                d="M2 2l6 6M8 2l-6 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      )}
    </>
  )
}
