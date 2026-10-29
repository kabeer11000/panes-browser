import '../styles.css'
import './tabcard.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TabCard } from './TabCard'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TabCard />
  </StrictMode>
)
