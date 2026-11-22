import { useRef, useState } from 'react'
import type { Space } from '@shared/types'
import { ShareSection } from '@renderer/components/ShareSection'
import { useShareState } from '@renderer/components/useShare'
import { useDismiss } from './useDismiss'

/**
 * Share, always in sight on the board's top bar (as in Figma): invite people, see who is here, join with a link.
 * The same section as in the space's settings, where it was buried under the colours.
 */
export function ShareButton({ space }: { space: Space | undefined }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, ref, () => setOpen(false))
  const state = useShareState(space?.id ?? -1, !!space?.shared)
  if (!space || !window.api.share) return null
  const status = state?.status ?? 'connecting'
  const here = (state?.people.length ?? 0) + 1
  // what the chip says is how the room is, not only that it is shared
  const label =
    status === 'live'
      ? here > 1
        ? `Live · ${here}`
        : 'Live'
      : status === 'offline'
        ? 'Offline'
        : status === 'refused'
          ? 'Not let in'
          : 'Connecting'
  return (
    <div className="cv-share" ref={ref}>
      <button
        type="button"
        className={'cv-share-btn' + (space.shared ? ' on ' + status : '') + (open ? ' open' : '')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={space.shared ? `Shared space: ${label}` : 'Share this space'}
        onClick={() => setOpen((o) => !o)}
      >
        {space.shared ? (
          <>
            <svg className="cv-share-live" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="7" cy="7" r="2.2" />
              <path d="M3.6 3.6a4.8 4.8 0 0 0 0 6.8M10.4 3.6a4.8 4.8 0 0 1 0 6.8" />
            </svg>
            {label}
          </>
        ) : (
          'Share'
        )}
      </button>
      {open && (
        <div className="cv-share-pop" role="dialog" aria-label={`Share ${space.name}`}>
          <ShareSection space={space} />
        </div>
      )}
    </div>
  )
}
