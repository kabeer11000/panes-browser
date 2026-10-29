import { useEffect, useState } from 'react'
import type { TabsState } from '../../../shared/types'

type SpaceMarks = Pick<TabsState, 'spaceAudio' | 'spaceAttention'>

/** What each space has going on, for the marks on their avatars: sound playing or muted, and what waits there. */
export function useSpaceMarks(): SpaceMarks {
  const [marks, setMarks] = useState<SpaceMarks>({ spaceAudio: {}, spaceAttention: {} })
  useEffect(() => {
    let alive = true
    const take = (s: TabsState): void =>
      setMarks({ spaceAudio: s.spaceAudio, spaceAttention: s.spaceAttention })
    void window.api.getState().then((d) => alive && take(d.state))
    const off = window.api.onState(take)
    return () => {
      alive = false
      off()
    }
  }, [])
  return marks
}
