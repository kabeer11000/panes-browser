import { useEffect, useState } from 'react'
import type { TabsState } from '../../../shared/types'

/** Which spaces have sound playing or muted, for the speaker on their avatars. */
export function useSpaceAudio(): TabsState['spaceAudio'] {
  const [audio, setAudio] = useState<TabsState['spaceAudio']>({})
  useEffect(() => {
    let alive = true
    void window.api.getState().then((d) => alive && setAudio(d.state.spaceAudio))
    const off = window.api.onState((s) => setAudio(s.spaceAudio))
    return () => {
      alive = false
      off()
    }
  }, [])
  return audio
}
