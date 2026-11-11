import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import {
  clipText,
  nextClip,
  resolvePaste,
  type Clip,
  type ClipAction,
  type ClipEntry,
  type PasteWhat
} from '@shared/tabClip'
import type { TabInfo } from '@shared/types'

/**
 * The one held cut or copy of tabs, shared by the sidebar and the board (they live in the same window). What is cut
 * shows dimmed wherever it is drawn: sidebar rows (`data-tab-id`), board cards (`data-cid`) and notes (`data-nid`, on
 * the board of the space it was cut in, which the board marks with `data-board`).
 */
let clip: Clip | null = null
const subs = new Set<() => void>()

export const getClip = (): Clip | null => clip

export function dispatchClip(a: ClipAction): void {
  const next = nextClip(clip, a)
  if (next === clip) return
  clip = next
  paintCut()
  subs.forEach((f) => f())
}

const subscribe = (f: () => void): (() => void) => {
  subs.add(f)
  return () => subs.delete(f)
}
export const useClip = (): Clip | null => useSyncExternalStore(subscribe, getClip)

function paintCut(): void {
  let el = document.getElementById('tab-clip-cut')
  if (!el) {
    el = document.createElement('style')
    el.id = 'tab-clip-cut'
    document.head.append(el)
  }
  const c = clip?.mode === 'cut' ? clip : null
  const sel = (c?.entries ?? []).map((e) =>
    e.kind === 'tab'
      ? `[data-tab-id="${e.id}"],[data-cid="${e.id}"]`
      : e.kind === 'item'
        ? `[data-board="${c!.space}"] [data-cid="${e.id}"]`
        : `[data-board="${c!.space}"] [data-nid="${e.note.id}"]`
  )
  // filter, not opacity: cards and rows animate their own opacity
  el.textContent = sel.length ? `${sel.join(',')}{filter:opacity(0.45)}` : ''
}

/** Hold these and put their addresses on the system clipboard (plain lines, and links for rich text). */
export function copyEntries(mode: 'copy' | 'cut', space: number, entries: ClipEntry[]): void {
  if (entries.length === 0) return
  dispatchClip({ type: mode, space, entries })
  const { text, html } = clipText(entries)
  void navigator.clipboard
    .write([
      new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' })
      })
    ])
    .catch(() => navigator.clipboard.writeText(text).catch(() => undefined))
}

/** The system clipboard's text, or null when it cannot be read (then what is held is pasted). */
export const readSystemText = (): Promise<string | null> =>
  navigator.clipboard.readText().catch(() => null)

export const isEditable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** Cut, copy and paste keys belong to text: a field has focus or some text is selected. */
export const textOwnsKeys = (t: EventTarget | null): boolean =>
  isEditable(t) || isEditable(document.activeElement) || !!window.getSelection()?.toString()

const tabEntry = (t: TabInfo): ClipEntry => ({ kind: 'tab', id: t.id, url: t.url, title: t.title })

/**
 * Sidebar Ctrl+C / Ctrl+X / Ctrl+V: the picked tabs (else the active one) are held; a paste puts copies, or the cut
 * tabs themselves (from any space), after the active tab and in its group. Addresses copied elsewhere open as tabs
 * there. Keys only reach here when the window's own UI has focus, never a page.
 */
export function useSidebarClip(o: {
  tabs: TabInfo[]
  activeId: number | null
  picked: ReadonlySet<number>
  spaceId: number
  /** Another view is up (the board has its own keys, the stack and grid none). */
  off: boolean
}): void {
  const ref = useRef(o)
  useLayoutEffect(() => {
    ref.current = o
  })
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      const { tabs, activeId, picked, spaceId, off } = ref.current
      if (off) return
      if (e.key === 'Escape') {
        if (getClip()?.mode === 'cut') dispatchClip({ type: 'escape' })
        return
      }
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || textOwnsKeys(e.target)) return
      const k = e.key.toLowerCase()
      if (k !== 'c' && k !== 'x') return
      const chosen = picked.size > 0 ? tabs.filter((t) => picked.has(t.id)) : tabs.filter((t) => t.id === activeId)
      if (chosen.length === 0) return
      e.preventDefault()
      copyEntries(k === 'x' ? 'cut' : 'copy', spaceId, chosen.map(tabEntry))
    }
    const paste = (e: ClipboardEvent): void => {
      if (ref.current.off || isEditable(e.target)) return
      const what = resolvePaste(getClip(), e.clipboardData?.getData('text/plain') ?? '')
      if (what.kind === 'none') return
      e.preventDefault()
      void pasteInSidebar(what, ref.current)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('paste', paste)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('paste', paste)
    }
  }, [])
}

async function pasteInSidebar(
  what: Exclude<PasteWhat, { kind: 'none' }>,
  o: { tabs: TabInfo[]; activeId: number | null; spaceId: number }
): Promise<void> {
  const { tabs, activeId, spaceId } = o
  const active = tabs.find((t) => t.id === activeId)
  const index = active ? tabs.indexOf(active) + 1 : tabs.length
  let ids: number[]
  if (what.kind === 'urls') ids = await window.api.openTabs(what.urls, spaceId)
  else {
    const c = what.clip
    const tabIds = c.entries.flatMap((e) => (e.kind === 'tab' ? [e.id] : []))
    // board cards that are not tabs open as tabs; notes have no tab
    const urls = c.entries.flatMap((e) =>
      e.kind === 'item' && /^https?:/i.test(e.item.url) ? [e.item.url] : []
    )
    if (c.mode === 'cut') {
      if (c.space !== spaceId) for (const id of tabIds) window.api.moveTabToSpace(id, spaceId)
      ids = tabIds
    } else {
      ids = (await window.api.duplicateTabs(tabIds, spaceId)).filter((i): i is number => i !== null)
    }
    if (urls.length) ids = [...ids, ...(await window.api.openTabs(urls, spaceId))]
    dispatchClip({ type: 'pasted' })
  }
  if (ids.length) window.api.moveTabs(ids, index, active?.groupId ?? null)
}
