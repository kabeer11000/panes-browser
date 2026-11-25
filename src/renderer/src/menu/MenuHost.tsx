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
  useEffect(() => window.menuHost.onShow(setMenu), [])
  if (!menu) return <div className="cv menu-host" />
  const { seq } = menu
  return (
    <div className="cv menu-host">
      <ContextMenu
        key={seq}
        x={menu.x}
        y={menu.y}
        title={menu.title}
        up={menu.up}
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
