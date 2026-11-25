import { displayHost } from '@shared/url'

export const host = displayHost

export { formatBytes } from '@shared/downloads'

export const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** "Today", "Yesterday", or a long date, for grouping history. */
export function dayLabel(ms: number, now = new Date()): string {
  const d = new Date(ms)
  const startOf = (x: Date): number =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
}
