import { app, nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import type { windowAttention } from '../shared/attention'

type Summary = ReturnType<typeof windowAttention>

const UNSEEN_RGB = [0xe5, 0x48, 0x4d] as const // red, as Windows apps mark unread
const RINGING_RGB = [0x30, 0xa4, 0x6c] as const // green, the colour of answering a call

/** A filled, softly edged dot for the taskbar button's corner (16 px, as Windows draws overlays). */
function dot([r, g, b]: readonly [number, number, number]): NativeImage {
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // one pixel of falloff at the rim instead of a jagged edge
      const a = Math.max(0, Math.min(1, c + 0.5 - Math.hypot(x - c, y - c)))
      const i = (y * size + x) * 4
      // BGRA, premultiplied, as createFromBitmap expects
      buf[i] = Math.round(b * a)
      buf[i + 1] = Math.round(g * a)
      buf[i + 2] = Math.round(r * a)
      buf[i + 3] = Math.round(255 * a)
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

/**
 * The window's taskbar button while the person is elsewhere: a dot on it while something waits (green for a call
 * ringing), and a flash when something new arrives. Both go when the window is focused: by then the tabs say it.
 */
export class TaskbarAttention {
  private last: Summary = { count: 0, unseen: false, ringing: false }
  private shown: 'unseen' | 'ringing' | null = null
  private dots: Partial<Record<'unseen' | 'ringing', NativeImage>> = {}

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
    if (want === this.shown) return
    this.shown = want
    if (!want) return this.win.setOverlayIcon(null, '')
    const image = (this.dots[want] ??= dot(want === 'ringing' ? RINGING_RGB : UNSEEN_RGB))
    this.win.setOverlayIcon(
      image,
      want === 'ringing' ? 'A call is coming in' : 'Something new in Panes'
    )
  }
}
