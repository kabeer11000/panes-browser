/**
 * navigator.share for pages (Electron has none, so a site's Share button did nothing or threw). Run in the page's own
 * world from its source text (contextBridge.executeInMainWorld): it must not refer to anything outside itself. The
 * share sheet is Panes' own (main/index.ts: copy the link, or email it).
 */
export interface ShareData {
  title: string
  text: string
  url: string
}

/** What a page asked to share, checked (from the page's world); null when there is nothing to share. */
export function parseShareData(v: unknown): ShareData | null {
  const o = v as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const s = (x: unknown, max: number): string => (typeof x === 'string' ? x.slice(0, max) : '')
  const data = { title: s(o.title, 300), text: s(o.text, 2000), url: s(o.url, 4000) }
  if (data.url && !/^https?:\/\//i.test(data.url)) data.url = ''
  return data.url || data.text || data.title ? data : null
}

export function webShareShim(
  bridge: { share: (data: string) => Promise<boolean> },
  g: typeof globalThis = globalThis
): void {
  const nav = g.navigator as Navigator & { share?: unknown; canShare?: unknown }
  if (!nav || typeof nav.share === 'function') return
  const has = (
    d: unknown
  ): d is { title?: unknown; text?: unknown; url?: unknown; files?: unknown[] } =>
    !!d && typeof d === 'object'
  const usable = (d: unknown): boolean =>
    has(d) &&
    !(Array.isArray(d.files) && d.files.length > 0) && // files: not shared from here
    (typeof d.url === 'string' || typeof d.text === 'string' || typeof d.title === 'string')
  const abs = (u: unknown): string => {
    if (typeof u !== 'string' || !u) return ''
    try {
      return new URL(u, g.location.href).href
    } catch {
      return ''
    }
  }
  Object.defineProperty(nav, 'canShare', {
    configurable: true,
    value: (d?: unknown) => usable(d)
  })
  Object.defineProperty(nav, 'share', {
    configurable: true,
    value: (d?: unknown): Promise<void> => {
      if (!usable(d)) return Promise.reject(new TypeError('Nothing to share'))
      const act = (nav as Navigator & { userActivation?: { isActive: boolean } }).userActivation
      if (act && !act.isActive)
        return Promise.reject(
          new DOMException('Must be handling a user gesture', 'NotAllowedError')
        )
      const data = d as { title?: unknown; text?: unknown; url?: unknown }
      const out = JSON.stringify({
        title: data.title ?? '',
        text: data.text ?? '',
        url: abs(data.url)
      })
      return bridge.share(out).then((done) => {
        if (!done) throw new DOMException('Share canceled', 'AbortError')
      })
    }
  })
}
