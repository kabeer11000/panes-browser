import { useEffect, useRef, useState } from 'react'
import {
  inOrder,
  ICE_SERVERS,
  videoBox,
  type LiveControl,
  type LiveSignal,
  type RemoteInput
} from '@shared/share/live'
import type { Person, Room } from './room'

/**
 * Watching someone's live tab from the web (tasks/shared-spaces.md, 7g): the same calls as in Panes (LiveShare.tsx),
 * through the room's relay. Sound, the host's and driver's pointers, and driving it when the host lets this guest.
 */

const parse = <T,>(data: string): T | null => {
  try {
    return JSON.parse(data) as T
  } catch {
    return null
  }
}
type Ptr = Extract<LiveControl, { k: 'ptr' }>
const button = (b: number): 'left' | 'middle' | 'right' =>
  b === 1 ? 'middle' : b === 2 ? 'right' : 'left'
const mods = (e: React.KeyboardEvent): Array<'shift' | 'control' | 'alt' | 'meta'> => {
  const m: Array<'shift' | 'control' | 'alt' | 'meta'> = []
  if (e.shiftKey) m.push('shift')
  if (e.ctrlKey) m.push('control')
  if (e.altKey) m.push('alt')
  if (e.metaKey) m.push('meta')
  return m
}

export function Watch({
  room,
  host,
  people,
  myName,
  onClose
}: {
  room: Room
  host: Person
  people: Person[]
  myName: string
  onClose: () => void
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const ctl = useRef<RTCDataChannel | null>(null)
  const mv = useRef<RTCDataChannel | null>(null)
  const [state, setState] = useState<'connecting' | 'live' | 'gone'>('connecting')
  const [control, setControl] = useState<'none' | 'asked' | 'yes' | 'no'>('none')
  const [sound, setSound] = useState(true)
  const [ptrs, setPtrs] = useState<Record<number, { x: number; y: number; t: number }>>({})
  /** Where the picture is inside the stage (object-fit: contain), for placing pointers on it. */
  const [geo, setGeo] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null
  )
  const roomRef = useRef(room)
  useEffect(() => {
    roomRef.current = room
  })
  const hostRtc = host.rtc

  const sendSize = (): void => {
    const el = stage.current
    const ch = ctl.current
    if (!el || ch?.readyState !== 'open') return
    const d = window.devicePixelRatio || 1
    const msg: LiveControl = {
      k: 'size',
      w: Math.round(el.clientWidth * d),
      h: Math.round(el.clientHeight * d)
    }
    ch.send(JSON.stringify(msg))
  }
  const sendSizeRef = useRef(sendSize)
  useEffect(() => {
    sendSizeRef.current = sendSize
  })

  useEffect(() => {
    if (!hostRtc) return
    const r = roomRef.current
    const send = (sig: LiveSignal): void => r.signal(hostRtc, JSON.stringify(sig))
    const onPtr = (m: Ptr): void =>
      setPtrs((cur) => {
        const next = { ...cur }
        if (m.x === null) delete next[m.who]
        else next[m.who] = { x: m.x, y: m.y, t: Date.now() }
        return next
      })
    let dead = false
    let servers: RTCIceServer[] = ICE_SERVERS
    let pc: RTCPeerConnection | null = null
    let knock = 0
    let redial = 0
    /**
     * One connection per call: the host makes a new one for every hello it answers, so an offer after the first (two
     * hellos crossed, or the host's picture restarted) needs a new one here too. Reusing the old one hung on
     * "Connecting".
     */
    const fresh = (): RTCPeerConnection => {
      pc?.close()
      const conn = new RTCPeerConnection({ iceServers: servers })
      pc = conn
      conn.ontrack = (e) => {
        const v = video.current
        if (v && e.streams[0]) {
          v.srcObject = e.streams[0]
          void v.play().catch(() => {
            // a browser that will not play sound unasked: start muted, the sound button turns it on
            v.muted = true
            setSound(false)
            void v.play().catch(() => undefined)
          })
        }
      }
      conn.ondatachannel = (e) => {
        const ch = e.channel
        ch.onmessage = (m: MessageEvent): void => {
          const msg = parse<LiveControl>(String(m.data))
          if (msg?.k === 'ptr') onPtr(msg)
          else if (msg?.k === 'granted') setControl('yes')
          else if (msg?.k === 'denied') setControl('no')
          else if (msg?.k === 'revoked') setControl('none')
        }
        if (ch.label === 'ctl') {
          ctl.current = ch
          ch.onopen = () => sendSizeRef.current()
        } else if (ch.label === 'mv') mv.current = ch
      }
      conn.onicecandidate = (e) =>
        e.candidate && send({ k: 'ice', c: e.candidate.toJSON() as never })
      conn.onconnectionstatechange = () => {
        if (pc !== conn) return
        window.clearTimeout(redial)
        // live once the line is through (a track announced over a line that never connects is a black picture)
        if (conn.connectionState === 'connected') setState('live')
        // the line dropped or never came through: call again, quietly
        else if (conn.connectionState === 'failed') {
          setState('connecting')
          redial = window.setTimeout(hello, 1500)
        } else if (conn.connectionState === 'disconnected') redial = window.setTimeout(hello, 4000)
      }
      return conn
    }
    /**
     * Ask the host to call. A hello the host was not listening for yet (it had only just started showing the tab) is
     * lost, and the host answers only a hello: say it again until their offer is here.
     */
    const hello = (): void => {
      if (dead) return
      const conn = fresh()
      send({ k: 'hello' })
      window.clearInterval(knock)
      knock = window.setInterval(() => {
        if (dead || pc !== conn || conn.remoteDescription) window.clearInterval(knock)
        else send({ k: 'hello' })
      }, 3000)
    }
    const off = r.onSignal(
      inOrder(async (from, data) => {
        if (from !== hostRtc || dead) return
        const sig = parse<LiveSignal>(data)
        if (!sig) return
        if (sig.k === 'sdp' && sig.sdp.type === 'offer') {
          const conn = pc && !pc.remoteDescription ? pc : fresh()
          await conn.setRemoteDescription(sig.sdp)
          await conn.setLocalDescription(await conn.createAnswer())
          send({ k: 'sdp', sdp: conn.localDescription!.toJSON() as never })
        } else if (sig.k === 'ice') await pc?.addIceCandidate(sig.c).catch(() => undefined)
        else if (sig.k === 'bye') setState('gone')
      })
    )
    // the relay's ICE servers (TURN when it has a key) before anything is gathered; hello once they are in
    void r
      .iceServers()
      .catch(() => null)
      .then((got) => {
        if (got) servers = got
        hello()
      })
    const sweep = window.setInterval(
      () =>
        setPtrs((cur) => {
          const now = Date.now()
          const keep = Object.entries(cur).filter(([who, p]) => who === '0' || now - p.t < 5000)
          return keep.length === Object.keys(cur).length ? cur : Object.fromEntries(keep)
        }),
      1000
    )
    return () => {
      dead = true
      off()
      window.clearInterval(sweep)
      window.clearInterval(knock)
      window.clearTimeout(redial)
      send({ k: 'bye' })
      pc?.close()
      ctl.current = null
      mv.current = null
    }
  }, [hostRtc])

  useEffect(() => {
    const el = stage.current
    if (!el) return
    let t = 0
    const measure = (): void => {
      const v = video.current
      if (!v || !v.videoWidth) return setGeo(null)
      const b = videoBox(
        { width: v.clientWidth, height: v.clientHeight },
        { width: v.videoWidth, height: v.videoHeight }
      )
      setGeo({ ...b, x: b.x + v.offsetLeft, y: b.y + v.offsetTop })
    }
    const ro = new ResizeObserver(() => {
      measure()
      window.clearTimeout(t)
      t = window.setTimeout(() => sendSizeRef.current(), 250)
    })
    ro.observe(el)
    // the picture's own size changes as the host shrinks or grows it for this panel
    const v = video.current
    v?.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      v?.removeEventListener('resize', measure)
      window.clearTimeout(t)
    }
  }, [])

  const say = (msg: LiveControl, fast = false): void => {
    const ch = fast && mv.current?.readyState === 'open' ? mv.current : ctl.current
    if (ch?.readyState === 'open') ch.send(JSON.stringify(msg))
  }
  const driving = control === 'yes'
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
  return (
    <div className="wb-watch" role="dialog" aria-label={`${host.name}'s tab, live`}>
      <header>
        <span className="wb-face" style={{ background: host.color }}>
          {host.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="wb-watch-what">
          <b>{host.name}&rsquo;s tab</b>
          <span>{host.live?.title || host.live?.url}</span>
        </div>
        <span className={'wb-badge ' + state}>
          <i aria-hidden="true" />
          {state === 'live' ? 'Live' : state === 'gone' ? 'Ended' : 'Connecting'}
        </span>
        {state === 'live' && (
          <button
            type="button"
            className={'wb-btn' + (sound ? '' : ' off')}
            aria-pressed={sound}
            onClick={() => {
              const next = !sound
              setSound(next)
              if (video.current) {
                video.current.muted = !next
                void video.current.play().catch(() => undefined)
              }
            }}
          >
            {sound ? 'Sound on' : 'Sound off'}
          </button>
        )}
        {driving ? (
          <button
            type="button"
            className="wb-btn on"
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
            className="wb-btn"
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
        <button type="button" className="wb-close" aria-label="Stop watching" onClick={onClose}>
          &times;
        </button>
      </header>
      <div
        ref={stage}
        className={'wb-stage' + (driving ? ' driving' : '')}
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
        <video ref={video} playsInline muted={!sound} />
        {geo &&
          Object.entries(ptrs).map(([who, p]) => {
            const person = who === '0' ? host : people.find((q) => q.rtc === Number(who))
            return (
              <div
                key={who}
                className="wb-ptr"
                style={
                  {
                    transform: `translate(${geo.x + p.x * geo.width}px, ${geo.y + p.y * geo.height}px)`,
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
        {state !== 'live' && (
          <p className="wb-wait">
            {state === 'gone' ? `${host.name} stopped showing it.` : 'Connecting to their tab…'}
          </p>
        )}
      </div>
    </div>
  )
}
