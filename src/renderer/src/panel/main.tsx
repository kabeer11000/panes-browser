import '../styles.css'
import './panel.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Panel } from './Panel'

// prefers-color-scheme already matches the active space, so the panel wears the window's scheme.
document.documentElement.dataset.scheme = matchMedia('(prefers-color-scheme: dark)').matches
  ? 'dark'
  : 'light'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Panel />
  </StrictMode>
)
