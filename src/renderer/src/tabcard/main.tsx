import { installTooltips } from '@renderer/tooltip'
import '@renderer/styles.css'
import './tabcard.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TabCard } from './TabCard'
import { installSpringTokens } from '@renderer/motion'

installSpringTokens() // the shared spring as CSS tokens, as in the main window
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TabCard />
  </StrictMode>
)

installTooltips()
