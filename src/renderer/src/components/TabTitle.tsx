import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { TabInfo } from '@shared/types'
import { tabTitle } from '@renderer/tabTitle'

/**
 * A tab's title. When the shorter AI title takes the place of the page's own (or goes back) the two cross-fade
 * instead of jumping; an ordinary title change is just a change of text.
 */
export function TabTitle({
  tab,
  className
}: {
  tab: TabInfo
  className: string
}): React.JSX.Element {
  const reduced = useReducedMotion()
  return (
    <span className={className}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={tab.aiTitle ? 'ai' : 'page'}
          className="tt"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          {tabTitle(tab)}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
