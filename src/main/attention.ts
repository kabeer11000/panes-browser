import { app, nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import type { windowAttention } from '@shared/attention'
import { badgeIcon, badgeLabel } from '@shared/badgeIcon'

type Summary = ReturnType<typeof windowAttention>

const UNSEEN_RGB = [0xe5, 0x48, 0x4d] as const // red, as Windows apps mark unread
const RINGING_RGB = [0x30, 0xa4, 0x6c] as const // green, the colour of answering a call

/** The taskbar button's corner badge: `label` (a count, or nothing for a plain dot) on a circle of `rgb`. */
function badge(label: string, rgb: readonly [number, number, number]): NativeImage {
  const img = nativeImage.createFromBitmap(Buffer.from(badgeIcon(label, rgb, 16)), {
    width: 16,
    height: 16
  })
  img.addRepresentation({
    scaleFactor: 2,
    width: 32,
    height: 32,
    buffer: Buffer.from(badgeIcon(label, rgb, 32))
  })
  return img
}

/**
 * The window's taskbar button while the person is elsewhere: a dot on it while something waits (green for a call
 * ringing), and a flash when something new arrives. Both go when the window is focused: by then the tabs say it.
 */
export class TaskbarAttention {
  private last: Summary = { count: 0, unseen: false, ringing: false }
  private shown: string | null = null
  private badges = new Map<string, NativeImage>()

  constructor(private win: BrowserWindow) {
    win.on('focus', () => {
      this.win.flashFrame(false)
      this.apply()
    })
    win.on('blur', () => this.apply())
  }

  update(next: Summary): void {
    if (this.win.isDestroyed()) return
    const prev = this.last
    this.last = next
    // Flash only on something new (not on every state push), and only while the person is away from the window.
    const arrived =
      (next.unseen && (!prev.unseen || next.count > prev.count)) || (next.ringing && !prev.ringing)
    if (arrived && !this.win.isFocused()) this.win.flashFrame(true)
    if (process.platform !== 'win32') app.setBadgeCount(next.count) // the dock and Unity show a number
    this.apply()
  }

  private apply(): void {
    if (this.win.isDestroyed() || process.platform !== 'win32') return
    const want = this.win.isFocused()
      ? null
      : this.last.ringing
        ? 'ringing'
        : this.last.unseen
          ? 'unseen'
          : null
    // the unread count is in the badge (as on the tabs), a call keeps its green dot
    const label = want === 'unseen' ? badgeLabel(this.last.count) : ''
    const key = want ? `${want}:${label}` : null
    if (key === this.shown) return
    this.shown = key
    if (!want || !key) return this.win.setOverlayIcon(null, '')
    let image = this.badges.get(key)
    if (!image) {
      image = badge(label, want === 'ringing' ? RINGING_RGB : UNSEEN_RGB)
      this.badges.set(key, image)
    }
    this.win.setOverlayIcon(
      image,
      want === 'ringing'
        ? 'A call is coming in'
        : this.last.count > 0
          ? `${this.last.count} unread in Panes`
          : 'Something new in Panes'
    )
  }
}
