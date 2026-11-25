import { installTooltips } from '@renderer/tooltip'
import '@renderer/styles.css'
import './find.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Find } from './Find'
import { installSpringTokens } from '@renderer/motion'

installSpringTokens() // the shared spring as CSS tokens, as in the main window
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Find />
  </StrictMode>
)

installTooltips()
