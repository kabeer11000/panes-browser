// bippy/core, not bippy: the package's main entry installs the hook as soon as it is imported. (Its type declarations
// name this export by a minified alias, hence the cast.)
import * as bippy from 'bippy/core'

const { safelyInstallRDTHook } = bippy as unknown as { safelyInstallRDTHook: () => void }

/** Debugging Panes itself (Settings, which loads the page with `?debug`): React Scan is on. */
export const DEBUG_UI = new URLSearchParams(location.search).has('debug')

// React Scan needs React's devtools hook in place before react-dom loads, so this module is imported first. The
// scanner itself (400 KB) is loaded only in that case, after the first render (main.tsx).
if (DEBUG_UI) safelyInstallRDTHook()
