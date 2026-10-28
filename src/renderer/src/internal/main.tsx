import '../styles.css'
import './internal.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Shell } from './Shell'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell />
  </StrictMode>
)
