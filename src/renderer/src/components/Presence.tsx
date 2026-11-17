import { useEffect, useRef, useState, type ReactElement } from 'react'
import { reducedMotion } from '@renderer/motion'

/** How long a leaving popover plays its exit (--dur-exit, a little over: the spring's tail is invisible). */
const EXIT_MS = 180

/**
 * Lets a popover or menu leave instead of vanishing: when `children` turns falsy, the last one stays mounted for its
 * exit (`.presence-leave > *` in styles.css: a quick fade and shrink toward where it came from), then goes. The
 * wrapper is `display: contents`, so it adds no box to the layout around it.
 */
export function Presence({
  children
}: {
  children: ReactElement | null | false | undefined
}): React.JSX.Element | null {
  const [kept, setKept] = useState<ReactElement | null>(children || null)
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  if (children && (kept !== children || leaving)) {
    // the parent re-rendered it (or it came back while leaving): show the live one
    setKept(children)
    setLeaving(false)
  } else if (!children && kept && !leaving) {
    if (reducedMotion()) setKept(null)
    else setLeaving(true)
  }

  useEffect(() => {
    if (!leaving) return
    timer.current = window.setTimeout(() => {
      setKept(null)
      setLeaving(false)
    }, EXIT_MS)
    return () => window.clearTimeout(timer.current)
  }, [leaving])

  if (!kept) return null
  return <div className={'presence' + (leaving ? ' presence-leave' : '')}>{kept}</div>
}
