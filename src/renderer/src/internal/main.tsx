import '@renderer/styles.css'
import './controls.css'
import './internal.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Shell } from './Shell'
import { Reader } from './pages/Reader'

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
    {/* panes://reader shares this entry (and its preload API) but not the settings shell around it */}
    {location.hostname === 'reader' ? <Reader /> : <Shell />}
  </StrictMode>
)
