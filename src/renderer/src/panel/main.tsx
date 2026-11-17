import { installTooltips } from '@renderer/tooltip'
import '@renderer/styles.css'
import './panel.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Panel } from './Panel'
import { installSpringTokens } from '@renderer/motion'

// prefers-color-scheme already matches the active space, so the panel wears the window's scheme.
document.documentElement.dataset.scheme = matchMedia('(prefers-color-scheme: dark)').matches
  ? 'dark'
  : 'light'

installSpringTokens() // the shared spring as CSS tokens, as in the main window
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Panel />
  </StrictMode>
)

installTooltips()
