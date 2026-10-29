import { useEffect, useState } from 'react'
import logo from '../../assets/logo.png'
import type { AboutInfo } from '../../../../shared/types'
import { formatSpeed, type UpdateState } from '../../../../shared/update'
import { Group, Row } from '../ui'

const POLL_MS = 1000

const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

const platformName = (p: string): string =>
  p === 'win32' ? 'Windows' : p === 'darwin' ? 'macOS' : p === 'linux' ? 'Linux' : p

function CheckMark(): React.JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.18" />
      <path
        d="m6 10.4 2.7 2.6L14 7.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The headline and supporting line for whatever the updater is doing. */
function Headline({ state }: { state: UpdateState }): React.JSX.Element {
  switch (state.kind) {
    case 'disabled':
      return (
        <>
          <div className="sw-headline">Updates are off for this build</div>
          <div className="sw-sub">{state.reason}</div>
        </>
      )
    case 'idle':
      return (
        <>
          <div className="sw-headline ok">
            <CheckMark />
            Panes is up to date
          </div>
          <div className="sw-sub">
            {state.checkedAt ? `Last checked at ${clock(state.checkedAt)}` : 'Not checked yet'}
          </div>
        </>
      )
    case 'checking':
      return (
        <>
          <div className="sw-headline">
            <span className="sw-spin" aria-hidden="true" />
            Checking for updates
          </div>
          <div className="sw-sub">This only takes a moment.</div>
        </>
      )
    case 'available':
      return (
        <>
          <div className="sw-headline">Panes {state.version} is available</div>
          <div className="sw-sub">Starting the download.</div>
          <div className="sw-bar indeterminate" role="progressbar" aria-label="Starting download">
            <span />
          </div>
        </>
      )
    case 'downloading':
      return (
        <>
          <div className="sw-headline">Downloading Panes {state.version}</div>
          <div className="sw-sub">
            {Math.round(state.percent)}% &middot; {formatSpeed(state.bytesPerSecond)}
          </div>
          <div
            className="sw-bar"
            role="progressbar"
            aria-label="Download progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(state.percent)}
          >
            <span style={{ width: `${state.percent}%` }} />
          </div>
        </>
      )
    case 'installing':
      return (
        <>
          <div className="sw-headline">Installing Panes {state.version}</div>
          <div className="sw-sub">
            Panes is closing and will open again by itself in a few seconds. Your tabs come back as
            they were.
          </div>
        </>
      )
    case 'ready':
      return (
        <>
          <div className="sw-headline ok">
            <CheckMark />
            Panes {state.version} is ready
          </div>
          <div className="sw-sub">
            Restart to finish updating. Your tabs come back as they were.
          </div>
        </>
      )
    case 'error':
      return (
        <>
          <div className="sw-headline bad">Couldn&apos;t check for updates</div>
          <div className="sw-sub">{state.message}</div>
        </>
      )
  }
}

/** The two things you can do, always in the same place: look for an update, and take one that is ready. */
/** One button at a time, the one that fits where the update is. */
function Actions({
  state,
  onCheck,
  onInstall
}: {
  state: UpdateState
  onCheck: () => void
  onInstall: () => void
}): React.JSX.Element | null {
  switch (state.kind) {
    case 'disabled':
      return null
    case 'ready':
      return (
        <div className="sw-actions">
          <button className="int-btn primary" onClick={onInstall} autoFocus>
            Restart to update
          </button>
        </div>
      )
    case 'installing':
      return (
        <div className="sw-actions">
          <button className="int-btn" disabled>
            <span className="sw-spin" aria-hidden="true" />
            Installing...
          </button>
        </div>
      )
    case 'available':
    case 'downloading':
      return null // the progress bar above is the whole story; nothing to press
    case 'checking':
      return (
        <div className="sw-actions">
          <button className="int-btn" disabled>
            <span className="sw-spin" aria-hidden="true" />
            Checking...
          </button>
        </div>
      )
    case 'error':
      return (
        <div className="sw-actions">
          <button className="int-btn primary" onClick={onCheck}>
            Try again
          </button>
        </div>
      )
    default:
      return (
        <div className="sw-actions">
          <button className="int-btn primary" onClick={onCheck}>
            Check for updates
          </button>
        </div>
      )
  }
}

export function Software(): React.JSX.Element {
  const api = window.panesInternal
  const [state, setState] = useState<UpdateState | null>(null)
  const [about, setAbout] = useState<AboutInfo | null>(null)

  useEffect(() => {
    void api.about().then(setAbout)
    const tick = (): void => void api.updateState().then(setState)
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => clearInterval(id)
  }, [api])

  if (!state) return <></>

  const check = (): void => {
    // Show it at once; the poll would otherwise lag a second behind the click.
    setState({ kind: 'checking', checkedAt: state.kind === 'idle' ? state.checkedAt : null })
    void api.updateCheck()
  }
  const notes =
    state.kind === 'available' || state.kind === 'downloading' || state.kind === 'ready'
      ? state.notes
      : ''

  return (
    <>
      <section className="sw-hero">
        <img className="sw-logo" src={logo} alt="" width={76} height={76} />
        <div className="sw-name">Panes</div>
        <div className="sw-version">Version {about?.version ?? ''}</div>
        <div className="sw-status" aria-live="polite">
          <Headline state={state} />
          <Actions state={state} onCheck={check} onInstall={() => void api.updateInstall()} />
        </div>
      </section>

      {notes && (
        <Group title="What's new">
          <div className="u-row sw-notes">{notes}</div>
        </Group>
      )}

      <Group
        title="Feedback"
        footer="Opens your email app with a message to the developer, with this version and your system filled in below where you write."
      >
        <Row label="Tell me what you think" hint="A bug, an idea, something that felt wrong.">
          <button className="int-btn primary" onClick={() => void api.sendFeedback()}>
            Send feedback
          </button>
        </Row>
      </Group>

      <Group
        title="About"
        footer="Panes checks for updates when it starts and every few hours, downloads them quietly in the background, and installs when you restart. It never restarts on its own."
      >
        <Row label="Version">
          <span className="sw-val">{about?.version}</span>
        </Row>
        <Row label="Chromium">
          <span className="sw-val">{about?.chrome}</span>
        </Row>
        <Row label="Electron">
          <span className="sw-val">{about?.electron}</span>
        </Row>
        <Row label="Node.js">
          <span className="sw-val">{about?.node}</span>
        </Row>
        <Row label="System">
          <span className="sw-val">
            {about ? `${platformName(about.platform)} ${about.arch}` : ''}
          </span>
        </Row>
      </Group>
    </>
  )
}
