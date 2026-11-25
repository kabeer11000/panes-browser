import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { FindApi, FindResult } from '@shared/types'
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from '@renderer/components/icons'

declare global {
  interface Window {
    findBar: FindApi
  }
}

/**
 * Find in page, as Chrome's: a small bar floating over the page's top right corner. It is a view of its own
 * (main/findFloat.ts), since a page is a native view that paints over anything the window itself draws.
 */
export function Find(): React.JSX.Element {
  const api = window.findBar
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [result, setResult] = useState<FindResult | null>(null)

  useEffect(() => api.onResult(setResult), [api])
  useEffect(() => {
    const focus = (): void => {
      input.current?.focus()
      input.current?.select()
    }
    focus()
    return api.onFocus(focus)
  }, [api])

  const close = (): void => {
    setText('')
    setResult(null)
    api.close()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') api.find(text, !e.shiftKey)
    else if (e.key === 'Escape') close()
  }

  return (
    <div className="find-card" role="search">
      <input
        ref={input}
        value={text}
        placeholder="Find in page"
        aria-label="Find in page"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          if (!e.target.value) setResult(null)
          api.find(e.target.value)
        }}
        onKeyDown={onKeyDown}
      />
      <span className="find-count" aria-live="polite">
        {text && result ? `${result.active}/${result.matches}` : text ? '0/0' : ''}
      </span>
      <span className="find-sep" aria-hidden="true" />
      <button
        type="button"
        className="find-btn"
        title="Previous (Shift+Enter)"
        disabled={!text}
        onClick={() => api.find(text, false)}
      >
        <ChevronUpIcon />
      </button>
      <button
        type="button"
        className="find-btn"
        title="Next (Enter)"
        disabled={!text}
        onClick={() => api.find(text, true)}
      >
        <ChevronDownIcon />
      </button>
      <button type="button" className="find-btn" title="Close (Esc)" onClick={close}>
        <CloseIcon />
      </button>
    </div>
  )
}
