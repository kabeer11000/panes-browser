import { webFrame } from 'electron'
import { PASSKEY_SHIM } from '@shared/passkeys'

// Every frame of every tab, at document start, in the page's own world (see shared/passkeys.ts).
webFrame.executeJavaScript(PASSKEY_SHIM).catch(() => undefined)
