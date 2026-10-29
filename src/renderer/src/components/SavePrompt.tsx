import { useEffect, useState } from 'react'
import type { PasswordPrompt } from '../../../shared/types'
import { CloseIcon, EyeIcon, EyeOffIcon, KeyIcon } from './icons'

/**
 * Offer to remember a login. Inline under the address bar when the sidebar is open; with it closed the
 * same card is shown by the popover view, which hangs under the address bar over the page.
 */
export function SavePrompt({
  prompt,
  reveal,
  onAnswer
}: {
  prompt: PasswordPrompt
  /** Fetches the password on request; it is never part of the prompt itself. */
  reveal: () => Promise<string | null>
  onAnswer: (answer: 'save' | 'never' | 'dismiss') => void
}): React.JSX.Element {
  const host = new URL(prompt.origin).host
  const update = prompt.kind === 'update'
  const title = update ? 'Update password?' : 'Save password?'

  // Callers key this component per prompt, so a revealed password is forgotten with its prompt.
  const [secret, setSecret] = useState<string | null>(null)
  const toggleSecret = (): void => {
    if (secret !== null) return setSecret(null)
    void reveal().then(setSecret)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onAnswer('dismiss')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onAnswer])

  return (
    <div className="sp-wrap no-drag">
      <div className="sp-clip">
        <div className="sp-card" role="alertdialog" aria-label={title}>
          <div className="sp-head">
            <span className="sp-tile">
              <KeyIcon />
            </span>
            <div className="sp-text">
              <b>{title}</b>
              <span>{host}</span>
            </div>
            <button
              type="button"
              className="sp-x"
              aria-label="Not now"
              title="Not now (Esc)"
              onClick={() => onAnswer('dismiss')}
            >
              <CloseIcon />
            </button>
          </div>

          <div className="sp-fields">
            <div className="sp-field">
              <span className="sp-key">Username</span>
              <span className="sp-val">{prompt.username || 'None'}</span>
            </div>
            <div className="sp-field">
              <span className="sp-key">Password</span>
              <span className={'sp-val ' + (secret === null ? 'mask' : 'mono')}>
                {secret ?? '••••••••'}
              </span>
              <button
                type="button"
                className="sp-eye"
                aria-label={secret === null ? 'Show password' : 'Hide password'}
                title={secret === null ? 'Show password' : 'Hide password'}
                onClick={toggleSecret}
              >
                {secret === null ? <EyeIcon /> : <EyeOffIcon />}
              </button>
            </div>
          </div>

          <div className="sp-actions">
            <button
              type="button"
              className="sp-btn"
              title="Never offer to save a password for this site"
              onClick={() => onAnswer('never')}
            >
              Never
            </button>
            <button type="button" className="sp-btn primary" onClick={() => onAnswer('save')}>
              {update ? 'Update' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
