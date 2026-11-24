import { forwardRef, useState } from 'react'
import type { PermissionAnswer, PermissionPromptState } from '@shared/types'

/**
 * A site's (or a proxy's) request for a user name and password, as Chrome asks it: who asks, in their own words, a
 * warning when the password would go unencrypted, and the two fields. Enter signs in, Esc cancels (Permission.tsx).
 */
export const LoginCard = forwardRef<
  HTMLDivElement,
  {
    login: NonNullable<PermissionPromptState['login']>
    temporary?: boolean
    onAnswer: (a: PermissionAnswer) => void
  }
>(function LoginCard({ login, temporary, onAnswer }, ref) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const who = login.proxy ? `The proxy ${login.host}` : login.host
  return (
    <div className="perm-root" ref={ref}>
      <form
        className="perm-card"
        role="dialog"
        aria-label={`Sign in to ${login.host}`}
        onSubmit={(e) => {
          e.preventDefault()
          onAnswer({ action: 'login', username, password })
        }}
      >
        <div className="perm-title">
          <b>Sign in</b>
          <span className="perm-login-who">
            {who} asks for a user name and password
            {login.realm ? ` (its message: “${login.realm}”)` : ''}.
          </span>
        </div>
        {login.retry && (
          <div className="perm-note perm-login-warn">That user name or password did not work.</div>
        )}
        {login.insecure && (
          <div className="perm-note perm-login-warn">
            This connection is not secure: what you type here can be read on the way.
          </div>
        )}
        <label className="perm-field">
          <span>User name</span>
          <input
            autoFocus
            autoComplete="username"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="perm-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {temporary && (
          <div className="perm-note">A private tab: Panes forgets it when it closes.</div>
        )}
        <div className="perm-actions">
          <button type="submit" className="perm-btn primary">
            Sign in
          </button>
          <button type="button" className="perm-btn" onClick={() => onAnswer({ action: 'cancel' })}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
})
