import { app } from 'electron'
import { noteLayerBoot } from './layers'
import { mark } from './startupTrace'

/**
 * Only one Panes runs. This is the first import of index.ts so that a second one, started by a link or file handed to
 * Panes as the default browser, finds out at once: it passes its arguments to the running Panes (its 'second-instance'
 * event, see index.ts) and exits before anything else is loaded. Waiting until the rest of the app had loaded made every
 * link opened in Panes pay for starting a whole second copy of it.
 *
 * The lock belongs to the data folder, so an override of it (PANES_USERDATA) is applied before this, by loader.ts.
 */
export const gotLock = app.requestSingleInstanceLock()
mark('lock')
if (!gotLock) app.exit(0)
// Only the copy that goes on to open a window counts as a start of the running app layer (a link handed over does not).
else noteLayerBoot()
