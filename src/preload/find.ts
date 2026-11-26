import { contextBridge, ipcRenderer } from 'electron'
import type { BackdropApi, FindApi, FindResult } from '@shared/types'

const on =
  <A extends unknown[]>(channel: string) =>
  (cb: (...args: A) => void): (() => void) => {
    const listener = (_e: unknown, ...args: unknown[]): void => cb(...(args as A))
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }

const api: FindApi = {
  find: (text, forward) => ipcRenderer.send('find:run', text, forward),
  close: () => ipcRenderer.send('find:close'),
  onResult: on<[FindResult]>('find:result'),
  onFocus: on<[]>('find:focus')
}

contextBridge.exposeInMainWorld('findBar', api)
const backdrop: BackdropApi = { layers: (area) => ipcRenderer.invoke('float:backdrop', area) }
contextBridge.exposeInMainWorld('backdrop', backdrop)
