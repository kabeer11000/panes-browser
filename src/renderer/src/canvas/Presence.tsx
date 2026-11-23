import type { SharePerson } from '@shared/types'

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
