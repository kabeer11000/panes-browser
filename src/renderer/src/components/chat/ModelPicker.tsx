import { useEffect, useRef, useState } from 'react'
import type { ChatInfo, ChatModelOption } from '@shared/types'
import { ChevronIcon } from '../icons'

/** The model chat uses: shown in the header, a menu of what is set up (and, disabled, what is not). */
export function ModelPicker({ info }: { info: ChatInfo }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const pick = (o: ChatModelOption): void => {
    if (!o.available) return
    window.api.chatSetModel(o.choice, o.chatgptModel)
    setOpen(false)
  }
  const groups: Array<{ name: string; items: ChatModelOption[] }> = []
  for (const o of info.models) {
    const g = groups.find((x) => x.name === o.group)
    if (g) g.items.push(o)
    else groups.push({ name: o.group, items: [o] })
  }

  return (
    <div
      className="chat-pick"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation() // closes the menu, not the panel
          setOpen(false)
        }
      }}
    >
      <button
        type="button"
        className="chat-pick-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose the model chat uses"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="chat-pick-label">{info.label || 'Choose a model'}</span>
        <ChevronIcon />
      </button>
      {open && (
        <div className="chat-menu" role="menu" aria-label="Model">
          {groups.map((g) => (
            <div key={g.name || 'auto'} role="group" aria-label={g.name || undefined}>
              {g.name && <div className="chat-menu-group">{g.name}</div>}
              {g.items.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={o.current}
                  aria-disabled={!o.available}
                  className={
                    'chat-menu-item' + (o.current ? ' on' : '') + (o.available ? '' : ' off')
                  }
                  onClick={() => pick(o)}
                >
                  <span className="chat-menu-check" aria-hidden="true" />
                  <span className="chat-menu-name">{o.label}</span>
                  {o.hint && <span className="chat-menu-hint">{o.hint}</span>}
                </button>
              ))}
            </div>
          ))}
          <div className="chat-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="chat-menu-item"
            onClick={() => {
              setOpen(false)
              window.api.chatAction('settings')
            }}
          >
            <span className="chat-menu-check" aria-hidden="true" />
            <span className="chat-menu-name">Manage models</span>
          </button>
        </div>
      )}
    </div>
  )
}
