import { useState } from 'react'
import type { Space } from '../../../shared/types'

/**
 * Which way the active space moved along the row: 1 when it is further right than before, -1 when
 * further left. Names and tab lists slide in from that side, so switching feels like moving along a row.
 */
export function useSpaceDir(spaces: Space[], activeSpaceId: number): number {
  const index = spaces.findIndex((s) => s.id === activeSpaceId)
  const [seen, setSeen] = useState(index)
  const [dir, setDir] = useState(1)
  if (index !== seen) {
    // adjusted while rendering, so the first frame of the new space already slides the right way
    setDir(index > seen ? 1 : -1)
    setSeen(index)
  }
  return dir
}
