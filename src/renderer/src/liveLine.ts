import {
  inOrder,
  ICE_SERVERS,
  sizeFor,
  videoRect,
  type LiveControl,
  type LiveSignal
} from '@shared/share/live'
import { parse } from '@renderer/liveHost'

/**
 * One WebRTC line to a person showing a tab live, shared by everything here that shows it: the viewer (LiveShare.tsx)
 * and the tab's cards on the board. The host keeps one connection per watcher, so two of ours would cut each other
 * off. Made by the first to want it, closed when the last lets go; calls again by itself when the line drops.
 *
 * What it sends as its size: the viewer's room when the viewer is open (the host's tab takes that shape), else the
 * largest card's, marked `card` (the picture is sent that small; the tab keeps its shape).
 */
export interface LiveLine {
  stream: MediaStream | null
  state: 'connecting' | 'live'
  hasSound: boolean
  ctl: RTCDataChannel | null
  mv: RTCDataChannel | null
  /** Where the page's video is, as the host last said (checked): for a viewer opened after it was said. */
  video: [number, number, number, number] | null
  /** The viewer shows it (not only cards): a card under it need not draw the same picture again. */
  viewing: boolean
}

/** Something showing the line: told when it changes, and asked its size. */
export interface LiveUser {
  /** Changed: the stream, the state, sound. */
  changed: () => void
  /** A message from the host (pointers, control answers, the page's cursor). */
  message?: (msg: LiveControl) => void
  /** Its size in device pixels; `card` for a card (never shapes the host's tab). */
  size: () => { w: number; h: number; card?: boolean } | null
}

interface Shared {
  line: LiveLine
  users: Set<LiveUser>
  close: () => void
  sendSize: () => void
}

const lines = new Map<string, Shared>()

/** How long a line no one shows is kept, so a card scrolled off and back (or the viewer opened from it) reuses it. */
const LINGER_MS = 4000

/** Show the host's live tab: the line, and a release to call when done. */
export function takeLine(
  spaceId: number,
  hostRtc: number,
  user: LiveUser
): { line: LiveLine; release: () => void; sendSize: () => void } {
  const key = `${spaceId}:${hostRtc}`
  let s = lines.get(key)
  if (!s) {
    s = open(spaceId, hostRtc)
    lines.set(key, s)
  }
  const shared = s
  /** Whether a viewer (a user that is not a card) shows the line: everyone is told when that changes. */
  const viewers = (): void => {
    const viewing = [...shared.users].some((u) => !u.size()?.card)
    if (viewing === shared.line.viewing) return
    shared.line.viewing = viewing
    for (const u of shared.users) u.changed()
  }
  shared.users.add(user)
  viewers()
  clearTimeout(lingering.get(key))
  shared.sendSize()
  return {
    line: shared.line,
    sendSize: shared.sendSize,
    release: () => {
      shared.users.delete(user)
      viewers()
      shared.sendSize()
      if (shared.users.size > 0) return
      lingering.set(
        key,
        window.setTimeout(() => {
          if (shared.users.size > 0 || lines.get(key) !== shared) return
          lines.delete(key)
          shared.close()
        }, LINGER_MS)
      )
    }
  }
}
const lingering = new Map<string, number>()

function open(spaceId: number, hostRtc: number): Shared {
  const line: LiveLine = {
    stream: null,
    state: 'connecting',
    hasSound: false,
    ctl: null,
    mv: null,
    video: null,
    viewing: false
  }
  const users = new Set<LiveUser>()
  const tell = (): void => {
    for (const u of users) u.changed()
  }
  const hear = (msg: LiveControl): void => {
    if (msg.k === 'vid') line.video = videoRect(msg.r)
    for (const u of users) u.message?.(msg)
  }
  let lastSize = ''
  const sendSize = (): void => {
    const ch = line.ctl
    const s = sizeFor([...users].map((u) => u.size()))
    if (!s || ch?.readyState !== 'open') return
    const msg: LiveControl = s.card
      ? { k: 'size', w: Math.round(s.w), h: Math.round(s.h), card: true }
      : { k: 'size', w: Math.round(s.w), h: Math.round(s.h) }
    const text = JSON.stringify(msg)
    if (text === lastSize) return
    lastSize = text
    ch.send(text)
  }
  let dead = false
  let pc: RTCPeerConnection | null = null
  let off: (() => void) | null = null
  let redial = 0
  let knock = 0
  const send = (sig: LiveSignal): void =>
    window.api.share?.signal(spaceId, hostRtc, JSON.stringify(sig))

  const dial = (): void => {
    if (dead || !window.api.share) return
    hangUp(false)
    lastSize = ''
    const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pc = conn
    conn.ontrack = (e) => {
      if (e.track.kind === 'audio') line.hasSound = true
      if (e.streams[0]) line.stream = e.streams[0]
      tell()
    }
    conn.ondatachannel = (e) => {
      const ch = e.channel
      if (ch.label === 'ctl') {
        line.ctl = ch
        ch.onopen = () => sendSize()
        ch.onmessage = (m) => {
          const msg = parse<LiveControl>(String(m.data))
          if (msg) hear(msg)
        }
      } else if (ch.label === 'mv') {
        line.mv = ch
        ch.onmessage = (m) => {
          const msg = parse<LiveControl>(String(m.data))
          if (msg) hear(msg)
        }
      }
    }
    conn.onicecandidate = (e) => e.candidate && send({ k: 'ice', c: e.candidate.toJSON() as never })
    // the line dropped (sleep, a network change) while they still show it: call again, quietly
    conn.onconnectionstatechange = () => {
      if (pc !== conn) return
      window.clearTimeout(redial)
      // live once the line is through, not when the track is announced: a call that never connects (networks that
      // block a direct line) used to show "Live" over a black picture
      if (conn.connectionState === 'connected') {
        line.state = 'live'
        tell()
      } else if (conn.connectionState === 'failed') {
        line.state = 'connecting'
        tell()
        redial = window.setTimeout(dial, 800)
      } else if (conn.connectionState === 'disconnected') redial = window.setTimeout(dial, 4000)
    }
    off = window.api.share.onSignal(
      inOrder(async (sid, from, data) => {
        if (sid !== spaceId || from !== hostRtc || pc !== conn) return
        const sig = parse<LiveSignal>(data)
        if (!sig) return
        if (sig.k === 'sdp' && sig.sdp.type === 'offer') {
          await conn.setRemoteDescription(sig.sdp)
          await conn.setLocalDescription(await conn.createAnswer())
          send({ k: 'sdp', sdp: conn.localDescription!.toJSON() as never })
        } else if (sig.k === 'ice') await conn.addIceCandidate(sig.c).catch(() => undefined)
        // their picture restarted (or the host's Panes did): call again; if they really stopped, what shows it goes
        // with their live tab
        else if (sig.k === 'bye') {
          line.state = 'connecting'
          tell()
          window.clearTimeout(redial)
          redial = window.setTimeout(dial, 1200)
        }
      })
    )
    // the relay's ICE servers (TURN when it has a key) before anything is gathered; hello once they are in
    void window.api.share
      .ice(spaceId)
      .catch(() => null)
      .then((servers) => {
        if (dead || pc !== conn) return
        if (servers)
          try {
            conn.setConfiguration({ iceServers: servers })
          } catch {
            // the built-in STUN stays
          }
        send({ k: 'hello' })
        // a hello the host was not listening for yet (it had only just started showing the tab) is lost, and the host
        // answers only a hello: say it again until their offer is here
        window.clearInterval(knock)
        knock = window.setInterval(() => {
          if (dead || pc !== conn || conn.remoteDescription) window.clearInterval(knock)
          else send({ k: 'hello' })
        }, 3000)
      })
  }
  /** Ends this call; `bye` tells the host (not when calling again: the new hello replaces it). */
  const hangUp = (bye: boolean): void => {
    window.clearTimeout(redial)
    window.clearInterval(knock)
    off?.()
    off = null
    if (pc) {
      if (bye) send({ k: 'bye' })
      pc.close()
    }
    pc = null
    line.ctl = null
    line.mv = null
  }
  dial()
  return {
    line,
    users,
    sendSize,
    close: () => {
      dead = true
      hangUp(true)
      line.stream = null
    }
  }
}
