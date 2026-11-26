import { useReorder } from '@renderer/hooks/useReorder'
import { motion } from 'motion/react'
import { useCallback, useRef, useState } from 'react'
import type { Space } from '@shared/types'
import { attentionLabel, badgeText } from '@shared/attention'
import { useSpaceMarks } from '@renderer/hooks/useSpaceAudio'
import { SpaceAvatar } from '@renderer/components/SpaceAvatar'
import { SpacePopover } from '@renderer/components/SpacePopover'
import { Presence } from '@renderer/components/Presence'
import { GripIcon, PlusIcon } from '@renderer/components/icons'
import { useGlider } from '@renderer/hooks/useGlider'
import { useOverlayHold } from '@renderer/overlay'
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
  useOverlayHold('board-spaces', open || edited !== undefined)

  // drag a space up or down the list to put it elsewhere (useReorder), as in the sidebar
  const {
    ordered: orderedSpaces,
    dragging,
    handlers: reorder
  } = useReorder(spaces, window.api.moveSpace)

  // the highlight is one pill gliding to the row under the pointer (or the keys), as in every other Panes menu;
  // it stands aside while a space is dragged (the dragged row is lifted instead)
  const menu = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLSpanElement>(null)
  const [lit, setLit] = useState<string | null>(null)
  useGlider(
    menu,
    pill,
    `[data-hl="${lit ?? ''}"]`,
    `${lit}|${orderedSpaces.map((s) => s.id).join()}`,
    lit === null || dragging !== null
  )
  const light = (
    key: string
  ): Pick<React.HTMLAttributes<HTMLElement>, 'onPointerEnter' | 'onFocus'> & {
    'data-hl': string
  } => ({ 'data-hl': key, onPointerEnter: () => setLit(key), onFocus: () => setLit(key) })

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
      <Presence>
        {open && (
          <div
            className={'cv-space-menu' + (dragging !== null ? ' reordering' : '')}
            role="menu"
            aria-label="Spaces"
            ref={menu}
            onPointerLeave={() => setLit(null)}
          >
            <span className="cv-space-pill" ref={pill} aria-hidden="true" />
            {orderedSpaces.map((s, i) => {
              const on = s.id === activeSpaceId
              const waiting = on ? undefined : spaceAttention[s.id]
              const sound = spaceAudio[s.id]
              return (
                <motion.button
                  key={s.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  className={
                    'cv-space-item' + (on ? ' on' : '') + (dragging === s.id ? ' dragging' : '')
                  }
                  // the others slide aside as the order changes; the dragged one follows the pointer instead
                  layout={dragging !== s.id}
                  transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                  {...reorder(s.id)}
                  {...light(String(s.id))}
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
                  {/* drag to put it elsewhere: the grip shows on hover, the whole row can be dragged */}
                  <span className="cv-space-grip" aria-hidden="true">
                    <GripIcon />
                  </span>
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
                </motion.button>
              )
            })}
            <div className="cv-space-sep" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="cv-space-item plain"
              {...light('new')}
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
              {...light('settings')}
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
      </Presence>
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
