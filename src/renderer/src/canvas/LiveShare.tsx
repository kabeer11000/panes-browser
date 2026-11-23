import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWatching, watchLive } from '@renderer/liveWatch'
import { ChevronDownIcon, SpeakerIcon } from '@renderer/components/icons'
import { holdOverlay, releaseOverlay } from '@renderer/overlay'
import { useShareState } from '@renderer/components/useShare'
import type { SharePerson } from '@shared/types'
import { videoBox, type LiveControl, type RemoteInput } from '@shared/share/live'
import { takeLine, type LiveUser } from '@renderer/liveLine'
import { Face } from '@renderer/components/ShareSection'

/**
 * A tab shown live in a shared space (tasks/shared-spaces.md, shared browsing), like Hyperbeam but with the host's own
 * tab as the browser: its picture goes to each watcher over WebRTC (peer to peer, signalled through the relay, sealed
 * there), and one watcher at a time may drive it when the host lets them.
 */

type Ptr = Extract<LiveControl, { k: 'ptr' }>

/**
 * The host's and the driver's pointers over the live picture (tab capture draws no cursor): named arrows, placed by
 * the picture's box inside the video. Its own state, so only it redraws at the pointers' rate.
 */
function LivePointers({
  sinkRef,
  video,
  host,
  people
}: {
  sinkRef: React.RefObject<(m: Ptr) => void>
  video: React.RefObject<HTMLVideoElement | null>
  host: SharePerson
  people: SharePerson[]
}): React.JSX.Element {
  const [at, setAt] = useState<Record<number, { x: number; y: number; t: number }>>({})
  useEffect(() => {
    sinkRef.current = (m) =>
      setAt((cur) => {
        const next = { ...cur }
        if (m.x === null) delete next[m.who]
        else next[m.who] = { x: m.x, y: m.y, t: Date.now() }
        return next
      })
    // a driver's pointer that stopped coming (they let go, or left the picture) goes after a while; the host's stays
    // until it leaves the page (it is sent only as it moves)
    const sweep = window.setInterval(
      () =>
        setAt((cur) => {
          const now = Date.now()
          const keep = Object.entries(cur).filter(([who, p]) => who === '0' || now - p.t < 5000)
          return keep.length === Object.keys(cur).length ? cur : Object.fromEntries(keep)
        }),
      1000
    )
    return () => {
      window.clearInterval(sweep)
      sinkRef.current = () => undefined
    }
  }, [sinkRef])
  const v = video.current
  if (!v || !v.videoWidth) return <></>
  const box = videoBox(
    { width: v.clientWidth, height: v.clientHeight },
    { width: v.videoWidth, height: v.videoHeight }
  )
  return (
    <>
      {Object.entries(at).map(([who, p]) => {
        const person = who === '0' ? host : people.find((q) => q.rtc === Number(who))
        return (
          <div
            key={who}
            className="live-ptr"
            style={
              {
                transform: `translate(${v.offsetLeft + box.x + p.x * box.width}px, ${v.offsetTop + box.y + p.y * box.height}px)`,
                '--pc': person?.color ?? '#888'
              } as React.CSSProperties
            }
            aria-hidden="true"
          >
            <svg width="16" height="18" viewBox="0 0 16 18">
              <path d="M1 1l13 7.5-6 1.2L5.2 16z" />
            </svg>
            <span>{person?.name ?? 'Someone'}</span>
          </div>
        )
      })}
    </>
  )
}

/** A watcher's side: the host's tab, live, and driving it once let. */
/** The live panel's margin from the window's edges, and its bar's height (canvas.css .live-view, .cv-panel-head). */
const VIEW_MARGIN = 8
const VIEW_BAR = 34
/** The room the live picture could fill: the window less the panel's margin and bar (CSS pixels). */
function viewRoom(): { w: number; h: number } {
  return {
    w: Math.max(200, window.innerWidth - 2 * VIEW_MARGIN),
    h: Math.max(150, window.innerHeight - 2 * VIEW_MARGIN - VIEW_BAR)
  }
}
const stop = (e: React.SyntheticEvent): void => e.stopPropagation()

function LiveViewer({
  spaceId,
  host,
  people,
  myName,
  onClose
}: {
  spaceId: number
  host: SharePerson
  people: SharePerson[]
  myName: string
  onClose: () => void
}): React.JSX.Element {
  const ptrSink = useRef<(m: Ptr) => void>(() => undefined)
  const video = useRef<HTMLVideoElement>(null)
  /** The line to the host, shared with their tab's cards on the board (liveLine.ts). */
  const lineRef = useRef<ReturnType<typeof takeLine> | null>(null)
  // the picture outlives any one <video>: whichever is mounted gets it (a remount once left a live call showing black)
  const attach = useCallback((v: HTMLVideoElement | null): void => {
    video.current = v
    const stream = lineRef.current?.line.stream
    if (v && stream && v.srcObject !== stream) {
      v.srcObject = stream
      void v.play().catch(() => undefined)
    }
  }, [])
  const [state, setState] = useState<'connecting' | 'live' | 'gone'>('connecting')
  /** Still not through after a while: say so instead of "Connecting" for good. */
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (state === 'live') return
    const t = window.setTimeout(() => setSlow(true), 12_000)
    return () => {
      window.clearTimeout(t)
      setSlow(false)
    }
  }, [state])
  const [control, setControl] = useState<'none' | 'asked' | 'yes' | 'no'>('none')
  const controlRef = useRef(control)
  useEffect(() => {
    controlRef.current = control
  }, [control])
  /** The host's tab's sound, on unless turned off here (only while it has any). */
  const [sound, setSound] = useState(true)
  const [hasSound, setHasSound] = useState(false)
  /** The page's own cursor under the pointer (the host says it): a hand on links, a bar on text. */
  const [cursor, setCursor] = useState('default')
  const hostRtc = host.rtc
  const stage = useRef<HTMLDivElement>(null)
  // The page views are native and paint over the window's own UI: while the viewer is open they stand aside as
  // pictures, wherever it was opened from (the board's preview, the tab view), so every click lands on the picture.
  useEffect(() => {
    void holdOverlay('live-watch')
    return () => void releaseOverlay('live-watch')
  }, [])

  useEffect(() => {
    if (!window.api.share || !hostRtc) return
    const user: LiveUser = {
      changed: () => {
        const l = lineRef.current?.line
        if (!l) return
        setState(l.state)
        setHasSound(l.hasSound)
        attach(video.current)
      },
      message: (msg) => {
        if (msg.k === 'ptr') ptrSink.current(msg)
        else if (msg.k === 'granted') setControl('yes')
        else if (msg.k === 'denied') setControl('no')
        else if (msg.k === 'revoked') setControl('none')
        else if (msg.k === 'cur' && /^[a-z-]{1,24}$/.test(msg.c)) setCursor(msg.c)
      },
      // the room it could fill (the window, less its margin and bar), not the picture's own box: out of the host's
      // sight their tab takes this shape, and the picture then grows to fill it
      size: () => {
        const d = window.devicePixelRatio || 1
        const r = viewRoom()
        return { w: r.w * d, h: r.h * d }
      }
    }
    const held = takeLine(spaceId, hostRtc, user)
    lineRef.current = held
    user.changed()
    let t = 0
    const later = (): void => {
      window.clearTimeout(t)
      t = window.setTimeout(held.sendSize, 250)
    }
    window.addEventListener('resize', later)
    return () => {
      window.removeEventListener('resize', later)
      window.clearTimeout(t)
      // the line may stay up for the tab's card: driving ends with the viewer
      const ch = held.line.ctl
      if (controlRef.current === 'yes' && ch?.readyState === 'open')
        ch.send(JSON.stringify({ k: 'release' } satisfies LiveControl))
      held.release()
      lineRef.current = null
    }
  }, [spaceId, hostRtc, attach])

  const say = (msg: LiveControl, fast = false): void => {
    const l = lineRef.current?.line
    const ch = fast && l?.mv?.readyState === 'open' ? l.mv : l?.ctl
    if (ch?.readyState === 'open') ch.send(JSON.stringify(msg))
  }
  const driving = control === 'yes'
  const hostFirst = host.name.split(' ')[0]
  // Esc puts it away, as it does the preview (not while driving: then keys are for their page)
  useEffect(() => {
    if (driving) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [driving, onClose])
  /** A pointer on the video as fractions of the page (null outside the picture, in its letterbox). */
  /** A pointer on the video as fractions of the page: null outside the picture, or held to its edge (`clamp`). */
  const at = (
    e: { clientX: number; clientY: number },
    clamp = false
  ): { x: number; y: number } | null => {
    const v = video.current
    if (!v) return null
    const r = v.getBoundingClientRect()
    const box = videoBox(r, { width: v.videoWidth, height: v.videoHeight })
    const x = (e.clientX - r.left - box.x) / box.width
    const y = (e.clientY - r.top - box.y) / box.height
    if (clamp) return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
    return x < 0 || y < 0 || x > 1 || y > 1 ? null : { x, y }
  }
  // Everything the pointer does goes in one ordered line (a press, the moves of a drag, the release), the moves and
  // the scrolling gathered to one a frame: a click never overtakes the move before it, and nothing floods the line.
  const input = (e: RemoteInput): void => say({ k: 'input', e })
  const pend = useRef<{ move?: { x: number; y: number }; wheel?: RemoteInput & { t: 'wheel' } }>({})
  const frame = useRef(0)
  const flush = (): void => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    const p = pend.current
    pend.current = {}
    if (p.move) input({ t: 'move', ...p.move })
    if (p.wheel) input(p.wheel)
  }
  const soon = (): void => {
    frame.current ||= requestAnimationFrame(flush)
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  /** Buttons the driver holds on the picture (a drag): its moves and release count even past the picture's edge. */
  const held = useRef(0)

  const button = (b: number): 'left' | 'middle' | 'right' =>
    b === 1 ? 'middle' : b === 2 ? 'right' : 'left'
  const site = ((): string => {
    try {
      return new URL(host.live?.url ?? '').hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  })()
  const mods = (e: React.KeyboardEvent): Array<'shift' | 'control' | 'alt' | 'meta'> => [
    ...(e.shiftKey ? (['shift'] as const) : []),
    ...(e.ctrlKey ? (['control'] as const) : []),
    ...(e.altKey ? (['alt'] as const) : []),
    ...(e.metaKey ? (['meta'] as const) : [])
  ]

  // in the body, not the board's top bar: over every bar and toast of the board, as the preview is
  return createPortal(
    <div
      className="live-view"
      role="dialog"
      aria-label={`${host.name}'s tab, live`}
      // Portaled to the body, but React still bubbles its events up the component tree to the board (which renders
      // it): the board took the pointer on every press (its release never reached the picture: clicks went "under"
      // it) and panned and selected under every move. Nothing in here is the board's.
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onMouseDown={stop}
      onMouseUp={stop}
      onClick={stop}
      onDoubleClick={stop}
      onWheel={stop}
      onContextMenu={stop}
      onKeyDown={stop}
      onKeyUp={stop}
      onDragStart={stop}
    >
      {/* the preview's own slim bar (Expanded.tsx): whose page it is in the address pill, then only what a watcher
          can do: drive (when let), sound, close */}
      <header className="cv-panel-head live-head">
        <div className="cv-hzone cv-hzone-l">
          <div className="cv-panel-title" title={host.live?.url}>
            <span className="cv-panel-icon">
              <Face name={host.name} color={host.color} size={16} />
            </span>
            <strong>{host.live?.title || host.live?.url}</strong>
            <span>
              {host.name}
              {site ? ` · ${site}` : ''}
            </span>
          </div>
          <span className={'live-badge ' + state}>
            <i aria-hidden="true" />
            {state === 'live' ? 'Live' : state === 'gone' ? 'Ended' : 'Connecting'}
          </span>
        </div>
        <div className="cv-hzone cv-hzone-r">
          {driving ? (
            <button
              type="button"
              className="live-btn on"
              title={`You are controlling ${host.name}'s tab. Click to give it back.`}
              onClick={() => {
                say({ k: 'release' })
                setControl('none')
              }}
            >
              <i aria-hidden="true" />
              You&apos;re in control · Give back
            </button>
          ) : (
            <button
              type="button"
              className="live-btn"
              disabled={state !== 'live' || control === 'asked'}
              title={`Ask ${host.name} to let you click and type in their tab`}
              onClick={() => {
                say({ k: 'ask', name: myName })
                setControl('asked')
              }}
            >
              {control === 'asked'
                ? `Waiting for ${hostFirst}…`
                : control === 'no'
                  ? `${hostFirst} said no · Ask again`
                  : 'Ask to control'}
            </button>
          )}
          {hasSound && (
            <button
              type="button"
              className="cv-hbtn"
              aria-pressed={sound}
              aria-label={sound ? 'Mute their tab' : 'Unmute their tab'}
              title={sound ? 'Mute their tab' : 'Unmute their tab'}
              onClick={() => setSound((v) => !v)}
            >
              <SpeakerIcon muted={!sound} />
            </button>
          )}
          <button
            type="button"
            className="cv-hbtn"
            aria-label="Stop watching"
            title="Stop watching (Esc)"
            onClick={onClose}
          >
            <ChevronDownIcon />
          </button>
        </div>
      </header>
      <div
        ref={stage}
        className={'live-stage' + (driving ? ' driving' : '')}
        style={
          driving
            ? ({ cursor, '--pc': host.color } as React.CSSProperties)
            : undefined
        }
        tabIndex={driving ? 0 : -1}
        onPointerMove={(e) => {
          if (!driving) return
          const p = at(e, held.current > 0)
          if (!p) return
          pend.current.move = p
          soon()
        }}
        onPointerDown={(e) => {
          const p = driving && at(e)
          if (!p) return
          e.currentTarget.focus()
          e.currentTarget.setPointerCapture(e.pointerId) // a drag keeps its pointer past the picture's edge
          flush()
          held.current++
          input({ t: 'down', ...p, b: button(e.button), n: e.detail || 1 })
        }}
        onPointerUp={(e) => {
          if (!driving || held.current === 0) return
          flush()
          held.current--
          input({ t: 'up', ...at(e, true)!, b: button(e.button), n: e.detail || 1 })
        }}
        onWheel={(e) => {
          const p = driving && at(e)
          if (!p) return
          // lines and pages as pixels (a mouse wheel says lines; a touchpad, pixels)
          const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1
          const w = pend.current.wheel
          pend.current.wheel = {
            t: 'wheel',
            ...p,
            dx: (w?.dx ?? 0) + e.deltaX * k,
            dy: (w?.dy ?? 0) + e.deltaY * k
          }
          soon()
        }}
        onDragStart={(e) => e.preventDefault()}
        onContextMenu={(e) => driving && e.preventDefault()}
        onKeyDown={(e) => {
          if (!driving) return
          e.preventDefault()
          input({ t: 'key', key: e.key, up: false, mods: mods(e) })
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) input({ t: 'char', text: e.key })
        }}
        onKeyUp={(e) => {
          if (!driving) return
          e.preventDefault()
          input({ t: 'key', key: e.key, up: true, mods: mods(e) })
        }}
      >
        <video ref={attach} muted={!sound} playsInline disablePictureInPicture />
        {state === 'live' && (
          <LivePointers sinkRef={ptrSink} video={video} host={host} people={people} />
        )}
        {state !== 'live' && (
          <p className="live-wait">
            {state === 'gone'
              ? `${host.name} stopped showing it.`
              : slow
                ? `Can't get a line through to ${host.name}'s Panes. Their network or yours is blocking it; still trying…`
                : 'Connecting to their tab…'}
          </p>
        )}
      </div>
    </div>,
    document.body
  )
}

/**
 * Live tabs on a shared board: the host's bar (who watches, who asks to drive, stop), the others' "watch" chips, and
 * the panel a watcher sees.
 */
/**
 * The card of a tab someone is showing live, on the others' boards: their picture playing on it, small and muted,
 * while the card is on screen (Canvas gives it the host only then). It shares the viewer's line (liveLine.ts) and
 * tells the host only how big the card is, so the picture is sent that small and their tab keeps its shape. The
 * card's own picture shows until the first frame.
 */
export function LiveCardVideo({
  spaceId,
  hostRtc,
  w,
  h
}: {
  spaceId: number
  hostRtc: number
  /** The card's size on the board. */
  w: number
  h: number
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const [on, setOn] = useState(false)
  const size = useRef({ w, h })
  const sendSize = useRef<() => void>(() => undefined)
  useEffect(() => {
    size.current = { w, h }
    sendSize.current()
  }, [w, h])
  useEffect(() => {
    if (!window.api.share) return
    const v = video.current
    let held: ReturnType<typeof takeLine> | null = null
    const show = (): void => {
      const stream = held?.line.stream
      if (v && stream && v.srcObject !== stream) {
        v.srcObject = stream
        void v.play().catch(() => undefined)
      }
    }
    held = takeLine(spaceId, hostRtc, {
      changed: show,
      size: () => {
        const d = window.devicePixelRatio || 1
        return { w: size.current.w * d, h: size.current.h * d, card: true }
      }
    })
    sendSize.current = held.sendSize
    show()
    return () => {
      sendSize.current = () => undefined
      held?.release()
      if (v) v.srcObject = null
      setOn(false)
    }
  }, [spaceId, hostRtc])
  return (
    <div className={'cv-live' + (on ? ' on' : '')} aria-hidden="true">
      <video
        ref={video}
        className="cv-live-whole"
        muted
        playsInline
        onPlaying={() => setOn(true)}
      />
    </div>
  )
}

export function LiveShare({
  spaceId,
  shared,
  people,
  myName
}: {
  spaceId: number
  shared: boolean
  people: SharePerson[]
  myName: string
}): React.JSX.Element | null {
  const w = useWatching()
  const watchingId = w?.spaceId === spaceId ? w.personId : null
  const setWatchingId = (id: number | null): void =>
    watchLive(id === null ? null : { spaceId, personId: id })
  if (!shared) return null
  const showing = people.filter((p) => p.live && p.rtc)
  const watched = showing.find((p) => p.id === watchingId) ?? null
  return (
    <>
      {watched && (
        <LiveViewer
          key={watched.id}
          spaceId={spaceId}
          host={watched}
          people={people}
          myName={myName}
          onClose={() => setWatchingId(null)}
        />
      )}
    </>
  )
}

/**
 * Watching someone's live tab away from the board (tab view): the same viewer, opened from the window's Watch chip
 * (StatusChips). The page views are native and would sit over it, so they give way to their pictures meanwhile.
 */
export function LiveWatchPanel({
  spaceId,
  shared
}: {
  spaceId: number
  shared: boolean
}): React.JSX.Element | null {
  const w = useWatching()
  const st = useShareState(spaceId, shared)
  const host =
    w?.spaceId === spaceId
      ? st?.people.find((p) => p.id === w.personId && p.live && p.rtc)
      : undefined
  if (!host || !st) return null
  return (
    <LiveViewer
      key={host.id}
      spaceId={spaceId}
      host={host}
      people={st.people}
      myName={st.me?.name ?? 'Someone'}
      onClose={() => watchLive(null)}
    />
  )
}
