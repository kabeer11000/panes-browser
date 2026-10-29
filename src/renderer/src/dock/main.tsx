import '../styles.css'
import './dock.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Dock } from './Dock'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Dock />
  </StrictMode>
)
