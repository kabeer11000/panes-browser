import '@renderer/styles.css'
import '@renderer/internal/controls.css'
import './print.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrintDialog } from './PrintDialog'
import { installSpringTokens } from '@renderer/motion'

// prefers-color-scheme already matches the active space (main also paints the window's colours in).
document.documentElement.dataset.scheme = matchMedia('(prefers-color-scheme: dark)').matches
  ? 'dark'
  : 'light'

installSpringTokens() // the shared spring as CSS tokens, as in the main window
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrintDialog />
  </StrictMode>
)
