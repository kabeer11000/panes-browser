import { useEffect, useState } from 'react'
import type { DownloadAction, DownloadInfo } from '../../../../shared/types'
import { DownloadIcon } from '../../components/icons'
import { formatBytes, formatTime, host } from '../format'
import { EmptyState } from '../ui'

const POLL_MS = 700

const stateLabel = (d: DownloadInfo): string => {
  switch (d.state) {
    case 'progressing':
      return d.total > 0
        ? `${formatBytes(d.received)} of ${formatBytes(d.total)}`
        : formatBytes(d.received)
    case 'paused':
      return `Paused, ${formatBytes(d.received)}`
    case 'completed':
      return `${formatBytes(d.total || d.received)} - ${host(d.url)}`
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Failed'
  }
}

export function Downloads(): React.JSX.Element {
  const [items, setItems] = useState<DownloadInfo[]>([])

  // Progress changes constantly, so poll while the page is open.
  useEffect(() => {
    const tick = (): void => void window.panesInternal.downloadsList().then(setItems)
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => clearInterval(id)
  }, [])

  const act = (id: number, action: DownloadAction): void =>
    void window.panesInternal.downloadAction(id, action)

  return (
    <>
      {items.length === 0 && (
        <EmptyState icon={<DownloadIcon />} title="No downloads yet">
          Files you download show up here, with their progress and a way to open them.
        </EmptyState>
      )}
      <div className="u-group" hidden={items.length === 0}>
        {items.map((d) => (
          <div key={d.id} className="u-row int-item download">
            <div className="int-link static">
              <span className="int-title">{d.filename}</span>
              <span className="int-sub">
                {formatTime(d.time)} - {stateLabel(d)}
              </span>
              {(d.state === 'progressing' || d.state === 'paused') && (
                <div className="progress">
                  <span
                    style={{ width: d.total > 0 ? `${(d.received / d.total) * 100}%` : '30%' }}
                  />
                </div>
              )}
            </div>
            <div className="int-actions">
              {d.state === 'completed' && (
                <>
                  <button className="int-btn small" onClick={() => act(d.id, 'open')}>
                    Open
                  </button>
                  <button className="int-btn small" onClick={() => act(d.id, 'show')}>
                    Show in folder
                  </button>
                </>
              )}
              {d.state === 'progressing' && (
                <button className="int-btn small" onClick={() => act(d.id, 'pause')}>
                  Pause
                </button>
              )}
              {d.state === 'paused' && (
                <button className="int-btn small" onClick={() => act(d.id, 'resume')}>
                  Resume
                </button>
              )}
              {(d.state === 'progressing' || d.state === 'paused') && (
                <button className="int-btn small" onClick={() => act(d.id, 'cancel')}>
                  Cancel
                </button>
              )}
              {d.state !== 'progressing' && d.state !== 'paused' && (
                <button className="int-btn small" onClick={() => act(d.id, 'remove')}>
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
