import { useReorder } from '@renderer/hooks/useReorder'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Space } from '@shared/types'
import { attentionLabel, badgeText } from '@shared/attention'
import { useSpaceMarks } from '@renderer/hooks/useSpaceAudio'
import { SpaceAvatar } from '@renderer/components/SpaceAvatar'
import { SpacePopover } from '@renderer/components/SpacePopover'
import { Presence } from '@renderer/components/Presence'
import { PlusIcon } from '@renderer/components/icons'
import { holdOverlay, releaseOverlay } from '@renderer/overlay'
import { useDismiss } from './useDismiss'

/**
 * The board's spaces, top left (the look picked from the mockups, #8): the space's name is the board's title, with no
 * box around it. A click lists the spaces (their shortcuts, what waits in each) with New space and this space's
 * settings under them; right-click a space for its own settings. The sidebar and tab bars keep their avatar row.
 */
export function BoardSpaces({
  spaces,
  activeSpaceId
}: {
  spaces: Space[]
  activeSpaceId: number
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, host, close)
  const { spaceAudio, spaceAttention } = useSpaceMarks()
  const active = spaces.find((s) => s.id === activeSpaceId)
  const edited = spaces.find((s) => s.id === editing)
  // something waiting in another space: a dot on the title, so it is seen without opening the list
  const elsewhere = spaces.some((s) => s.id !== activeSpaceId && spaceAttention[s.id])

  // the live page is a native view over the board: while a list or the settings is open it stands aside as a picture
  const over = open || edited !== undefined
  useEffect(() => {
    if (!over) return
    void holdOverlay('board-spaces')
    return () => void releaseOverlay('board-spaces')
  }, [over])

  // drag a space up or down the list to put it elsewhere (useReorder), as in the sidebar
  const {
    ordered: orderedSpaces,
    dragging,
    handlers: reorder
  } = useReorder(spaces, window.api.moveSpace)

  return (
    <div className="cv-space-title-wrap space-switcher down" ref={host}>
      <button
        type="button"
        className={'cv-space-title no-drag' + (open ? ' on' : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Spaces"
        onClick={() => {
          setEditing(null)
          setOpen((o) => !o)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setOpen(false)
          setEditing(activeSpaceId)
        }}
      >
        {active && (
          <SpaceAvatar color={active.color} color2={active.color2} icon={active.icon} size={22} />
        )}
        <span className="cv-space-name">{active?.name ?? 'Space'}</span>
        {elsewhere && (
          <i className="cv-space-elsewhere" aria-label="Something new in another space" />
        )}
        <svg
          className="cv-space-chev"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="cv-space-menu" role="menu" aria-label="Spaces">
          {orderedSpaces.map((s, i) => {
            const on = s.id === activeSpaceId
            const waiting = on ? undefined : spaceAttention[s.id]
            const sound = spaceAudio[s.id]
            return (
              <button
                key={s.id}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                className={
                  'cv-space-item' + (on ? ' on' : '') + (dragging === s.id ? ' dragging' : '')
                }
                {...reorder(s.id)}
                title={waiting ? attentionLabel(waiting) : undefined}
                onClick={() => {
                  setOpen(false)
                  if (on) return
                  if (waiting?.callTabId != null) window.api.activateTab(waiting.callTabId)
                  else window.api.switchSpace(s.id)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setOpen(false)
                  setEditing(s.id)
                }}
              >
                <SpaceAvatar color={s.color} color2={s.color2} icon={s.icon} size={20} />
                <span className="cv-space-item-name">{s.name}</span>
                {s.shared && <span className="cv-space-item-meta">Shared</span>}
                {sound?.playing && <span className="cv-space-item-meta">Playing</span>}
                {waiting && !waiting.call && (
                  <span className="cv-space-item-attn">{badgeText(waiting.count, 9)}</span>
                )}
                {on ? (
                  <svg
                    className="cv-space-check"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m5 12 5 5 9-10" />
                  </svg>
                ) : (
                  i < 9 && <kbd>Ctrl+Alt+{i + 1}</kbd>
                )}
              </button>
            )
          })}
          <div className="cv-space-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="cv-space-item plain"
            onClick={() => {
              setOpen(false)
              window.api.createSpace()
            }}
          >
            <span className="cv-space-plus" aria-hidden="true">
              <PlusIcon />
            </span>
            New space
          </button>
          <button
            type="button"
            role="menuitem"
            className="cv-space-item plain"
            onClick={() => {
              setOpen(false)
              setEditing(activeSpaceId)
            }}
          >
            <span className="cv-space-plus" aria-hidden="true" />
            {active?.name ?? 'Space'} settings…
          </button>
        </div>
      )}
      <Presence>
        {edited && (
          <SpacePopover
            key={edited.id}
            space={edited}
            canDelete={spaces.length > 1}
            placement="down"
            onClose={() => setEditing(null)}
          />
        )}
      </Presence>
    </div>
  )
}
