import type { DownloadAction, DownloadInfo } from './types'

/** "12.3 MB": bytes in the largest unit that keeps the number readable. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}

/** "20 s left", "3 min left", "2 h left": rounded the way a person reads a countdown. */
export function formatLeft(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s left`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min left`
  return `${Math.round(seconds / 3600)} h left`
}

export const isActive = (d: DownloadInfo): boolean =>
  d.state === 'progressing' || d.state === 'paused'

/** The file's extension, lowercase without the dot, or '' when it has none. */
export function extensionOf(filename: string): string {
  return /\.([a-z0-9]{1,8})$/i.exec(filename)?.[1]?.toLowerCase() ?? ''
}

/** Kinds of file that run code when opened: never opened on their own (Chrome refuses "Always open" for them too). */
const RUNS_CODE = new Set([
  'exe',
  'msi',
  'msix',
  'msixbundle',
  'appx',
  'appxbundle',
  'bat',
  'cmd',
  'com',
  'scr',
  'pif',
  'cpl',
  'ps1',
  'psm1',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'hta',
  'jar',
  'lnk',
  'url',
  'reg',
  'inf',
  'msc',
  'dll',
  'sys',
  'dmg',
  'pkg',
  'app',
  'command',
  'sh',
  'run',
  'deb',
  'rpm',
  'appimage',
  'html',
  'htm',
  'svg',
  'xhtml',
  'mht'
])

/** Whether files of this kind may be set to open by themselves when they finish. */
/** Whether opening a file of this kind can run code (a program, a script, a page). */
export const runsCode = (filename: string): boolean => RUNS_CODE.has(extensionOf(filename))

export const canAlwaysOpen = (filename: string): boolean =>
  extensionOf(filename) !== '' && !runsCode(filename)

/** The second line of a download's row: what it is doing, in words. */
export function downloadStatus(d: DownloadInfo): string {
  if (d.note) return d.note
  if (d.missing) return 'File moved or deleted'
  const of =
    d.total > 0 ? `${formatBytes(d.received)} of ${formatBytes(d.total)}` : formatBytes(d.received)
  switch (d.state) {
    case 'progressing': {
      const parts = [of]
      if (d.speed && d.speed > 0) {
        parts.push(`${formatBytes(d.speed)}/s`)
        if (d.total > d.received) parts.push(formatLeft((d.total - d.received) / d.speed))
      }
      if (d.openWhenDone) parts.unshift('Opening when complete')
      return parts.join(', ')
    }
    case 'paused':
      return `Paused, ${of}`
    case 'completed':
      return formatBytes(d.total || d.received)
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Failed'
  }
}

export type DownloadTone = 'run' | 'paused' | 'done' | 'failed'

/**
 * How full the bar is and how it looks. `value` is null while the size is not known (an indeterminate sweep); a
 * cancelled or failed download keeps the bar where it stopped.
 */
export function downloadProgress(d: DownloadInfo): { value: number | null; tone: DownloadTone } {
  const tone: DownloadTone =
    d.state === 'progressing'
      ? 'run'
      : d.state === 'paused'
        ? 'paused'
        : d.state === 'completed'
          ? 'done'
          : 'failed'
  if (tone === 'done') return { value: 1, tone }
  if (d.total <= 0) return { value: tone === 'failed' ? 0 : null, tone }
  return { value: Math.min(1, Math.max(0, d.received / d.total)), tone }
}

export type DownloadMenuItem =
  { action: DownloadAction; label: string; checked?: boolean; enabled?: boolean } | 'separator'

/** A download's right-click menu, as Chrome's: what makes sense for its state, in Chrome's order. */
export function downloadMenu(d: DownloadInfo, alwaysOpen: boolean): DownloadMenuItem[] {
  const items: DownloadMenuItem[] = []
  const always = canAlwaysOpen(d.filename)
  const ok = d.state === 'completed' && !d.missing
  if (isActive(d)) {
    items.push({ action: 'open-when-done', label: 'Open when done', checked: !!d.openWhenDone })
    if (always)
      items.push({
        action: 'always-open',
        label: 'Always open files of this type',
        checked: alwaysOpen
      })
    items.push('separator')
    items.push({
      action: d.state === 'paused' ? 'resume' : 'pause',
      label: d.state === 'paused' ? 'Resume' : 'Pause'
    })
  } else if (d.state === 'completed') {
    items.push({ action: 'open', label: 'Open', enabled: ok })
    if (always)
      items.push({
        action: 'always-open',
        label: 'Always open files of this type',
        checked: alwaysOpen
      })
    items.push('separator')
    items.push({ action: 'show', label: 'Show in folder', enabled: ok })
  } else {
    items.push({ action: 'retry', label: 'Retry', enabled: !!d.url })
    items.push('separator')
  }
  if (d.url) items.push({ action: 'copy-link', label: 'Copy download link' })
  items.push(
    isActive(d)
      ? { action: 'cancel', label: 'Cancel' }
      : { action: 'remove', label: 'Remove from list' }
  )
  return items
}
