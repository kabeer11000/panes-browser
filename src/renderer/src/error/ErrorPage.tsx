import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  describeError,
  parseErrorParams,
  retryTarget,
  type ErrorKind
} from '../../../shared/errors'
import { SEARCH_ENGINES } from '../../../shared/settings'
import { Runner } from './Runner'

const KONAMI = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a'
]
const PANE_COLORS = ['#7ab4ff', '#ff7ac8', '#ff8a6b', '#8be0b4', '#b69cff', '#ffd166']
const POKES = 7
const SECRETS = [
  'Panes: now with 100% more panes.',
  'This page has no tabs to close. Just you.',
  'You found the pane in the glass.',
  'Have you tried turning the internet off and on again?'
]

/** One small line-drawn badge per kind of failure, drawn on the mascot's front pane. */
function Badge({ kind }: { kind: ErrorKind }): React.JSX.Element {
  const paths: Record<ErrorKind, string> = {
    offline: 'M6 16a8 8 0 0 1 12 0M9 19a4 4 0 0 1 6 0M12 22h.01M4 4l16 16',
    dns: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM16 16l5 5M9 9.5a2 2 0 1 1 2 2v1',
    refused: 'M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5',
    timeout: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l3 2M9 2h6',
    cert: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
    blocked: 'M12 3 4 6v6c0 4.4 3.2 7.6 8 9 4.8-1.4 8-4.6 8-9V6zM9 9l6 6M15 9l-6 6',
    generic: 'M12 4 3 20h18zM12 10v4M12 17h.01'
  }
  return (
    <svg className="mascot-badge" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[kind]} />
    </svg>
  )
}

function Mascot({
  kind,
  poked,
  onPoke
}: {
  kind: ErrorKind
  poked: boolean
  onPoke: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={'mascot' + (poked ? ' shuffle' : '')}
      aria-label="Panes mascot"
      onClick={onPoke}
    >
      <span className="m-pane m-back" />
      <span className="m-pane m-mid" />
      <span className="m-pane m-front">
        <Badge kind={kind} />
      </span>
    </button>
  )
}

function rain(): void {
  const layer = document.createElement('div')
  layer.className = 'rain'
  for (let i = 0; i < 44; i++) {
    const p = document.createElement('i')
    p.style.left = `${Math.random() * 100}%`
    p.style.background = PANE_COLORS[i % PANE_COLORS.length]
    p.style.animationDelay = `${Math.random() * 1.2}s`
    p.style.animationDuration = `${2 + Math.random() * 1.8}s`
    p.style.setProperty('--spin', `${Math.round(Math.random() * 720 - 360)}deg`)
    layer.appendChild(p)
  }
  document.body.appendChild(layer)
  setTimeout(() => layer.remove(), 4500)
}

export function ErrorPage(): React.JSX.Element {
  const params = useMemo(() => parseErrorParams(location.search), [])
  const info = useMemo(() => describeError(params.desc), [params.desc])
  const target = retryTarget(params.url)
  const host = useMemo(() => {
    try {
      return new URL(params.url).hostname
    } catch {
      return params.url
    }
  }, [params.url])

  const [pokes, setPokes] = useState(0)
  const [secret, setSecret] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const typed = useRef('')
  const konami = useRef(0)

  useEffect(() => {
    document.title = info.title
  }, [info.title])

  const retry = useCallback(() => {
    if (target) location.replace(target)
  }, [target])

  // Offline: come back on our own the moment the network does, like Chrome does.
  useEffect(() => {
    if (info.kind !== 'offline') return
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [info.kind, retry])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (playing) return
      // Konami code: panes rain down.
      konami.current =
        e.key === KONAMI[konami.current] ? konami.current + 1 : e.key === KONAMI[0] ? 1 : 0
      if (konami.current === KONAMI.length) {
        konami.current = 0
        rain()
        setSecret('Up, up, down, down... you know the way.')
      }
      // Offline: space starts the game. Anywhere else, type "play".
      if (info.kind === 'offline' && e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        setPlaying(true)
        return
      }
      if (e.key.length === 1) {
        typed.current = (typed.current + e.key.toLowerCase()).slice(-4)
        if (typed.current === 'play') setPlaying(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [info.kind, playing])

  const poke = (): void => {
    const n = pokes + 1
    setPokes(n)
    if (n % POKES === 0) setSecret(SECRETS[(n / POKES - 1) % SECRETS.length])
  }

  const searchInstead = async (): Promise<void> => {
    const s = await window.panesInternal.getSettings()
    location.href = SEARCH_ENGINES[s.searchEngine].url + encodeURIComponent(host)
  }

  const quitGame = useCallback(() => setPlaying(false), [])

  return (
    <main className={'err kind-' + info.kind}>
      <Mascot kind={info.kind} poked={pokes > 0 && pokes % POKES === 0} onPoke={poke} />
      <h1>{info.title}</h1>
      <p className="err-msg">
        {host ? <b className="err-host">{host}</b> : null}
        {info.message}
      </p>

      <div className="err-actions">
        {target && (
          <button type="button" className="err-btn primary" onClick={retry} autoFocus>
            Try again
          </button>
        )}
        {info.kind === 'dns' && host && (
          <button type="button" className="err-btn" onClick={() => void searchInstead()}>
            Search for it
          </button>
        )}
        <button
          type="button"
          className="err-btn"
          disabled={!params.back}
          onClick={() => history.back()}
        >
          Go back
        </button>
      </div>

      <ul className="err-tips">
        {info.tips.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>

      {playing ? (
        <Runner onQuit={quitGame} />
      ) : (
        info.kind === 'offline' && (
          <button type="button" className="err-hint" onClick={() => setPlaying(true)}>
            Press Space to play while you wait
          </button>
        )
      )}

      <p className={'err-secret' + (secret ? ' on' : '')} aria-live="polite">
        {secret ?? ' '}
      </p>

      <details className="err-details">
        <summary>Details</summary>
        <dl>
          <dt>Address</dt>
          <dd>{params.url || 'unknown'}</dd>
          <dt>Error</dt>
          <dd>
            {params.desc} ({params.code})
          </dd>
        </dl>
      </details>
    </main>
  )
}
