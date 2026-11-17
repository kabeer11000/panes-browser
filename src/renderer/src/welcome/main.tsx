import { installTooltips } from '@renderer/tooltip'
import '@renderer/styles.css'
import '@renderer/internal/internal.css'
import '@renderer/internal/controls.css'
import './welcome.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Welcome } from './Welcome'
import { installSpringTokens } from '@renderer/motion'

// The tour fills the window on its own and is always dark, whatever the space will be.
document.documentElement.dataset.scheme = 'dark'
// See-through until the space's colour is known, so the view's own background shows meanwhile.
document.documentElement.style.setProperty('--stage-bg', 'transparent')

installSpringTokens() // the shared spring as CSS tokens, as in the main window
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Welcome />
  </StrictMode>
)

installTooltips()
