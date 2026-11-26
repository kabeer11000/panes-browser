import { createContext, useContext } from 'react'
import type { ShareAct, ShareFacts } from '@shared/ai/canvasMenu'

/**
 * A tab's sharing in a shared space, for the menus that are not the card's own (the preview's More, a tab's in the
 * strip): what it is now, and running a pick, the same code the card's menu runs (Canvas.tsx provides it).
 */
export interface ShareMenu {
  /** Its facts for the menu; null when the board offers none (not a shared space, a private tab...). */
  factsOf: (id: number) => ShareFacts | null
  run: (id: number, act: ShareAct) => void
}

export const ShareMenuContext = createContext<ShareMenu | null>(null)
export const useShareMenu = (): ShareMenu | null => useContext(ShareMenuContext)
