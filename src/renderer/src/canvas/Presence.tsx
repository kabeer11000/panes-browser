import type { SharePerson } from '@shared/types'
import { Face } from '@renderer/components/ShareSection'

/**
 * The others in a shared space, on the board: each one's pointer as an arrow with their name, where they are on the
 * board (board coordinates, so they pan and zoom with it, at the same size on screen whatever the zoom).
 */
export function RemoteCursors({ people }: { people: SharePerson[] }): React.JSX.Element {
  return (
    <>
      {people.map((p) =>
        p.cursor ? (
          <div
            key={p.id}
            className="cv-rcursor"
            style={{ left: p.cursor.x, top: p.cursor.y, '--c': p.color } as React.CSSProperties}
            aria-hidden="true"
          >
            <svg width="16" height="20" viewBox="0 0 16 20">
              <path d="M1 1 L1 16 L5 12 L8 19 L11 17.6 L8 11 L14 11 Z" />
            </svg>
            <span>{p.name}</span>
          </div>
        ) : null
      )}
    </>
  )
}

/** Who is in a shared space, as faces beside the space switcher (nothing when it is not shared). */
export function PresenceFaces({ people }: { people: SharePerson[] }): React.JSX.Element | null {
  if (people.length === 0) return null
  const shown = people.slice(0, 4)
  return (
    <div className="cv-faces" aria-label={`${people.length} more here`}>
      {shown.map((p) => (
        <Face key={p.id} name={p.name} color={p.color} size={24} />
      ))}
      {people.length > shown.length && <span className="cv-faces-more">+{people.length - shown.length}</span>}
    </div>
  )
}
