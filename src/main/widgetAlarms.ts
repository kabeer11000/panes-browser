import { Notification, type NativeImage } from 'electron'
import { alarmsOf, dueAlarms, nextAlarm, type Alarm } from '@shared/widgets'
import type { CanvasService } from './ai/canvas'
import type { SpaceStore } from './spaces'
import { JsonStore } from './store'

/** setTimeout's longest wait; anything later is looked at again then. */
const MAX_WAIT = 6 * 3600_000
/** Gone off this long before it was noticed (Panes was closed): said so in the notification. */
const LATE_MS = 90_000

/**
 * Board widgets that go off (a timer running out, a reminder coming due, see shared/widgets.ts) notify from here,
 * so they do whether the board is open, another space is on screen or the window is minimised. Each one is told once:
 * what has been told is kept on disk, so a reminder that came due while Panes was closed is told once at the next start.
 */
export class WidgetAlarms {
  private told = new JsonStore<{ keys: string[] }>('widget-alarms', { keys: [] })
  private timer: NodeJS.Timeout | null = null
  /** Shown notifications, held so they (and their click handlers) are not collected while on screen. */
  private shown = new Set<Notification>()

  constructor(
    private d: {
      canvas: CanvasService
      spaces: SpaceStore
      icon?: NativeImage | string
      /** Bring the window up on that space's board. */
      open: (spaceId: number) => void
    }
  ) {}

  /** Look at every board again: tell what is due, and wait for the next. Called on start and after each board save. */
  check(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const all: Alarm[] = this.d.spaces
      .list()
      .flatMap((s) => alarmsOf(s.id, this.d.canvas.load(s.id).state?.notes ?? []))
    const now = Date.now()
    const told = new Set(this.told.value.keys)
    for (const a of dueAlarms(all, told, now)) this.notify(a, now - a.at > LATE_MS)
    // only what is still on a board is remembered: a widget reset, set again or deleted is forgotten
    const keys = all.filter((a) => a.at <= now).map((a) => a.key)
    if (keys.length !== told.size || keys.some((k) => !told.has(k))) {
      this.told.value = { keys }
      this.told.save()
    }
    const next = nextAlarm(all, now)
    if (next === null) return
    this.timer = setTimeout(() => this.check(), Math.min(MAX_WAIT, Math.max(0, next - now) + 50))
    this.timer.unref?.()
  }

  private notify(a: Alarm, late: boolean): void {
    if (!Notification.isSupported()) return
    const when = new Date(a.at).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    })
    const n = new Notification({
      title: a.title,
      body: late ? `${a.body} (due at ${when})` : a.body,
      icon: this.d.icon,
      urgency: 'critical',
      timeoutType: 'never'
    })
    this.shown.add(n)
    n.on('click', () => this.d.open(a.spaceId))
    n.on('close', () => this.shown.delete(n))
    n.show()
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
