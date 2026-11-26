import { useSyncExternalStore } from 'react'
import { formatBytes } from '@shared/downloads'
import { ICE_SERVERS, inOrder } from '@shared/share/live'
import { ASK_MS, CHUNK, parseFileSignal, type FileSignal } from '@shared/share/transfer'
import { parse } from '@renderer/liveHost'

/**
 * Files sent straight between people in a shared space (shared/share/transfer.ts): one WebRTC data channel per file,
 * the signals through the room's relay; the relay never sees a byte of the file. Two ways:
 *
 * - to one person (`sendFile`): they are asked on a card, and it goes once they say yes;
 * - in the chat (`postFile`): a message offers it, and anyone who clicks Download fetches it from here (`fetchFile`)
 *   while this Panes is open. Nothing is kept anywhere but on the two computers.
 *
 * Runs in the window for as long as it is open (`startFileTransfers`, from App).
 */

/** A file going from here to someone, as the board shows it. */
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

/** A file from the chat on its way here, by the file's id. */
export interface Fetching {
  /** The transfer's id (to cancel it). */
  id: string
  got: number
  size: number
  state: 'getting' | 'saved' | 'failed' | 'gone' | 'cancelled'
}

let sending: Sending[] = []
let fetching: Record<string, Fetching> = {}
const listeners = new Set<() => void>()
const tell = (): void => {
  for (const l of listeners) l()
}
const update = (id: string, patch: Partial<Sending>): void => {
  sending = sending.map((x) => (x.id === id ? { ...x, ...patch } : x))
  tell()
}
const updateFetch = (file: string, patch: Partial<Fetching>): void => {
  const was = fetching[file]
  if (!was) return
  fetching = { ...fetching, [file]: { ...was, ...patch } }
  tell()
}
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useSending(spaceId: number): Sending[] {
  const all = useSyncExternalStore(subscribe, () => sending)
  return all.filter((s) => s.spaceId === spaceId)
}

/** Files from the chat being fetched here, or fetched, by the file's id. */
export function useFetching(): Record<string, Fetching> {
  return useSyncExternalStore(subscribe, () => fetching)
}

/** Files offered in the chat from here (by the file's id): only those this Panes still holds can be fetched. */
const posted = new Map<string, { spaceId: number; file: File }>()
export const holds = (fileId: string): boolean => posted.has(fileId)

/** Stop a file on its way (either way), or put away a finished one's line. */
export function dismissSend(id: string): void {
  const s = sending.find((x) => x.id === id)
  if (s && (s.state === 'asking' || s.state === 'sending')) stops.get(id)?.()
  else {
    sending = sending.filter((x) => x.id !== id)
    tell()
  }
}
export function cancelFetch(file: string): void {
  const f = fetching[file]
  if (f?.state === 'getting') stops.get(f.id)?.()
}

const signal = (spaceId: number, to: number, sig: FileSignal): void =>
  window.api.share?.signal(spaceId, to, JSON.stringify(sig))

/**
 * What each transfer waits for from the other side, by id (sender's and receiver's alike): its handler, and who the
 * other side is (`space:relay address`), since a signal for that transfer from anyone else is not theirs to give.
 */
const handlers = new Map<string, { who: string; fn: (sig: FileSignal) => void | Promise<void> }>()
const stops = new Map<string, () => void>()

/**
 * A line for a file: direct only. STUN finds the way through each side's router; TURN (the relay's paid fallback,
 * which carries every byte itself) is left out, so a file never costs relay traffic. Two computers that cannot reach
 * each other directly get "could not connect" instead.
 */
const connection = async (): Promise<RTCPeerConnection> =>
  new RTCPeerConnection({ iceServers: ICE_SERVERS })

/** The biggest piece the line takes (Chromium to Chromium: 256 KB), the safe size when it does not say. */
const pieceSize = (pc: RTCPeerConnection): number =>
  Math.max(CHUNK, Math.min(256 * 1024, pc.sctp?.maxMessageSize || CHUNK))

/**
 * Send `file` as transfer `id` to `to`, who is waiting for it: the offer, the line, the pieces. The entry `id` in
 * `sending` follows it; `end` is how it stops.
 */
async function serve(
  spaceId: number,
  to: number,
  id: string,
  file: File,
  end: (state: Sending['state'], say?: 'cancel') => void,
  over: () => boolean
): Promise<RTCPeerConnection | null> {
  update(id, { state: 'sending' })
  const conn = await connection()
  if (over()) {
    conn.close()
    return null
  }
  conn.onicecandidate = (e) =>
    e.candidate && signal(spaceId, to, { k: 'f', id, o: 'ice', c: e.candidate.toJSON() as never })
  conn.onconnectionstatechange = () => {
    if (conn.connectionState === 'failed') end('failed', 'cancel')
  }
  const ch = conn.createDataChannel('file', { ordered: true })
  ch.binaryType = 'arraybuffer'
  ch.bufferedAmountLowThreshold = 4 << 20
  // the other side says "done" once everything is written down
  ch.onmessage = (m) => m.data === 'done' && end('sent')
  ch.onclose = () => end('failed')
  ch.onopen = async () => {
    const step = pieceSize(conn)
    let shown = 0
    for (let at = 0; at < file.size && !over();) {
      // keep some MB in flight: no more piles up in memory, no less leaves the line idle
      if (ch.bufferedAmount > 16 << 20)
        await new Promise((r) => ch.addEventListener('bufferedamountlow', r, { once: true }))
      if (over() || ch.readyState !== 'open') return
      const piece = await file.slice(at, at + step).arrayBuffer()
      ch.send(piece)
      at += piece.byteLength
      if (Date.now() - shown > 200 || at === file.size) {
        shown = Date.now()
        update(id, { sent: at })
      }
    }
  }
  await conn.setLocalDescription(await conn.createOffer())
  signal(spaceId, to, { k: 'f', id, o: 'sdp', sdp: conn.localDescription!.toJSON() as never })
  return conn
}

/** A transfer from here, listed: `serve` once `go` is called (they said yes, or asked for it). */
function outgoing(
  spaceId: number,
  to: number,
  toName: string,
  file: File,
  id: string,
  state: Sending['state']
): { go: () => void; end: (state: Sending['state'], say?: 'cancel') => void } {
  sending = [
    ...sending,
    { id, spaceId, to, toName, name: file.name, size: file.size, sent: 0, state }
  ]
  tell()
  let pc: RTCPeerConnection | null = null
  let over = false
  let started = false
  const end = (state: Sending['state'], say?: 'cancel'): void => {
    if (over) return
    over = true
    handlers.delete(id)
    stops.delete(id)
    if (say) signal(spaceId, to, { k: 'f', id, o: say })
    pc?.close()
    update(id, { state })
  }
  stops.set(id, () => end('cancelled', 'cancel'))
  const go = (): void => {
    if (started || over) return
    started = true
    void serve(spaceId, to, id, file, end, () => over).then((c) => (pc = c))
  }
  handlers.set(id, {
    who: `${spaceId}:${to}`,
    fn: async (sig) => {
      if (sig.o === 'no') return end('declined')
      if (sig.o === 'cancel') return end('failed')
      if (sig.o === 'yes') return go()
      if (sig.o === 'sdp' && sig.sdp.type === 'answer') await pc?.setRemoteDescription(sig.sdp)
      else if (sig.o === 'ice') await pc?.addIceCandidate(sig.c).catch(() => undefined)
    }
  })
  return { go, end }
}

/** Offer `file` to the person at relay address `to`, and send it once they take it. */
export function sendFile(spaceId: number, to: number, toName: string, file: File): void {
  const id = crypto.randomUUID()
  const { end } = outgoing(spaceId, to, toName, file, id, 'asking')
  const timer = window.setTimeout(() => end('failed', 'cancel'), ASK_MS)
  const was = handlers.get(id)!
  handlers.set(id, {
    who: was.who,
    fn: (sig) => {
      if (sig.o === 'yes' || sig.o === 'no' || sig.o === 'cancel') window.clearTimeout(timer)
      return was.fn(sig)
    }
  })
  signal(spaceId, to, { k: 'f', id, o: 'ask', name: file.name, size: file.size })
}

/** Offer `file` to everyone in the space's chat: fetched from here by whoever wants it, while Panes is open. */
export function postFile(spaceId: number, file: File): void {
  const id = crypto.randomUUID()
  posted.set(id, { spaceId, file })
  window.api.share?.say(spaceId, `Shared a file: ${file.name} (${formatBytes(file.size)})`, {
    id,
    name: file.name,
    size: file.size
  })
}

/** Someone asks for a file offered in the chat from here: theirs if this Panes still holds it. */
async function asked(
  spaceId: number,
  from: number,
  sig: Extract<FileSignal, { o: 'get' }>
): Promise<void> {
  const held = posted.get(sig.file)
  if (!held || held.spaceId !== spaceId)
    return signal(spaceId, from, { k: 'f', id: sig.id, o: 'no' })
  const state = await window.api.share?.state(spaceId)
  const toName = state?.people.find((p) => p.rtc === from)?.name ?? 'Someone'
  outgoing(spaceId, from, toName, held.file, sig.id, 'sending').go()
}

/**
 * Take transfer `id` of `size` bytes from `from` into downloads entry `t` (main writes it): the line once their offer
 * comes, the pieces as they come. `progress` and `done` tell whoever shows it.
 */
function receive(
  spaceId: number,
  from: number,
  id: string,
  size: number,
  t: number,
  progress: (got: number) => void,
  done: (ok: boolean) => void
): void {
  const share = window.api.share!
  let pc: RTCPeerConnection | null = null
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
    share.recvAbort(t)
    pc?.close()
    done(false)
  }
  const offCancel = share.onRecvCancel((n) => n === t && end('cancel'))
  stops.set(id, () => end('cancel'))
  const ready = connection().then((conn) => {
    if (over) {
      conn.close()
      return null
    }
    pc = conn
    conn.onicecandidate = (e) =>
      e.candidate &&
      signal(spaceId, from, { k: 'f', id, o: 'ice', c: e.candidate.toJSON() as never })
    conn.onconnectionstatechange = () => {
      if (conn.connectionState === 'failed') end('cancel')
    }
    let got = 0
    let shown = 0
    conn.ondatachannel = (e) => {
      const ch = e.channel
      ch.binaryType = 'arraybuffer'
      const complete = (): void => {
        finish()
        void share.recvEnd(t).then((ok) => {
          if (ok && ch.readyState === 'open') ch.send('done')
          else signal(spaceId, from, { k: 'f', id, o: 'cancel' })
          done(ok)
          // the "done" goes out before the line closes
          window.setTimeout(() => conn.close(), 1000)
        })
      }
      ch.onopen = () => size === 0 && !over && complete()
      ch.onmessage = (m) => {
        if (over || !(m.data instanceof ArrayBuffer)) return
        got += m.data.byteLength
        share.recvChunk(t, new Uint8Array(m.data))
        if (got >= size) return complete()
        if (Date.now() - shown > 200) {
          shown = Date.now()
          progress(got)
        }
      }
      ch.onclose = () => end()
    }
    return conn
  })
  handlers.set(id, {
    who: `${spaceId}:${from}`,
    fn: async (sig) => {
      if (sig.o === 'cancel' || sig.o === 'no') return end()
      const conn = await ready
      if (!conn) return
      if (sig.o === 'sdp' && sig.sdp.type === 'offer') {
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
}

/** Someone offers a file to this person alone: main asks on a card; taken, it comes here. */
async function offered(
  spaceId: number,
  from: number,
  ask: Extract<FileSignal, { o: 'ask' }>
): Promise<void> {
  const share = window.api.share
  if (!share) return
  const { id, size } = ask
  let gone = false
  // while the card is up, only a cancel can come (the rest follows a yes): it takes the question back
  handlers.set(id, {
    who: `${spaceId}:${from}`,
    fn: (sig) => {
      if (sig.o !== 'cancel') return
      gone = true
      handlers.delete(id)
      share.recvUnask(id)
    }
  })
  const t = await share.recvAsk(id, spaceId, from, ask.name, size)
  if (gone) {
    if (t !== null) share.recvAbort(t)
    return
  }
  handlers.delete(id)
  if (t === null) return signal(spaceId, from, { k: 'f', id, o: 'no' })
  receive(
    spaceId,
    from,
    id,
    size,
    t,
    () => undefined,
    () => undefined
  )
  signal(spaceId, from, { k: 'f', id, o: 'yes' })
}

/**
 * Download a file offered in the chat, from `from` (the relay address of whoever offered it) straight into
 * downloads. Clicking Download is the yes: no card.
 */
export async function fetchFile(
  spaceId: number,
  from: number,
  file: { id: string; name: string; size: number }
): Promise<void> {
  const share = window.api.share
  if (!share || fetching[file.id]?.state === 'getting') return
  const id = crypto.randomUUID()
  fetching = { ...fetching, [file.id]: { id, got: 0, size: file.size, state: 'getting' } }
  tell()
  const t = await share.recvTake(id, spaceId, from, file.name, file.size)
  if (t === null) return updateFetch(file.id, { state: 'failed' })
  let said = false
  receive(
    spaceId,
    from,
    id,
    file.size,
    t,
    (got) => updateFetch(file.id, { got }),
    (ok) => {
      if (fetching[file.id]?.id !== id) return
      const was = fetching[file.id]!.state
      updateFetch(file.id, {
        got: ok ? file.size : fetching[file.id]!.got,
        state: ok ? 'saved' : was === 'gone' ? 'gone' : said ? 'failed' : 'cancelled'
      })
    }
  )
  // their "no": this Panes does not hold it any more (restarted, or it was another session's)
  const h = handlers.get(id)!
  handlers.set(id, {
    who: h.who,
    fn: (sig) => {
      if (sig.o === 'no') updateFetch(file.id, { state: 'gone' })
      else said = true
      return h.fn(sig)
    }
  })
  signal(spaceId, from, { k: 'f', id, o: 'get', file: file.id })
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
      } else if (sig.o === 'get') {
        if (!h) void asked(spaceId, from, sig)
      } else if (h?.who === `${spaceId}:${from}`) await h.fn(sig)
    })
  )
}
