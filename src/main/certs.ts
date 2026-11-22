import { app, ipcMain } from 'electron'

/**
 * Chrome's way past a certificate it cannot trust: on the error page, Advanced, then "Proceed to <site> (unsafe)".
 * The site is then let through for the rest of this run (never saved), as Chrome does. Electron refuses every such
 * certificate on its own; without this a site on a self-signed or expired certificate (a router's page, a local dev
 * server) could not be opened at all.
 */
let installed = false

export function installCertBypass(): void {
  // createWindow runs again on macOS once every window is closed; one handler, one allow-list, for the whole run
  if (installed) return
  installed = true
  const allowed = new Set<string>()
  // only from Panes' own error page, for an https address
  ipcMain.handle('int:cert-proceed', (e, url: unknown) => {
    if (!e.senderFrame?.url.startsWith('panes://error') || typeof url !== 'string') return false
    try {
      const u = new URL(url)
      if (u.protocol !== 'https:') return false
      allowed.add(u.host)
      return true
    } catch {
      return false
    }
  })
  app.on('certificate-error', (event, _wc, url, _error, _certificate, callback) => {
    try {
      if (!allowed.has(new URL(url).host)) return
    } catch {
      return
    }
    event.preventDefault()
    callback(true)
  })
}
