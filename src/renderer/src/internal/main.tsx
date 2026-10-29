import '../styles.css'
import './internal.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Shell } from './Shell'

// Before the first paint: the tokens default to dark, so without this a light page would flash dark
// while its settings load. prefers-color-scheme already matches the active space (see SpaceStore).
document.documentElement.dataset.scheme = matchMedia('(prefers-color-scheme: dark)').matches
  ? 'dark'
  : 'light'

// Until the space's colour is known the page stays see-through, so the view's own (already tinted)
// background shows instead of a flash of the default colours.
document.documentElement.style.setProperty('--stage-bg', 'transparent')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell />
  </StrictMode>
)
