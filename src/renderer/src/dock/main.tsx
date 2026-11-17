import { installTooltips } from '@renderer/tooltip'
import '@renderer/styles.css'
import './dock.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Dock } from './Dock'
import { installSpringTokens } from '@renderer/motion'

installSpringTokens() // the shared spring as CSS tokens, as in the main window
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Dock />
  </StrictMode>
)

installTooltips()
