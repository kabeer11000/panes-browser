import { app } from 'electron'
import { mark } from './startupTrace'

/**
 * Only one Panes runs. This is the first import of index.ts so that a second one, started by a link or file handed to
 * Panes as the default browser, finds out at once: it passes its arguments to the running Panes (its 'second-instance'
 * event, see index.ts) and exits before anything else is loaded. Waiting until the rest of the app had loaded made every
 * link opened in Panes pay for starting a whole second copy of it.
 *
 * The lock belongs to the data folder, so the folder an override names (tests, and side-by-side copies) is set first.
 */
if (process.env['PANES_USERDATA']) app.setPath('userData', process.env['PANES_USERDATA'])

export const gotLock = app.requestSingleInstanceLock()
mark('lock')
if (!gotLock) app.exit(0)
