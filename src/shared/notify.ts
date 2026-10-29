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
 * Put into a page whose site may show notifications (it checks, and does nothing otherwise, so a page that was never
 * allowed carries nothing a bot check could spot). Chromium shows the page's notifications as Windows toasts and
 * passes clicks and closes back to the page by itself; this only listens, so the browser can mark the tab and bring
 * it forward when a toast is clicked (Electron does neither). Two things it changes:
 * - `new Notification(...)` is the real one, behind a Proxy that adds a click listener to what it makes.
 * - `registration.showNotification(...)` from the page: Electron drops notifications from service workers without
 *   showing anything, so the page's call is shown as a page notification instead (actions are not possible there).
 * Returns whether it installed, so main knows the page's reports can be trusted for this document.
 */
export const NOTIFY_SCRIPT = `(() => {
  const Real = window.Notification
  if (typeof Real !== 'function' || Real.permission !== 'granted') return false
  const say = console.debug.bind(console)
  const report = (data) => say('${NOTIFY_PREFIX}' + JSON.stringify(data))
  let next = 0
  const watch = (note, title, options) => {
    const id = ++next
    report({ kind: 'show', id, title: String(title ?? ''), body: String((options && options.body) ?? '') })
    note.addEventListener('click', () => report({ kind: 'click', id }))
    return note
  }
  window.Notification = new Proxy(Real, {
    construct: (target, args, newTarget) => watch(Reflect.construct(target, args, newTarget), args[0], args[1])
  })
  const SWR = window.ServiceWorkerRegistration
  if (SWR && typeof SWR.prototype.showNotification === 'function') {
    SWR.prototype.showNotification = function showNotification(title, options) {
      const { actions, ...rest } = options || {}
      try {
        new window.Notification(title, rest)
        return Promise.resolve()
      } catch (e) {
        return Promise.reject(e)
      }
    }
  }
  return true
})()`
