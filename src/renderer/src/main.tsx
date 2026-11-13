import { DEBUG_UI } from './debugHook' // first: before react-dom
import './styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

document.documentElement.dataset.platform = window.api.platform

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

if (DEBUG_UI)
  void import('react-scan').then(({ scan }) =>
    scan({ enabled: true, dangerouslyForceRunInProduction: true })
  )
