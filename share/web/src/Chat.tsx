import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { unreadAfter, type ChatMessage } from '@shared/share/chat'
import { formatBytes } from '@shared/downloads'

/** The space's chat on the web board: the same messages as in Panes (the room's document, sealed end to end). */

const time = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function Chat({
  messages,
  me,
  onSay,
  join
}: {
  messages: ChatMessage[]
  me: number
  onSay: (text: string) => void
  /** Open this space in Panes (a file offered in the chat is downloaded there). */
  join: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const atEnd = useRef(true)
  const box = useRef<HTMLTextAreaElement>(null)
  const last = messages.at(-1)?.id ?? null
  useLayoutEffect(() => {
    const el = list.current
    if (el && atEnd.current) el.scrollTop = el.scrollHeight
  }, [messages, open])
  useEffect(() => {
    if (open) box.current?.focus()
  }, [open])
  const toggle = (on: boolean): void => {
    if (!on && open) setSeen(last)
    setOpen(on)
  }
  const unread = open ? 0 : unreadAfter(messages, seen, me)
  const send = (): void => {
    const t = draft.trim()
    if (!t) return
    onSay(t)
    setDraft('')
    atEnd.current = true
  }
  return (
    <div className="wb-chat-host">
      <button
        type="button"
        className={'wb-chat-btn' + (open ? ' on' : '')}
        aria-expanded={open}
        aria-label={unread ? `Chat, ${unread} unread` : 'Chat'}
        onClick={() => toggle(!open)}
      >
        <svg
          width="17"
          height="17"
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
        {unread > 0 && <span className="wb-chat-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="wb-chat" role="dialog" aria-label="Chat">
          <header className="wb-dock-head">
            <strong>Chat</strong>
            <span className="wb-dock-sp" />
            <button
              type="button"
              title="Hide (Esc)"
              aria-label="Hide the chat"
              onClick={() => toggle(false)}
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
          <p className="wb-chat-sub">Everyone in this space sees it, in Panes and on the web.</p>
          <div
            ref={list}
            className="wb-chat-list"
            onScroll={(e) => {
              const el = e.currentTarget
              atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
            }}
          >
            {messages.length === 0 && <p className="wb-chat-empty">Say hello to everyone here.</p>}
            {messages.map((m, i) => {
              const prev = messages[i - 1]
              const first = !prev || prev.by !== m.by || m.at - prev.at > 5 * 60_000
              const mine = m.by === me
              return (
                <div
                  key={m.id}
                  className={'wb-chat-msg' + (mine ? ' mine' : '') + (first ? ' first' : '')}
                >
                  {first && (
                    <div className="wb-chat-who">
                      {!mine && <b style={{ color: m.color }}>{m.name}</b>}
                      <time>{time(m.at)}</time>
                    </div>
                  )}
                  {m.file ? (
                    <div className="wb-file">
                      <span className="wb-file-ext" aria-hidden="true">
                        {(/\.([a-z0-9]{1,5})$/i.exec(m.file.name)?.[1] ?? 'file')
                          .toUpperCase()
                          .slice(0, 4)}
                      </span>
                      <span className="wb-file-words">
                        <b title={m.file.name}>{m.file.name}</b>
                        <small>
                          {formatBytes(m.file.size)} &middot;{' '}
                          <a href={join}>Open in Panes to download</a>
                        </small>
                      </span>
                    </div>
                  ) : (
                    <p>{m.text}</p>
                  )}
                </div>
              )
            })}
          </div>
          <form
            className="wb-chat-say"
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
