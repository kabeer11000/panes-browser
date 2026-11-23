import { useRef, useState } from 'react'
import type { Space } from '@shared/types'
import { ShareSection } from '@renderer/components/ShareSection'
import { useShareState } from '@renderer/components/useShare'
import { useHostView } from '@renderer/liveHost'
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
  const showing = useHostView(space?.id ?? -1)
  if (!space || !window.api.share) return null
  const status = state?.status ?? 'connecting'
  const others = state?.people.length ?? 0
  // What the capsule says is what matters most right now, so it is hard to forget: a tab shown live to the others
  // (red, with who watches), else that the space is shared and who is in it, else how the room is doing.
  const label = showing
    ? `Showing live${showing.watching ? ` · ${showing.watching} watching` : ''}`
    : status === 'live'
      ? `Shared · ${others ? `${others} here` : 'just you'}`
      : status === 'offline'
        ? 'Shared · offline'
        : status === 'refused'
          ? 'Not let in'
          : 'Shared · connecting'
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
