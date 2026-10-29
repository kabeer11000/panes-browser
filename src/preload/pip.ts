import { contextBridge, ipcRenderer } from 'electron'
import type { PipApi, PipState } from '../shared/types'

const api: PipApi = {
  onState: (cb) => {
    const listener = (_e: unknown, state: PipState): void => cb(state)
    ipcRenderer.on('pip:state', listener)
    return () => ipcRenderer.removeListener('pip:state', listener)
  },
  playPause: () => ipcRenderer.send('pip:play-pause'),
  seek: (to) => ipcRenderer.send('pip:seek', to),
  skip: (delta) => ipcRenderer.send('pip:skip', delta),
  toggleMute: () => ipcRenderer.send('pip:mute'),
  close: () => ipcRenderer.send('pip:close'),
  back: () => ipcRenderer.send('pip:back'),
  drag: (phase) => ipcRenderer.send('pip:drag', phase)
}

contextBridge.exposeInMainWorld('pip', api)
