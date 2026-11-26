import { ipcMain, type BrowserWindow } from 'electron'
import { createWriteStream, rmSync, writeFileSync, type WriteStream } from 'fs'
import type { PermissionPromptState, SharePerson } from '@shared/types'
import { formatBytes, runsCode } from '@shared/downloads'
import { MAX_SEND, safeFileName } from '@shared/share/transfer'
import type { DownloadManager } from './downloads'

/**
 * Files sent straight here by someone in a shared space (shared/share/transfer.ts): the window's side takes the
 * pieces off the line, this asks first and writes them into the downloads folder, listed like a download.
 */
export interface ReceivedDeps {
  win: BrowserWindow
  downloads: DownloadManager
  confirm: (c: NonNullable<PermissionPromptState['confirm']>) => {
    answer: Promise<number | null>
    cancel: () => void
  }
  /** Who is at that relay address in that space now; null for no one (they left, or it was never them). */
  personOf: (spaceId: number, rtc: number) => SharePerson | null
}

interface Incoming {
  out: WriteStream
  path: string
  size: number
  got: number
  row: ReturnType<DownloadManager['incoming']>
}

/** At most this many questions at once: someone offering over and over cannot bury the window in cards. */
const MAX_ASKING = 3

export function registerReceived(d: ReceivedDeps): void {
  const mine = (e: { sender: unknown }): boolean => e.sender === d.win.webContents
  const asking = new Map<string, () => void>()
  const files = new Map<number, Incoming>()
  let next = 1

  const drop = (t: number, tellWindow: boolean): void => {
    const f = files.get(t)
    if (!f) return
    files.delete(t)
    f.out.destroy()
    f.out.once('close', () => rmSync(f.path, { force: true }))
    f.row.end(false)
    if (tellWindow && !d.win.isDestroyed()) d.win.webContents.send('share:recv-cancel', t)
  }

  /** Someone offers a file: ask, and when it is taken, where it goes. The transfer's number, or null for no. */
  ipcMain.handle(
    'share:recv-ask',
    async (e, key: unknown, spaceId: unknown, from: unknown, name: unknown, size: unknown) => {
      if (!mine(e) || typeof key !== 'string' || key.length > 64 || asking.has(key)) return null
      if (typeof spaceId !== 'number' || typeof from !== 'number' || typeof name !== 'string')
        return null
      if (!Number.isSafeInteger(size) || (size as number) < 0 || (size as number) > MAX_SEND)
        return null
      if (asking.size >= MAX_ASKING) return null
      // the name is the room's, not what the offer says
      const who = d.personOf(spaceId, from)
      if (!who) return null
      const file = safeFileName(name)
      const q = d.confirm({
        title: `${who.name} wants to send you a file`,
        detail:
          `${file}, ${formatBytes(size as number)}. It goes to your downloads.` +
          (runsCode(file)
            ? ' This kind of file can run programs on your computer: save it only if you expected it.'
            : ''),
        choices: [
          { label: 'Save', tone: runsCode(file) ? 'danger' : 'primary' },
          { label: 'Decline' }
        ]
      })
      asking.set(key, q.cancel)
      const pick = await q.answer.finally(() => asking.delete(key))
      // still here: they could have left while the card was up
      if (pick !== 0 || !d.personOf(spaceId, from)) return null
      const path = d.downloads.pathFor(file)
      const t = next++
      const out = createWriteStream(path, { flags: 'wx' })
      out.on('error', () => drop(t, true))
      files.set(t, {
        out,
        path,
        size: size as number,
        got: 0,
        row: d.downloads.incoming(path, size as number, () => drop(t, true))
      })
      return t
    }
  )
  /** The offer went away before it was answered. */
  ipcMain.on('share:recv-unask', (e, key: unknown) => {
    if (mine(e) && typeof key === 'string') asking.get(key)?.()
  })
  ipcMain.on('share:recv-chunk', (e, t: unknown, data: unknown) => {
    const f = typeof t === 'number' && mine(e) ? files.get(t) : undefined
    if (!f || !(data instanceof Uint8Array)) return
    f.got += data.byteLength
    // never more than was offered
    if (f.got > f.size) return drop(t as number, true)
    f.out.write(data)
    f.row.progress(f.got)
  })
  /** Everything came: kept when it is all there. */
  ipcMain.handle('share:recv-end', async (e, t: unknown) => {
    const f = typeof t === 'number' && mine(e) ? files.get(t) : undefined
    if (!f) return false
    if (f.got !== f.size) {
      drop(t as number, false)
      return false
    }
    files.delete(t as number)
    await new Promise<void>((r) => f.out.end(r))
    if (process.platform === 'win32')
      try {
        // from the internet, as Windows marks a download: SmartScreen and Office's protected view treat it so
        writeFileSync(`${f.path}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n')
      } catch {
        // a drive without streams (FAT): kept unmarked
      }
    f.row.end(true)
    return true
  })
  ipcMain.on('share:recv-abort', (e, t: unknown) => {
    if (mine(e) && typeof t === 'number') drop(t, false)
  })
}
