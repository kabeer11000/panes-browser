import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { ContactFrames, ScanClock, type Contact } from '@shared/touchContacts'

/**
 * Raw precision-touchpad contacts for the board's free scrolling (see shared/freeScroll.ts) and the tab view's swipes
 * (see gestures.ts). Windows only: there
 * Chromium puts touchpad scrolls on one axis, and the raw contacts are the only place the other axis survives.
 * macOS and Linux scroll freely already, so this does nothing there.
 *
 * Uses koffi (prebuilt FFI, loaded from app.asar like adblock-rs) for user32's raw input and hid.dll's report
 * parsing. Loaded only when a board first opens or the swipes are turned on, after startup.
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
const U_SCAN_TIME = 0x56
const U_TOUCHPAD = 0x05

interface Axis {
  min: number
  /** mm per logical unit */
  mm: number
  /** the whole axis, mm */
  span: number
}
interface Device {
  prep: Buffer
  /** link collection of each finger slot, in report order */
  slots: { link: number; x: Axis; y: Axis }[]
  countLink: number
  frames: ContactFrames
  clock: ScanClock
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
  return { min: lmin, mm: len / Math.max(1, lmax - lmin), span: len }
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
  return { prep, slots, countLink, frames: new ContactFrames(), clock: new ScanClock() }
}

/** A finished frame, for the tab view's swipes: `padW` is how wide the pad is (mm). */
export interface TouchFrame {
  dx: number
  dy: number
  fingers: number
  x: number
  y: number
  xMin: number
  xMax: number
  padW: number
}

/**
 * One window's reader: on while its board is open (frames go to the board's page) or the tab view's swipes want
 * them (frames go to `nav`), and only while it is the window in front.
 */
class Reader {
  /** The board's page while it is open. */
  board: WebContents | null = null
  /** The tab view's swipes, while they are on. */
  nav: ((f: TouchFrame) => void) | null = null
  private devices = new Map<bigint, Device | null>()
  private buf = Buffer.alloc(512)
  private hooked = false
  // Reused for every report (about 125 a second): garbage made here is collected on main, where tabs run too.
  private rep = Buffer.alloc(64)
  private val = [0]
  private usages = new Uint16Array(16)
  private usageLen = [0]
  private contacts: Contact[] = []

  constructor(
    private readonly a: Api,
    private readonly win: BrowserWindow
  ) {}

  private on = false

  /** Registers or drops the raw input to match who wants it; whether frames will come. */
  sync(): boolean {
    const want = !!this.board || !!this.nav
    if (want === this.on) return want
    if (want) this.on = this.start()
    else {
      this.stop()
      this.on = false
    }
    return this.on
  }

  private start(): boolean {
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

  private stop(): void {
    const dev = Buffer.alloc(16)
    dev.writeUInt16LE(PAGE_DIGITIZER, 0)
    dev.writeUInt16LE(U_TOUCHPAD, 2)
    dev.writeUInt32LE(RIDEV_REMOVE, 4)
    this.a.register(dev, 1, 16)
    if (this.hooked && !this.win.isDestroyed()) this.win.unhookWindowMessage(WM_INPUT)
    this.lastFingers = 0
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
      // when the touch happened, as near as main can tell, in a clock the page shares (see PanResampler)
      const at = performance.timeOrigin + performance.now()
      const each = this.buf.readUInt32LE(HEADER)
      const reports = this.buf.readUInt32LE(HEADER + 4)
      for (let i = 0; i < reports; i++) {
        const start = HEADER + 8 + i * each
        if (this.rep.length !== each) this.rep = Buffer.alloc(each)
        this.buf.copy(this.rep, 0, start, start + each)
        this.report(d, this.rep, at)
      }
    } catch (err) {
      console.warn('touchpad: bad report', err)
    }
  }

  /** One value from the report, or null when it has none. */
  private value(d: Device, r: Buffer, page: number, link: number, usage: number): number | null {
    const ok = this.a.getValue(HIDP_INPUT, page, link, usage, this.val, d.prep, r, r.length)
    return ok === HIDP_OK ? this.val[0] : null
  }

  private report(d: Device, r: Buffer, at: number): void {
    const count = this.value(d, r, PAGE_DIGITIZER, d.countLink, U_CONTACT_COUNT) ?? 0
    // only the slots this report fills: the others are empty (two fingers down use 2 of the pad's 5)
    const room = d.frames.room(count)
    const slots = this.contacts
    slots.length = 0
    for (let i = 0; i < d.slots.length && slots.length < room; i++) {
      const s = d.slots[i]
      const x = this.value(d, r, PAGE_DESKTOP, s.link, U_X)
      const y = this.value(d, r, PAGE_DESKTOP, s.link, U_Y)
      if (x === null || y === null) continue
      this.usageLen[0] = this.usages.length
      let tip = false
      if (
        this.a.getUsages(
          HIDP_INPUT,
          PAGE_DIGITIZER,
          s.link,
          this.usages,
          this.usageLen,
          d.prep,
          r,
          r.length
        ) === HIDP_OK
      )
        for (let u = 0; u < this.usageLen[0]; u++) if (this.usages[u] === U_TIP) tip = true
      slots.push({
        id: this.value(d, r, PAGE_DIGITIZER, s.link, U_CONTACT_ID) ?? s.link,
        tip,
        x: (x - s.x.min) * s.x.mm,
        y: (y - s.y.min) * s.y.mm
      })
    }
    // when the pad took this report (its own clock, even), else when main read it
    const t = d.clock.time(this.value(d, r, PAGE_DIGITIZER, d.countLink, U_SCAN_TIME), at)
    const f = d.frames.feed(count, slots)
    if (!f) return
    // only two-finger motion matters, plus the frame where the fingers come off
    if (f.fingers < 2 && this.lastFingers < 2) return
    this.lastFingers = f.fingers
    if (this.board && !this.board.isDestroyed())
      this.board.send('canvas:touchpad', f.dx, f.dy, f.fingers, f.y, t)
    else if (this.nav) this.nav({ ...f, padW: d.slots[0].x.span })
  }

  private lastFingers = 0
}

const readers = new Map<BrowserWindow, Reader>()

function readerFor(win: BrowserWindow): Reader | null {
  if (process.platform !== 'win32' || win.isDestroyed()) return null
  let r = readers.get(win)
  if (r) return r
  const a = load()
  if (!a) return null
  r = new Reader(a, win)
  readers.set(win, r)
  win.once('closed', () => readers.delete(win))
  return r
}

/** The tab view's swipes in this window: frames go to `nav` while the board is not open; null turns them off. */
export function setTouchpadNav(win: BrowserWindow, nav: ((f: TouchFrame) => void) | null): boolean {
  const r = nav ? readerFor(win) : readers.get(win)
  if (!r) return false
  r.nav = nav
  try {
    return r.sync()
  } catch (err) {
    console.warn('touchpad: could not start', err)
    return false
  }
}

const watched = new WeakSet<WebContents>()

/** `canvas:touchpad` (true/false) from a board; replies whether raw frames will come. */
export function registerTouchpad(): void {
  ipcMain.handle('canvas:touchpad', (e, on: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return false
    const r = on === true ? readerFor(win) : readers.get(win)
    if (!r) return false
    const page = e.sender
    r.board = on === true ? page : r.board === page ? null : r.board
    if (on === true && !watched.has(page)) {
      watched.add(page)
      page.once('destroyed', () => {
        if (r.board !== page) return
        r.board = null
        try {
          r.sync()
        } catch {
          /* window already gone */
        }
      })
    }
    return r.sync() && r.board === page
  })
}
