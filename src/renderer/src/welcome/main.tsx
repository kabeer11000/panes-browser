import '../styles.css'
import '../internal/internal.css'
import './welcome.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Welcome } from './Welcome'

// Before the first paint, so a light page never flashes dark. prefers-color-scheme already matches the space.
document.documentElement.dataset.scheme = matchMedia('(prefers-color-scheme: dark)').matches
  ? 'dark'
  : 'light'
// See-through until the space's colour is known, so the view's own tinted background shows meanwhile.
document.documentElement.style.setProperty('--stage-bg', 'transparent')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Welcome />
  </StrictMode>
)
