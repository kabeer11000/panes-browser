import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { boundsOf, cardBox, type Box, type CanvasState } from '@shared/ai/canvas'
import { itemFor } from '@shared/ai/canvasItems'
import {
  layoutBoxes,
  pasteOffset,
  pasteOnBoard,
  placeCards,
  removeFromBoard,
  resolvePaste,
  restoreOnBoard,
  type Clip,
  type ClipEntry
} from '@shared/tabClip'
import type { TabInfo } from '@shared/types'
import { copyEntries, dispatchClip, getClip, readSystemText, useClip } from '@renderer/tabClip'

type Pt = { x: number; y: number }

export interface BoardClipDeps {
  spaceId: number
  root: RefObject<HTMLDivElement | null>
  st: CanvasState | null
  stRef: RefObject<CanvasState | null>
  edit: (fn: (s: CanvasState) => CanvasState, o?: { flip?: boolean }) => boolean
  /** An undo step for the board as it is now; `revert` also runs on undo (closes or moves back tabs). */
  record: (label: string, state: CanvasState, merge?: boolean, revert?: () => void) => void
  selRef: RefObject<Set<string>>
  setSel: (s: Set<string>) => void
  byId: Map<number, TabInfo>
  toastNow: (text: string) => void
}

export interface BoardClip {
  /** Ctrl+C / Ctrl+X: hold the selected cards and notes. False when nothing of that kind is selected. */
  copy: (cut: boolean) => boolean
  /** Ctrl+D: copies of the selected cards and notes beside them. False when nothing of that kind is selected. */
  duplicate: () => boolean
  /** Ctrl+V or a menu's Paste: what is held (or addresses copied elsewhere) centred on `at` (board units). */
  pasteAt: (at: Pt) => Promise<boolean>
  /** The board's paste event: true when it was ours (held things, or a list of several addresses). */
  onPaste: (text: string, at: Pt) => boolean
  /** Something is held to paste (addresses copied elsewhere also paste, but cannot be known without reading). */
  canPaste: boolean
}

const plural = (n: number, one: string): string => (n === 1 ? `1 ${one}` : `${n} ${one}s`)

/** Cut, copy, duplicate and paste on the board. The pure parts are in shared/tabClip.ts. */
export function useBoardClip(d: BoardClipDeps): BoardClip {
  const ref = useRef(d)
  useLayoutEffect(() => {
    ref.current = d
  })
  const held = useClip()

  // notes and items cut here are dimmed only on this space's board (their ids are per board)
  useEffect(() => {
    d.root.current?.setAttribute('data-board', String(d.spaceId))
  }, [d.root, d.spaceId])

  // tab copies arrive as cards a moment after they are made: each is put at its place when its card shows up
  const pending = useRef<{ targets: Array<{ id: number } & Pt>; at: Pt; t: number } | null>(null)
  useEffect(() => {
    const p = pending.current
    if (!p || !d.st) return
    if (Date.now() - p.t > 8000) {
      pending.current = null
      return
    }
    const st = d.st
    const here = p.targets.filter((t) => st.cards.some((c) => c.id === t.id))
    if (here.length === 0) return
    pending.current = { ...p, targets: p.targets.filter((t) => !here.includes(t)) }
    if (pending.current.targets.length === 0) pending.current = null
    d.edit((s) => placeCards(s, here, p.at), { flip: true })
  })

  // made once (its functions read the latest board through `ref` when they run)
  const [api] = useState<BoardClip>(() => {
    const selected = (): ClipEntry[] => {
      const { stRef, selRef, byId } = ref.current
      const s = stRef.current
      if (!s) return []
      const out: ClipEntry[] = []
      for (const k of selRef.current) {
        if (k.startsWith('n:')) {
          const note = s.notes.find((n) => n.id === k.slice(2))
          if (note) out.push({ kind: 'note', note })
        } else if (k.startsWith('c:')) {
          const card = s.cards.find((c) => String(c.id) === k.slice(2))
          if (!card) continue
          if (card.id >= 0) {
            const t = byId.get(card.id)
            out.push({
              kind: 'tab',
              id: card.id,
              url: t?.url ?? card.url,
              title: t?.title ?? '',
              box: cardBox(card)
            })
          } else {
            const item = s.items[String(card.id)]
            if (item) out.push({ kind: 'item', id: card.id, item, box: cardBox(card) })
          }
        }
      }
      return out
    }
    /** Where each thing is now on this board, else where it was when held; tabs from the sidebar have no place. */
    const boxOf = (s: CanvasState, e: ClipEntry, here: boolean): Box | undefined => {
      if (e.kind === 'note') return (here && s.notes.find((n) => n.id === e.note.id)) || e.note
      const card = (e.kind === 'tab' || here) && s.cards.find((c) => c.id === e.id)
      return card ? cardBox(card) : e.box
    }
    const paste = async (
      clip: Clip,
      boxes: Box[],
      off: { dx: number; dy: number },
      at: Pt
    ): Promise<boolean> => {
      const { stRef, spaceId, edit, record, setSel } = ref.current
      const s = stRef.current
      if (!s) return false
      const here = clip.space === spaceId
      const cut = clip.mode === 'cut'
      const r = pasteOnBoard(s, clip.entries, boxes, off, at, cut && here)
      const reverts: Array<() => void> = []
      const n = clip.entries.length
      record(cut ? `Moved ${plural(n, 'item')}` : `Pasted ${plural(n, 'item')}`, s, false, () =>
        reverts.reverse().forEach((f) => f())
      )
      edit(() => r.state, { flip: true })
      if (cut) dispatchClip({ type: 'pasted' })
      // cut on another space's board: its notes and items leave that board (put back on undo)
      if (cut && !here && clip.entries.some((e) => e.kind !== 'tab')) {
        const src = await window.api.canvas.load(clip.space)
        const before = src?.state
        if (before) {
          window.api.canvas.save(clip.space, removeFromBoard(before, clip.entries))
          reverts.push(() => {
            void window.api.canvas.load(clip.space).then((now) => {
              if (now?.state)
                window.api.canvas.save(clip.space, restoreOnBoard(now.state, before, clip.entries))
            })
          })
        }
      }
      let ids: Array<number | null> = []
      if (r.tabs.length && (!cut || !here)) {
        const tabIds = r.tabs.map((t) => t.entry.id)
        if (cut) {
          // a tab of another space comes here; undo sends it back
          for (const id of tabIds) window.api.moveTabToSpace(id, spaceId)
          reverts.push(() => tabIds.forEach((id) => window.api.moveTabToSpace(id, clip.space)))
          ids = tabIds
        } else {
          ids = await window.api.duplicateTabs(tabIds, spaceId)
          const made = ids.filter((i): i is number => i !== null)
          reverts.push(() => made.forEach((id) => window.api.closeTab(id)))
        }
        const targets = r.tabs.flatMap((t, i) => {
          const id = ids[i]
          return id === null || id === undefined ? [] : [{ id, x: t.x, y: t.y }]
        })
        pending.current = { targets, at, t: Date.now() }
        // some may already be cards (the tab list came back first)
        ref.current.edit((s0) => placeCards(s0, targets, at), { flip: true })
      }
      const tabKeys = ids.flatMap((id) => (id === null ? [] : [`c:${id}`]))
      setSel(new Set([...r.keys, ...tabKeys]))
      return true
    }
    const pasteWhat = (
      system: string | null,
      at: Pt,
      onlyMany: boolean
    ): boolean | Promise<boolean> => {
      const s = ref.current.stRef.current
      if (!s) return false
      const what = resolvePaste(getClip(), system)
      if (what.kind === 'clip') {
        const here = what.clip.space === ref.current.spaceId
        const boxes = layoutBoxes(what.clip.entries.map((e) => boxOf(s, e, here)))
        void paste(what.clip, boxes, pasteOffset(boxes, at), at)
        return true
      }
      // one address is the board's own paste (a link card); several are laid out in a row as link cards
      if (what.kind !== 'urls' || (onlyMany && what.urls.length < 2)) return false
      const boxes = layoutBoxes(what.urls.map(() => undefined))
      const entries: ClipEntry[] = what.urls.map((u, i) => ({
        kind: 'item',
        id: 0,
        item: itemFor(u, '', { source: 'web' }),
        box: boxes[i]
      }))
      void paste(
        { mode: 'copy', space: ref.current.spaceId, entries, text: '' },
        boxes,
        pasteOffset(boxes, at),
        at
      )
      return true
    }
    return {
      copy: (cut) => {
        const entries = selected()
        if (entries.length === 0) return false
        copyEntries(cut ? 'cut' : 'copy', ref.current.spaceId, entries)
        ref.current.toastNow(`${cut ? 'Cut' : 'Copied'} ${plural(entries.length, 'item')}`)
        return true
      },
      duplicate: () => {
        const entries = selected()
        const s = ref.current.stRef.current
        if (entries.length === 0 || !s) return false
        const boxes = layoutBoxes(entries.map((e) => boxOf(s, e, true)))
        const b = boundsOf(boxes)!
        const at = { x: b.x + b.w / 2 + 32, y: b.y + b.h / 2 + 32 }
        void paste(
          { mode: 'copy', space: ref.current.spaceId, entries, text: '' },
          boxes,
          { dx: 32, dy: 32 },
          at
        )
        return true
      },
      pasteAt: async (at) => !!(await pasteWhat(await readSystemText(), at, false)),
      onPaste: (text, at) => pasteWhat(text, at, true) === true,
      canPaste: false
    }
  })
  return { ...api, canPaste: held !== null }
}
