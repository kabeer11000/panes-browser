import { useEffect, useState } from 'react'
import type { MenuApi, MenuShow } from '@shared/types'
import { ContextMenu } from '@renderer/canvas/ContextMenu'

declare global {
  interface Window {
    menuHost: MenuApi
  }
}

/** The menu view (main/menuFloat.ts): the board's own menu, over the whole window. */
export function MenuHost(): React.JSX.Element {
  const [menu, setMenu] = useState<MenuShow | null>(null)
  // bumped when main drops the menu (the window resized): a new host, so the old menu leaves without its animation,
  // which a hidden view never plays out (it played on the next menu's opening instead)
  const [drops, setDrops] = useState(0)
  useEffect(
    () =>
      window.menuHost.onShow((m) => {
        if (!m) setDrops((n) => n + 1)
        setMenu(m)
      }),
    []
  )
  if (!menu) return <div key={drops} className="cv menu-host" />
  const { seq } = menu
  return (
    <div key={drops} className="cv menu-host">
      <ContextMenu
        key={seq}
        x={menu.x}
        y={menu.y}
        title={menu.title}
        up={menu.up}
        closeOnResize={false}
        items={menu.items}
        onPick={(id) => window.menuHost.pick(seq, id)}
        onClose={() => {
          setMenu((m) => (m?.seq === seq ? null : m))
          // after the pick, which the menu reports just after closing: the click runs before the caller hears it closed
          queueMicrotask(() => window.menuHost.close(seq))
        }}
      />
    </div>
  )
}
