import { useEffect, useRef, useState } from 'react'
import type { SharePerson } from '@shared/types'
import {
  ICE_SERVERS,
  videoBox,
  type LiveControl,
  type LiveSignal,
  type RemoteInput
} from '@shared/share/live'
import { Face } from '@renderer/components/ShareSection'
import { parse, useHostView } from '@renderer/liveHost'

/**
 * A tab shown live in a shared space (tasks/shared-spaces.md, shared browsing), like Hyperbeam but with the host's own
 * tab as the browser: its picture goes to each watcher over WebRTC (peer to peer, signalled through the relay, sealed
 * there), and one watcher at a time may drive it when the host lets them.
 */

/** A watcher's side: the host's tab, live, and driving it once let. */
function LiveViewer({
  spaceId,
  host,
  myName,
  onClose
}: {
  spaceId: number
  host: SharePerson
  myName: string
  onClose: () => void
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
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
      const v = video.current
      if (e.track.kind === 'audio') setHasSound(true)
      if (v && e.streams[0]) {
        v.srcObject = e.streams[0]
        void v.play().catch(() => undefined)
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
          if (msg?.k === 'granted') setControl('yes')
          else if (msg?.k === 'denied') setControl('no')
          else if (msg?.k === 'revoked') setControl('none')
        }
      } else if (ch.label === 'mv') mv.current = ch
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
  const mods = (e: React.KeyboardEvent): Array<'shift' | 'control' | 'alt' | 'meta'> => [
    ...(e.shiftKey ? (['shift'] as const) : []),
    ...(e.ctrlKey ? (['control'] as const) : []),
    ...(e.altKey ? (['alt'] as const) : []),
    ...(e.metaKey ? (['meta'] as const) : [])
  ]

  return (
    <div className="live-view" role="dialog" aria-label={`${host.name}'s tab, live`}>
      <div className="live-head">
        <Face name={host.name} color={host.color} size={22} />
        <div className="live-what">
          <b>{host.name}&rsquo;s tab</b>
          <span>{host.live?.title || host.live?.url}</span>
        </div>
        <span className={'live-badge ' + state}>
          <i aria-hidden="true" />
          {state === 'live' ? 'Live' : state === 'gone' ? 'Ended' : 'Connecting'}
        </span>
        {driving ? (
          <button
            type="button"
            className="live-btn on"
            onClick={() => {
              say({ k: 'release' })
              setControl('none')
            }}
          >
            You are driving &middot; Let go
          </button>
        ) : (
          <button
            type="button"
            className="live-btn"
            disabled={state !== 'live' || control === 'asked'}
            onClick={() => {
              say({ k: 'ask', name: myName })
              setControl('asked')
            }}
          >
            {control === 'asked'
              ? 'Asked…'
              : control === 'no'
                ? 'Ask again for control'
                : 'Ask for control'}
          </button>
        )}
        {hasSound && (
          <button
            type="button"
            className={'live-btn' + (sound ? '' : ' off')}
            aria-pressed={sound}
            title={sound ? 'Turn their tab’s sound off' : 'Turn their tab’s sound on'}
            onClick={() => setSound((v) => !v)}
          >
            {sound ? 'Sound on' : 'Sound off'}
          </button>
        )}
        <button type="button" className="live-close" aria-label="Stop watching" onClick={onClose}>
          &times;
        </button>
      </div>
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
        <video ref={video} muted={!sound} playsInline />
        {state !== 'live' && (
          <p className="live-wait">
            {state === 'gone' ? `${host.name} stopped showing it.` : 'Connecting to their tab…'}
          </p>
        )}
      </div>
    </div>
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
  liveTab,
  myName,
  onStop
}: {
  spaceId: number
  shared: boolean
  people: SharePerson[]
  /** The tab this person shows live here, if any. */
  liveTab: number | null
  myName: string
  onStop: () => void
}): React.JSX.Element | null {
  const view = useHostView(spaceId)
  const host = {
    watching: view?.watching ?? 0,
    asking: view?.asking ?? null,
    driver: view?.driver ?? null,
    allow: () => view?.allow(),
    deny: () => view?.deny(),
    takeBack: () => view?.takeBack()
  }
  const [watchingId, setWatchingId] = useState<number | null>(null)
  if (!shared) return null
  const showing = people.filter((p) => p.live && p.rtc)
  const watched = showing.find((p) => p.id === watchingId) ?? null
  return (
    <>
      {liveTab !== null && (
        <div className="live-bar" role="status">
          <span className="live-dot" aria-hidden="true" />
          <span className="live-bar-text">
            Showing live
            {host.watching > 0 ? ` · ${host.watching} watching` : ''}
          </span>
          {host.asking ? (
            <>
              <span className="live-bar-ask">{host.asking.name} asks to drive</span>
              <button type="button" className="live-btn primary" onClick={host.allow}>
                Let them
              </button>
              <button type="button" className="live-btn" onClick={host.deny}>
                No
              </button>
            </>
          ) : host.driver ? (
            <>
              <span className="live-bar-ask">{host.driver.name} is driving</span>
              <button type="button" className="live-btn" onClick={host.takeBack}>
                Take back
              </button>
            </>
          ) : null}
          <button type="button" className="live-btn quiet" onClick={onStop}>
            Stop
          </button>
        </div>
      )}
      {showing.length > 0 && !watched && (
        <div className="live-invites">
          {showing.map((p) => (
            <button
              key={p.id}
              type="button"
              className="live-invite"
              onClick={() => setWatchingId(p.id)}
            >
              <Face name={p.name} color={p.color} size={18} />
              <span>
                {p.name} is showing <b>{p.live!.title || p.live!.url}</b>
              </span>
              <em>Watch</em>
            </button>
          ))}
        </div>
      )}
      {watched && (
        <LiveViewer
          key={watched.id}
          spaceId={spaceId}
          host={watched}
          myName={myName}
          onClose={() => setWatchingId(null)}
        />
      )}
    </>
  )
}
