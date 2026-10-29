import { useEffect, useRef, useState } from 'react'
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
  const [previews, setPreviews] = useState<Record<number, string>>({})
  const previewsRef = useRef<Record<number, string>>({})
  const asked = useRef<Record<number, number>>({}) // how many times each download's picture has been asked for

  // Progress changes constantly, so poll while the page is open.
  useEffect(() => {
    const tick = (): void =>
      void window.panesInternal.downloadsList().then((list) => {
        setItems(list)
        // Pictures are made once a file is done, in the background: ask for the ones still missing, a few times each
        // (the list itself is polled without them, since they are large and do not change).
        const missing = list
          .filter((d) => d.state === 'completed' && (asked.current[d.id] ?? 0) < 6)
          .filter((d) => !(d.id in previewsRef.current))
          .map((d) => d.id)
        if (missing.length === 0) return
        for (const id of missing) asked.current[id] = (asked.current[id] ?? 0) + 1
        void window.panesInternal.downloadPreviews(missing).then((got) => {
          if (Object.keys(got).length === 0) return
          previewsRef.current = { ...previewsRef.current, ...got }
          setPreviews(previewsRef.current)
        })
      })
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
            {previews[d.id] ? (
              <span className="dl-thumb" style={{ backgroundImage: `url(${previews[d.id]})` }} />
            ) : (
              <span className="dl-thumb ext">
                {(/\.([a-z0-9]{1,4})$/i.exec(d.filename)?.[1] ?? '').toUpperCase()}
              </span>
            )}
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
