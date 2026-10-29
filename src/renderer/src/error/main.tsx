import '../styles.css'
import './error.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { parseSpaceTheme } from '../../../shared/errors'
import { ErrorPage } from './ErrorPage'

// Before the first paint, so a light page never flashes dark. prefers-color-scheme already matches the space.
document.documentElement.dataset.scheme = matchMedia('(prefers-color-scheme: dark)').matches
  ? 'dark'
  : 'light'

// The page background leans toward the space's colour (see --stage-bg); the address carries it so nothing flashes.
const theme = parseSpaceTheme(location.search)
if (theme) {
  document.documentElement.style.setProperty('--space', theme.color)
  document.documentElement.style.setProperty('--tint', `${Math.round(theme.tint * 100)}%`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorPage />
  </StrictMode>
)
