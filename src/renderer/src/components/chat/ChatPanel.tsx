import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { groupSteps, suggestionsFor, type ChatMessage, type StepGroup } from '@shared/ai/chatConv'
import type { TabInfo } from '@shared/types'
import { displayHost } from '@shared/url'
import { holdOverlay, releaseOverlay } from '@renderer/overlay'
import { CloseIcon, FileIcon, HistoryIcon, PlusIcon } from '../icons'
import { Blocked } from './Blocked'
import { Composer } from './Composer'
import { ModelPicker } from './ModelPicker'
import { Markdown } from './Markdown'
import { ConfirmCard, StepRow } from './Steps'
import { useChat, type ChatApi } from './useChat'
import { Working } from './Working'
import { workingLabel } from './workingLabel'
import { CHAT_MAX, CHAT_MIN, clampW, GAP } from './width'
import './chat.css'

/** Text to put in the box when the panel opens, e.g. a selection from the page; `key` makes each one new. */
export interface ChatDraft {
  text: string
  key: number
}

interface Props {
  tabs: TabInfo[]
  active: TabInfo | null
  width: number
  onWidth: (w: number) => void
  /** Pointer-dragging the edge: the width follows at once instead of gliding. */
  resizing: boolean
  onResizing: (on: boolean) => void
  focusKey: number
  draft?: ChatDraft | null
  onClose: () => void
}

function Body({
  chat,
  onSuggest
}: {
  chat: ChatApi
  onSuggest: (t: string) => void
}): React.JSX.Element {
  const { info, messages, page } = chat
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  // follow the stream only while the person is at the bottom: scrolling up to read stops it
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })
  useEffect(() => {
    stick.current = true
  }, [messages.length])

  if (info?.block) return <Blocked block={info.block} />
  if (messages.length === 0) {
    return (
      <div className="chat-state empty">
        <h3>{page ? 'Ask about this page' : 'How can I help?'}</h3>
        {page && <p className="host">{page.aiTitle ?? (page.title || displayHost(page.url))}</p>}
        <div className="chat-suggest">
          {suggestionsFor(page ? { title: page.title, url: page.url } : null).map((s) => (
            <button key={s} type="button" onClick={() => onSuggest(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div
      ref={scroller}
      className="chat-scroll"
      role="log"
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      }}
    >
      {messages.map((m, i) => (
        <Message
          key={m.id}
          m={m}
          last={i === messages.length - 1}
          streaming={chat.streaming}
          onAnswer={chat.answer}
          onRetry={chat.retry}
        />
      ))}
    </div>
  )
}

function Message({
  m,
  last,
  streaming,
  onAnswer,
  onRetry
}: {
  m: ChatMessage
  last: boolean
  streaming: boolean
  onAnswer: (callId: string, ok: boolean) => void
  onRetry: () => void
}): React.JSX.Element {
  if (m.role === 'user') {
    const text = m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
    return (
      <div className="chat-msg user">
        <div className="chat-bubble">{text}</div>
        {m.files && m.files.length > 0 && (
          <div className="chat-used">
            {m.files.map((f) => (
              <span key={f.id} className="file">
                <FileIcon />
                {f.name}
              </span>
            ))}
          </div>
        )}
        {m.chips && m.chips.length > 0 && (
          <div className="chat-used">
            {m.chips.map((c) => (
              <span key={c.tabId}>{c.current ? 'Current page' : c.title || 'Tab'}</span>
            ))}
          </div>
        )}
      </div>
    )
  }
  const blocks = groupSteps(m.parts)
  const tail = m.parts[m.parts.length - 1]
  // shown until words arrive, and again while a step runs after them
  const working =
    last &&
    streaming &&
    (m.parts.length === 0 || (tail?.type === 'tool' && tail.state !== 'confirm'))
  return (
    <div className="chat-msg assistant">
      {blocks.map((b, i) =>
        'steps' in b ? (
          (b as StepGroup).state === 'confirm' ? (
            <ConfirmCard key={b.steps[0].id} group={b as StepGroup} onAnswer={onAnswer} />
          ) : (
            <StepRow key={b.steps[0].id} group={b as StepGroup} />
          )
        ) : b.type === 'text' ? (
          <Markdown key={i} text={b.text} />
        ) : null
      )}
      {working && <Working label={workingLabel(m.parts)} />}
      {m.error && (
        <div className="chat-error" role="alert">
          <span>{m.error}</span>
          {last && !streaming && (
            <button type="button" className="chat-btn" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const ago = (t: number): string => {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m} min`
  if (m < 1440) return `${Math.round(m / 60)} h`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ChatPanel(p: Props): React.JSX.Element {
  const chat = useChat(p.active)
  const reduced = useReducedMotion()
  const [showHistory, setShowHistory] = useState(false)
  const { info } = chat
  const noModel = !info?.target
  const drag = useRef<{ x: number; w: number } | null>(null)
  const [dropping, setDropping] = useState(false)

  const closeAndReturn = (): void => {
    p.onClose()
    // the page gets the keyboard back
    if (p.active) window.api.activateTab(p.active.id)
  }

  const startDrag = (e: PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, w: p.width }
    p.onResizing(true)
    void holdOverlay('chat-resize')
  }
  const moveDrag = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (d) p.onWidth(clampW(d.w - (e.clientX - d.x)))
  }
  const endDrag = (): void => {
    if (!drag.current) return
    drag.current = null
    p.onResizing(false)
    void releaseOverlay('chat-resize')
    try {
      localStorage.setItem('panes:chat-w', String(p.width))
    } catch {
      // the width is just not remembered
    }
  }

  const status = chat.streaming ? 'Answering' : chat.lastText ? 'Answer ready' : ''
  return (
    <motion.aside
      className="chat-dock"
      aria-label="Chat"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: p.width + GAP, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={
        reduced || p.resizing ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
      }
      // closing: the panel is gone from the keyboard at once, not when the glide ends
      onKeyDown={(e) => e.key === 'Escape' && closeAndReturn()}
    >
      <div
        className={'chat-card' + (dropping ? ' dropping' : '') + (chat.streaming ? ' live' : '')}
        style={{ width: p.width }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files') || noModel) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDropping(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDropping(false)
          chat.dropFiles([...e.dataTransfer.files])
        }}
      >
        {dropping && (
          <div className="chat-drop" aria-hidden="true">
            <FileIcon />
            <span>Drop PDFs or text files to ask about them</span>
          </div>
        )}
        <div
          className="chat-edge"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat"
          aria-valuenow={p.width}
          aria-valuemin={CHAT_MIN}
          aria-valuemax={CHAT_MAX}
          tabIndex={0}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            e.preventDefault()
            e.stopPropagation()
            const w = clampW(p.width + (e.key === 'ArrowLeft' ? 24 : -24))
            p.onWidth(w)
            try {
              localStorage.setItem('panes:chat-w', String(w))
            } catch {
              // not remembered
            }
          }}
        />
        <header className="chat-head">
          <div className="chat-model">
            {info ? <ModelPicker info={info} /> : <span />}
            {info?.target === 'chatgpt' && (
              <a
                href="https://chatgpt.com/"
                onClick={(e) => {
                  e.preventDefault()
                  window.api.createTab('https://chatgpt.com/')
                }}
              >
                Manage usage
              </a>
            )}
          </div>
          <button
            type="button"
            className="icon-btn no-drag"
            aria-label="Past chats"
            title="Past chats"
            aria-pressed={showHistory}
            onClick={() => setShowHistory((s) => !s)}
          >
            <HistoryIcon />
          </button>
          <button
            type="button"
            className="icon-btn no-drag"
            aria-label="New chat"
            title="New chat"
            onClick={() => {
              chat.reset()
              setShowHistory(false)
            }}
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            className="icon-btn no-drag"
            aria-label="Close chat"
            title="Close (Ctrl+Shift+L)"
            onClick={closeAndReturn}
          >
            <CloseIcon />
          </button>
        </header>
        {showHistory ? (
          <div className="chat-history">
            {chat.saved.length === 0 && <p className="none">No saved chats yet.</p>}
            {chat.saved.map((c) => (
              <div key={c.id} className="chat-hist-row">
                <button
                  type="button"
                  className="chat-hist-open"
                  onClick={() => {
                    chat.open(c.id)
                    setShowHistory(false)
                  }}
                >
                  <span className="t">{c.title}</span>
                  <span className="a">{ago(c.updated)}</span>
                </button>
                <button
                  type="button"
                  className="icon-btn no-drag"
                  aria-label={`Delete ${c.title}`}
                  onClick={() => chat.remove(c.id)}
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Body chat={chat} onSuggest={chat.send} />
        )}
        {info?.starting && (
          <div className="chat-note" role="status">
            Starting the local model. Your message goes through as soon as it is ready.
          </div>
        )}
        {info?.limited && (
          <div className="chat-note" role="status">
            Your ChatGPT plan has reached its usage limit for now. Chat stays on ChatGPT until it
            resets.
          </div>
        )}
        {info?.reauth && !info.block && (
          <div className="chat-note" role="status">
            ChatGPT needs you to sign in again.{' '}
            <button type="button" onClick={() => window.api.openInternal('settings')}>
              Open Settings
            </button>
          </div>
        )}
        <Composer
          key={p.draft?.key ?? 0}
          tabs={p.tabs}
          page={chat.page}
          hiddenPage={chat.hiddenPage}
          currentOn={chat.currentOn}
          onCurrent={chat.setCurrentOn}
          mentions={chat.mentions}
          onMentions={chat.setMentions}
          streaming={chat.streaming}
          disabled={noModel}
          focusKey={p.focusKey}
          draft={p.draft}
          files={chat.files}
          attachNote={chat.attachNote}
          onAttach={chat.pickFiles}
          onRemoveFile={chat.removeFile}
          onSend={chat.send}
          onStop={chat.stop}
        />
        <p className="ai-disclaimer">AI can make mistakes. Check important details.</p>
        <div className="chat-sr" aria-live="polite" role="status">
          {status}
        </div>
      </div>
    </motion.aside>
  )
}
