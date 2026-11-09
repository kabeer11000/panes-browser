import { contextBridge, ipcRenderer } from 'electron'
import type { PrintApi } from '@shared/types'

const api: PrintApi = {
  init: () => ipcRenderer.invoke('print:init'),
  preview: (o) => ipcRenderer.invoke('print:preview', o),
  run: (o) => ipcRenderer.invoke('print:run', o),
  system: (o) => ipcRenderer.invoke('print:system', o),
  windowControl: (action) => ipcRenderer.send('print:window', action),
  close: () => ipcRenderer.send('print:close'),
  onOpen: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('print:open', listener)
    return () => ipcRenderer.removeListener('print:open', listener)
  }
}

contextBridge.exposeInMainWorld('printApi', api)
