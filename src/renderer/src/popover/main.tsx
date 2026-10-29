import '../styles.css'
import './popover.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Popover } from './Popover'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popover />
  </StrictMode>
)
