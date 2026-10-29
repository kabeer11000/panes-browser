import { useEffect, useState } from 'react'
import type { SpaceMode } from '../../shared/types'

const query = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: dark)')

/**
 * The light or dark scheme a space's mode resolves to. 'system' follows prefers-color-scheme, which
 * Electron ties to the OS theme (or to the active space's mode, see SpaceStore), and updates live.
 */
export function useScheme(mode: SpaceMode | undefined): 'dark' | 'light' {
  const [systemDark, setSystemDark] = useState(() => query().matches)
  useEffect(() => {
    const mq = query()
    const onChange = (): void => setSystemDark(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  if (mode === 'dark' || mode === 'light') return mode
  return systemDark ? 'dark' : 'light'
}
