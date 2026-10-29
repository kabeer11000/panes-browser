import { useState } from 'react'
import type { PermissionApi, ScreenSource } from '../../../shared/types'

const host = (origin: string): string => origin.replace(/^https?:\/\//, '')

/** Chrome-style chooser: Entire screen or a Window, previews to pick from, then Share. */
export function ShareDialog({
  origin,
  sources,
  audio,
  onAnswer
}: {
  origin: string
  sources: ScreenSource[]
  audio: boolean
  onAnswer: PermissionApi['answer']
}): React.JSX.Element {
  const screens = sources.filter((s) => s.kind === 'screen')
  const windows = sources.filter((s) => s.kind === 'window')
  const [tab, setTab] = useState<'screen' | 'window'>(screens.length > 0 ? 'screen' : 'window')
  const [picked, setPicked] = useState<string | null>(null)
  const [withAudio, setWithAudio] = useState(true)
  const shown = tab === 'screen' ? screens : windows
  const chosen = shown.find((s) => s.id === picked) ?? null
  const share = (id: string): void => onAnswer({ action: 'share', sourceId: id, audio: withAudio })

  return (
    <div
      className="share-scrim"
      onPointerDown={(e) => e.target === e.currentTarget && onAnswer({ action: 'cancel' })}
    >
      <div className="share-dialog" role="dialog" aria-label="Choose what to share">
        <h2>
          Choose what to share with <b>{host(origin)}</b>
        </h2>
        <div className="share-tabs" role="tablist">
          {(
            [
              ['screen', 'Entire screen', screens.length],
              ['window', 'Window', windows.length]
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'on' : ''}
              onClick={() => {
                setTab(id)
                setPicked(null)
              }}
            >
              {label}
              <i>{n}</i>
            </button>
          ))}
        </div>
        <div
          className="share-grid"
          role="listbox"
          aria-label={tab === 'screen' ? 'Screens' : 'Windows'}
        >
          {shown.length === 0 && <p className="share-empty">Nothing to share here.</p>}
          {shown.map((s) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={picked === s.id}
              className={'share-item' + (picked === s.id ? ' on' : '')}
              onClick={() => setPicked(s.id)}
              onDoubleClick={() => share(s.id)}
            >
              <span className="share-thumb">
                {s.thumb ? (
                  <img src={s.thumb} alt="" draggable={false} />
                ) : s.icon ? (
                  <img className="icon" src={s.icon} alt="" draggable={false} />
                ) : (
                  <b>{(s.name || '?').charAt(0).toUpperCase()}</b>
                )}
              </span>
              <span className="share-name" title={s.name}>
                {s.name || (s.kind === 'screen' ? 'Screen' : 'Window')}
              </span>
            </button>
          ))}
        </div>
        <div className="share-foot">
          {audio && tab === 'screen' ? (
            <label className="share-audio">
              <input
                type="checkbox"
                checked={withAudio}
                onChange={(e) => setWithAudio(e.target.checked)}
              />
              Also share system audio
            </label>
          ) : (
            <span />
          )}
          <span className="share-buttons">
            <button
              type="button"
              className="perm-btn"
              onClick={() => onAnswer({ action: 'cancel' })}
            >
              Cancel
            </button>
            <button
              type="button"
              className="perm-btn primary"
              disabled={!chosen}
              onClick={() => chosen && share(chosen.id)}
            >
              Share
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
