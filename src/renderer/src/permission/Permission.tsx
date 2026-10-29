import { useEffect, useRef, useState } from 'react'
import { describeKinds } from '../../../shared/permissions'
import type { PermissionApi, PermissionPromptState } from '../../../shared/types'
import { ShareDialog } from './ShareDialog'

declare global {
  interface Window {
    permission: PermissionApi
  }
}

const host = (origin: string): string => origin.replace(/^https?:\/\//, '')

export function Permission(): React.JSX.Element | null {
  const api = window.permission
  const [state, setState] = useState<PermissionPromptState | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.state().then(setState)
    return api.onState(setState)
  }, [api])

  // The view is only as tall as the card, so it never covers page area it has no business covering.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => api.resize(el.getBoundingClientRect().height - 72))
    ro.observe(el)
    return () => ro.disconnect()
  }, [api, state])

  // Escape answers "not now"; an answer-less card would otherwise hold the page's request open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') api.answer({ action: 'cancel' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api])

  if (!state) return null
  const { origin, kinds, sources, audio } = state
  if (sources) {
    return (
      <ShareDialog
        key={origin}
        origin={origin}
        sources={sources}
        audio={!!audio}
        onAnswer={api.answer}
      />
    )
  }

  return (
    <div className="perm-root" ref={box} key={origin + kinds.join()}>
      <div className="perm-card" role="dialog" aria-label="Site permission">
        <div className="perm-title">
          <b>{host(origin)}</b>
          {` wants to use your ${describeKinds(kinds)}`}
        </div>
        {
          <>
            <div className="perm-actions">
              <button
                type="button"
                className="perm-btn primary"
                autoFocus
                onClick={() => api.answer({ action: 'allow' })}
              >
                Allow
              </button>
              <button
                type="button"
                className="perm-btn"
                onClick={() => api.answer({ action: 'once' })}
              >
                Allow this time
              </button>
              <button
                type="button"
                className="perm-btn"
                onClick={() => api.answer({ action: 'block' })}
              >
                Block
              </button>
            </div>
            <div className="perm-note">
              Allow and Block are remembered. Change them any time in Settings.
            </div>
          </>
        }
      </div>
    </div>
  )
}
