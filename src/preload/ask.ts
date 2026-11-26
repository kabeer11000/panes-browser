import { contextBridge, ipcRenderer } from 'electron'
import type { BackdropApi, AskApi, AskShow, ChatStreamEvent } from '@shared/types'

const on = <A extends unknown[]>(channel: string, cb: (...a: A) => void): (() => void) => {
  const listener = (_e: unknown, ...a: unknown[]): void => cb(...(a as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: AskApi = {
  ready: () => ipcRenderer.send('ask:ready'),
  run: (action, question) => ipcRenderer.send('ask:run', action, question),
  stop: () => ipcRenderer.send('ask:stop'),
  close: () => ipcRenderer.send('ask:close'),
  copy: () => ipcRenderer.send('ask:copy'),
  continueInChat: () => ipcRenderer.send('ask:continue'),
  onShow: (cb) => on<[AskShow]>('ask:show', cb),
  onEvent: (cb) => on<[ChatStreamEvent]>('ai:chat-event', cb)
}

contextBridge.exposeInMainWorld('ask', api)
const backdrop: BackdropApi = { layers: (area) => ipcRenderer.invoke('float:backdrop', area) }
contextBridge.exposeInMainWorld('backdrop', backdrop)
