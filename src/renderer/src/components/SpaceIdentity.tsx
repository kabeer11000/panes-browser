import { useState } from 'react'
import { SPACE_ICONS, type SpaceIcon } from '../../../shared/spaceicons'
import type { Space } from '../../../shared/types'
import { SpaceAvatar, SpaceGlyph } from './SpaceAvatar'

interface Props {
  space: Pick<Space, 'name' | 'color' | 'color2' | 'icon'>
  /** Called with the trimmed new name once editing ends; never with an empty one. */
  onName: (name: string) => void
  onIcon: (icon: SpaceIcon) => void
}

/** Who a space is: its avatar, its name and the glyph it wears. Shared by the sidebar popover and settings. */
export function SpaceIdentity({ space, onName, onIcon }: Props): React.JSX.Element {
  // Text being typed; null while showing the saved name.
  const [draft, setDraft] = useState<string | null>(null)
  const name = draft ?? space.name

  const commit = (): void => {
    const next = (draft ?? '').trim()
    if (draft !== null && next && next !== space.name) onName(next)
    setDraft(null)
  }

  return (
    <div className="sid">
      <div className="sid-head">
        <SpaceAvatar color={space.color} color2={space.color2} icon={space.icon} size={44} />
        <input
          className="space-name"
          value={name}
          maxLength={24}
          aria-label="Space name"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') setDraft(null)
          }}
        />
      </div>
      <div className="sid-icons" role="radiogroup" aria-label="Space icon">
        {SPACE_ICONS.map((icon) => (
          <button
            key={icon}
            type="button"
            role="radio"
            aria-checked={space.icon === icon}
            aria-label={icon}
            className={'sid-icon' + (space.icon === icon ? ' on' : '')}
            style={{ ['--sc' as string]: space.color }}
            onClick={() => onIcon(icon)}
          >
            <SpaceGlyph icon={icon} />
          </button>
        ))}
      </div>
    </div>
  )
}
