import { useEffect, useState } from 'react'
import type { LoginEdits, PasswordPrompt } from '../../../shared/types'
import { CloseIcon, EyeIcon, EyeOffIcon, KeyIcon } from './icons'

/**
 * Offer to remember a login. Inline under the address bar when the sidebar is open; with it closed the
 * same card is shown by the popover view, which hangs under the address bar over the page.
 * The username and password can be corrected before saving: sites often fill the wrong field.
 */
export function SavePrompt({
  prompt,
  reveal,
  onAnswer
}: {
  prompt: PasswordPrompt
  /** Fetches the password on request; it is never part of the prompt itself. */
  reveal: () => Promise<string | null>
  onAnswer: (answer: 'save' | 'never' | 'dismiss', edits?: LoginEdits) => void
}): React.JSX.Element {
  const host = new URL(prompt.origin).host
  const update = prompt.kind === 'update'
  const title = update ? 'Update password?' : 'Save password?'

  // Callers key this component per prompt, so edits and a revealed password are forgotten with their prompt.
  const [username, setUsername] = useState(prompt.username)
  const [password, setPassword] = useState<string | null>(null) // null: leave the captured one as it is
  const [shown, setShown] = useState(false)
  const toggleSecret = (): void => {
    if (shown) return setShown(false)
    if (password === null) void reveal().then((p) => setPassword((cur) => cur ?? p ?? ''))
    setShown(true)
  }
  const save = (): void => onAnswer('save', { username: username.trim(), password })

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
            <label className="sp-field">
              <span className="sp-key">Username</span>
              <input
                className="sp-input"
                value={username}
                placeholder="Username or email"
                autoComplete="off"
                spellCheck={false}
                aria-label="Username"
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
            </label>
            <label className="sp-field">
              <span className="sp-key">Password</span>
              <input
                className={'sp-input' + (shown ? ' mono' : '')}
                type={shown ? 'text' : 'password'}
                value={password ?? ''}
                placeholder="Keep the one just typed"
                autoComplete="off"
                spellCheck={false}
                aria-label="Password"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
              <button
                type="button"
                className="sp-eye"
                aria-label={shown ? 'Hide password' : 'Show password'}
                title={shown ? 'Hide password' : 'Show password'}
                onClick={toggleSecret}
              >
                {shown ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </label>
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
            <button type="button" className="sp-btn primary" onClick={save}>
              {update ? 'Update' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
