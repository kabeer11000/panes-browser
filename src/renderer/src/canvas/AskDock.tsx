import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { exampleAsks, splitBlocks } from '@shared/ai/canvasPlace'
import { boardStatus } from '@shared/ai/canvasTools'
import { queueLabel } from '@shared/ai/canvasQueue'
import { displayHost } from '@shared/url'
import { Markdown } from '@renderer/components/chat/Markdown'
import { workingLabel } from '@renderer/components/chat/workingLabel'
import '@renderer/components/chat/chat.css'
import type { AskApi, AskTurn } from './useAsk'
import './ask.css'

interface Props {
  ask: AskApi
  /** Whether AI is enabled for this canvas board. */
  enabled?: boolean
  /** Whether AI is currently thinking/working on the board. */
  busy?: boolean
  /** Open the dock and focus its input box. */
  onShow?: () => void
  /** Submit a message or query from the dock's input box. */
  onSubmit?: (q: string) => void
  /** Tabs that can be @mentioned in the dock's input box. */
  mentionable?: Array<{ tab: number; title: string }>
  /** Titles of what is on the board, for the example asks. */
  titles: string[]
  /** A source or link: pan to its card (or open it as a card). */
  onOpen: (url: string, tab?: number) => void
  /** Put this text on the board (an answer, or a part of one), next to the cards it came from. */
  onAdd: (text: string, turn: AskTurn) => void
  /** Run an example ask. */
  onExample: (q: string) => void
  canUndo: boolean
  onUndo: () => void
  /** A step the person must answer first, from the assistant's tools. */
  confirm: { text: string; answer: (ok: boolean) => void } | null
  /** Its width was dragged (px; the board keeps it for the space). */
  onResize?: (w: number) => void
  /** Its message box, for the board to put the cursor in ("Ask about this"). */
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
}

const SPRING = { type: 'spring', stiffness: 420, damping: 36, mass: 0.9 } as const

const badge = (url: string): string => {
  const parts = (displayHost(url) || '?').split('.')
  return (parts.length > 1 ? parts[parts.length - 2] : parts[0]).charAt(0).toUpperCase()
}

/** One quiet line saying what the assistant is doing right now. */
function statusOf(t: AskTurn): string {
  const last = [...t.steps].reverse().find((s) => s.state === 'running' || s.state === 'confirm')
  if (last) return boardStatus(last.name) ?? workingLabel(t.steps)
  if (t.text === '')
    return t.tabs.length
      ? `Reading ${t.tabs.length === 1 ? '1 tab' : `${t.tabs.length} tabs`}`
      : 'Thinking'
  return 'Writing'
}

function Answer({
  turn,
  onAdd,
  onOpen
}: {
  turn: AskTurn
  onAdd: Props['onAdd']
  onOpen: Props['onOpen']
}): React.JSX.Element {
  const parts = useMemo(() => splitBlocks(turn.text), [turn.text])
  return (
    <div
      className={'cv-dock-a' + (turn.done ? '' : ' streaming')}
      onClickCapture={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (!a) return
        e.preventDefault()
        e.stopPropagation()
        const href = a.getAttribute('href') ?? ''
        if (/^https?:\/\//i.test(href)) onOpen(href)
      }}
    >
      {parts.map((p, i) => (
        <div className="cv-part" key={i}>
          <Markdown text={p} />
          {turn.done && (
            <button
              type="button"
              className="cv-part-add"
              title="Add this to the canvas"
              aria-label="Add this part to the canvas"
              onClick={() => onAdd(p, turn)}
            >
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path
                  d="M8 3v10M3 8h10"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * The conversation, docked on the right edge: narrow, glass, the latest answer open and older turns as one-line
 * rows. Every answer, and every part of one, can be added to the board; nothing lands there otherwise. Waiting
 * messages and the context attached to the next one sit at the foot.
 */
export function AskDock({
  ask,
  enabled = true,
  busy = false,
  onShow,
  onSubmit,
  mentionable = [],
  titles,
  onOpen,
  onAdd,
  onExample,
  confirm,
  canUndo,
  onUndo,
  onResize,
  inputRef
}: Props): React.JSX.Element {
  const working = ask.streaming || busy
  const [draft, setDraft] = useState('')
  const [at, setAt] = useState<string | null>(null)
  const sendDraft = (): void => {
    const q = draft.trim()
    if (!q) return
    setDraft('')
    setAt(null)
    if (inputRef?.current) inputRef.current.style.height = 'auto'
    if (onSubmit) onSubmit(q)
    else ask.ask(q)
  }
  const reduced = useReducedMotion()
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [opened, setOpenTurn] = useState<{ id: string; n: number } | null>(null)
  const openTurn = opened && opened.n === ask.turns.length ? opened.id : null
  const [editing, setEditing] = useState<string | null>(null)
  const dragId = useRef<string | null>(null)
  const last = ask.turns[ask.turns.length - 1]
  const hints = useMemo(() => exampleAsks(titles), [titles])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })
  useEffect(() => {
    stick.current = true
  }, [ask.turns.length])

  return (
    <>
      <AnimatePresence>
        {enabled && !ask.open && (
          <motion.button
            key="handle"
            type="button"
            className={'cv-dock-handle ai-edge' + (working ? ' on' : '')}
            aria-label="Show the conversation"
            title="Ask AI"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            onClick={() => (onShow ? onShow() : ask.show())}
          >
            Ask
            {working && <i className="cv-dock-dot" aria-hidden="true" />}
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {enabled && ask.open && (
          <motion.aside
            key="dock"
            className="cv-dock"
            aria-label="Conversation"
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 40, transition: { duration: 0.18 } }}
            transition={reduced ? { duration: 0.12 } : SPRING}
          >
            <div
              className="cv-dock-rz"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the conversation"
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                e.stopPropagation()
                const el = e.currentTarget
                const right = el.parentElement!.getBoundingClientRect().right
                el.setPointerCapture(e.pointerId)
                el.classList.add('on')
                const move = (ev: PointerEvent): void => onResize?.(Math.round(right - ev.clientX))
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
              <strong>Ask</strong>
              <span className="cv-dock-sp" />
              <button
                type="button"
                title="New conversation"
                aria-label="New conversation"
                disabled={ask.turns.length === 0 && ask.queue.length === 0}
                onClick={ask.reset}
              >
                New
              </button>
              <button
                type="button"
                title="Hide (Esc)"
                aria-label="Hide the conversation"
                onClick={ask.close}
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
              className="cv-dock-scroll"
              ref={scroller}
              role="log"
              aria-live="polite"
              onScroll={(e) => {
                const el = e.currentTarget
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
              }}
            >
              {ask.turns.length === 0 && (
                <div className="cv-dock-hints">
                  <p>
                    Ask about anything on the board or in your tabs, or have it tidy the board for
                    you.
                  </p>
                  {hints.map((h) => (
                    <button key={h} type="button" onClick={() => onExample(h)}>
                      {h}
                    </button>
                  ))}
                </div>
              )}
              {ask.turns.map((t) => {
                const latest = t === last
                const expanded = latest || openTurn === t.id
                const cites = latest
                  ? ask.sources.filter(
                      (s) => t.tabs.some((id) => id === s.tab) || t.text.includes(s.url)
                    )
                  : []
                return (
                  <section key={t.id} className={'cv-dock-turn' + (expanded ? ' open' : '')}>
                    {expanded ? (
                      <p className="cv-dock-q">{t.q}</p>
                    ) : (
                      <button
                        type="button"
                        className="cv-dock-row"
                        onClick={() => setOpenTurn({ id: t.id, n: ask.turns.length })}
                        title={t.q}
                      >
                        <span>{t.q}</span>
                        <small>{t.text.replace(/[#*_`>\-[\]()]/g, '').slice(0, 70)}</small>
                      </button>
                    )}
                    {expanded && (
                      <>
                        {t.did.map((d, i) => (
                          <p className="cv-dock-did" key={i}>
                            {d}
                            {latest && canUndo && i === t.did.length - 1 && (
                              <>
                                {' · '}
                                <button type="button" onClick={onUndo}>
                                  Undo
                                </button>
                              </>
                            )}
                          </p>
                        ))}
                        {t.text && <Answer turn={t} onAdd={onAdd} onOpen={onOpen} />}
                        {t.error && <p className="cv-dock-err">{t.error}</p>}
                        {cites.length > 0 && (
                          <div className="cv-ask-sources" aria-label="Sources">
                            {cites.map((s) => (
                              <button
                                key={s.url}
                                type="button"
                                className="cv-ask-src"
                                title={s.url}
                                onClick={() => onOpen(s.url, s.tab)}
                              >
                                <i aria-hidden="true">{badge(s.url)}</i>
                                <span>
                                  {s.title && s.title !== s.url ? s.title : displayHost(s.url)}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {t.done && t.text && (
                          <div className="cv-dock-acts">
                            <button type="button" onClick={() => onAdd(t.text, t)}>
                              Add to canvas
                            </button>
                            <button
                              type="button"
                              onClick={() => void navigator.clipboard.writeText(t.text)}
                            >
                              Copy
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </section>
                )
              })}
            </div>
            <div className="cv-dock-foot">
              {ask.streaming && last && (
                <div className="cv-dock-status" role="status">
                  <i className="cv-dock-dot" aria-hidden="true" />
                  <span>{confirm ? 'Waiting for your answer' : statusOf(last)}</span>
                  <button type="button" onClick={ask.stop}>
                    Stop
                  </button>
                </div>
              )}
              {confirm && (
                <div className="cv-dock-confirm" role="alertdialog" aria-label="Confirm">
                  <span>{confirm.text}</span>
                  <button type="button" onClick={() => confirm.answer(false)}>
                    Not now
                  </button>
                  <button type="button" className="primary" onClick={() => confirm.answer(true)}>
                    Allow
                  </button>
                </div>
              )}
              {ask.queue.length > 0 && (
                <div className="cv-dock-queue" aria-label="Waiting messages">
                  <div className="cv-dock-queue-head">
                    <span>{queueLabel(ask.queue.length)}</span>
                    <button type="button" onClick={ask.clearQueued}>
                      Clear queue
                    </button>
                  </div>
                  {ask.queue.map((q, i) => (
                    <div
                      key={q.id}
                      className="cv-dock-qrow"
                      draggable={editing !== q.id}
                      onDragStart={() => (dragId.current = q.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragId.current && dragId.current !== q.id)
                          ask.moveQueued(dragId.current, i)
                        dragId.current = null
                      }}
                    >
                      <span className="cv-dock-grip" aria-hidden="true">
                        :::
                      </span>
                      {editing === q.id ? (
                        <input
                          autoFocus
                          defaultValue={q.text}
                          aria-label="Edit waiting message"
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') {
                              ask.editQueued(q.id, e.currentTarget.value)
                              setEditing(null)
                            } else if (e.key === 'Escape') setEditing(null)
                          }}
                          onBlur={(e) => {
                            ask.editQueued(q.id, e.currentTarget.value)
                            setEditing(null)
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="cv-dock-qtext"
                          title="Edit"
                          onClick={() => setEditing(q.id)}
                        >
                          {q.text}
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label="Remove"
                        title="Remove"
                        onClick={() => ask.removeQueued(q.id)}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {ask.chips.length > 0 && (
                <div className="cv-dock-chips" aria-label="Attached to the next question">
                  {ask.chips.map((c) => (
                    <span key={c.tab} className="cv-dock-chip">
                      <span>{c.title}</span>
                      <button
                        type="button"
                        aria-label={`Leave out ${c.title}`}
                        onClick={() => ask.dropChip(c.tab)}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {/* the conversation's own box: the board's toolbar may be out of the way (a page is open) */}
              <form
                className={'cv-dock-input ai-edge' + (working ? ' on' : '')}
                onSubmit={(e) => {
                  e.preventDefault()
                  sendDraft()
                }}
              >
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={draft}
                  placeholder={
                    ask.turns.length ? 'Ask a follow-up' : 'Ask about the board or your tabs'
                  }
                  aria-label="Message"
                  onChange={(e) => {
                    const val = e.target.value
                    setDraft(val)
                    const m = /@([^\s@]{0,30})$/.exec(val)
                    setAt(m ? m[1].toLowerCase() : null)
                    const el = e.target
                    el.style.height = 'auto'
                    el.style.height = `${Math.min(168, el.scrollHeight)}px`
                  }}
                  onKeyDown={(e) => {
                    // the board's own keys (delete, tools) stay out of the text
                    e.stopPropagation()
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      sendDraft()
                    } else if (e.key === 'Escape') {
                      if (at !== null) {
                        setAt(null)
                        return
                      }
                      e.currentTarget.blur()
                      ask.close()
                    }
                  }}
                />
                {at !== null && mentionable.length > 0 && (
                  <div className="cv-mention" role="listbox" aria-label="Mention a tab">
                    {mentionable
                      .filter((t) => t.title.toLowerCase().includes(at))
                      .slice(0, 6)
                      .map((t) => (
                        <button
                          key={t.tab}
                          type="button"
                          role="option"
                          aria-selected="false"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setDraft((prev) => prev.replace(/@[^\s@]{0,30}$/, ''))
                            setAt(null)
                            ask.mention(t.tab)
                            inputRef?.current?.focus()
                          }}
                        >
                          {t.title}
                        </button>
                      ))}
                  </div>
                )}
                <button
                  type="submit"
                  className="cv-dock-send"
                  aria-label={ask.streaming ? 'Send after this answer' : 'Send'}
                  title={
                    ask.streaming
                      ? 'Send after this answer (it waits in the queue)'
                      : 'Send (Enter)'
                  }
                  disabled={!draft.trim()}
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <path
                      d="M8 13V3M3.5 7.5 8 3l4.5 4.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </form>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  )
}
