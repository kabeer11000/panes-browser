import { contextBridge, ipcRenderer } from 'electron'
import type {
  FindResult,
  InitialData,
  PanesApi,
  Rect,
  Settings,
  TabsState,
  UiCommand
} from '../shared/types'

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
  unsplit: (keepId) => ipcRenderer.send('tabs:unsplit', keepId),
  toggleSplit: () => ipcRenderer.send('tabs:toggle-split'),
  dropTab: (id, targetId, edge) => ipcRenderer.send('tabs:drop', id, targetId, edge),
  closePane: (id) => ipcRenderer.send('tabs:close-pane', id),
  setRatios: (path, ratios) => ipcRenderer.send('tabs:ratios', path, ratios),
  moveTab: (id, index) => ipcRenderer.send('tabs:move', id, index),
  setOverlay: (open) => ipcRenderer.invoke('ui:overlay', open) as Promise<void>,
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
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
