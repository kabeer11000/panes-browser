/** What the page reports (through the console) when it shows a notification and when one of them is clicked. */
export const NOTIFY_PREFIX = '__panes_notify__'

export type NotifyReport =
  { kind: 'show'; id: number; title: string; body: string } | { kind: 'click'; id: number }

const MAX_TEXT = 300 // a notification's text is only read for words like "calling"; no need to carry a novel

/** The report in a console message, or null for any other message. */
export function parseNotify(message: string): NotifyReport | null {
  if (!message.startsWith(NOTIFY_PREFIX)) return null
  let v: Record<string, unknown>
  try {
    v = JSON.parse(message.slice(NOTIFY_PREFIX.length)) as Record<string, unknown>
  } catch {
    return null
  }
  if (!v || typeof v.id !== 'number' || !Number.isSafeInteger(v.id) || v.id <= 0) return null
  if (v.kind === 'click') return { kind: 'click', id: v.id }
  if (v.kind !== 'show') return null
  const text = (x: unknown): string => (typeof x === 'string' ? x.slice(0, MAX_TEXT) : '')
  return { kind: 'show', id: v.id, title: text(v.title), body: text(v.body) }
}

/**
 * The page's notifications, as Windows toasts: Chromium shows them and passes clicks back to the page, but Electron
 * neither marks the tab nor brings it forward, so a click on a WhatsApp toast did nothing. This listens to every
 * notification the page makes and reports it, and a real click on its toast, to main (`report` gets the JSON that
 * follows NOTIFY_PREFIX). Run by the frame preload in the page's world at document start, before the page's own code:
 * a page that keeps its own hold on `Notification` from its first line (WhatsApp does) was missed by a hook put in
 * later. A Proxy, so the constructor still reads as native. Also: Electron drops notifications from service workers
 * without showing anything, so a page's `registration.showNotification` is shown as a page notification instead
 * (actions are not possible there).
 *
 * Self-contained (no imports or outer names): Electron runs it from its source text.
 */
export function notifyShim(
  bridge: { report: (data: string) => void },
  g: typeof globalThis = globalThis
): void {
  const Real = g.Notification
  if (typeof Real !== 'function') return
  let next = 0
  const watch = (
    note: Notification,
    title: unknown,
    options?: NotificationOptions
  ): Notification => {
    const id = ++next
    const body = String(options?.body ?? '')
    bridge.report(JSON.stringify({ kind: 'show', id, title: String(title ?? ''), body }))
    note.addEventListener('click', (e: Event) => {
      // only Chromium's own click, from the toast: a page cannot pull its tab forward with a made-up event
      if (e.isTrusted) bridge.report(JSON.stringify({ kind: 'click', id }))
    })
    return note
  }
  g.Notification = new Proxy(Real, {
    construct: (target, args, newTarget) =>
      watch(Reflect.construct(target, args, newTarget) as Notification, args[0], args[1])
  })
  const swr = g.ServiceWorkerRegistration?.prototype
  if (swr && typeof swr.showNotification === 'function') {
    swr.showNotification = function showNotification(title: string, options?: NotificationOptions) {
      const rest = { ...(options ?? {}) } as NotificationOptions & { actions?: unknown }
      delete rest.actions
      try {
        new g.Notification(title, rest)
        return Promise.resolve()
      } catch (e) {
        return Promise.reject(e)
      }
    }
  }
}
