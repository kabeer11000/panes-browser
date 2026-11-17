import { contextBridge, ipcRenderer } from 'electron'
import type { InternalApi } from '@shared/types'
import { installAutofill } from './autofill'
import { installSelectionWatch } from './selection'

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
    openMany: (items) => ipcRenderer.invoke('int:open-many', items),
    bookmarksList: () => ipcRenderer.invoke('int:bookmarks-list'),
    bookmarkRemove: (id) => ipcRenderer.invoke('int:bookmark-remove', id),
    torStatus: () => ipcRenderer.invoke('int:tor-status'),
    torStart: (snowflake) => ipcRenderer.invoke('int:tor-start', snowflake),
    torStop: () => ipcRenderer.invoke('int:tor-stop'),
    torNewTab: () => ipcRenderer.invoke('int:tor-new-tab'),
    privateNewTab: () => ipcRenderer.invoke('int:private-new-tab'),
    openTouchpadSettings: () => ipcRenderer.invoke('int:touchpad-settings'),
    dumpsList: () => ipcRenderer.invoke('int:dumps-list'),
    dumpSave: (close) => ipcRenderer.invoke('int:dump-save', close),
    dumpOpen: (id) => ipcRenderer.invoke('int:dump-open', id),
    dumpRename: (id, name) => ipcRenderer.invoke('int:dump-rename', id, name),
    dumpRemove: (id) => ipcRenderer.invoke('int:dump-remove', id),
    downloadsList: () => ipcRenderer.invoke('int:downloads-list'),
    downloadAction: (id, action) => ipcRenderer.invoke('int:download-action', id, action),
    downloadPreviews: (ids) => ipcRenderer.invoke('int:download-previews', ids),
    readerGet: (key) => ipcRenderer.invoke('int:reader-get', key),
    readerExit: () => ipcRenderer.invoke('int:reader-exit'),
    readerToCanvas: (key) => ipcRenderer.invoke('int:reader-canvas', key),
    aiStatus: () => ipcRenderer.invoke('int:ai-status'),
    aiDownload: () => ipcRenderer.invoke('int:ai-download'),
    aiCancelDownload: () => ipcRenderer.invoke('int:ai-cancel'),
    aiRetry: () => ipcRenderer.invoke('int:ai-retry'),
    aiRemoveLocal: () => ipcRenderer.invoke('int:ai-remove-local'),
    aiRemoveData: () => ipcRenderer.invoke('int:ai-remove-data'),
    aiOpenModelsDir: () => ipcRenderer.invoke('int:ai-models-open'),
    aiPickModelsDir: () => ipcRenderer.invoke('int:ai-models-pick'),
    aiResetModelsDir: () => ipcRenderer.invoke('int:ai-models-reset'),
    aiSetKey: (provider, key) => ipcRenderer.invoke('int:ai-set-key', provider, key),
    aiRemoveKey: (provider) => ipcRenderer.invoke('int:ai-remove-key', provider),
    aiSignIn: (provider) => ipcRenderer.invoke('int:ai-signin', provider),
    aiOpenGeminiKeyPage: () => ipcRenderer.invoke('int:ai-gemini-key-page'),
    aiCancelSignIn: () => ipcRenderer.invoke('int:ai-signin-cancel'),
    aiSignOut: (provider) => ipcRenderer.invoke('int:ai-signout', provider),
    aiChatgptModels: () => ipcRenderer.invoke('int:ai-chatgpt-models'),
    aiClearChats: () => ipcRenderer.invoke('int:ai-chats-clear'),
    onAiChanged: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on('int:ai-changed', listener)
      return () => ipcRenderer.removeListener('int:ai-changed', listener)
    },
    getSettings: () => ipcRenderer.invoke('int:settings-get'),
    setSettings: (patch) => ipcRenderer.invoke('int:settings-set', patch),
    permissionsList: () => ipcRenderer.invoke('int:perms-list'),
    permissionSet: (origin, kind, decision) =>
      ipcRenderer.invoke('int:perm-set', origin, kind, decision),
    permissionRemove: (origin, kind) => ipcRenderer.invoke('int:perm-remove', origin, kind),
    permissionsReset: () => ipcRenderer.invoke('int:perms-reset'),
    onPermissionsChanged: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on('int:perms-changed', listener)
      return () => ipcRenderer.removeListener('int:perms-changed', listener)
    },
    memoryStats: () => ipcRenderer.invoke('int:memory-stats'),
    memoryFree: () => ipcRenderer.invoke('int:memory-free'),
    restart: () => ipcRenderer.invoke('int:restart'),
    sendFeedback: () => ipcRenderer.invoke('int:feedback'),
    onboardingDone: () => ipcRenderer.invoke('int:onboarding-done'),
    pickDownloadDir: () => ipcRenderer.invoke('int:pick-download-dir'),
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
    passwordGenerate: () => ipcRenderer.invoke('int:password-generate'),
    importSources: () => ipcRenderer.invoke('int:import-sources'),
    importRun: (sourceId, profileDir, items) =>
      ipcRenderer.invoke('int:import-run', sourceId, profileDir, items),
    importEverything: (items, only) => ipcRenderer.invoke('int:import-everything', items, only),
    onImportProgress: (cb) => {
      const listener = (_e: unknown, p: Parameters<typeof cb>[0]): void => cb(p)
      ipcRenderer.on('int:import-progress', listener)
      return () => ipcRenderer.removeListener('int:import-progress', listener)
    },
    importPasswordsFile: () => ipcRenderer.invoke('int:import-passwords-file'),
    importPasswordsFrom: (sourceId) => ipcRenderer.invoke('int:passwords-from', sourceId),
    cancelPasswordsWatch: () => ipcRenderer.send('int:passwords-watch-cancel'),
    onPasswordsImported: (cb) => {
      const listener = (_e: unknown, r: Parameters<typeof cb>[0]): void => cb(r)
      ipcRenderer.on('int:passwords-imported', listener)
      return () => ipcRenderer.removeListener('int:passwords-imported', listener)
    },
    deleteImportedPasswordsFile: () => ipcRenderer.invoke('int:import-passwords-delete'),
    importBookmarksFile: () => ipcRenderer.invoke('int:import-bookmarks-file')
  }
  contextBridge.exposeInMainWorld('panesInternal', api)
} else {
  installAutofill()
  installSelectionWatch()
}
