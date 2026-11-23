import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SharePerson } from '@shared/types'
import { ICE_SERVERS, type LiveControl, type LiveSignal } from '@shared/share/live'

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

type Peer = { pc: RTCPeerConnection; ctl: RTCDataChannel | null; mv: RTCDataChannel | null }

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
          maxFrameRate: 30
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
      ear.pause()
      ear.srcObject = null
      earRef.current = null
      if (stream) stream.getTracks().forEach((t) => t.stop())
    }
  }, [spaceId, tabId])
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
