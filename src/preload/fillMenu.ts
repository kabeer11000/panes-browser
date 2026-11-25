/**
 * The list a form field offers to fill from (saved logins, addresses, cards): under the field, in the page, out of the
 * page's styles' reach (a closed shadow root). Arrows move, Enter picks, Escape closes; a press on a row picks it
 * without taking the focus from the field.
 */

const STYLE = `
:host { all: initial; }
.menu {
  font: 13px system-ui, sans-serif;
  min-width: 240px;
  max-width: 360px;
  padding: 6px;
  border-radius: 14px;
  background: #26262b;
  color: #f2f2f4;
  box-shadow: 0 0 0 1px rgb(255 255 255 / 0.1), 0 12px 32px rgb(0 0 0 / 0.4);
}
@media (prefers-color-scheme: light) {
  .menu { background: #fff; color: #1b1b1f; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.1), 0 12px 32px rgb(0 0 0 / 0.18); }
  .row:hover, .row.on { background: rgb(0 0 0 / 0.07); }
}
.row { display: flex; flex-direction: column; gap: 2px; padding: 7px 10px; border-radius: 8px; cursor: default; }
.row:hover, .row.on { background: rgb(255 255 255 / 0.1); }
.row span, .row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row small { opacity: 0.6; font-size: 11px; }
`

export interface FillMenu {
  /** The field it hangs under. */
  field: HTMLElement
  close(): void
  /** A key pressed in the field: true when the menu took it. */
  key(e: KeyboardEvent): boolean
}

export function openFillMenu(
  field: HTMLElement,
  rows: ReadonlyArray<{ label: string; sub: string }>,
  pick: (i: number) => void
): FillMenu {
  const box = field.getBoundingClientRect()
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;z-index:2147483647;left:${box.left}px;top:${box.bottom + 4}px;`
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = STYLE
  const menu = document.createElement('div')
  menu.className = 'menu'
  menu.setAttribute('role', 'listbox')
  let current = -1
  const els = rows.map((r, i) => {
    const row = document.createElement('div')
    row.className = 'row'
    row.setAttribute('role', 'option')
    const label = document.createElement('span')
    label.textContent = r.label
    row.append(label)
    if (r.sub) {
      const sub = document.createElement('small')
      sub.textContent = r.sub
      row.append(sub)
    }
    // mousedown, not click: the field keeps the focus, so the menu is not closed by its blur
    row.addEventListener('mousedown', (e) => {
      e.preventDefault()
      pick(i)
    })
    menu.append(row)
    return row
  })
  root.append(style, menu)
  document.documentElement.append(host)
  const highlight = (i: number): void => {
    current = (i + els.length) % els.length
    els.forEach((r, n) => r.classList.toggle('on', n === current))
  }
  return {
    field,
    close: () => host.remove(),
    key: (e) => {
      if (e.key === 'Escape') host.remove()
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp')
        highlight(current + (e.key === 'ArrowDown' ? 1 : -1))
      else if (e.key === 'Enter' && current >= 0) pick(current)
      else return false
      e.preventDefault()
      e.stopPropagation()
      return true
    }
  }
}
