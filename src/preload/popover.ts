import { contextBridge, ipcRenderer } from 'electron'
import type { PopoverApi, PopoverState } from '../shared/types'

const api: PopoverApi = {
  state: () => ipcRenderer.invoke('popover:state') as Promise<PopoverState>,
  onState: (cb) => {
    const listener = (_e: unknown, state: PopoverState): void => cb(state)
    ipcRenderer.on('popover:state', listener)
    return () => ipcRenderer.removeListener('popover:state', listener)
  },
  resize: (height) => ipcRenderer.send('popover:resize', height),
  answer: (answer, edits) => ipcRenderer.send('pw:answer', answer, edits),
  reveal: () => ipcRenderer.invoke('pw:reveal-pending') as Promise<string | null>
}

contextBridge.exposeInMainWorld('popover', api)
