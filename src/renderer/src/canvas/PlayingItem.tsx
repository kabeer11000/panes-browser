import type { TabInfo } from '@shared/types'
import { SpeakerIcon, CloseIcon } from '@renderer/components/icons'
import { MiniPauseIcon, MiniPlayIcon } from './icons'
import { isCapturing } from '@shared/capture'

/**
 * One thing playing (or paused) on the board, or a call: its title goes to its card; play or pause, mute, and leave
 * the list. A call has no play or pause and stays listed while it lasts.
 */
export function PlayingItem({
  t,
  onGo,
  onForget
}: {
  t: TabInfo
  onGo: (id: number) => void
  onForget: (id: number) => void
}): React.JSX.Element {
  const call = isCapturing(t.capture)
  const on = call || (t.audible && !t.muted)
  const title =
    t.private || t.tor ? 'Private tab' : t.aiTitle || t.title || (call ? 'Call' : 'Playing')
  return (
    <div className="cv-playing-item">
      <button
        type="button"
        className="cv-playing-go"
        title={call ? 'In a call: go to its card' : 'Go to its card'}
        onClick={() => onGo(t.id)}
      >
        <span className={'cv-eq' + (on ? '' : ' still')} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="cv-playing-title">{title}</span>
      </button>
      {!call && (
        <button
          type="button"
          className="cv-mbtn"
          aria-label={t.audible ? `Pause ${title}` : `Play ${title}`}
          title={t.audible ? 'Pause' : 'Play'}
          onClick={() =>
            void window.api.mediaPlay?.(t.id, t.audible ? 'pause' : 'play').catch(() => undefined)
          }
        >
          {t.audible ? <MiniPauseIcon /> : <MiniPlayIcon />}
        </button>
      )}
      <button
        type="button"
        className="cv-mbtn"
        aria-label={t.muted ? `Unmute ${title}` : `Mute ${title}`}
        title={t.muted ? 'Unmute' : 'Mute'}
        onClick={() => window.api.toggleMute(t.id)}
      >
        <SpeakerIcon muted={t.muted} />
      </button>
      {!t.audible && !call && (
        <button
          type="button"
          className="cv-mbtn cv-playing-x"
          aria-label={`Take ${title} off the list`}
          title="Take it off the list"
          onClick={() => onForget(t.id)}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  )
}
