import { contextBridge, ipcRenderer } from 'electron'
import type { InternalApi } from '../shared/types'
import { installAutofill } from './autofill'

// This script is attached to every tab; it only exposes anything to panes:// pages.
if (location.protocol === 'panes:') {
  const api: InternalApi = {
    updateState: () => ipcRenderer.invoke('int:update-state'),
    updateCheck: () => ipcRenderer.invoke('int:update-check'),
    updateInstall: () => ipcRenderer.invoke('int:update-install'),
    about: () => ipcRenderer.invoke('int:about'),
    historyList: (q, limit, offset) => ipcRenderer.invoke('int:history-list', q, limit, offset),
    historyRemove: (id) => ipcRenderer.invoke('int:history-remove', id),
    historyRemoveMany: (ids) => ipcRenderer.invoke('int:history-remove-many', ids),
    bookmarksList: () => ipcRenderer.invoke('int:bookmarks-list'),
    bookmarkRemove: (id) => ipcRenderer.invoke('int:bookmark-remove', id),
    downloadsList: () => ipcRenderer.invoke('int:downloads-list'),
    downloadAction: (id, action) => ipcRenderer.invoke('int:download-action', id, action),
    getSettings: () => ipcRenderer.invoke('int:settings-get'),
    setSettings: (patch) => ipcRenderer.invoke('int:settings-set', patch),
    permissionsList: () => ipcRenderer.invoke('int:perms-list'),
    permissionRemove: (origin, kind) => ipcRenderer.invoke('int:perm-remove', origin, kind),
    permissionsReset: () => ipcRenderer.invoke('int:perms-reset'),
    memoryStats: () => ipcRenderer.invoke('int:memory-stats'),
    memoryFree: () => ipcRenderer.invoke('int:memory-free'),
    restart: () => ipcRenderer.invoke('int:restart'),
    onboardingDone: () => ipcRenderer.invoke('int:onboarding-done'),
    defaultBrowserStatus: () => ipcRenderer.invoke('int:default-status'),
    defaultBrowserRequest: () => ipcRenderer.invoke('int:default-request'),
    clearData: (kinds, since) => ipcRenderer.invoke('int:clear-data', kinds, since),
    spacesList: () => ipcRenderer.invoke('int:spaces-list'),
    spaceCreate: () => ipcRenderer.invoke('int:space-create'),
    spaceUpdate: (id, patch) => ipcRenderer.invoke('int:space-update', id, patch),
    spaceDelete: (id) => ipcRenderer.invoke('int:space-delete', id),
    passwordsList: () => ipcRenderer.invoke('int:passwords-list'),
    passwordReveal: (id) => ipcRenderer.invoke('int:password-reveal', id),
    passwordSave: (login) => ipcRenderer.invoke('int:password-save', login),
    passwordEdit: (id, username, password) =>
      ipcRenderer.invoke('int:password-edit', id, username, password),
    passwordRemove: (id) => ipcRenderer.invoke('int:password-remove', id),
    passwordsImport: (csv) => ipcRenderer.invoke('int:passwords-import', csv),
    passwordsExport: () => ipcRenderer.invoke('int:passwords-export'),
    passwordGenerate: () => ipcRenderer.invoke('int:password-generate')
  }
  contextBridge.exposeInMainWorld('panesInternal', api)
} else {
  installAutofill()
}
