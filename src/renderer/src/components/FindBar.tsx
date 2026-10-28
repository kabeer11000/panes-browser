import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { FindResult } from '../../../shared/types'
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from './icons'

/** Find-in-page. Lives in the sidebar because native page views always paint above renderer UI. */
export function FindBar({
  focusKey,
  onClose
}: {
  focusKey: number
  onClose: () => void
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [result, setResult] = useState<FindResult | null>(null)

  useEffect(() => window.api.onFindResult(setResult), [])
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusKey])

  const close = (): void => {
    window.api.stopFind()
    onClose()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') window.api.find(text, !e.shiftKey)
    else if (e.key === 'Escape') close()
  }

  return (
    <div className="findbar no-drag">
      <input
        ref={inputRef}
        value={text}
        placeholder="Find in page"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          if (!e.target.value) setResult(null)
          window.api.find(e.target.value)
        }}
        onKeyDown={onKeyDown}
      />
      <span className="find-count">
        {text && result ? `${result.active}/${result.matches}` : text ? '0/0' : ''}
      </span>
      <button
        className="pane-btn"
        title="Previous (Shift+Enter)"
        onClick={() => window.api.find(text, false)}
      >
        <ChevronUpIcon />
      </button>
      <button className="pane-btn" title="Next (Enter)" onClick={() => window.api.find(text, true)}>
        <ChevronDownIcon />
      </button>
      <button className="pane-btn" title="Close (Esc)" onClick={close}>
        <CloseIcon />
      </button>
    </div>
  )
}
