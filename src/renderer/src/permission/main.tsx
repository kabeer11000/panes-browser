import '../styles.css'
import './permission.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Permission } from './Permission'

// prefers-color-scheme already matches the active space (see SpaceStore), so the card wears the window's scheme.
document.documentElement.dataset.scheme = matchMedia('(prefers-color-scheme: dark)').matches
  ? 'dark'
  : 'light'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Permission />
  </StrictMode>
)
