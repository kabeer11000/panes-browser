import { contextBridge, ipcRenderer } from 'electron'
import type { DockApi, DockOverlayState, DownloadInfo, DownloadStart } from '../shared/types'

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: unknown, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DockApi = {
  downloads: () => ipcRenderer.invoke('downloads:list') as Promise<DownloadInfo[]>,
  onDownloads: (cb) => subscribe<[DownloadInfo[]]>('downloads:state', cb),
  onStart: (cb) => subscribe<[DownloadStart]>('downloads:start', cb),
  onCorner: (cb) => subscribe<[boolean]>('dock:corner', cb),
  act: (id, action) => ipcRenderer.send('downloads:act', id, action),
  openDownloads: () => ipcRenderer.send('dock:open-downloads'),
  setMode: (mode) => ipcRenderer.send('dock:mode', mode),
  toggle: () => ipcRenderer.send('dock:toggle'),
  onOverlay: (cb) => subscribe<[DockOverlayState]>('dock:overlay', cb),
  onLanded: (cb) => subscribe<[]>('dock:landed', cb),
  onToggle: (cb) => subscribe<[]>('dock:toggle', cb),
  report: (state) => ipcRenderer.send('dock:report', state),
  landed: () => ipcRenderer.send('dock:landed'),
  onSlide: (cb) => subscribe<['sink' | 'tuck' | 'rise']>('dock:slide', cb)
}

contextBridge.exposeInMainWorld('dock', api)
