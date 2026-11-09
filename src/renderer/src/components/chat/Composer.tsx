import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { displayHost } from '@shared/url'
import type { TabInfo } from '@shared/types'
import type { ChatFile } from '@shared/ai/chatConv'
import { AttachIcon, CloseIcon, FileIcon, SendIcon, StopSquareIcon } from '../icons'
import { shareable, type Mention } from './useChat'

const MAX_HEIGHT = 168

interface Props {
  tabs: TabInfo[]
  page: TabInfo | null
  hiddenPage: boolean
  currentOn: boolean
  onCurrent: (on: boolean) => void
  mentions: Mention[]
  onMentions: (m: Mention[]) => void
  streaming: boolean
  disabled: boolean
  focusKey: number
  draft?: { text: string; key: number } | null
  files: ChatFile[]
  attachNote: string
  onAttach: () => void
  onRemoveFile: (id: string) => void
  onSend: (text: string) => void
  onStop: () => void
}

/** The @query being typed right before the caret, or null. */
const mentionAt = (text: string, caret: number): { start: number; query: string } | null => {
  const m = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))
  return m ? { start: caret - m[2].length - 1, query: m[2].toLowerCase() } : null
}

export function Composer(p: Props): React.JSX.Element {
  const [text, setText] = useState(p.draft?.text ?? '') // the panel is given a new key per draft
  const [caret, setCaret] = useState(p.draft?.text.length ?? 0)
  const [pick, setPick] = useState(0)
  const [pickClosed, setPickClosed] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ta.current
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length) // a quoted selection: type below it
  }, [p.focusKey])

  // grows with its text up to a few lines, then scrolls
  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(MAX_HEIGHT, el.scrollHeight)}px`
  }, [text])

  const at = pickClosed ? null : mentionAt(text, caret)
  const choices = useMemo(() => {
    if (!at) return []
    const taken = new Set(p.mentions.map((m) => m.tabId))
    return p.tabs
      .filter((t) => shareable(t) && !taken.has(t.id) && t.id !== (p.currentOn ? p.page?.id : -1))
      .filter(
        (t) => !at.query || `${t.title} ${displayHost(t.url)}`.toLowerCase().includes(at.query)
      )
      .slice(0, 6)
  }, [at, p.tabs, p.mentions, p.currentOn, p.page])
  const open = choices.length > 0

  const choose = (t: TabInfo): void => {
    if (!at) return
    const next = text.slice(0, at.start) + text.slice(caret)
    setText(next)
    p.onMentions([...p.mentions, { tabId: t.id, title: t.aiTitle ?? t.title }])
    setPick(0)
    requestAnimationFrame(() => {
      ta.current?.focus()
      ta.current?.setSelectionRange(at.start, at.start)
      setCaret(at.start)
    })
  }

  const submit = (): void => {
    if (!text.trim() || p.streaming || p.disabled) return
    p.onSend(text)
    setText('')
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setPick((i) => (i + (e.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        choose(choices[Math.min(pick, choices.length - 1)])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setPickClosed(true)
        return
      }
    }
    // Escape bubbles to the panel, which closes and gives the keyboard back to the page
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const currentChip = p.hiddenPage ? (
    <span className="chat-chip muted" title="Private and Tor tabs are never shared with AI">
      Private tab, not shared
    </span>
  ) : p.page ? (
    <span className={'chat-chip' + (p.currentOn ? ' on' : '')}>
      <button
        type="button"
        className="chat-chip-main"
        aria-pressed={p.currentOn}
        title={p.currentOn ? 'This page is shared with the chat' : 'Share this page with the chat'}
        onClick={() => p.onCurrent(!p.currentOn)}
      >
        <span className="chat-chip-dot" aria-hidden="true" />
        <span className="chat-chip-text">{p.currentOn ? 'Current page' : 'Page not shared'}</span>
      </button>
    </span>
  ) : null

  return (
    <div className="chat-composer">
      <div className="chat-chips">
        {currentChip}
        {p.files.map((f) => (
          <span key={f.id} className="chat-chip on file" title={f.name}>
            <span className="chat-chip-main static">
              <FileIcon />
              <span className="chat-chip-text">{f.name}</span>
              {f.pages > 0 && <span className="chat-chip-meta">{f.pages} p</span>}
            </span>
            <button
              type="button"
              className="chat-chip-x"
              aria-label={`Remove ${f.name}`}
              onClick={() => p.onRemoveFile(f.id)}
            >
              <CloseIcon />
            </button>
          </span>
        ))}
        {p.mentions.map((m) => (
          <span key={m.tabId} className="chat-chip on">
            <span className="chat-chip-main static">
              <span className="chat-chip-text">{m.title || 'Tab'}</span>
            </span>
            <button
              type="button"
              className="chat-chip-x"
              aria-label={`Remove ${m.title || 'tab'}`}
              onClick={() => p.onMentions(p.mentions.filter((x) => x.tabId !== m.tabId))}
            >
              <CloseIcon />
            </button>
          </span>
        ))}
      </div>
      {p.attachNote && (
        <p className="chat-attach-note" role="status">
          {p.attachNote}
        </p>
      )}
      <div className={'chat-field ai-edge' + (p.streaming ? ' on' : '')}>
        <button
          type="button"
          className="chat-attach"
          aria-label="Attach files"
          title="Attach a PDF or text file (or drop it here)"
          disabled={p.disabled}
          onClick={p.onAttach}
        >
          <AttachIcon />
        </button>
        {open && (
          <ul className="chat-mentions" role="listbox" aria-label="Tabs to add">
            {choices.map((t, i) => (
              <li
                key={t.id}
                role="option"
                aria-selected={i === pick}
                className={i === pick ? 'sel' : ''}
                onPointerDown={(e) => {
                  e.preventDefault() // keep the caret in the box
                  choose(t)
                }}
                onPointerEnter={() => setPick(i)}
              >
                <span className="t">{t.aiTitle ?? (t.title || displayHost(t.url))}</span>
                <span className="h">{displayHost(t.url)}</span>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={text}
          aria-label="Message"
          disabled={p.disabled}
          placeholder={
            p.disabled ? 'Chat is not ready yet' : 'Ask, or tell it what to do. @ adds a tab'
          }
          spellCheck
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value)
            setCaret(e.target.selectionStart)
            setPickClosed(false)
            setPick(0)
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKey}
        />
        {p.streaming ? (
          <button
            type="button"
            className="chat-send stop"
            aria-label="Stop"
            title="Stop"
            onClick={p.onStop}
          >
            <StopSquareIcon />
          </button>
        ) : (
          <button
            type="button"
            className="chat-send"
            aria-label="Send"
            title="Send (Enter)"
            disabled={!text.trim() || p.disabled}
            onClick={submit}
          >
            <SendIcon />
          </button>
        )}
      </div>
    </div>
  )
}
