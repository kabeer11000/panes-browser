import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ASK_ACTIONS, type AskAction } from '@shared/ask'
import type { AskApi, AskShow } from '@shared/types'
import { CloseIcon } from '@renderer/components/icons'
import { Markdown } from '@renderer/components/chat/Markdown'

declare global {
  interface Window {
    ask: AskApi
  }
}

/** The two small views of ask-about-selection (main/askSelection.ts): the chip beside the text, and the answer card. */
export function Ask({ kind }: { kind: 'chip' | 'card' }): React.JSX.Element {
  return kind === 'chip' ? <Chip /> : <Card />
}

function Chip(): React.JSX.Element {
  const api = window.ask
  const row = useRef<HTMLDivElement>(null)
  // Ctrl+Shift+Y puts the keyboard here: the first button takes it
  useEffect(() => {
    const first = (): void => row.current?.querySelector('button')?.focus()
    window.addEventListener('focus', first)
    return () => window.removeEventListener('focus', first)
  }, [])
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') return api.close()
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!dir) return
    const buttons = [...(row.current?.querySelectorAll('button') ?? [])]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    buttons[(at + dir + buttons.length) % buttons.length]?.focus()
    e.preventDefault()
  }
  return (
    <div className="ask-root ask-chip-root">
      <div
        className="ask-chip"
        role="toolbar"
        aria-label="Ask about the selected text"
        ref={row}
        onKeyDown={onKey}
      >
        {ASK_ACTIONS.map((a) => (
          <button key={a.id} type="button" onClick={() => api.run(a.id)}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const TITLES: Record<AskAction, string> = {
  ask: 'Ask about this',
  explain: 'Explanation',
  translate: 'Translation',
  summarise: 'Summary'
}

function Card(): React.JSX.Element {
  const api = window.ask
  const [show, setShow] = useState<AskShow | null>(null)
  const [text, setText] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [question, setQuestion] = useState('')
  const field = useRef<HTMLInputElement>(null)

  useEffect(
    () =>
      api.onShow((s) => {
        setShow(s)
        setText('')
        setError('')
        setQuestion('')
        setWorking(!s.needsQuestion)
        if (s.needsQuestion) window.setTimeout(() => field.current?.focus(), 30)
      }),
    [api]
  )
  useEffect(
    () =>
      api.onEvent((e) => {
        if (e.kind === 'text') setText((t) => t + e.text)
        else if (e.kind === 'done') setWorking(false)
        else if (e.kind === 'error') {
          setWorking(false)
          setError(e.message)
        }
      }),
    [api]
  )
  // after the listeners above: main answers with what to show
  useEffect(() => api.ready(), [api])
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') api.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api])

  if (!show) return <div className="ask-root" />
  const asking = show.needsQuestion && !working && !text && !error
  const done = !working && !asking

  return (
    // the view is bigger than the card: a press outside the card is a click away
    <div
      className={`ask-root ${show.below ? 'below' : 'above'}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) api.close()
      }}
    >
      <div className="ask-card" role="dialog" aria-label={TITLES[show.action]} key={show.action}>
        <div className="ask-head">
          <span className="ask-title">{TITLES[show.action]}</span>
          <button type="button" className="ask-x" aria-label="Close" onClick={api.close}>
            <CloseIcon />
          </button>
        </div>
        <p className="ask-quote">{show.preview}</p>
        {asking ? (
          <form
            className="ask-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (!question.trim()) return
              setWorking(true)
              api.run('ask', question.trim())
            }}
          >
            <input
              ref={field}
              value={question}
              maxLength={500}
              placeholder="What do you want to know?"
              aria-label="Your question"
              onChange={(e) => setQuestion(e.target.value)}
            />
          </form>
        ) : (
          <div className="ask-body" aria-live="polite">
            {error ? (
              <p className="ask-error">{error}</p>
            ) : text ? (
              <Markdown text={text} />
            ) : (
              <p className="ask-wait">Thinking</p>
            )}
          </div>
        )}
        <div className="ask-foot">
          {working ? (
            <button type="button" onClick={api.stop}>
              Stop
            </button>
          ) : (
            <>
              <button type="button" className="ask-main" onClick={api.continueInChat}>
                Continue in chat
              </button>
              {done && text && (
                <button type="button" onClick={api.copy}>
                  Copy
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
