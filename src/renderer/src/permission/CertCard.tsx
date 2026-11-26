import { forwardRef } from 'react'
import type { PermissionAnswer, PermissionPromptState } from '@shared/types'
import { Backdrop } from '@renderer/components/Backdrop'

const date = (ms: number): string => new Date(ms).toLocaleDateString([], { dateStyle: 'medium' })

/**
 * A site asks for a certificate that says who you are (a client certificate, as some workplaces and banks use):
 * this computer's, to pick one from, or none. Nothing is sent without a pick.
 */
export const CertCard = forwardRef<
  HTMLDivElement,
  {
    host: string
    certs: NonNullable<PermissionPromptState['certs']>
    onAnswer: (a: PermissionAnswer) => void
  }
>(function CertCard({ host, certs, onAnswer }, ref) {
  return (
    <div className="perm-root" ref={ref}>
      <div className="perm-card" role="dialog" aria-label={`Choose a certificate for ${host}`}>
        <Backdrop />
        <div className="perm-title">
          <b>{host || 'This site'}</b> asks for a certificate that says who you are
        </div>
        <div className="perm-certs" role="list">
          {certs.map((c, i) => (
            <button
              key={i}
              type="button"
              role="listitem"
              className="perm-cert"
              autoFocus={i === 0}
              onClick={() => onAnswer({ action: 'cert', index: i })}
            >
              <b>{c.name}</b>
              <span>
                From {c.issuer} · {c.expires < Date.now() ? 'expired' : 'until'} {date(c.expires)}
              </span>
            </button>
          ))}
        </div>
        <div className="perm-actions">
          <button type="button" className="perm-btn" onClick={() => onAnswer({ action: 'cancel' })}>
            Don&apos;t send one
          </button>
        </div>
      </div>
    </div>
  )
})
