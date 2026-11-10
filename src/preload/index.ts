import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { UpdateState } from '@shared/update'
import type { CanvasFoundEvent } from '@shared/ai/canvasFind'
import type {
  FindResult,
  InitialData,
  PanesApi,
  Rect,
  Settings,
  TabsState,
  PasswordPrompt,
  PreviewKey,
  UiCommand
} from '@shared/types'

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: unknown, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: PanesApi = {
  getState: () => ipcRenderer.invoke('tabs:get') as Promise<InitialData>,
  onState: (cb) => subscribe<[TabsState]>('tabs:state', cb),
  onThumb: (cb) => subscribe<[number, string]>('tabs:thumb', cb),
  onCommand: (cb) => subscribe<[UiCommand]>('ui:command', cb),
  onStackWheel: (cb) => subscribe<[number]>('ui:stack-wheel', cb),
  onStackRelease: (cb) => subscribe<[]>('ui:stack-release', cb),
  createTab: (input) => ipcRenderer.send('tabs:create', input),
  closeTab: (id) => ipcRenderer.send('tabs:close', id),
  activateTab: (id) => ipcRenderer.send('tabs:activate', id),
  navigate: (input) => ipcRenderer.send('tabs:navigate', input),
  back: () => ipcRenderer.send('tabs:back'),
  forward: () => ipcRenderer.send('tabs:forward'),
  reload: () => ipcRenderer.send('tabs:reload'),
  stop: () => ipcRenderer.send('tabs:stop'),
  setContentBounds: (rects: Record<number, Rect>) => ipcRenderer.send('ui:bounds', rects),
  splitWith: (id) => ipcRenderer.send('tabs:split-with', id),
  splitMany: (ids) => ipcRenderer.send('tabs:split-many', ids),
  unsplit: (keepId) => ipcRenderer.send('tabs:unsplit', keepId),
  toggleSplit: () => ipcRenderer.send('tabs:toggle-split'),
  print: () => ipcRenderer.send('tabs:print'),
  runAction: (id) => ipcRenderer.send('tabs:action', id),
  onAskAi: (cb) => subscribe<[string | null]>('ui:ask-ai', cb),
  dropTab: (id, targetId, edge) => ipcRenderer.send('tabs:drop', id, targetId, edge),
  closePane: (id) => ipcRenderer.send('tabs:close-pane', id),
  tabMenu: (id, picked) => ipcRenderer.send('tabs:tab-menu', id, picked),
  pageMenu: (id, x, y, live) => ipcRenderer.invoke('tabs:page-menu', id, x, y, live),
  tabHover: (id, anchor) => ipcRenderer.send('tabs:hover', id, anchor),
  hideDock: (hide) => ipcRenderer.send('ui:dock-hide', hide),
  sendFeedback: () => ipcRenderer.send('app:feedback'),
  toggleSitePanel: (anchor) => ipcRenderer.send('site:panel-toggle', anchor),
  addToGroup: (id, groupId) => ipcRenderer.send('tabs:add-to-group', id, groupId),
  siteInfo: () => ipcRenderer.invoke('site:info'),
  siteUpdate: (patch) => ipcRenderer.invoke('site:update', patch),
  groupMenu: (id) => ipcRenderer.send('tabs:group-menu', id),
  muteSpace: (id) => ipcRenderer.send('tabs:mute-space', id),
  newPrivateTab: () => ipcRenderer.send('tabs:new-private'),
  newTorTab: () => ipcRenderer.send('tabs:new-tor'),
  torReconnect: () => ipcRenderer.send('tor:reconnect'),
  appMenu: (x, y) => ipcRenderer.send('tabs:app-menu', x, y),
  updateGroup: (id, patch) => ipcRenderer.send('tabs:group-update', id, patch),
  onRenameGroup: (cb) => subscribe<[number]>('ui:rename-group', cb),
  stopCapture: (id, kinds) => ipcRenderer.send('tabs:stop-capture', id, kinds),
  setNewTabPhoto: (id) => ipcRenderer.send('settings:newtab-photo', id),
  toggleMute: (id) => ipcRenderer.send('tabs:toggle-mute', id),
  mediaPlay: (id, action) => ipcRenderer.invoke('tabs:media', id, action),
  togglePip: () => ipcRenderer.send('pip:toggle'),
  exitPip: () => ipcRenderer.send('pip:exit'),
  watchTopBar: (enabled, barPx) => ipcRenderer.send('ui:bar-watch', enabled, barPx),
  onPeekBar: (cb) => subscribe<[boolean]>('ui:peek-bar', cb),
  watchSidebar: (enabled, open, openedByHover, widthPx) =>
    ipcRenderer.send('ui:side-watch', enabled, open, openedByHover, widthPx),
  isDefaultBrowser: () => ipcRenderer.invoke('default:status'),
  setDefaultBrowser: () => ipcRenderer.invoke('default:request'),
  dismissDefaultBrowser: () => ipcRenderer.send('default:dismiss'),
  onSideHover: (cb) => subscribe<['open' | 'close']>('ui:side-hover', cb),
  suggestLocal: (q) => ipcRenderer.invoke('search:local', q),
  newTabSmart: () => ipcRenderer.invoke('newtab:smart'),
  openBoard: (spaceId) => ipcRenderer.send('newtab:open-board', spaceId),
  suggestRemote: (q) => ipcRenderer.invoke('search:remote', q),
  suggestSemantic: (q, exclude) => ipcRenderer.invoke('search:semantic', q, exclude),
  aiWarm: () => ipcRenderer.send('ai:warm'),
  chatInfo: () => ipcRenderer.invoke('ai:chat-info'),
  chatSend: (req) => ipcRenderer.invoke('ai:chat-send', req),
  chatPrime: (req) => ipcRenderer.send('ai:chat-prime', { ...req, mode: 'panel' }),
  chatPickFiles: () => ipcRenderer.invoke('ai:chat-pick-files'),
  chatAttach: (files) =>
    ipcRenderer.invoke(
      'ai:chat-attach',
      files.map((f) => webUtils.getPathForFile(f)).filter(Boolean)
    ),
  chatStop: (turnId) => ipcRenderer.send('ai:chat-stop', turnId),
  chatAnswer: (turnId, callId, ok) => ipcRenderer.send('ai:chat-answer', turnId, callId, ok),
  chatList: () => ipcRenderer.invoke('ai:chat-list'),
  chatLoad: (id) => ipcRenderer.invoke('ai:chat-load', id),
  chatSave: (conv, ephemeral) => ipcRenderer.send('ai:chat-save', conv, ephemeral),
  chatDelete: (id) => ipcRenderer.send('ai:chat-delete', id),
  chatAction: (action) => ipcRenderer.send('ai:chat-action', action),
  chatSetModel: (choice, chatgptModel) =>
    ipcRenderer.send('ai:chat-set-model', choice, chatgptModel),
  onChatChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('ai:chat-changed', listener)
    return () => ipcRenderer.removeListener('ai:chat-changed', listener)
  },
  onChatEvent: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: Parameters<typeof cb>[0]): void => cb(ev)
    ipcRenderer.on('ai:chat-event', listener)
    return () => ipcRenderer.removeListener('ai:chat-event', listener)
  },
  onChatNamed: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, id: string): void => cb(id)
    ipcRenderer.on('ai:chat-named', listener)
    return () => ipcRenderer.removeListener('ai:chat-named', listener)
  },
  canvas: {
    load: (spaceId) => ipcRenderer.invoke('canvas:load', spaceId),
    save: (spaceId, state) => ipcRenderer.send('canvas:save', spaceId, state),
    open: (spaceId) => ipcRenderer.send('canvas:open', spaceId),
    inView: (spaceId, tabIds) => ipcRenderer.send('canvas:in-view', spaceId, tabIds),
    streaming: (tabIds) => ipcRenderer.send('canvas:streaming', tabIds),
    streamSource: (tabId) => ipcRenderer.invoke('canvas:stream-source', tabId),
    videoRegion: (tabId) => ipcRenderer.invoke('canvas:video-region', tabId),
    close: (spaceId) => ipcRenderer.send('canvas:close', spaceId),
    cluster: (spaceId) => ipcRenderer.invoke('canvas:cluster', spaceId),
    name: (spaceId, tabIds) => ipcRenderer.invoke('canvas:name', spaceId, tabIds),
    assign: (spaceId, tabId, frames) => ipcRenderer.invoke('canvas:assign', spaceId, tabId, frames),
    reopen: (n) => ipcRenderer.send('canvas:reopen', n),
    content: (tabId) => ipcRenderer.invoke('canvas:content', tabId),
    reader: (req) => ipcRenderer.invoke('canvas:reader', req),
    summarize: (req) => ipcRenderer.invoke('canvas:summarize', req),
    placement: (req) => ipcRenderer.invoke('canvas:placement', req),
    bytes: (req) => ipcRenderer.invoke('canvas:bytes', req),
    store: async (f) => {
      const path = webUtils.getPathForFile(f)
      return ipcRenderer.invoke(
        'canvas:store',
        path ? { path } : { name: f.name, data: new Uint8Array(await f.arrayBuffer()) }
      )
    },
    capture: (rect) => ipcRenderer.invoke('canvas:capture', rect),
    saveFile: (req) => ipcRenderer.invoke('canvas:save-file', req),
    find: (queryId, query, spaceId, classify) =>
      ipcRenderer.send('canvas:find', queryId, query, spaceId, classify),
    cancelFind: (queryId) => ipcRenderer.send('canvas:find-cancel', queryId),
    onFound: (cb) => subscribe<[CanvasFoundEvent]>('canvas:found', cb),
    liveOpen: (req) => ipcRenderer.invoke('canvas:live-open', req),
    liveMove: (tabId, rect) => ipcRenderer.send('canvas:live-move', tabId, rect),
    liveHide: () => ipcRenderer.send('canvas:live-hide'),
    liveCompanions: (list) => ipcRenderer.send('canvas:live-companions', list),
    liveShot: (tabId) => ipcRenderer.invoke('canvas:live-shot', tabId),
    liveNav: (tabId, what) => ipcRenderer.send('canvas:live-nav', tabId, what),
    preview: (open, tab) => ipcRenderer.send('canvas:preview', open, tab),
    onPreviewKey: (cb) => subscribe<[PreviewKey]>('canvas:preview-key', cb),
    navigate: (tab, input) => ipcRenderer.invoke('canvas:navigate', tab, input),
    onTool: (cb) => subscribe<[string, string, unknown]>('canvas:tool', cb),
    toolResult: (id, text) => ipcRenderer.send('canvas:tool-result', id, text),
    onNew: (cb) => subscribe<[]>('canvas:new', cb),
    onShowTab: (cb) => subscribe<[number]>('canvas:show-tab', cb),
    onLinkOpened: (cb) => subscribe<[number, number]>('canvas:link-opened', cb)
  },
  openInSplit: (input) => ipcRenderer.send('tabs:open-in-split', input),
  switchSpace: (id) => ipcRenderer.send('spaces:switch', id),
  createSpace: () => ipcRenderer.send('spaces:create'),
  moveTabToSpace: (tabId, spaceId) => ipcRenderer.send('spaces:move-tab', tabId, spaceId),
  updateSpace: (id, patch) => ipcRenderer.send('spaces:update', id, patch),
  deleteSpace: (id) => ipcRenderer.send('spaces:delete', id),
  popOutPane: (id) => ipcRenderer.send('tabs:pop-out', id),
  setRatios: (path, ratios) => ipcRenderer.send('tabs:ratios', path, ratios),
  moveTab: (id, index, groupId) => ipcRenderer.send('tabs:move', id, index, groupId),
  moveTabs: (ids, index, groupId) => ipcRenderer.send('tabs:move-many', ids, index, groupId),
  duplicateTabs: (ids, spaceId) => ipcRenderer.invoke('tabs:duplicate', ids, spaceId),
  openTabs: (urls, spaceId) => ipcRenderer.invoke('tabs:open-many', urls, spaceId),
  setSlide: (x, y) => ipcRenderer.send('ui:slide', x, y),
  setOverlay: (open, snapshot, sharp) =>
    ipcRenderer.invoke('ui:overlay', open, snapshot, sharp) as Promise<void>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
  onSettings: (cb) => subscribe<[Settings]>('settings:changed', cb),
  openInternal: (page) => ipcRenderer.send('tabs:open-internal', page),
  toggleBookmark: () => ipcRenderer.send('tabs:toggle-bookmark'),
  find: (text, forward) => ipcRenderer.send('find:run', text, forward),
  stopFind: () => ipcRenderer.send('find:stop'),
  onFindResult: (cb) => subscribe<[FindResult]>('ui:find-result', cb),
  minimizeWindow: () => ipcRenderer.send('win:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('win:maximize'),
  closeWindow: () => ipcRenderer.send('win:close'),
  onPasswordPrompt: (cb) => subscribe<[PasswordPrompt | null]>('pw:prompt', cb),
  answerPassword: (answer, edits) => ipcRenderer.send('pw:answer', answer, edits),
  onUpdateState: (cb) => subscribe<[UpdateState]>('ui:update', cb),
  getUpdateState: () => ipcRenderer.invoke('update:state') as Promise<UpdateState>,
  installUpdate: () => ipcRenderer.send('update:install'),
  revealPendingPassword: () => ipcRenderer.invoke('pw:reveal-pending') as Promise<string | null>,
  setPromptAnchor: (anchor) => ipcRenderer.send('pw:anchor', anchor),
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
