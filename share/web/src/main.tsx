import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, BadLink } from './App'
import { valid } from './link'
import './web.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{valid ? <App /> : <BadLink />}</StrictMode>
)
