import type { CSSProperties } from 'react'
import type { Space } from '../../../shared/types'

export type Theme = Pick<Space, 'color' | 'color2' | 'tint' | 'grain' | 'mode'>

/** CSS variables the themed background reads; shared by the live window and the picker's preview. */
export function themeVars(t: Theme): CSSProperties {
  return {
    '--space': t.color,
    '--space2': t.color2 ?? t.color,
    '--tint': `${Math.round(t.tint * 100)}%`,
    '--grain': t.grain
  } as CSSProperties
}
