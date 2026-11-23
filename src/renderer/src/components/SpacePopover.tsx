import { useEffect, useRef, useState } from 'react'
import { SPACE_ICONS } from '@shared/spaceicons'
import { SPACE_LOOKS } from '@shared/settings'
import type { BrowseWith, Space, SpaceMode } from '@shared/types'
import { SpaceAvatar, SpaceGlyph } from './SpaceAvatar'
import { ThemePicker } from './ThemePicker'
import { ShareSection } from './ShareSection'

const BROWSE: Array<{ value: BrowseWith | null; label: string; title: string }> = [
  { value: null, label: 'Default', title: 'As set in Settings' },
  { value: 'tabs', label: 'Tabs', title: 'Tabs in the sidebar or along the top' },
  { value: 'canvas', label: 'Canvas', title: 'The canvas board is the whole window' }
]

const MODES: Array<{ value: SpaceMode; label: string }> = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

/** The looks offered as swatches; the rest of the colours are behind Custom (the wheel). */
const SWATCHES = SPACE_LOOKS.slice(0, 6)

interface Props {
  space: Space
  canDelete: boolean
  placement?: 'up' | 'down'
  onClose: () => void
}

/**
 * Edit a space (the look picked from the mockups, #9): the space itself on top (its icon, its name, whether it is
 * shared), then grouped settings as in macOS / iOS: Sharing, Look, Browsing, and deleting last. One short card; the
 * colour wheel and the icons open in place only when asked for. Closes on Escape or an outside click.
 */
export function SpacePopover({
  space,
  canDelete,
  placement = 'up',
  onClose
}: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [confirming, setConfirming] = useState(false)
  const [icons, setIcons] = useState(false)
  const [custom, setCustom] = useState(false)
  // Text being typed; null while showing the saved name.
  const [draft, setDraft] = useState<string | null>(null)
  const update = (patch: Partial<Space>): void => window.api.updateSpace(space.id, patch)
  const look = SWATCHES.find((l) => l.color === space.color && l.color2 === space.color2)

  // The window's drag regions swallow clicks, so while this is open they stop dragging and a click on
  // the top bar reaches the outside-click handler below like a click anywhere else.
  useEffect(() => {
    document.documentElement.classList.add('popover-open')
    return () => document.documentElement.classList.remove('popover-open')
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: globalThis.PointerEvent): void => {
      const t = e.target as HTMLElement
      // Chips open this popover, so a press on one must not also close it.
      if (!ref.current?.contains(t) && !t.closest('.space-chip, .cv-space-title')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [onClose])

  const commitName = (): void => {
    const next = (draft ?? '').trim()
    if (draft !== null && next && next !== space.name) update({ name: next })
    setDraft(null)
  }

  return (
    <div
      className={'space-popover spg ' + placement}
      ref={ref}
      role="dialog"
      aria-label={`Edit ${space.name}`}
    >
      {/* the card keeps its shadow; only this inner part scrolls, so its edges can fade */}
      <div className="space-pop-scroll">
        <div className="spg-hero" style={{ ['--sc' as string]: space.color }}>
          <button
            type="button"
            className="spg-avatar"
            aria-expanded={icons}
            title="Change the icon"
            onClick={() => setIcons((v) => !v)}
          >
            <SpaceAvatar color={space.color} color2={space.color2} icon={space.icon} size={54} />
          </button>
          <input
            className="spg-name"
            value={draft ?? space.name}
            maxLength={24}
            aria-label="Space name"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              else if (e.key === 'Escape') {
                e.stopPropagation()
                setDraft(null)
              }
            }}
          />
          <span className="spg-status">
            {space.shared ? (
              <>
                <i className="spg-live" aria-hidden="true" />
                Shared
              </>
            ) : (
              'Only you'
            )}
          </span>
          {icons && (
            <div className="sid-icons spg-icons" role="radiogroup" aria-label="Space icon">
              {SPACE_ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  role="radio"
                  aria-checked={space.icon === icon}
                  aria-label={icon}
                  className={'sid-icon' + (space.icon === icon ? ' on' : '')}
                  style={{ ['--sc' as string]: space.color }}
                  onClick={() => update({ icon })}
                >
                  <SpaceGlyph icon={icon} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="spg-sect">Sharing</div>
        <div className="spg-group spg-pad">
          <ShareSection space={space} />
        </div>

        <div className="spg-sect">Look</div>
        <div className="spg-group">
          <div className="spg-row">
            <span className="spg-label">Colour</span>
            <div className="spg-swatches" role="group" aria-label="Colour">
              {SWATCHES.map((l) => (
                <button
                  key={l.name}
                  type="button"
                  title={l.name}
                  aria-label={l.name}
                  aria-pressed={look === l}
                  className={'spg-swatch' + (look === l ? ' on' : '')}
                  style={{
                    background: l.color2
                      ? `linear-gradient(135deg, ${l.color}, ${l.color2})`
                      : l.color
                  }}
                  onClick={() => update({ color: l.color, color2: l.color2 })}
                />
              ))}
              <button
                type="button"
                title="Custom colours, intensity and texture"
                aria-label="Custom colours"
                aria-expanded={custom}
                className={'spg-swatch custom' + (!look || custom ? ' on' : '')}
                onClick={() => setCustom((v) => !v)}
              />
            </div>
          </div>
          {custom && (
            <div className="spg-custom">
              <ThemePicker
                color={space.color}
                color2={space.color2}
                tint={space.tint}
                grain={space.grain}
                mode={space.mode}
                onChange={(patch) => update(patch)}
              />
            </div>
          )}
          <div className="spg-row">
            <span className="spg-label">Appearance</span>
            <div className="spg-seg" role="radiogroup" aria-label="Appearance">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={space.mode === m.value}
                  className={space.mode === m.value ? 'on' : ''}
                  onClick={() => update({ mode: m.value })}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="spg-sect">Browsing</div>
        <div className="spg-group">
          <div className="spg-row">
            <span className="spg-label">Browse with</span>
            <div className="spg-seg" role="radiogroup" aria-label="Browse with">
              {BROWSE.map((b) => (
                <button
                  key={b.label}
                  type="button"
                  role="radio"
                  aria-checked={space.browseWith === b.value}
                  title={b.title}
                  className={space.browseWith === b.value ? 'on' : ''}
                  onClick={() => update({ browseWith: b.value })}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="spg-row spg-link"
            onClick={() => {
              window.api.openInternal('settings')
              onClose()
            }}
          >
            <span className="spg-label">More settings for this space</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </div>

        {canDelete && (
          <div className="spg-group">
            <button
              type="button"
              className="spg-row spg-danger"
              onClick={() => (confirming ? window.api.deleteSpace(space.id) : setConfirming(true))}
            >
              {confirming ? 'Close its tabs and delete' : 'Delete space…'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
