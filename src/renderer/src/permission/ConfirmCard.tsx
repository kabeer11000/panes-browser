import { forwardRef } from 'react'
import type { PermissionAnswer, PermissionPromptState } from '@shared/types'

/**
 * Panes' own question, on the same card as a site's, in place of a system dialog: private tabs that would close on a
 * restart, a page with unsaved changes, which device to connect. Escape puts it away (Permission.tsx).
 */
export const ConfirmCard = forwardRef<
  HTMLDivElement,
  {
    confirm: NonNullable<PermissionPromptState['confirm']>
    onAnswer: (a: PermissionAnswer) => void
  }
>(function ConfirmCard({ confirm, onAnswer }, ref) {
  const { title, detail, choices, list } = confirm
  const pick = (index: number): void => onAnswer({ action: 'choose', index })
  return (
    <div className="perm-root" ref={ref}>
      <div className="perm-card" role="alertdialog" aria-label={title}>
        <div className="perm-title">
          <b>{title}</b>
        </div>
        {detail && <p className="perm-confirm-detail">{detail}</p>}
        {list ? (
          <div className="perm-certs" role="list">
            {choices.map((c, i) => (
              <button
                key={i}
                type="button"
                role="listitem"
                className="perm-cert"
                autoFocus={i === 0}
                onClick={() => pick(i)}
              >
                <b>{c.label}</b>
              </button>
            ))}
          </div>
        ) : null}
        <div className="perm-actions">
          {list ? (
            <button
              type="button"
              className="perm-btn"
              onClick={() => onAnswer({ action: 'cancel' })}
            >
              Cancel
            </button>
          ) : (
            choices.map((c, i) => (
              <button
                key={i}
                type="button"
                className={'perm-btn' + (c.tone ? ' ' + c.tone : '')}
                autoFocus={c.tone === 'primary'}
                onClick={() => pick(i)}
              >
                {c.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
})
