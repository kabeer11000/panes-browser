/** A saved set of tabs: what was open at one moment, to open again or send on. */
export interface DumpTab {
  url: string
  title: string
  favicon: string | null
}

export interface TabDump {
  id: number
  name: string
  time: number
  tabs: DumpTab[]
}

export const MAX_DUMPS = 200
export const MAX_DUMP_TABS = 500
const MAILTO_LIMIT = 1800 // mail clients truncate or refuse longer links

/** "Tabs, 29 Oct 2026, 15:40": names a dump until the user renames it. */
export function dumpName(time: number): string {
  const d = new Date(time)
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const clock = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `Tabs, ${date}, ${clock}`
}

/** Only pages that can be opened again, once each, in order. */
export function dumpableTabs(tabs: readonly DumpTab[]): DumpTab[] {
  const seen = new Set<string>()
  const out: DumpTab[] = []
  for (const t of tabs) {
    if (!/^(https?|file):/i.test(t.url) || seen.has(t.url)) continue
    seen.add(t.url)
    out.push({ url: t.url, title: t.title || t.url, favicon: t.favicon })
    if (out.length >= MAX_DUMP_TABS) break
  }
  return out
}

/** The dump as plain text, one page per pair of lines: for the clipboard or the body of an email. */
export function dumpText(dump: TabDump): string {
  return [
    dump.name,
    '',
    ...dump.tabs.map((t) => (t.title === t.url ? t.url : `${t.title}\n${t.url}`))
  ]
    .join('\n')
    .trim()
}

/**
 * A mailto: link carrying the dump, or null when it would be too long for mail clients to take
 * (the caller then falls back to copying the text).
 */
export function dumpMailto(dump: TabDump): string | null {
  const link = `mailto:?subject=${encodeURIComponent(dump.name)}&body=${encodeURIComponent(dumpText(dump))}`
  return link.length <= MAILTO_LIMIT ? link : null
}

/** A name typed by the user (arrives over IPC, so untrusted): trimmed and capped, or the fallback. */
export function sanitizeName(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 80) : fallback
}
