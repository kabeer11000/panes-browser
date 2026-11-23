import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SharePerson } from '@shared/types'
import { downscaleFor, ICE_SERVERS, type LiveControl, type LiveSignal } from '@shared/share/live'

/**
 * The host's side of a tab shown live in a shared space (tasks/shared-spaces.md, shared browsing): the tab's picture
 * and sound to each watcher over WebRTC, and the driver's input once let in. It runs in the window for as long as the
 * tab is live, whether the board is open or not (it used to live in the board, and leaving the board cut everyone
 * off). The board's bar and the status chips read it from here (useHostViews; LiveHosts.tsx runs them).
 */

export const parse = <T>(data: string): T | null => {
  try {
    return JSON.parse(data) as T
  } catch {
    return null
  }
}

type Peer = {
  pc: RTCPeerConnection
  ctl: RTCDataChannel | null
  mv: RTCDataChannel | null
  /** Their picture's sender: shrunk to the size they show it at (`size`). */
  video: RTCRtpSender | null
  scale: number
}

/** The host's side: the tab's picture to everyone who asks, and their input once let in. */
export function useLiveHost(
  spaceId: number,
  tabId: number | null,
  people: SharePerson[],
  /** The shared tab is muted here: the host's own playback of its sound is quiet (see `ear`). */
  muted: boolean
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
  const earRef = useRef<HTMLAudioElement | null>(null)
  /** The tab takes the new driver's shape (set by the call effect, which knows the sizes). */
  const shapeRef = useRef<() => void>(() => undefined)
  const mutedRef = useRef(muted)

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
      const video = {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: source,
          maxWidth: 1920,
          maxHeight: 1080,
          // smooth when the page moves (a still page sends frames only as it changes)
          maxFrameRate: 60
        }
      }
      const audio = { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: source } }
      const ask = (withSound: boolean): Promise<MediaStream> =>
        navigator.mediaDevices.getUserMedia({
          audio: withSound ? audio : false,
          video
        } as unknown as MediaStreamConstraints)
      // the tab's sound too (watch-together); a picture alone if sound cannot be had
      const s = await ask(true).catch(() => ask(false))
      if (dead) {
        s.getTracks().forEach((t) => t.stop())
        return null
      }
      if (stream && stream !== s) stream.getTracks().forEach((t) => t.stop())
      stream = s
      hear(s)
      return s
    }
    // Capturing a tab's sound takes it off the host's speakers (measured: the output fell to silence), so the host
    // hears it again from the captured track, once: no echo, no doubling. Quiet while the tab is muted.
    const ear = new Audio()
    earRef.current = ear
    ear.muted = mutedRef.current
    const hear = (s: MediaStream): void => {
      const tracks = s.getAudioTracks()
      ear.srcObject = tracks.length ? new MediaStream(tracks) : null
      if (tracks.length) void ear.play().catch(() => undefined)
    }
    // the relay's ICE servers (STUN, and TURN when it has a key), asked once for this live tab
    const ice = (window.api.share.ice?.(spaceId) ?? Promise.resolve(null))
      .catch(() => null)
      .then((s) => s ?? ICE_SERVERS)
    const send = (to: number, sig: LiveSignal): void =>
      window.api.share!.signal(spaceId, to, JSON.stringify(sig))
    /**
     * A watcher's call ends. `keep`: they only closed the picture or are calling again, so leave to drive stays
     * theirs (it goes when the host takes it back, or they leave the space): reopening it used to lose control.
     */
    const drop = (from: number, keep = false): void => {
      waiting.delete(from)
      peers.current.get(from)?.pc.close()
      peers.current.delete(from)
      if (!keep && driverRef.current === from) {
        driverRef.current = null
        setDriverId(null)
      }
      setAskingId((a) => (a === from ? null : a))
      setWatching(peers.current.size)
    }
    /** A watcher's picture no bigger than they show it (a small panel need not get a full 1080p stream). */
    const fit = (from: number, w: unknown, h: unknown): void => {
      const peer = peers.current.get(from)
      const track = peer?.video?.track
      if (!peer?.video || !track || typeof w !== 'number' || typeof h !== 'number') return
      const st = track.getSettings()
      const scale = downscaleFor({ w: st.width ?? 0, h: st.height ?? 0 }, { w, h })
      if (scale === peer.scale) return
      peer.scale = scale
      const p = peer.video.getParameters()
      if (!p.encodings?.length) return
      p.encodings[0].scaleResolutionDownBy = scale
      void peer.video.setParameters(p).catch(() => undefined)
    }
    /** Each watcher's picture size; the driver's shape (else the last told) is the one the tab takes out of sight. */
    const sizes = new Map<number, { w: number; h: number }>()
    const shape = (from: number): void => {
      const s = sizes.get(driverRef.current ?? from)
      if (s && s.w > 0 && s.h > 0) window.api.share?.liveAspect?.(spaceId, s.w / s.h)
    }
    shapeRef.current = (): void => {
      if (driverRef.current !== null) shape(driverRef.current)
    }
    const onCtl = (from: number, msg: LiveControl): void => {
      if (msg.k === 'size') {
        if (typeof msg.w === 'number' && typeof msg.h === 'number')
          sizes.set(from, { w: msg.w, h: msg.h })
        fit(from, msg.w, msg.h)
        shape(from)
      }
      else if (msg.k === 'ask') setAskingId(from)
      else if (msg.k === 'release' && driverRef.current === from) {
        driverRef.current = null
        setDriverId(null)
      } else if (msg.k === 'input' && driverRef.current === from) {
        window.api.share!.input(spaceId, msg.e)
        // the driver's pointer to everyone else watching (the driver sees their own)
        const e = msg.e
        if (e.t === 'move' || e.t === 'down') pointTo({ k: 'ptr', who: from, x: e.x, y: e.y }, from)
      }
    }
    /** A pointer to every watcher but one, on the fast channel (a late one is dropped, not queued). */
    const pointTo = (msg: LiveControl, except?: number): void => {
      const data = JSON.stringify(msg)
      for (const [to, p] of peers.current)
        if (to !== except && p.mv?.readyState === 'open') p.mv.send(data)
    }
    // the host's own pointer over the page, about 30 times a second while anyone watches (tab capture draws none)
    let lastPtr = ''
    let lastCur = ''
    const pointer = window.setInterval(() => {
      // the page's cursor to the driver as it changes (a hand on a link, a bar on text)
      const driver = driverRef.current
      if (driver !== null && window.api.share?.pageCursor)
        void window.api.share.pageCursor(spaceId).then((c) => {
          if (dead || !c || c === lastCur) return
          const ch = peers.current.get(driver)?.ctl
          if (ch?.readyState !== 'open') return
          lastCur = c
          ch.send(JSON.stringify({ k: 'cur', c }))
        })
      if (peers.current.size === 0 || !window.api.share?.pointer) return
      void window.api.share.pointer(spaceId).then((at) => {
        const key = at ? `${at.x.toFixed(4)},${at.y.toFixed(4)}` : ''
        if (dead || key === lastPtr) return
        lastPtr = key
        pointTo({ k: 'ptr', who: 0, x: at ? at.x : null, y: at ? at.y : 0 })
      })
    }, 33)
    /** A call to one watcher, carrying the tab's picture and the two control channels. */
    const offer = async (from: number, s: MediaStream): Promise<void> => {
      drop(from, true)
      const pc = new RTCPeerConnection({ iceServers: await ice })
      const peer: Peer = { pc, ctl: null, mv: null, video: null, scale: 1 }
      peers.current.set(from, peer)
      setWatching(peers.current.size)
      for (const track of s.getTracks()) {
        const sender = pc.addTrack(track, s)
        if (track.kind === 'video') peer.video = sender
        // smooth, not sharp: frames keep coming when the network is tight. WebRTC's congestion control adapts the
        // rate under these ceilings (and `fit` the size): plenty on a good line, less as it tightens.
        const p = sender.getParameters()
        p.degradationPreference = 'maintain-framerate'
        if (track.kind === 'video' && p.encodings?.[0]) {
          p.encodings[0].maxBitrate = 8_000_000
          p.encodings[0].maxFramerate = 60
          p.encodings[0].priority = 'high'
          p.encodings[0].networkPriority = 'high'
        }
        void sender.setParameters(p).catch(() => undefined)
      }
      peer.ctl = pc.createDataChannel('ctl', { ordered: true })
      // the driver calling again (they closed the picture and opened it): still theirs to drive
      peer.ctl.onopen = () => {
        if (driverRef.current !== from) return
        peer.ctl?.send(JSON.stringify({ k: 'granted' }))
        lastCur = '' // and the cursor again
      }
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
      } else if (sig.k === 'bye') drop(from, true)
    })
    const all = peers.current
    return () => {
      dead = true
      off()
      window.clearInterval(retry)
      window.clearInterval(pointer)
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
      ear.pause()
      ear.srcObject = null
      earRef.current = null
      if (stream) stream.getTracks().forEach((t) => t.stop())
    }
  }, [spaceId, tabId])
  // the driver left the space (not just their picture): leave to drive ends
  const driverHere = driverId === null || people.some((p) => p.rtc === driverId)
  useEffect(() => {
    if (driverHere) return
    driverRef.current = null
    setDriverId(null)
  }, [driverHere])
  useEffect(() => {
    mutedRef.current = muted
    if (earRef.current) earRef.current.muted = muted
  }, [muted])

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
      shapeRef.current()
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

/** What a live tab's host shows and can do, for the board's bar and the status chips. */
export interface HostView {
  spaceId: number
  tabId: number
  watching: number
  asking: SharePerson | null
  driver: SharePerson | null
  allow: () => void
  deny: () => void
  takeBack: () => void
  stop: () => void
}

let views: HostView[] = []
const listeners = new Set<() => void>()
/** The host views now (LiveHosts.tsx keeps them). */
export const hostViewsNow = (): HostView[] => views
export const publish = (next: HostView[]): void => {
  views = next
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
/** Every live tab this person hosts now. */
export function useHostViews(): HostView[] {
  return useSyncExternalStore(subscribe, () => views)
}
/** This space's live tab, if this person hosts one there. */
export function useHostView(spaceId: number): HostView | null {
  return useHostViews().find((v) => v.spaceId === spaceId) ?? null
}
