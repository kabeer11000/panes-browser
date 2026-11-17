import { useEffect, useRef, useState } from 'react'
import type { PopoverApi, PopoverState } from '@shared/types'
import { SavePrompt } from '@renderer/components/SavePrompt'
import { PROMPT_PAD } from '@shared/anchor'

declare global {
  interface Window {
    popover: PopoverApi
  }
}

export function Popover(): React.JSX.Element | null {
  const api = window.popover
  const [state, setState] = useState<PopoverState | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.state().then(setState)
    return api.onState(setState)
  }, [api])

  // Wear the same colours as the window: its space's light or dark mode and its two colours.
  useEffect(() => {
    if (!state) return
    const root = document.documentElement
    root.dataset.scheme = state.theme.scheme
    root.style.setProperty('--space', state.theme.color)
    root.style.setProperty('--space2', state.theme.color2)
  }, [state])

  // The view is only as tall as the card, so it never covers page area it has no business covering.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() =>
      api.resize(el.getBoundingClientRect().height - PROMPT_PAD.top - PROMPT_PAD.bottom)
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [api, state?.prompt])

  if (!state?.prompt) return null
  const { origin, username, kind } = state.prompt
  return (
    <div
      className="pop-root"
      ref={box}
      style={{ padding: `${PROMPT_PAD.top}px ${PROMPT_PAD.side}px ${PROMPT_PAD.bottom}px` }}
    >
      <SavePrompt
        key={`${origin}|${username}|${kind}`}
        prompt={state.prompt}
        reveal={api.reveal}
        onAnswer={api.answer}
      />
    </div>
  )
}
