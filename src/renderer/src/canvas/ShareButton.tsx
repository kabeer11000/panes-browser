import { useRef, useState } from 'react'
import type { Space } from '@shared/types'
import { Face, ShareSection } from '@renderer/components/ShareSection'
import { useShareState } from '@renderer/components/useShare'
import { useHostView } from '@renderer/liveHost'
import { useDismiss } from './useDismiss'

/**
 * Share, on the board's top bar (as in Figma), as small as it can be: "Share" until the space is; then one capsule
 * with the room's state as a dot and the others as faces; red with "Live" while this person shows a tab. Everything
 * else (the invite, who watches, Stop, Take back) is in its popover; only a request to drive comes out beside it,
 * while it waits for an answer.
 */
export function ShareButton({ space }: { space: Space | undefined }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, ref, () => setOpen(false))
  const state = useShareState(space?.id ?? -1, !!space?.shared)
  const showing = useHostView(space?.id ?? -1)
  if (!space || !window.api.share) return null
  const status = state?.status ?? 'connecting'
  const people = state?.people ?? []
  const said =
    status === 'live'
      ? people.length
        ? `${people.length} here`
        : 'just you'
      : status === 'offline'
        ? 'offline'
        : status === 'refused'
          ? 'not let in'
          : 'connecting'
  const label = showing
    ? `Showing a tab live${showing.watching ? `, ${showing.watching} watching` : ''}`
    : `Shared, ${said}`
  return (
    <div className="cv-share" ref={ref}>
      <button
        type="button"
        className={
          'cv-share-btn' +
          (space.shared ? ' on ' + status : '') +
          (showing ? ' showing' : '') +
          (open ? ' open' : '')
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={space.shared ? label : 'Share this space'}
        title={space.shared ? label : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {space.shared ? (
          <>
            <span className="cv-share-dot" aria-hidden="true" />
            {people.length > 0 && (
              <span className="cv-share-faces" aria-hidden="true">
                {people.slice(0, 3).map((p) => (
                  <Face key={p.id} name={p.name} color={p.color} size={18} />
                ))}
                {people.length > 3 && <em>+{people.length - 3}</em>}
              </span>
            )}
            {showing ? (
              <span>Live{showing.watching ? ` · ${showing.watching}` : ''}</span>
            ) : people.length === 0 ? (
              <span>{status === 'live' ? 'Shared' : said}</span>
            ) : null}
          </>
        ) : (
          'Share'
        )}
      </button>
      {showing?.asking && (
        <div className="cv-share-ask" role="alert">
          <span>{showing.asking.name.split(' ')[0]} wants to drive</span>
          <button type="button" className="primary" onClick={showing.allow}>
            Let them
          </button>
          <button type="button" onClick={showing.deny}>
            No
          </button>
        </div>
      )}
      {open && (
        <div className="cv-share-pop" role="dialog" aria-label={`Share ${space.name}`}>
          {showing && (
            <div className="cv-share-live">
              <span className="cv-share-dot" aria-hidden="true" />
              <span className="cv-share-live-what">
                {showing.driver
                  ? `${showing.driver.name.split(' ')[0]} is driving`
                  : `Showing a tab live${showing.watching ? ` · ${showing.watching} watching` : ''}`}
              </span>
              {showing.driver && (
                <button type="button" onClick={showing.takeBack}>
                  Take back
                </button>
              )}
              <button type="button" onClick={showing.stop}>
                Stop
              </button>
            </div>
          )}
          <ShareSection space={space} />
        </div>
      )}
    </div>
  )
}
