import { DEBUG_UI } from './debugHook' // first: before react-dom
import './styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installTypeAhead } from './typeAhead'
import App from './App'
import { Recover } from './Recover'
import { installSpringTokens } from './motion'
import { installTooltips } from './tooltip'
import { installNoHiddenScroll } from './noHiddenScroll'

document.documentElement.dataset.platform = window.api.platform
installSpringTokens()
installTooltips()
installNoHiddenScroll() // focus near the board's edge never scrolls the interface away

// before anything else listens: Ctrl+T then typing at once keeps every key (typeAhead.ts)
installTypeAhead()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Recover what="Panes">
      <App />
    </Recover>
  </StrictMode>
)

if (DEBUG_UI)
  void import('react-scan').then(({ scan }) =>
    scan({ enabled: true, dangerouslyForceRunInProduction: true })
  )
