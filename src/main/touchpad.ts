import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { ContactFrames, type Contact } from '@shared/touchContacts'

/**
 * Raw precision-touchpad contacts for the board's free scrolling (see shared/freeScroll.ts). Windows only: there
 * Chromium puts touchpad scrolls on one axis, and the raw contacts are the only place the other axis survives.
 * macOS and Linux scroll freely already, so this does nothing there.
 *
 * Uses koffi (prebuilt FFI, loaded from app.asar like adblock-rs) for user32's raw input and hid.dll's report
 * parsing. Loaded only when a board first opens, so startup does not pay for it.
 */

const WM_INPUT = 0x00ff
const RID_INPUT = 0x10000003
const RIDI_PREPARSEDDATA = 0x20000005
const RIM_TYPEHID = 2
const RIDEV_REMOVE = 0x1
const HEADER = 24 // RAWINPUTHEADER on 64-bit
const HIDP_INPUT = 0
const HIDP_OK = 0x00110000
const PAGE_DESKTOP = 0x01
const PAGE_DIGITIZER = 0x0d
const U_X = 0x30
const U_Y = 0x31
const U_TIP = 0x42
const U_CONTACT_ID = 0x51
const U_CONTACT_COUNT = 0x54
const U_TOUCHPAD = 0x05

interface Axis {
  min: number
  /** mm per logical unit */
  mm: number
}
interface Device {
  prep: Buffer
  /** link collection of each finger slot, in report order */
  slots: { link: number; x: Axis; y: Axis }[]
  countLink: number
  frames: ContactFrames
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any
interface Api {
  register: Fn
  getData: Fn
  getInfo: Fn
  getCaps: Fn
  getValueCaps: Fn
  getValue: Fn
  getUsages: Fn
}

let api: Api | null | undefined
function load(): Api | null {
  if (api !== undefined) return api
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const hid = koffi.load('hid.dll')
    api = {
      register: user32.func(
        'int __stdcall RegisterRawInputDevices(void *p, uint32 n, uint32 size)'
      ),
      getData: user32.func(
        'uint32 __stdcall GetRawInputData(uintptr_t h, uint32 cmd, void *data, _Inout_ uint32 *size, uint32 header)'
      ),
      getInfo: user32.func(
        'uint32 __stdcall GetRawInputDeviceInfoW(uintptr_t h, uint32 cmd, void *data, _Inout_ uint32 *size)'
      ),
      getCaps: hid.func('long __stdcall HidP_GetCaps(void *prep, void *caps)'),
      getValueCaps: hid.func(
        'long __stdcall HidP_GetValueCaps(int type, void *caps, _Inout_ uint16 *len, void *prep)'
      ),
      getValue: hid.func(
        'long __stdcall HidP_GetUsageValue(int type, uint16 page, uint16 link, uint16 usage, _Out_ uint32 *value, void *prep, void *report, uint32 len)'
      ),
      getUsages: hid.func(
        'long __stdcall HidP_GetUsages(int type, uint16 page, uint16 link, void *list, _Inout_ uint32 *len, void *prep, void *report, uint32 len2)'
      )
    }
  } catch (err) {
    console.warn('touchpad: raw input unavailable', err)
    api = null
  }
  return api
}

/** Logical units to mm from a value cap's physical range (HID units: cm or inch, with a signed exponent). */
function axisOf(cap: Buffer, o: number, fallbackMm: number): Axis {
  const exp = ((cap.readUInt32LE(o + 32) & 0xf) ^ 8) - 8
  const units = cap.readUInt32LE(o + 36) & 0xff
  const lmin = cap.readInt32LE(o + 40)
  const lmax = cap.readInt32LE(o + 44)
  const pmin = cap.readInt32LE(o + 48)
  const pmax = cap.readInt32LE(o + 52)
  const perUnit = units === 0x11 ? 10 : units === 0x13 ? 25.4 : 0
  let len = (pmax - pmin) * Math.pow(10, exp) * perUnit
  if (!(len > 5 && len < 1000)) len = fallbackMm
  return { min: lmin, mm: len / Math.max(1, lmax - lmin) }
}

function describe(a: Api, handle: bigint): Device | null {
  const size = [0]
  a.getInfo(handle, RIDI_PREPARSEDDATA, null, size)
  if (!size[0]) return null
  const prep = Buffer.alloc(size[0])
  if (a.getInfo(handle, RIDI_PREPARSEDDATA, prep, size) <= 0) return null
  const caps = Buffer.alloc(64)
  if (a.getCaps(prep, caps) !== HIDP_OK) return null
  if (caps.readUInt16LE(2) !== PAGE_DIGITIZER || caps.readUInt16LE(0) !== U_TOUCHPAD) return null
  const n = caps.readUInt16LE(48)
  const vcaps = Buffer.alloc(72 * n)
  const len = [n]
  if (a.getValueCaps(HIDP_INPUT, vcaps, len, prep) !== HIDP_OK) return null
  const xs = new Map<number, Axis>()
  const ys = new Map<number, Axis>()
  let countLink = -1
  // X first, so Y can fall back to X's scale when the device gives no physical size
  for (const pass of [U_X, U_Y]) {
    for (let i = 0; i < len[0]; i++) {
      const o = i * 72
      const page = vcaps.readUInt16LE(o)
      const link = vcaps.readUInt16LE(o + 6)
      const usage = vcaps.readUInt16LE(o + 56) // NotRange.Usage (Range.UsageMin)
      if (pass === U_X && page === PAGE_DIGITIZER && usage === U_CONTACT_COUNT) countLink = link
      if (page !== PAGE_DESKTOP || usage !== pass) continue
      if (pass === U_X) xs.set(link, axisOf(vcaps, o, 100))
      else {
        const x = xs.get(link)
        const ly = vcaps.readInt32LE(o + 44) - vcaps.readInt32LE(o + 40)
        ys.set(link, axisOf(vcaps, o, x ? x.mm * ly : 65)) // no size given: same resolution as X
      }
    }
  }
  const slots = [...xs.keys()]
    .filter((l) => ys.has(l))
    .sort((p, q) => p - q)
    .map((link) => ({ link, x: xs.get(link)!, y: ys.get(link)! }))
  if (!slots.length || countLink < 0) return null
  return { prep, slots, countLink, frames: new ContactFrames() }
}

/** One window's reader: on while its board is open and it is the window the touchpad reports to. */
class Reader {
  private devices = new Map<bigint, Device | null>()
  private buf = Buffer.alloc(512)
  private hooked = false

  constructor(
    private readonly a: Api,
    private readonly win: BrowserWindow,
    private readonly to: WebContents
  ) {}

  start(): boolean {
    const hwnd = this.win.getNativeWindowHandle().readBigUInt64LE(0)
    const dev = Buffer.alloc(16)
    dev.writeUInt16LE(PAGE_DIGITIZER, 0)
    dev.writeUInt16LE(U_TOUCHPAD, 2)
    dev.writeUInt32LE(0, 4) // foreground only: reports stop when Panes is not in front
    dev.writeBigUInt64LE(hwnd, 8)
    if (!this.a.register(dev, 1, 16)) return false
    if (!this.hooked) {
      this.win.hookWindowMessage(WM_INPUT, (_w, l) => this.onInput(l))
      this.hooked = true
    }
    return true
  }

  stop(): void {
    const dev = Buffer.alloc(16)
    dev.writeUInt16LE(PAGE_DIGITIZER, 0)
    dev.writeUInt16LE(U_TOUCHPAD, 2)
    dev.writeUInt32LE(RIDEV_REMOVE, 4)
    this.a.register(dev, 1, 16)
    if (this.hooked && !this.win.isDestroyed()) this.win.unhookWindowMessage(WM_INPUT)
    this.hooked = false
  }

  private onInput(l: Buffer): void {
    try {
      const size = [this.buf.length]
      let got = this.a.getData(l.readBigUInt64LE(0), RID_INPUT, this.buf, size, HEADER)
      if (got === 0xffffffff) {
        this.buf = Buffer.alloc(size[0] * 2)
        size[0] = this.buf.length
        got = this.a.getData(l.readBigUInt64LE(0), RID_INPUT, this.buf, size, HEADER)
      }
      if (got === 0xffffffff || got < HEADER + 8 || this.buf.readUInt32LE(0) !== RIM_TYPEHID) return
      const handle = this.buf.readBigUInt64LE(8)
      let d = this.devices.get(handle)
      if (d === undefined) this.devices.set(handle, (d = describe(this.a, handle)))
      if (!d) return
      const each = this.buf.readUInt32LE(HEADER)
      const reports = this.buf.readUInt32LE(HEADER + 4)
      for (let i = 0; i < reports; i++) {
        const start = HEADER + 8 + i * each
        this.report(d, Buffer.from(this.buf.subarray(start, start + each)))
      }
    } catch (err) {
      console.warn('touchpad: bad report', err)
    }
  }

  private report(d: Device, r: Buffer): void {
    const a = this.a
    const v = [0]
    const value = (page: number, link: number, usage: number): number | null =>
      a.getValue(HIDP_INPUT, page, link, usage, v, d.prep, r, r.length) === HIDP_OK ? v[0] : null
    const count = value(PAGE_DIGITIZER, d.countLink, U_CONTACT_COUNT) ?? 0
    const slots: Contact[] = []
    const list = new Uint16Array(16)
    for (const s of d.slots) {
      const x = value(PAGE_DESKTOP, s.link, U_X)
      const y = value(PAGE_DESKTOP, s.link, U_Y)
      if (x === null || y === null) continue
      const n = [list.length]
      const tip =
        a.getUsages(HIDP_INPUT, PAGE_DIGITIZER, s.link, list, n, d.prep, r, r.length) === HIDP_OK &&
        list.subarray(0, n[0]).includes(U_TIP)
      slots.push({
        id: value(PAGE_DIGITIZER, s.link, U_CONTACT_ID) ?? s.link,
        tip,
        x: (x - s.x.min) * s.x.mm,
        y: (y - s.y.min) * s.y.mm
      })
    }
    const f = d.frames.feed(count, slots)
    if (!f) return
    // only two-finger motion matters, plus the frame where the fingers come off
    if (f.fingers < 2 && this.lastFingers < 2) return
    this.lastFingers = f.fingers
    if (!this.to.isDestroyed()) this.to.send('canvas:touchpad', f.dx, f.dy, f.fingers, f.y)
  }

  private lastFingers = 0
}

/** `canvas:touchpad-on` (true/false) from a board; replies whether raw frames will come. */
export function registerTouchpad(): void {
  let active: Reader | null = null
  ipcMain.handle('canvas:touchpad', (e, on: unknown) => {
    if (process.platform !== 'win32') return false
    active?.stop()
    active = null
    if (on !== true) return false
    const a = load()
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!a || !win) return false
    const r = new Reader(a, win, e.sender)
    if (!r.start()) return false
    active = r
    e.sender.once('destroyed', () => {
      if (active === r) {
        active = null
        try {
          r.stop()
        } catch {
          /* window already gone */
        }
      }
    })
    return true
  })
}
