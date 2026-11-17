import { DEBUG_UI } from './debugHook' // first: before react-dom
import './styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { Recover } from './Recover'
import { installSpringTokens } from './motion'

document.documentElement.dataset.platform = window.api.platform
installSpringTokens()

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
