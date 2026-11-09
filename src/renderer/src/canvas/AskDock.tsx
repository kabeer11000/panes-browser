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
  titles,
  onOpen,
  onAdd,
  onExample,
  confirm,
  canUndo,
  onUndo
}: Props): React.JSX.Element {
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
        {!ask.open && ask.turns.length > 0 && (
          <motion.button
            key="handle"
            type="button"
            className="cv-dock-handle"
            aria-label="Show the conversation"
            title="Show the conversation"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            onClick={ask.show}
          >
            Ask
            {ask.streaming && <i className="cv-dock-dot" aria-hidden="true" />}
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {ask.open && (
          <motion.aside
            key="dock"
            className="cv-dock"
            aria-label="Conversation"
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 40, transition: { duration: 0.18 } }}
            transition={reduced ? { duration: 0.12 } : SPRING}
          >
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
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  )
}
