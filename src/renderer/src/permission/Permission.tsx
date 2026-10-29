import { useCallback, useEffect, useRef, useState } from 'react'
import { describeKinds } from '../../../shared/permissions'
import type { PermissionAnswer, PermissionApi, PermissionPromptState } from '../../../shared/types'
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

  // Every answer names the question it is for, so one meant for a card that was just replaced is dropped.
  const id = state?.id ?? 0
  const answer = useCallback((a: PermissionAnswer) => api.answer(id, a), [api, id])

  // Escape answers "not now"; an answer-less card would otherwise hold the page's request open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') answer({ action: 'cancel' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answer])

  if (!state) return null
  const { origin, kinds, sources, audio, blocked, temporary } = state
  if (sources) {
    return (
      <ShareDialog
        key={id}
        origin={origin}
        sources={sources}
        loading={!!state.loading}
        audio={!!audio}
        onAnswer={answer}
      />
    )
  }

  if (blocked) {
    const what = blocked === 'camera' ? 'camera' : 'microphone'
    return (
      <div className="perm-root" ref={box} key={id}>
        <div
          className="perm-card"
          role="alertdialog"
          aria-label={`Windows is blocking the ${what}`}
        >
          <div className="perm-title">
            <b>{host(origin)}</b>
            {` wants to use your ${what}, but Windows is not letting apps use it.`}
          </div>
          <div className="perm-note">
            Turn on the {what} for desktop apps in Windows privacy settings, then try again.
          </div>
          <div className="perm-actions">
            <button
              type="button"
              className="perm-btn primary"
              autoFocus
              onClick={() => answer({ action: 'openSettings' })}
            >
              Open settings
            </button>
            <button type="button" className="perm-btn" onClick={() => answer({ action: 'cancel' })}>
              Not now
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="perm-root" ref={box} key={id}>
      <div className="perm-card" role="dialog" aria-label="Site permission">
        <div className="perm-title">
          <b>{host(origin)}</b>
          {` wants to use your ${describeKinds(kinds)}`}
        </div>
        <div className="perm-actions">
          <button
            type="button"
            className="perm-btn primary"
            autoFocus
            onClick={() => answer({ action: 'allow' })}
          >
            Allow
          </button>
          <button type="button" className="perm-btn" onClick={() => answer({ action: 'once' })}>
            Allow this time
          </button>
          <button type="button" className="perm-btn" onClick={() => answer({ action: 'block' })}>
            Block
          </button>
        </div>
        <div className="perm-note">
          {temporary
            ? 'This is a private tab: the answer is forgotten when Panes closes.'
            : 'Allow and Block are remembered. Change them from the site button in the address bar.'}
        </div>
      </div>
    </div>
  )
}
