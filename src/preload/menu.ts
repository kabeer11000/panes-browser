import { contextBridge, ipcRenderer } from 'electron'
import type { MenuApi, MenuShow } from '@shared/types'

const api: MenuApi = {
  onShow: (cb) => {
    const listener = (_e: unknown, m: MenuShow): void => cb(m)
    ipcRenderer.on('menu:show', listener)
    return () => ipcRenderer.removeListener('menu:show', listener)
  },
  pick: (seq, id) => ipcRenderer.send('menu:pick', seq, id),
  close: (seq) => ipcRenderer.send('menu:close', seq)
}

contextBridge.exposeInMainWorld('menuHost', api)
