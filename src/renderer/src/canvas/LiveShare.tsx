import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWatching, watchLive } from '@renderer/liveWatch'
import { ChevronDownIcon, SpeakerIcon } from '@renderer/components/icons'
import { holdOverlay, releaseOverlay } from '@renderer/overlay'
import { useShareState } from '@renderer/components/useShare'
import type { SharePerson } from '@shared/types'
import {
  ICE_SERVERS,
  videoBox,
  type LiveControl,
  type LiveSignal,
  type RemoteInput
} from '@shared/share/live'
import { Face } from '@renderer/components/ShareSection'
import { parse } from '@renderer/liveHost'

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
  // the picture outlives any one <video>: whichever is mounted gets it (a remount once left a live call showing black)
  const stream = useRef<MediaStream | null>(null)
  const attach = useCallback((v: HTMLVideoElement | null): void => {
    video.current = v
    if (v && stream.current && v.srcObject !== stream.current) {
      v.srcObject = stream.current
      void v.play().catch(() => undefined)
    }
  }, [])
  const ctl = useRef<RTCDataChannel | null>(null)
  const mv = useRef<RTCDataChannel | null>(null)
  const [state, setState] = useState<'connecting' | 'live' | 'gone'>('connecting')
  const [control, setControl] = useState<'none' | 'asked' | 'yes' | 'no'>('none')
  /** The host's tab's sound, on unless turned off here (only while it has any). */
  const [sound, setSound] = useState(true)
  const [hasSound, setHasSound] = useState(false)
  const hostRtc = host.rtc
  const stage = useRef<HTMLDivElement>(null)
  /** Tells the host how big the picture is shown here (device pixels), so it sends no more than that. */
  const sendSize = useRef<() => void>(() => undefined)
  useEffect(() => {
    const el = stage.current
    if (!el) return
    let t = 0
    const send = (): void => {
      const ch = ctl.current
      if (ch?.readyState !== 'open') return
      const d = window.devicePixelRatio || 1
      const msg: LiveControl = {
        k: 'size',
        w: Math.round(el.clientWidth * d),
        h: Math.round(el.clientHeight * d)
      }
      ch.send(JSON.stringify(msg))
    }
    sendSize.current = send
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t)
      t = window.setTimeout(send, 250)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      window.clearTimeout(t)
    }
  }, [])

  useEffect(() => {
    if (!window.api.share || !hostRtc) return
    const send = (sig: LiveSignal): void =>
      window.api.share!.signal(spaceId, hostRtc, JSON.stringify(sig))
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pc.ontrack = (e) => {
      if (e.track.kind === 'audio') setHasSound(true)
      if (e.streams[0]) {
        stream.current = e.streams[0]
        attach(video.current)
        setState('live')
      }
    }
    pc.ondatachannel = (e) => {
      const ch = e.channel
      if (ch.label === 'ctl') {
        ctl.current = ch
        ch.onopen = () => sendSize.current()
        ch.onmessage = (m) => {
          const msg = parse<LiveControl>(String(m.data))
          if (msg?.k === 'ptr') ptrSink.current(msg)
          else if (msg?.k === 'granted') setControl('yes')
          else if (msg?.k === 'denied') setControl('no')
          else if (msg?.k === 'revoked') setControl('none')
        }
      } else if (ch.label === 'mv') {
        mv.current = ch
        ch.onmessage = (m) => {
          const msg = parse<LiveControl>(String(m.data))
          if (msg?.k === 'ptr') ptrSink.current(msg)
        }
      }
    }
    pc.onicecandidate = (e) => e.candidate && send({ k: 'ice', c: e.candidate.toJSON() as never })
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') setState('gone')
    }
    const off = window.api.share.onSignal(async (sid, from, data) => {
      if (sid !== spaceId || from !== hostRtc) return
      const sig = parse<LiveSignal>(data)
      if (!sig) return
      if (sig.k === 'sdp' && sig.sdp.type === 'offer') {
        await pc.setRemoteDescription(sig.sdp)
        await pc.setLocalDescription(await pc.createAnswer())
        send({ k: 'sdp', sdp: pc.localDescription!.toJSON() as never })
      } else if (sig.k === 'ice') await pc.addIceCandidate(sig.c).catch(() => undefined)
      else if (sig.k === 'bye') setState('gone')
    })
    // the relay's ICE servers (TURN when it has a key) before anything is gathered; hello once they are in
    let dead = false
    void window.api.share
      .ice(spaceId)
      .catch(() => null)
      .then((servers) => {
        if (dead) return
        if (servers)
          try {
            pc.setConfiguration({ iceServers: servers })
          } catch {
            // the built-in STUN stays
          }
        send({ k: 'hello' })
      })
    return () => {
      dead = true
      off()
      send({ k: 'bye' })
      pc.close()
      ctl.current = null
      mv.current = null
    }
  }, [spaceId, hostRtc])

  const say = (msg: LiveControl, fast = false): void => {
    const ch = fast && mv.current?.readyState === 'open' ? mv.current : ctl.current
    if (ch?.readyState === 'open') ch.send(JSON.stringify(msg))
  }
  const driving = control === 'yes'
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
  const at = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const v = video.current
    if (!v) return null
    const r = v.getBoundingClientRect()
    const box = videoBox(r, { width: v.videoWidth, height: v.videoHeight })
    const x = (e.clientX - r.left - box.x) / box.width
    const y = (e.clientY - r.top - box.y) / box.height
    return x < 0 || y < 0 || x > 1 || y > 1 ? null : { x, y }
  }
  const input = (e: RemoteInput, fast = false): void => say({ k: 'input', e }, fast)
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
    <div className="live-view" role="dialog" aria-label={`${host.name}'s tab, live`}>
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
              title="You are driving their tab. Click to let go."
              onClick={() => {
                say({ k: 'release' })
                setControl('none')
              }}
            >
              Driving · Let go
            </button>
          ) : (
            <button
              type="button"
              className={'cv-hbtn live-drive' + (control === 'asked' ? ' asked' : '')}
              disabled={state !== 'live' || control === 'asked'}
              aria-label="Ask to drive"
              title={
                control === 'asked'
                  ? `Asked ${host.name}…`
                  : control === 'no'
                    ? `${host.name} said no. Ask again`
                    : `Ask ${host.name} to let you drive their tab`
              }
              onClick={() => {
                say({ k: 'ask', name: myName })
                setControl('asked')
              }}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M3.5 2.2 12.6 8l-4 .9 2.2 4.4-1.6.8-2.2-4.4-3 2.7z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
              {control === 'asked' && <span>Asked</span>}
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
        tabIndex={driving ? 0 : -1}
        onPointerMove={(e) => {
          const p = driving && at(e)
          if (p) input({ t: 'move', ...p }, true)
        }}
        onPointerDown={(e) => {
          const p = driving && at(e)
          if (!p) return
          e.currentTarget.focus()
          input({ t: 'down', ...p, b: button(e.button), n: e.detail || 1 })
        }}
        onPointerUp={(e) => {
          const p = driving && at(e)
          if (p) input({ t: 'up', ...p, b: button(e.button), n: e.detail || 1 })
        }}
        onWheel={(e) => {
          const p = driving && at(e)
          if (p) input({ t: 'wheel', ...p, dx: e.deltaX, dy: e.deltaY }, true)
        }}
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
        <video ref={attach} muted={!sound} playsInline />
        {state === 'live' && (
          <LivePointers sinkRef={ptrSink} video={video} host={host} people={people} />
        )}
        {state !== 'live' && (
          <p className="live-wait">
            {state === 'gone' ? `${host.name} stopped showing it.` : 'Connecting to their tab…'}
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
  const on = !!host
  useEffect(() => {
    if (!on) return
    void holdOverlay('live-watch')
    return () => void releaseOverlay('live-watch')
  }, [on])
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
