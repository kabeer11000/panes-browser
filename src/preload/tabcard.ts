import { contextBridge, ipcRenderer } from 'electron'
import type { BackdropApi, TabCardApi, TabCardInfo } from '@shared/types'

const api: TabCardApi = {
  state: () => ipcRenderer.invoke('tabcard:state') as Promise<TabCardInfo | null>,
  onState: (cb) => {
    const listener = (_e: unknown, info: TabCardInfo | null): void => cb(info)
    ipcRenderer.on('tabcard:state', listener)
    return () => ipcRenderer.removeListener('tabcard:state', listener)
  },
  resize: (height) => ipcRenderer.send('tabcard:resize', height)
}

contextBridge.exposeInMainWorld('tabcard', api)
const backdrop: BackdropApi = { layers: (area) => ipcRenderer.invoke('float:backdrop', area) }
contextBridge.exposeInMainWorld('backdrop', backdrop)
