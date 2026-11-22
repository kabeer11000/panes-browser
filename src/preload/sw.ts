import { contextBridge, ipcRenderer } from 'electron'
import { swNotifyShim } from '@shared/swNotify'

// Every site's service worker: its notifications go to main, which shows them and marks the site's tab (Electron
// drops a worker's notifications otherwise; see swNotifyShim).
try {
  contextBridge.executeInMainWorld({
    func: swNotifyShim,
    args: [{ report: (note: unknown) => ipcRenderer.send('sw:notify', note) }]
  })
} catch {
  // a worker torn down as it started
}
