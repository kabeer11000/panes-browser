/**
 * Reading the open tabs of another browser from its session files: Chromium's SNSS command log and Firefox's
 * mozLz4-compressed sessionstore. Pure and defensive: a damaged or unexpected file gives fewer tabs, never an
 * exception, as these formats are private to each browser and change without notice.
 */

export interface SessionTab {
  url: string
  title: string
  pinned: boolean
}

/** At most this many tabs come over from one profile: a hoard of thousands would bury the sidebar. */
export const MAX_SESSION_TABS = 200

/** Only web pages: a browser's own pages (chrome://, edge://, about:), extensions, devtools and files stay behind. */
const isWeb = (url: string): boolean => /^https?:\/\//i.test(url)

// Command ids from Chromium's components/sessions/core/session_service_commands.cc.
const SET_TAB_WINDOW = 0
const SET_TAB_INDEX_IN_WINDOW = 2
const NAV_PRUNED_FROM_BACK = 5
const UPDATE_TAB_NAVIGATION = 6
const SET_SELECTED_NAVIGATION_INDEX = 7
const SET_WINDOW_TYPE = 9
const NAV_PRUNED_FROM_FRONT = 11
const SET_PINNED_STATE = 12
const TAB_CLOSED = 16
const WINDOW_CLOSED = 17
const NAV_PRUNED = 24

/** Window types other than this (popups, apps, devtools) are not windows of tabs. */
const WINDOW_TYPE_NORMAL = 0

interface Nav {
  url: string
  title: string
}

interface TabState {
  window: number
  index: number
  selected: number
  pinned: boolean
  navs: Map<number, Nav>
}

/** A little-endian reader over one record that answers null past its end instead of throwing. */
class Reader {
  constructor(
    private v: DataView,
    public at: number,
    private end: number
  ) {}
  int(): number | null {
    if (this.at + 4 > this.end) return null
    const n = this.v.getInt32(this.at, true)
    this.at += 4
    return n
  }
  /** A pickled byte string: int32 length, the bytes, then padding to 4. */
  bytes(unit: 1 | 2): Uint8Array | null {
    const len = this.int()
    if (len === null || len < 0) return null
    const size = len * unit
    if (this.at + size > this.end) return null
    const out = new Uint8Array(this.v.buffer, this.v.byteOffset + this.at, size)
    this.at += (size + 3) & ~3
    return out
  }
}

const utf8 = new TextDecoder('utf-8')
const utf16 = new TextDecoder('utf-16le')

/**
 * The tabs of the windows still open in a Chromium session file (`Sessions/Session_*`, or the older
 * `Current Session`), in window and tab order, each at the page it was showing.
 *
 * The file is "SNSS", an int32 version, then records of uint16 size, uint8 command id and size - 1 bytes of
 * payload. It is a log: the state as it was when the file was started, then every change since, so the
 * commands are replayed in order. Versions 2 and 4 are encrypted and give nothing.
 */
export function chromiumSessionTabs(file: Uint8Array, max = MAX_SESSION_TABS): SessionTab[] {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength)
  if (file.length < 8 || utf8.decode(file.subarray(0, 4)) !== 'SNSS') return []
  const version = v.getInt32(4, true)
  if (version !== 1 && version !== 3) return []

  const tabs = new Map<number, TabState>()
  const windowOrder: number[] = []
  const closedWindows = new Set<number>()
  const otherWindows = new Set<number>()
  const tab = (id: number): TabState => {
    let t = tabs.get(id)
    if (!t) {
      t = { window: -1, index: 0, selected: -1, pinned: false, navs: new Map() }
      tabs.set(id, t)
    }
    return t
  }

  let at = 8
  while (at + 2 <= file.length) {
    const size = v.getUint16(at, true)
    const start = at + 2
    at = start + size
    if (size < 1 || at > file.length) break // a record cut off by a crash ends the log
    const cmd = file[start]
    const r = new Reader(v, start + 1, at)
    try {
      switch (cmd) {
        case SET_TAB_WINDOW: {
          const win = r.int()
          const id = r.int()
          if (win === null || id === null) break
          tab(id).window = win
          if (!windowOrder.includes(win)) windowOrder.push(win)
          break
        }
        case SET_TAB_INDEX_IN_WINDOW: {
          const id = r.int()
          const index = r.int()
          if (id !== null && index !== null) tab(id).index = index
          break
        }
        case SET_SELECTED_NAVIGATION_INDEX: {
          const id = r.int()
          const index = r.int()
          if (id !== null && index !== null) tab(id).selected = index
          break
        }
        case SET_PINNED_STATE: {
          const id = r.int()
          if (id !== null && r.at < at) tab(id).pinned = file[r.at] !== 0
          break
        }
        case SET_WINDOW_TYPE: {
          const win = r.int()
          const type = r.int()
          if (win === null || type === null) break
          if (type === WINDOW_TYPE_NORMAL) otherWindows.delete(win)
          else otherWindows.add(win)
          break
        }
        case TAB_CLOSED: {
          const id = r.int()
          if (id !== null) tabs.delete(id)
          break
        }
        case WINDOW_CLOSED: {
          const win = r.int()
          if (win !== null) closedWindows.add(win)
          break
        }
        case UPDATE_TAB_NAVIGATION: {
          // a base::Pickle: uint32 payload size, then tab id, navigation index, url, title, ...
          r.at += 4
          const id = r.int()
          const index = r.int()
          const url = r.bytes(1)
          const title = r.bytes(2)
          if (id === null || index === null || !url) break
          tab(id).navs.set(index, {
            url: utf8.decode(url),
            title: title ? utf16.decode(title) : ''
          })
          break
        }
        case NAV_PRUNED_FROM_BACK: {
          // every navigation from `index` on is gone
          const id = r.int()
          const index = r.int()
          const t = id === null ? undefined : tabs.get(id)
          if (t && index !== null)
            for (const k of [...t.navs.keys()]) if (k >= index) t.navs.delete(k)
          break
        }
        case NAV_PRUNED_FROM_FRONT: {
          // the first `count` are gone and the rest move down
          const id = r.int()
          const count = r.int()
          const t = id === null ? undefined : tabs.get(id)
          if (t && count !== null && count > 0) {
            t.navs = shiftNavs(t.navs, 0, count)
            t.selected = shiftSelected(t.selected, 0, count)
          }
          break
        }
        case NAV_PRUNED: {
          const id = r.int()
          const index = r.int()
          const count = r.int()
          const t = id === null ? undefined : tabs.get(id)
          if (t && index !== null && count !== null && count > 0) {
            t.navs = shiftNavs(t.navs, index, count)
            t.selected = shiftSelected(t.selected, index, count)
          }
          break
        }
      }
    } catch {
      // one bad record is skipped; the rest of the log still counts
    }
  }

  const out: SessionTab[] = []
  for (const win of windowOrder) {
    if (closedWindows.has(win) || otherWindows.has(win)) continue
    const inWindow = [...tabs.values()]
      .filter((t) => t.window === win)
      .sort((a, b) => a.index - b.index)
    for (const t of inWindow) {
      const nav = t.navs.get(t.selected) ?? newestNav(t.navs)
      if (!nav || !isWeb(nav.url)) continue
      out.push({ url: nav.url, title: nav.title, pinned: t.pinned })
      if (out.length >= max) return out
    }
  }
  return out
}

/** Navigations with `count` of them removed at `from`, the later ones renumbered down to close the gap. */
function shiftNavs(navs: Map<number, Nav>, from: number, count: number): Map<number, Nav> {
  const out = new Map<number, Nav>()
  for (const [k, nav] of navs) {
    if (k < from) out.set(k, nav)
    else if (k >= from + count) out.set(k - count, nav)
  }
  return out
}

/**
 * The selected navigation once `count` are removed at `from`: a later one moves down with the rest, and one that
 * was removed lands where the gap closed (as Chromium does).
 */
export function shiftSelected(selected: number, from: number, count: number): number {
  if (selected < from) return selected
  if (selected >= from + count) return selected - count
  return from
}

function newestNav(navs: Map<number, Nav>): Nav | undefined {
  let best = -Infinity
  for (const k of navs.keys()) best = Math.max(best, k)
  return navs.get(best)
}

/** The newest session file among a Chromium profile's `Sessions` folder entries (`Session_<time>`). */
export function newestChromiumSession(names: string[]): string | null {
  let best: string | null = null
  let bestTime = -1n
  for (const name of names) {
    const m = /^Session_(\d+)$/.exec(name)
    if (!m) continue
    const time = BigInt(m[1])
    if (time > bestTime) {
      bestTime = time
      best = name
    }
  }
  return best
}

/**
 * An LZ4 block (no frame) decompressed into exactly `size` bytes, or null when it is malformed. Sequences are a
 * token (literal length high nibble, match length low nibble, 15 meaning "more bytes follow"), the literals, then
 * a 2-byte little-endian offset back into the output and the match, at least 4 bytes long.
 */
export function lz4Block(src: Uint8Array, size: number): Uint8Array | null {
  if (size < 0 || size > 512 * 1024 * 1024) return null
  const out = new Uint8Array(size)
  let i = 0
  let o = 0
  const length = (base: number): number | null => {
    let n = base
    if (base === 15) {
      for (;;) {
        if (i >= src.length) return null
        const b = src[i++]
        n += b
        if (b !== 255) break
      }
    }
    return n
  }
  while (i < src.length) {
    const token = src[i++]
    const lit = length(token >> 4)
    if (lit === null || i + lit > src.length || o + lit > size) return null
    out.set(src.subarray(i, i + lit), o)
    i += lit
    o += lit
    if (i >= src.length) break // the last sequence is literals only
    if (i + 2 > src.length) return null
    const offset = src[i] | (src[i + 1] << 8)
    i += 2
    const more = length(token & 15)
    if (more === null || offset === 0 || offset > o) return null
    const len = more + 4
    if (o + len > size) return null
    // byte by byte: a match may overlap the bytes it is producing (a repeated run)
    for (let k = 0; k < len; k++, o++) out[o] = out[o - offset]
  }
  return o === size ? out : null
}

/** Firefox's mozLz4 files (sessionstore.jsonlz4 and friends): "mozLz40\0", uint32 LE size, an LZ4 block. */
export function mozLz4(file: Uint8Array): Uint8Array | null {
  if (file.length < 12) return null
  for (let k = 0; k < 8; k++) if (file[k] !== 'mozLz40\0'.charCodeAt(k)) return null
  const size = new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(8, true)
  return lz4Block(file.subarray(12), size)
}

interface FirefoxEntry {
  url?: unknown
  title?: unknown
}
interface FirefoxTab {
  entries?: FirefoxEntry[]
  index?: unknown
  pinned?: unknown
}
interface FirefoxSession {
  windows?: Array<{ tabs?: FirefoxTab[]; isPopup?: unknown }>
}

/** The tabs of the open windows in a Firefox `sessionstore.jsonlz4` / `recovery.jsonlz4`, each at its current page. */
export function firefoxSessionTabs(file: Uint8Array, max = MAX_SESSION_TABS): SessionTab[] {
  return readFirefoxSession(file, max) ?? []
}

/**
 * A Firefox profile's session files, relative to the profile, in the order Firefox itself reads them: a clean
 * shutdown writes `sessionstore.jsonlz4` and removes the recovery files, so it exists only while Firefox is closed
 * and is then the newest; while Firefox runs, the recovery store and its backup are the live session.
 * `previous.jsonlz4` is the session before last, the final fallback.
 */
export const FIREFOX_SESSION_FILES: readonly string[] = [
  'sessionstore.jsonlz4',
  'sessionstore-backups/recovery.jsonlz4',
  'sessionstore-backups/recovery.baklz4',
  'sessionstore-backups/previous.jsonlz4'
]

/** As firefoxSessionTabs, but null when the file is no readable session at all, so the next file is tried. */
export function readFirefoxSession(file: Uint8Array, max = MAX_SESSION_TABS): SessionTab[] | null {
  const raw = mozLz4(file)
  if (!raw) return null
  let session: FirefoxSession
  try {
    session = JSON.parse(utf8.decode(raw)) as FirefoxSession
  } catch {
    return null
  }
  const out: SessionTab[] = []
  for (const w of Array.isArray(session.windows) ? session.windows : []) {
    if (!w || w.isPopup === true) continue
    for (const t of Array.isArray(w.tabs) ? w.tabs : []) {
      const entries = Array.isArray(t?.entries) ? t.entries : []
      if (!entries.length) continue
      // index is 1-based; a missing or odd one means the newest entry
      const at = typeof t.index === 'number' ? t.index - 1 : entries.length - 1
      const e = entries[Math.min(Math.max(at, 0), entries.length - 1)]
      const url = typeof e?.url === 'string' ? e.url : ''
      if (!isWeb(url)) continue
      out.push({
        url,
        title: typeof e.title === 'string' ? e.title : '',
        pinned: t.pinned === true
      })
      if (out.length >= max) return out
    }
  }
  return out
}
