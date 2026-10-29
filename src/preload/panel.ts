import { contextBridge, ipcRenderer } from 'electron'
import type { SitePanelApi } from '../shared/types'

const api: SitePanelApi = {
  info: () => ipcRenderer.invoke('panel:info'),
  update: (patch) => ipcRenderer.invoke('panel:update', patch),
  resize: (height) => ipcRenderer.send('panel:resize', height),
  close: () => ipcRenderer.send('panel:close'),
  pick: () => ipcRenderer.send('panel:pick'),
  onShow: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('panel:show', listener)
    return () => ipcRenderer.removeListener('panel:show', listener)
  }
}

contextBridge.exposeInMainWorld('sitePanel', api)
