import { app, nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import type { windowAttention } from '@shared/attention'
import { badgeIcon, badgeLabel, badgeScript } from '@shared/badgeIcon'

type Summary = ReturnType<typeof windowAttention>

const UNSEEN_RGB = [0xe5, 0x48, 0x4d] as const // red, as Windows apps mark unread
const RINGING_RGB = [0x30, 0xa4, 0x6c] as const // green, the colour of answering a call

/** The sizes Windows draws an overlay icon at: 16 px at 100% display scale, up to 40 px at 250%. */
const SIZES = [16, 20, 24, 32, 40] as const

/**
 * The taskbar button's corner badge: `label` (a count, or nothing for a plain dot), or a handset for a call, on a
 * circle of `rgb`. Drawn by the window's own page in the system font (badgeScript); the pixel-font picture is the
 * fallback while the page cannot draw (not loaded yet, gone).
 */
async function drawBadge(
  win: BrowserWindow,
  label: string,
  rgb: readonly [number, number, number],
  symbol: 'phone' | null
): Promise<NativeImage> {
  try {
    const urls = (await win.webContents.executeJavaScript(
      badgeScript(label, rgb, SIZES, symbol)
    )) as Record<string, string>
    const img = nativeImage.createFromDataURL(urls[16])
    for (const s of SIZES.slice(1)) img.addRepresentation({ scaleFactor: s / 16, dataURL: urls[s] })
    if (!img.isEmpty()) return img
  } catch {
    // the page could not draw it: the pixel one below
  }
  return pixelBadge(label, rgb)
}

function pixelBadge(label: string, rgb: readonly [number, number, number]): NativeImage {
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
 * The window's taskbar button while the person is elsewhere: a badge on it while something waits (the unread count
 * on red, a handset on green for a call ringing), and a flash when something new arrives. Both go when the window is focused: by then the tabs say it.
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
    void this.show()
  }

  private async show(): Promise<void> {
    if (this.win.isDestroyed() || process.platform !== 'win32') return
    const want = this.win.isFocused()
      ? null
      : this.last.ringing
        ? 'ringing'
        : this.last.unseen
          ? 'unseen'
          : null
    // the unread count is in the badge (as on the tabs), a call is a handset on green
    const label = want === 'unseen' ? badgeLabel(this.last.count) : ''
    const key = want ? `${want}:${label}` : null
    if (key === this.shown) return
    this.shown = key
    if (!want || !key) {
      this.win.setOverlayIcon(null, '')
      return
    }
    let image = this.badges.get(key)
    if (!image) {
      image = await drawBadge(
        this.win,
        label,
        want === 'ringing' ? RINGING_RGB : UNSEEN_RGB,
        want === 'ringing' ? 'phone' : null
      )
      if (this.win.isDestroyed() || this.shown !== key) return // changed while it was drawn
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
