import { contextBridge, ipcRenderer } from 'electron'
import type { PermissionApi, PermissionPromptState } from '../shared/types'

const api: PermissionApi = {
  state: () => ipcRenderer.invoke('perm:state') as Promise<PermissionPromptState | null>,
  onState: (cb) => {
    const listener = (_e: unknown, state: PermissionPromptState | null): void => cb(state)
    ipcRenderer.on('perm:state', listener)
    return () => ipcRenderer.removeListener('perm:state', listener)
  },
  resize: (height) => ipcRenderer.send('perm:resize', height),
  answer: (answer) => ipcRenderer.send('perm:answer', answer)
}

contextBridge.exposeInMainWorld('permission', api)
