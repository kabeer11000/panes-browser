import '@renderer/styles.css'
import '@renderer/canvas/canvas.css'
import '@renderer/canvas/board.css'
import '@renderer/canvas/surfaces.css'
import './menu.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MenuHost } from './MenuHost'
import { installSpringTokens } from '@renderer/motion'

installSpringTokens()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MenuHost />
  </StrictMode>
)
