import { contextBridge, ipcRenderer } from 'electron'
import type { InternalApi } from '../shared/types'

// This script is attached to every tab; it only exposes anything to panes:// pages.
if (location.protocol === 'panes:') {
  const api: InternalApi = {
    historyList: (q, limit, offset) => ipcRenderer.invoke('int:history-list', q, limit, offset),
    historyRemove: (id) => ipcRenderer.invoke('int:history-remove', id),
    bookmarksList: () => ipcRenderer.invoke('int:bookmarks-list'),
    bookmarkRemove: (id) => ipcRenderer.invoke('int:bookmark-remove', id),
    downloadsList: () => ipcRenderer.invoke('int:downloads-list'),
    downloadAction: (id, action) => ipcRenderer.invoke('int:download-action', id, action),
    getSettings: () => ipcRenderer.invoke('int:settings-get'),
    setSettings: (patch) => ipcRenderer.invoke('int:settings-set', patch),
    clearData: (kinds, since) => ipcRenderer.invoke('int:clear-data', kinds, since),
    spacesList: () => ipcRenderer.invoke('int:spaces-list'),
    spaceCreate: () => ipcRenderer.invoke('int:space-create'),
    spaceUpdate: (id, patch) => ipcRenderer.invoke('int:space-update', id, patch),
    spaceDelete: (id) => ipcRenderer.invoke('int:space-delete', id)
  }
  contextBridge.exposeInMainWorld('panesInternal', api)
}
