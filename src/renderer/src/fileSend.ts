import { useSyncExternalStore } from 'react'
import { ICE_SERVERS, inOrder } from '@shared/share/live'
import { ASK_MS, CHUNK, parseFileSignal, type FileSignal } from '@shared/share/transfer'
import { parse } from '@renderer/liveHost'

/**
 * Files sent straight to someone in a shared space, and taken from them (shared/share/transfer.ts): one WebRTC data
 * channel per file, the signals through the room's relay. Runs in the window for as long as it is open
 * (`startFileTransfers`, from App), so closing the share popover does not stop a file on its way.
 */

/** A file this person is sending, as the share section shows it. */
export interface Sending {
  id: string
  spaceId: number
  to: number
  toName: string
  name: string
  size: number
  sent: number
  state: 'asking' | 'sending' | 'sent' | 'declined' | 'failed' | 'cancelled'
}

let sending: Sending[] = []
const listeners = new Set<() => void>()
const tell = (): void => {
  sending = [...sending]
  for (const l of listeners) l()
}
const update = (id: string, patch: Partial<Sending>): void => {
  const s = sending.find((x) => x.id === id)
  if (s) Object.assign(s, patch)
  tell()
}

export function useSending(spaceId: number): Sending[] {
  const all = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => sending
  )
  return all.filter((s) => s.spaceId === spaceId)
}

/** Stop a file on its way, or put away a finished one's line. */
export function dismissSend(id: string): void {
  const s = sending.find((x) => x.id === id)
  if (s && (s.state === 'asking' || s.state === 'sending')) stops.get(id)?.()
  else {
    sending = sending.filter((x) => x.id !== id)
    tell()
  }
}

const signal = (spaceId: number, to: number, sig: FileSignal): void =>
  window.api.share?.signal(spaceId, to, JSON.stringify(sig))

/**
 * What each file waits for from the other side, by id (sender's and receiver's alike): its handler, and who the other
 * side is (`space:relay address`), since a signal for that file from anyone else is not theirs to give.
 */
const handlers = new Map<string, { who: string; fn: (sig: FileSignal) => void | Promise<void> }>()
const stops = new Map<string, () => void>()

async function connection(spaceId: number): Promise<RTCPeerConnection> {
  const servers = await window.api.share?.ice(spaceId).catch(() => null)
  return new RTCPeerConnection({ iceServers: servers ?? ICE_SERVERS })
}

/** Offer `file` to the person at relay address `to`, and send it once they take it. */
export function sendFile(spaceId: number, to: number, toName: string, file: File): void {
  const id = crypto.randomUUID()
  sending.push({
    id,
    spaceId,
    to,
    toName,
    name: file.name,
    size: file.size,
    sent: 0,
    state: 'asking'
  })
  tell()
  let pc: RTCPeerConnection | null = null
  let over = false
  const end = (state: Sending['state'], say?: 'cancel'): void => {
    if (over) return
    over = true
    window.clearTimeout(timer)
    handlers.delete(id)
    stops.delete(id)
    if (say) signal(spaceId, to, { k: 'f', id, o: say })
    pc?.close()
    update(id, { state })
  }
  const timer = window.setTimeout(() => end('failed', 'cancel'), ASK_MS)
  stops.set(id, () => end('cancelled', 'cancel'))
  handlers.set(id, {
    who: `${spaceId}:${to}`,
    fn: async (sig) => {
      if (sig.o === 'no') return end('declined')
      if (sig.o === 'cancel') return end('failed')
      if (sig.o === 'sdp' && sig.sdp.type === 'answer') await pc?.setRemoteDescription(sig.sdp)
      else if (sig.o === 'ice') await pc?.addIceCandidate(sig.c).catch(() => undefined)
      else if (sig.o === 'yes' && !pc) {
        window.clearTimeout(timer)
        update(id, { state: 'sending' })
        const conn = await connection(spaceId)
        if (over) return conn.close()
        pc = conn
        conn.onicecandidate = (e) =>
          e.candidate &&
          signal(spaceId, to, { k: 'f', id, o: 'ice', c: e.candidate.toJSON() as never })
        conn.onconnectionstatechange = () => {
          if (conn.connectionState === 'failed') end('failed', 'cancel')
        }
        const ch = conn.createDataChannel('file', { ordered: true })
        ch.binaryType = 'arraybuffer'
        ch.bufferedAmountLowThreshold = 1 << 20
        // the other side says "done" once everything is written down
        ch.onmessage = (m) => m.data === 'done' && end('sent')
        ch.onclose = () => end('failed')
        ch.onopen = () => void pump(ch)
        await conn.setLocalDescription(await conn.createOffer())
        signal(spaceId, to, { k: 'f', id, o: 'sdp', sdp: conn.localDescription!.toJSON() as never })
      }
    }
  })
  const pump = async (ch: RTCDataChannel): Promise<void> => {
    let shown = 0
    for (let at = 0; at < file.size && !over;) {
      // keep a few MB in flight: no more piles up in memory, no less leaves the line idle
      if (ch.bufferedAmount > 8 << 20)
        await new Promise((r) => ch.addEventListener('bufferedamountlow', r, { once: true }))
      if (over || ch.readyState !== 'open') return
      const piece = await file.slice(at, at + CHUNK).arrayBuffer()
      ch.send(piece)
      at += piece.byteLength
      if (Date.now() - shown > 200 || at === file.size) {
        shown = Date.now()
        update(id, { sent: at })
      }
    }
  }
  signal(spaceId, to, { k: 'f', id, o: 'ask', name: file.name, size: file.size })
}

/** Someone offers a file: main asks on a card; taken, its pieces go to main as they come. */
async function offered(
  spaceId: number,
  from: number,
  ask: Extract<FileSignal, { o: 'ask' }>
): Promise<void> {
  const share = window.api.share
  if (!share) return
  const { id, size } = ask
  const who = `${spaceId}:${from}`
  let pc: RTCPeerConnection | null = null
  let t: number | null = null
  let over = false
  const finish = (): void => {
    over = true
    handlers.delete(id)
    stops.delete(id)
    offCancel()
  }
  const end = (say?: 'cancel'): void => {
    if (over) return
    finish()
    if (say) signal(spaceId, from, { k: 'f', id, o: say })
    if (t !== null) share.recvAbort(t)
    else share.recvUnask(id)
    pc?.close()
  }
  const offCancel = share.onRecvCancel((n) => n === t && end('cancel'))
  // while the card is up, only a cancel can come (the rest follows a yes): it takes the question back
  handlers.set(id, { who, fn: (sig) => (sig.o === 'cancel' ? end() : undefined) })
  t = await share.recvAsk(id, spaceId, from, ask.name, size)
  if (over) {
    if (t !== null) share.recvAbort(t)
    return
  }
  if (t === null) {
    finish()
    return signal(spaceId, from, { k: 'f', id, o: 'no' })
  }
  const taken = t
  const conn = await connection(spaceId)
  if (over) return conn.close()
  pc = conn
  conn.onicecandidate = (e) =>
    e.candidate && signal(spaceId, from, { k: 'f', id, o: 'ice', c: e.candidate.toJSON() as never })
  conn.onconnectionstatechange = () => {
    if (conn.connectionState === 'failed') end('cancel')
  }
  let got = 0
  conn.ondatachannel = (e) => {
    const ch = e.channel
    ch.binaryType = 'arraybuffer'
    const complete = (): void => {
      finish()
      void share.recvEnd(taken).then((ok) => {
        if (ok && ch.readyState === 'open') ch.send('done')
        else signal(spaceId, from, { k: 'f', id, o: 'cancel' })
        // the "done" goes out before the line closes
        window.setTimeout(() => conn.close(), 1000)
      })
    }
    ch.onopen = () => size === 0 && !over && complete()
    ch.onmessage = (m) => {
      if (over || !(m.data instanceof ArrayBuffer)) return
      got += m.data.byteLength
      share.recvChunk(taken, new Uint8Array(m.data))
      if (got >= size) complete()
    }
    ch.onclose = () => end()
  }
  handlers.set(id, {
    who,
    fn: async (sig) => {
      if (sig.o === 'cancel') end()
      else if (sig.o === 'sdp' && sig.sdp.type === 'offer') {
        await conn.setRemoteDescription(sig.sdp)
        await conn.setLocalDescription(await conn.createAnswer())
        signal(spaceId, from, {
          k: 'f',
          id,
          o: 'sdp',
          sdp: conn.localDescription!.toJSON() as never
        })
      } else if (sig.o === 'ice') await conn.addIceCandidate(sig.c).catch(() => undefined)
    }
  })
  stops.set(id, () => end('cancel'))
  signal(spaceId, from, { k: 'f', id, o: 'yes' })
}

/** Listen for file signals in every shared space; the returned function stops. */
export function startFileTransfers(): () => void {
  const share = window.api.share
  if (!share) return () => undefined
  return share.onSignal(
    inOrder(async (spaceId, from, data) => {
      const sig = parseFileSignal(parse(data))
      if (!sig) return
      const h = handlers.get(sig.id)
      if (sig.o === 'ask') {
        if (!h) void offered(spaceId, from, sig)
      } else if (h?.who === `${spaceId}:${from}`) await h.fn(sig)
    })
  )
}
