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
  // what the capsule says is how the room is (the faces beside it say who is in it)
  const label =
    status === 'live'
      ? 'Live'
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
            <span className="cv-share-dot" aria-hidden="true" />
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
