import { useEffect, useState } from 'react'
import type { DownloadInfo } from '@shared/types'
import { downloadProgress, isActive } from '@shared/downloads'

const SETTLE_MS = 1100 // a bar that just filled stays full, in green, this long before it goes

/**
 * A download's progress, the same in the bin's fan and on panes://downloads: a track with the part that is here, a
 * sweep while the size is not known, dimmed while paused, red where a failed one stopped, and briefly full and green
 * when it finishes (only when it was seen running: a list opened later shows no bars for finished files).
 */
export function DownloadBar({
  d,
  className
}: {
  d: DownloadInfo
  className?: string
}): React.JSX.Element | null {
  const active = isActive(d)
  // React's "state from the last render" pattern: it was running and now is not
  const [wasActive, setWasActive] = useState(active)
  const [settling, setSettling] = useState(false)
  if (wasActive !== active) {
    setWasActive(active)
    if (!active && d.state === 'completed') setSettling(true)
  }
  useEffect(() => {
    if (!settling) return
    const t = window.setTimeout(() => setSettling(false), SETTLE_MS)
    return () => window.clearTimeout(t)
  }, [settling])

  const { value, tone } = downloadProgress(d)
  const failedPart = d.state === 'interrupted' && value !== null && value > 0
  if (!active && !settling && !failedPart) return null
  return (
    <span
      className={
        'dl-bar ' + tone + (value === null ? ' unknown' : '') + (className ? ' ' + className : '')
      }
      role="progressbar"
      aria-label={`${d.filename} progress`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
    >
      <span
        className="dl-bar-fill"
        style={value === null ? undefined : { width: `${Math.max(value * 100, 2)}%` }}
      />
    </span>
  )
}
