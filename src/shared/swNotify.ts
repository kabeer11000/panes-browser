/**
 * Service workers' notifications (preload/sw.ts and main). Its own module: the worker's preload and the page's
 * (preload/frame.ts, shared/notify.ts) must share no module, or the bundler splits it into a chunk file that each
 * requires, and a sandboxed preload cannot require a file (every page's preload failed so).
 */

const MAX_TEXT = 300
/** What a service worker's notification reports to main (see swNotifyShim). */
export interface WorkerNote {
  title: string
  body: string
  /** Where clicking it should go, when the site said (`data.url`, as most push handlers carry it). */
  url: string | null
}

/** A worker's report, checked: null for anything that is not one. */
export function parseWorkerNote(v: unknown): WorkerNote | null {
  const o = v as Partial<Record<keyof WorkerNote, unknown>> | null
  if (!o || typeof o.title !== 'string') return null
  const url = typeof o.url === 'string' && /^https?:\/\//i.test(o.url) ? o.url.slice(0, 2000) : null
  return {
    title: o.title.slice(0, MAX_TEXT),
    body: typeof o.body === 'string' ? o.body.slice(0, MAX_TEXT) : '',
    url
  }
}

/**
 * A site's service worker showing a notification (a push while its tab is in the background: Gmail, Discord, chat
 * sites). Electron drops these without showing anything, and no page hears of them, so the tab was never marked.
 * Run in the worker (preload/sw.ts): `registration.showNotification` reports to main, which shows the toast and marks
 * the site's tab. Self-contained (no imports or outer names): Electron runs it from its source text.
 */
export function swNotifyShim(
  bridge: { report: (note: { title: string; body: string; url: string | null }) => void },
  g: typeof globalThis = globalThis
): void {
  const swr = g.ServiceWorkerRegistration?.prototype
  if (!swr || typeof swr.showNotification !== 'function') return
  swr.showNotification = function showNotification(title: string, options?: NotificationOptions) {
    const data = (options as { data?: unknown } | undefined)?.data as { url?: unknown } | undefined
    bridge.report({
      title: String(title ?? ''),
      body: String(options?.body ?? ''),
      url: typeof data?.url === 'string' ? data.url : null
    })
    return Promise.resolve()
  }
}
