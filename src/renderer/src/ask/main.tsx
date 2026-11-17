import { installTooltips } from '@renderer/tooltip'
import '@renderer/styles.css'
import '@renderer/components/chat/chat.css'
import './ask.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Ask } from './Ask'
import { installSpringTokens } from '@renderer/motion'

installSpringTokens() // the shared spring as CSS tokens, as in the main window
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Ask kind={new URLSearchParams(location.search).get('v') === 'card' ? 'card' : 'chip'} />
  </StrictMode>
)

installTooltips()
