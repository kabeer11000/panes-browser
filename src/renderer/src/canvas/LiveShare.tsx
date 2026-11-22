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

/**
 * A tab shown live in a shared space (tasks/shared-spaces.md, shared browsing), like Hyperbeam but with the host's own
 * tab as the browser: its picture goes to each watcher over WebRTC (peer to peer, signalled through the relay, sealed
 * there), and one watcher at a time may drive it when the host lets them.
 */

const parse = <T,>(data: string): T | null => {
  try {
    return JSON.parse(data) as T
  } catch {
    return null
  }
}

type Peer = { pc: RTCPeerConnection; ctl: RTCDataChannel | null; mv: RTCDataChannel | null }

/** The host's side: the tab's picture to everyone who asks, and their input once let in. */
function useLiveHost(
  spaceId: number,
  tabId: number | null,
  people: SharePerson[]
): {
  watching: number
  asking: SharePerson | null
  driver: SharePerson | null
  allow: () => void
  deny: () => void
  takeBack: () => void
} {
  const peers = useRef(new Map<number, Peer>())
  const [watching, setWatching] = useState(0)
  const [askingId, setAskingId] = useState<number | null>(null)
  const [driverId, setDriverId] = useState<number | null>(null)
  const driverRef = useRef<number | null>(null)

  useEffect(() => {
    if (tabId === null || !window.api.share) return
    let dead = false
    let stream: MediaStream | null = null
    let trying: Promise<MediaStream | null> | null = null
    /** Watchers who said hello while the tab could not be captured: offered to once it can (they say hello once). */
    const waiting = new Set<number>()
    let retry: number | undefined
    // The tab's picture, captured again when it is not live: a tab on a file: page refuses capture, and the first
    // refusal used to leave every watcher on "Connecting" for good.
    const capture = (): Promise<MediaStream | null> => {
      if (stream?.getVideoTracks().some((t) => t.readyState === 'live'))
        return Promise.resolve(stream)
      trying ??= grab()
        .catch(() => null)
        .finally(() => {
          trying = null
        })
      return trying
    }
    const grab = async (): Promise<MediaStream | null> => {
      const source = await window.api.canvas.streamSource?.(tabId)
      if (!source || dead) return null
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: source,
            maxWidth: 1920,
            maxHeight: 1080,
            maxFrameRate: 30
          }
        }
      } as unknown as MediaStreamConstraints)
      if (dead) {
        s.getTracks().forEach((t) => t.stop())
        return null
      }
      if (stream && stream !== s) stream.getTracks().forEach((t) => t.stop())
      stream = s
      return s
    }
    const send = (to: number, sig: LiveSignal): void =>
      window.api.share!.signal(spaceId, to, JSON.stringify(sig))
    const drop = (from: number): void => {
      waiting.delete(from)
      peers.current.get(from)?.pc.close()
      peers.current.delete(from)
      if (driverRef.current === from) {
        driverRef.current = null
        setDriverId(null)
      }
      setAskingId((a) => (a === from ? null : a))
      setWatching(peers.current.size)
    }
    const onCtl = (from: number, msg: LiveControl): void => {
      if (msg.k === 'ask') setAskingId(from)
      else if (msg.k === 'release' && driverRef.current === from) {
        driverRef.current = null
        setDriverId(null)
      } else if (msg.k === 'input' && driverRef.current === from)
        window.api.share!.input(spaceId, msg.e)
    }
    /** A call to one watcher, carrying the tab's picture and the two control channels. */
    const offer = async (from: number, s: MediaStream): Promise<void> => {
      drop(from)
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      const peer: Peer = { pc, ctl: null, mv: null }
      peers.current.set(from, peer)
      setWatching(peers.current.size)
      for (const track of s.getTracks()) {
        const sender = pc.addTrack(track, s)
        // smooth, not sharp: frames keep coming when the network is tight
        const p = sender.getParameters()
        p.degradationPreference = 'maintain-framerate'
        void sender.setParameters(p).catch(() => undefined)
      }
      peer.ctl = pc.createDataChannel('ctl', { ordered: true })
      peer.mv = pc.createDataChannel('mv', { ordered: false, maxRetransmits: 0 })
      for (const ch of [peer.ctl, peer.mv])
        ch.onmessage = (e) => {
          const msg = parse<LiveControl>(String(e.data))
          if (msg) onCtl(from, msg)
        }
      pc.onicecandidate = (e) =>
        e.candidate && send(from, { k: 'ice', c: e.candidate.toJSON() as never })
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') drop(from)
      }
      await pc.setLocalDescription(await pc.createOffer())
      send(from, { k: 'sdp', sdp: pc.localDescription!.toJSON() as never })
    }
    const offerWaiting = async (): Promise<void> => {
      const s = waiting.size ? await capture() : null
      if (dead || (waiting.size && !s)) return
      window.clearInterval(retry)
      retry = undefined
      if (!s) return
      for (const from of [...waiting]) void offer(from, s)
    }
    const off = window.api.share.onSignal(async (sid, from, data) => {
      if (sid !== spaceId) return
      const sig = parse<LiveSignal>(data)
      if (!sig) return
      if (sig.k === 'hello') {
        const s = await capture()
        if (dead) return
        if (!s) {
          waiting.add(from)
          retry ??= window.setInterval(() => void offerWaiting(), 2000)
          return
        }
        await offer(from, s)
      } else if (sig.k === 'sdp') {
        await peers.current
          .get(from)
          ?.pc.setRemoteDescription(sig.sdp)
          .catch(() => undefined)
      } else if (sig.k === 'ice') {
        await peers.current
          .get(from)
          ?.pc.addIceCandidate(sig.c)
          .catch(() => undefined)
      } else if (sig.k === 'bye') drop(from)
    })
    const all = peers.current
    return () => {
      dead = true
      off()
      window.clearInterval(retry)
      waiting.clear()
      for (const [to, p] of all) {
        send(to, { k: 'bye' })
        p.pc.close()
      }
      all.clear()
      setWatching(0)
      setAskingId(null)
      setDriverId(null)
      driverRef.current = null
      if (stream) stream.getTracks().forEach((t) => t.stop())
    }
  }, [spaceId, tabId])

  const say = (to: number, msg: LiveControl): void => {
    const ch = peers.current.get(to)?.ctl
    if (ch?.readyState === 'open') ch.send(JSON.stringify(msg))
  }
  const byRtc = (id: number | null): SharePerson | null =>
    id === null ? null : (people.find((p) => p.rtc === id) ?? null)
  return {
    watching,
    asking: byRtc(askingId),
    driver: byRtc(driverId),
    allow: () => {
      if (askingId === null) return
      if (driverRef.current !== null) say(driverRef.current, { k: 'revoked' })
      driverRef.current = askingId
      setDriverId(askingId)
      say(askingId, { k: 'granted' })
      setAskingId(null)
    },
    deny: () => {
      if (askingId !== null) say(askingId, { k: 'denied' })
      setAskingId(null)
    },
    takeBack: () => {
      if (driverRef.current !== null) say(driverRef.current, { k: 'revoked' })
      driverRef.current = null
      setDriverId(null)
    }
  }
}

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
  const hostRtc = host.rtc

  useEffect(() => {
    if (!window.api.share || !hostRtc) return
    const send = (sig: LiveSignal): void =>
      window.api.share!.signal(spaceId, hostRtc, JSON.stringify(sig))
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pc.ontrack = (e) => {
      const v = video.current
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
    send({ k: 'hello' })
    return () => {
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
        <button type="button" className="live-close" aria-label="Stop watching" onClick={onClose}>
          &times;
        </button>
      </div>
      <div
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
        <video ref={video} muted playsInline />
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
  const host = useLiveHost(spaceId, shared ? liveTab : null, people)
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
