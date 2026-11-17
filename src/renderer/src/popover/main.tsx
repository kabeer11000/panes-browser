import { installTooltips } from '@renderer/tooltip'
import '@renderer/styles.css'
import './popover.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Popover } from './Popover'
import { installSpringTokens } from '@renderer/motion'

installSpringTokens() // the shared spring as CSS tokens, as in the main window
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popover />
  </StrictMode>
)

installTooltips()
