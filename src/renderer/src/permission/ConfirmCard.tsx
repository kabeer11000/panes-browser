import { forwardRef, useState } from 'react'
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
  const { title, detail, choices, list, input, image } = confirm
  // a page's prompt(): the text typed goes back with the choice, Enter being the last (OK)
  const [text, setText] = useState(input ?? '')
  const pick = (index: number): void =>
    onAnswer({ action: 'choose', index, ...(input !== undefined ? { text } : {}) })
  return (
    <div className="perm-root" ref={ref}>
      <div className="perm-card" role="alertdialog" aria-label={title}>
        <div className="perm-title">
          <b>{title}</b>
        </div>
        {detail && <p className="perm-confirm-detail">{detail}</p>}
        {image && <img className="perm-confirm-image" src={image} alt="" />}
        {input !== undefined && (
          <input
            className="perm-confirm-input"
            value={text}
            autoFocus
            spellCheck={false}
            aria-label={title}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && pick(choices.length - 1)}
          />
        )}
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
                autoFocus={input === undefined && c.tone === 'primary'}
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
