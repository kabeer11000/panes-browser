import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  inTriangle,
  placeMenu,
  placeSubmenu,
  safeTriangle,
  typeAhead,
  type MenuAction,
  type MenuEntry,
  type Placed,
  type Rect
} from '@shared/menu'

export type { MenuEntry }

type Pt = { x: number; y: number }

const enabled = (e: MenuEntry | undefined): e is MenuAction => !!e && e !== 'sep' && !e.disabled
const rel = (r: DOMRect, o: DOMRect): Rect => ({
  x: r.left - o.left,
  y: r.top - o.top,
  w: r.width,
  h: r.height
})

/**
 * The board's right-click menu: what can be done with what is under the pointer. Opens at the pointer inside the
 * board (flipped at its edges, clear of the AI dock and of a live page, which draws above the page), with submenus
 * that open on hover (a safe triangle lets the pointer cross other rows on the way) and by keyboard: arrows,
 * Home/End, Enter/Space, Right/Left for submenus, a typed letter jumps, Esc closes one level. It closes on a press
 * outside, Esc, the window losing focus, a wheel over the board or a resize, and gives focus back.
 */
/** How long the pointer may rest on another row, on its way into a submenu, before that row takes over. */
const REST_MS = 260

export function ContextMenu({
  x,
  y,
  title,
  items,
  avoid = [],
  onPick,
  onClose
}: {
  /** The pointer, relative to the board. */
  x: number
  y: number
  /** What it is about (a card's title, "3 cards"), quiet at the top. */
  title?: string
  items: MenuEntry[]
  /** Boxes on the board it must not cover, relative to the board. */
  avoid?: Rect[]
  onPick: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  const levels = useRef<Array<HTMLDivElement | null>>([])
  const register = useCallback((depth: number, el: HTMLDivElement | null): void => {
    levels.current[depth] = el
  }, [])
  const levelAt = useCallback((depth: number) => levels.current[depth] ?? null, [])
  // the open submenus: path[d] is the row of level d whose submenu is open
  const [path, setPath] = useState<number[]>([])
  const pathRef = useRef(path)
  useLayoutEffect(() => {
    pathRef.current = path
  }, [path])
  // the pointer's way into the open submenu of level `depth`: while it keeps moving inside this triangle (towards
  // the submenu), the rows it crosses do not take over
  const grace = useRef<{ depth: number; tri: [Pt, Pt, Pt] } | null>(null)
  const pending = useRef<{ depth: number; i: number; timer: number } | null>(null)
  const typed = useRef({ q: '', at: 0 })

  // the entries of each open level
  const chain: MenuEntry[][] = [items]
  for (const i of path) {
    const e = chain[chain.length - 1][i]
    if (!e || e === 'sep' || !e.items) break
    chain.push(e.items)
  }

  const rows = (d: number): HTMLButtonElement[] => [
    ...(levels.current[d]?.querySelectorAll<HTMLButtonElement>('[data-i]') ?? [])
  ]
  const focusRow = (d: number, i: number): void => {
    rows(d)
      .find((b) => Number(b.dataset.i) === i)
      ?.focus({ preventScroll: false })
  }
  /** The next enabled row of level d from i in direction dir (wrapping). */
  const step = (d: number, i: number, dir: 1 | -1): number => {
    const list = chain[d]
    const n = list.length
    for (let k = 1; k <= n; k++) {
      const j = (((i + dir * k) % n) + n) % n
      if (enabled(list[j])) return j
    }
    return -1
  }
  const openSub = (d: number, i: number, focusFirst: boolean): void => {
    setPath((p) => [...p.slice(0, d), i])
    if (focusFirst) requestAnimationFrame(() => focusRow(d + 1, step(d + 1, -1, 1)))
  }
  const activate = (d: number, i: number, byKey: boolean): void => {
    const e = chain[d][i]
    if (!enabled(e)) return
    if (e.items) return openSub(d, i, byKey)
    onClose()
    onPick(e.id)
  }

  // the menu itself takes focus (no row lit up under a pointer that has not moved yet; the first arrow or letter
  // picks a row), and focus goes back where it was on close
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    levels.current[0]?.focus({ preventScroll: true })
    return () => {
      const now = document.activeElement
      if (before?.isConnected && (!now || now === document.body || wrap.current?.contains(now)))
        before.focus({ preventScroll: true })
    }
    // once, on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // keys: capture, so the board's own shortcuts never see them while the menu is open
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      const at = document.activeElement as HTMLElement | null
      const btn = at?.closest<HTMLElement>('[data-i]')
      const d = btn ? Number(btn.closest<HTMLElement>('[data-depth]')?.dataset.depth ?? 0) : 0
      const i = btn ? Number(btn.dataset.i) : -1
      const list = chain[d] ?? []
      const cur = list[i]
      if (e.key === 'Escape') {
        if (d > 0) {
          setPath((p) => p.slice(0, d - 1))
          focusRow(d - 1, pathRef.current[d - 1])
        } else onClose()
      } else if (e.key === 'ArrowDown') focusRow(d, step(d, i, 1))
      else if (e.key === 'ArrowUp') focusRow(d, step(d, i < 0 ? 0 : i, -1))
      else if (e.key === 'Home') focusRow(d, step(d, -1, 1))
      else if (e.key === 'End') focusRow(d, step(d, list.length, -1))
      else if (e.key === 'ArrowRight' && enabled(cur) && cur.items) openSub(d, i, true)
      else if (e.key === 'ArrowLeft' && d > 0) {
        setPath((p) => p.slice(0, d - 1))
        focusRow(d - 1, pathRef.current[d - 1])
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (i >= 0) activate(d, i, true)
      } else if (e.key === 'Tab') onClose()
      else if (e.ctrlKey || e.metaKey || e.altKey) {
        // a shortcut (Ctrl+Z, Ctrl+V...) is not the menu's: it closes and the key goes on
        if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) onClose()
        return
      } else if (e.key.length === 1) {
        const now = Date.now()
        typed.current = {
          q: (now - typed.current.at < 700 ? typed.current.q : '') + e.key,
          at: now
        }
        const labels = list.map((x) => (x === 'sep' ? '' : x.label))
        const off = list.map((x) => !enabled(x))
        const j = typeAhead(labels, i, typed.current.q, off)
        if (j >= 0) focusRow(d, j)
      } else if (/^F\d+$/.test(e.key)) {
        onClose()
        return
      }
      // anything else (Delete, Backspace...) is held back from the board while the menu is open
      e.preventDefault()
      e.stopPropagation()
    }
    const down = (e: PointerEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) onClose()
    }
    const wheel = (e: WheelEvent): void => {
      // a tall menu scrolls in itself; a wheel anywhere else moves the board, and the menu goes
      if (!wrap.current?.contains(e.target as Node)) onClose()
    }
    const away = (): void => onClose()
    const hidden = (): void => {
      if (document.hidden) onClose()
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('wheel', wheel, { capture: true, passive: true })
    window.addEventListener('blur', away)
    window.addEventListener('resize', away)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('wheel', wheel, { capture: true })
      window.removeEventListener('blur', away)
      window.removeEventListener('resize', away)
      document.removeEventListener('visibilitychange', hidden)
    }
  })

  // the board pans on wheel (its own listener, below this in the tree): a wheel in the menu scrolls the menu only
  useEffect(() => {
    const el = wrap.current
    const stop = (e: WheelEvent): void => e.stopPropagation()
    el?.addEventListener('wheel', stop, { passive: true })
    return () => el?.removeEventListener('wheel', stop)
  }, [])
  useEffect(() => () => window.clearTimeout(pending.current?.timer), [])

  /** The pointer is over row i of level d: it takes focus, and opens or closes submenus, unless it is only passing
   * through on its way into an open submenu. No time limit on the way: a slow hand gets there too. The triangle
   * narrows from wherever the pointer now is, so only movement towards the submenu keeps it; resting on a row
   * (REST_MS) or moving away hands over to that row. */
  const hover = (d: number, i: number, p: Pt): void => {
    const g = grace.current
    if (g && g.depth === d && pathRef.current[d] !== i && inTriangle(p, ...g.tri)) {
      // a few pixels behind the pointer, so the jitter of a hand does not count as moving away
      const back = g.tri[1].x >= p.x ? -6 : 6
      g.tri = [{ x: p.x + back, y: p.y }, g.tri[1], g.tri[2]]
      window.clearTimeout(pending.current?.timer)
      pending.current = {
        depth: d,
        i,
        timer: window.setTimeout(() => {
          const pd = pending.current
          pending.current = null
          grace.current = null
          if (pd) hover(pd.depth, pd.i, { x: -1e6, y: -1e6 })
        }, REST_MS)
      }
      return
    }
    grace.current = null
    window.clearTimeout(pending.current?.timer)
    pending.current = null
    const e = chain[d]?.[i]
    focusRow(d, i)
    if (enabled(e) && e.items) {
      if (pathRef.current[d] !== i || pathRef.current.length > d + 1) openSub(d, i, false)
    } else if (pathRef.current.length > d) setPath((p) => p.slice(0, d))
  }
  const leave = (d: number, i: number, p: Pt): void => {
    if (pending.current?.depth === d && pending.current.i === i) {
      window.clearTimeout(pending.current.timer)
      pending.current = null
    }
    const sub = levels.current[d + 1]
    const board = wrap.current?.parentElement?.getBoundingClientRect()
    if (pathRef.current[d] !== i || !sub || !board) {
      // off a plain row: nothing stays lit (the next row takes focus as the pointer reaches it)
      if (rows(d).some((b) => b === document.activeElement))
        levels.current[d]?.focus({ preventScroll: true })
      return
    }
    const r = rel(sub.getBoundingClientRect(), board)
    grace.current = { depth: d, tri: safeTriangle(p, r) }
  }

  return (
    <div className="cv-ctx-wrap" ref={wrap} onContextMenu={(e) => e.preventDefault()}>
      {chain.map((list, d) => (
        <Level
          key={d === 0 ? 'root' : `${d}:${path.slice(0, d).join('.')}`}
          depth={d}
          list={list}
          title={d === 0 ? title : undefined}
          label={
            d === 0
              ? (title ?? 'Board')
              : ((chain[d - 1][path[d - 1]] as MenuAction | undefined)?.label ?? '')
          }
          open={path[d]}
          anchor={x}
          anchorY={y}
          avoid={avoid}
          register={register}
          levelAt={levelAt}
          onRow={(i, p) => hover(d, i, p)}
          onLeave={(i, p) => leave(d, i, p)}
          onActivate={(i) => activate(d, i, false)}
        />
      ))}
    </div>
  )
}

const Check = (): React.JSX.Element => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
)
const More = (): React.JSX.Element => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m6.5 4.5 3.5 3.5-3.5 3.5" />
  </svg>
)

/** One level of the menu (the menu itself, or a submenu beside the row that opened it). */
function Level({
  depth,
  list,
  title,
  label,
  open,
  anchor,
  anchorY,
  avoid,
  register,
  levelAt,
  onRow,
  onLeave,
  onActivate
}: {
  depth: number
  list: MenuEntry[]
  title?: string
  label: string
  open: number | undefined
  anchor: number
  anchorY: number
  avoid: Rect[]
  /** Each level's element, kept by the menu for focus and the pointer's way into a submenu. */
  register: (depth: number, el: HTMLDivElement | null) => void
  levelAt: (depth: number) => HTMLDivElement | null
  onRow: (i: number, p: Pt) => void
  onLeave: (i: number, p: Pt) => void
  onActivate: (i: number) => void
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<Placed | null>(null)
  // placed before it is painted, from its own measured size: no flash at the wrong spot
  useLayoutEffect(() => {
    const el = box.current
    const board = el?.offsetParent as HTMLElement | null
    if (!el || !board) return
    const bounds = { w: board.clientWidth, h: board.clientHeight }
    const size = { w: el.offsetWidth, h: el.scrollHeight }
    if (depth === 0) return setAt(placeMenu({ x: anchor, y: anchorY }, size, bounds, avoid))
    const parent = levelAt(depth - 1)
    const row = parent?.querySelector<HTMLElement>('[aria-expanded="true"]')
    if (!parent || !row) return
    const o = board.getBoundingClientRect()
    setAt(
      placeSubmenu(
        rel(row.getBoundingClientRect(), o),
        rel(parent.getBoundingClientRect(), o),
        size,
        bounds,
        avoid
      )
    )
    // placed once per opening; the menu closes on resize
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // a column for the check mark, kept for every row of a level that has choices, so labels line up
  const lead = list.some((e) => e !== 'sep' && e.checked !== undefined)
  const pt = (e: React.PointerEvent): Pt => {
    const o = (box.current?.offsetParent as HTMLElement | null)?.getBoundingClientRect()
    return { x: e.clientX - (o?.left ?? 0), y: e.clientY - (o?.top ?? 0) }
  }
  return (
    <div
      className={'cv-ctx' + (depth ? ' sub' : '')}
      ref={(el) => {
        box.current = el
        register(depth, el)
      }}
      role="menu"
      tabIndex={-1}
      aria-label={label}
      aria-orientation="vertical"
      data-depth={depth}
      style={{
        left: at?.x ?? 0,
        top: at?.y ?? 0,
        // never painted at 0,0: the layout effect places it before the first paint (and it stays focusable)
        maxHeight: at?.maxH
      }}
    >
      {title && (
        <div className="cv-ctx-title" aria-hidden="true">
          {title}
        </div>
      )}
      {list.map((e, i) =>
        e === 'sep' ? (
          <div key={i} role="separator" className="cv-ctx-sep" />
        ) : (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            data-i={i}
            role={e.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={e.checked}
            aria-disabled={e.disabled || undefined}
            aria-haspopup={e.items ? 'menu' : undefined}
            aria-expanded={e.items ? open === i : undefined}
            aria-keyshortcuts={e.keys?.replace('Ctrl', 'Control').replace(/\bDel\b/, 'Delete')}
            className={(e.danger ? 'danger' : '') + (open === i ? ' open' : '')}
            onPointerMove={(ev) => onRow(i, pt(ev))}
            onPointerLeave={(ev) => onLeave(i, pt(ev))}
            onClick={() => onActivate(i)}
          >
            {lead && (
              <span className="cv-ctx-lead" aria-hidden="true">
                {e.checked && <Check />}
              </span>
            )}
            {e.swatch && (
              <i
                className={'cv-ctx-dot ' + (e.swatch.cls ?? '')}
                style={e.swatch.color ? { background: e.swatch.color } : undefined}
                aria-hidden="true"
              />
            )}
            <span className="cv-ctx-label">{e.label}</span>
            {e.keys && <kbd>{e.keys}</kbd>}
            {e.items && (
              <span className="cv-ctx-more" aria-hidden="true">
                <More />
              </span>
            )}
          </button>
        )
      )}
    </div>
  )
}
