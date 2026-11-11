import { app, BrowserWindow, dialog, shell, type OpenDialogOptions } from 'electron'
import { mkdirSync } from 'fs'
import type { AiSettings, AiStatus } from '@shared/ai/types'
import type { DownloadManager } from '../downloads'
import type { HistoryStore } from '../history'
import { handleInternal, notifyInternalPages } from '../internal'
import type { SettingsStore } from '../settings'
import type { TabManager } from '../tabs'
import { AiFeatures } from './features'
import { EmbeddingIndex } from './index'
import { KEY_PROVIDERS, type CredentialProvider } from '@shared/ai/types'
import { ChatService } from './chat'
import { KeyStore } from './providers'
import { checkGeminiKey, SignIn } from './signin'
import { AiRouter } from './router'
import { totalmem, availableParallelism } from 'os'
import { slowForLocal } from '@shared/ai/models'
import { aiRoot, defaultModelsDir, dirSize, LocalRuntime } from './runtime'
import { CanvasContent } from './canvasContent'
import { webSearch } from './canvasFind'
import { SEARCH_ENGINES } from '@shared/settings'

/** A page's readable words, run in a hidden page: a fixed script, nothing from a model. */
const HIDDEN_TEXT = (cap: number): string =>
  `(() => { const r = document.querySelector('article,main,[role=main]') || document.body; let t = String((r && r.innerText) || ''); if (t.length < 400 && document.body) t = String(document.body.innerText || ''); return { title: document.title, text: t.slice(0, ${Math.floor(cap)}) } })()`

const SIZE_CACHE_MS = 3000
const STARTUP_CATCH_UP_MS = 8000 // after the window is up, so it never competes with starting

const isKeyed = (v: unknown): v is CredentialProvider =>
  (KEY_PROVIDERS as readonly unknown[]).includes(v)

/**
 * Builds the AI core and wires it to the browser: the runtime, router, index and features, the settings that
 * switch them on and off, and the IPC the settings page uses. Returns what the rest of main needs.
 */
export function registerAi(d: {
  settings: SettingsStore
  tabs: TabManager
  history: HistoryStore
  downloads: DownloadManager
}): {
  features: AiFeatures
  runtime: LocalRuntime
  router: AiRouter
  index: EmbeddingIndex
  chat: ChatService
  content: CanvasContent
} {
  const keys = new KeyStore()
  const runtime = new LocalRuntime(() => d.settings.get().aiModelsDir)
  const ai = (): AiSettings => d.settings.get().ai
  const router = new AiRouter({ settings: ai, runtime, keys })
  const index = new EmbeddingIndex(router, () => ai().localProvider === 'local')
  const features = new AiFeatures({
    router,
    index,
    tabs: d.tabs,
    history: d.history,
    downloads: d.downloads
  })
  features.start()
  // the chat panel is told too, whenever something that decides where chat goes changes
  const hooks: { chat?: ChatService } = {}
  const aiChanged = (): void => {
    notifyInternalPages('int:ai-changed')
    hooks.chat?.changed()
  }
  const signin = new SignIn(keys, aiChanged)
  const content = new CanvasContent({ tabs: d.tabs, downloads: d.downloads })
  const chat = new ChatService({
    router,
    keys,
    runtime,
    signin,
    host: {
      tabs: () => d.tabs.aiTabs(),
      settings: ai,
      history: (q, n) => d.history.list(q, n, 0),
      semantic: (q, exclude) => features.semantic(q, exclude),
      open: (url) => d.tabs.openForAssistant(url),
      activate: (id) => d.tabs.show(id),
      close: (id) => d.tabs.close(id),
      find: (text) => d.tabs.find(text),
      downloads: () => d.downloads.list(),
      searchWeb: (q) => {
        const engine = SEARCH_ENGINES[d.settings.get().searchEngine] ?? SEARCH_ENGINES.duckduckgo
        return webSearch(content, engine.url, q)
      },
      readHidden: async (url, cap) => {
        const r = (await content.hidden(url, (wc) => wc.executeJavaScript(HIDDEN_TEXT(cap)))) as {
          title?: unknown
          text?: unknown
        } | null
        return r && typeof r.text === 'string'
          ? { title: typeof r.title === 'string' ? r.title.slice(0, 200) : '', text: r.text }
          : null
      },
      fetchBytes: (url) => content.bytes({ url }),
      searchUrl: () =>
        (SEARCH_ENGINES[d.settings.get().searchEngine] ?? SEARCH_ENGINES.duckduckgo).url
    },
    local: () => {
      const st = runtime.snapshot()
      const stopped = [st.chat, st.embed].find((x) => x.state === 'error')
      return {
        supported: st.supported,
        installed: st.installed,
        download: st.download,
        starting: st.chat.state === 'starting' || st.embed.state === 'starting',
        error: st.error ?? stopped?.message ?? null,
        installBytes: st.installBytes
      }
    },
    act: (action) => {
      if (action === 'enable-ai') d.settings.update({ ai: { ...ai(), enabled: true } })
      else if (action === 'download') {
        if (ai().enabled && ai().localProvider === 'local') void runtime.install()
      } else if (action === 'cancel-download') runtime.cancelInstall()
      else if (action === 'retry') runtime.retry()
      else d.tabs.openInternal('settings', 'ai')
    },
    setModel: (choice, chatgptModel) =>
      d.settings.update({
        ai: { ...ai(), chatProvider: choice, ...(chatgptModel ? { chatgptModel } : {}) }
      })
  })
  hooks.chat = chat
  d.settings.onChange(() => chat.changed())

  // ---- settings ----
  let prev = ai()
  let wasInstalled = false
  const wantsPages = (s: AiSettings): boolean =>
    s.enabled && (s.semanticHistory || s.grouping || s.canvas)
  const apply = (next: AiSettings): void => {
    runtime.configure(next.enabled, next.localProvider === 'local')
    if (prev.enabled && !next.enabled) features.forgetAll()
    else if (prev.titles !== next.titles || prev.enabled !== next.enabled) d.tabs.refresh()
    const was = wantsPages(prev)
    prev = next
    if (!was && wantsPages(next) && runtime.available) features.catchUp()
  }
  d.settings.onChange((s) => apply(s.ai))
  apply(ai())
  // AI was already on at the start: read pages and history that came in while it was not running
  if (wantsPages(ai())) {
    setTimeout(() => runtime.available && features.catchUp(), STARTUP_CATCH_UP_MS).unref()
  }

  let size = { at: 0, bytes: 0 }
  const status = (): AiStatus => {
    const now = Date.now()
    if (now - size.at > SIZE_CACHE_MS)
      size = { at: now, bytes: dirSize(aiRoot()) + runtime.externalModelBytes() }
    return {
      ...runtime.snapshot(),
      keys: keys.info(),
      signIn: signin.status,
      chatgptLimited: signin.limited,
      chatgptReauth: signin.reauth,
      dataBytes: size.bytes,
      slowDevice: slowForLocal(totalmem(), availableParallelism())
    }
  }
  runtime.onChange(() => {
    size.at = 0
    aiChanged()
    // the downloads just finished: read what is open and what is in history
    if (runtime.installed && !wasInstalled && wantsPages(ai())) features.catchUp()
    wasInstalled = runtime.installed
  })
  wasInstalled = runtime.installed

  // ---- the settings page ----
  handleInternal('int:ai-status', status)
  handleInternal('int:ai-download', () => {
    if (ai().enabled && ai().localProvider === 'local') void runtime.install()
  })
  handleInternal('int:ai-cancel', () => runtime.cancelInstall())
  handleInternal('int:ai-retry', () => runtime.retry())
  handleInternal('int:ai-remove-local', () => runtime.removeLocal())
  handleInternal('int:ai-remove-data', () => {
    features.forgetAll()
    runtime.removeAll()
    chat.clearAll()
  })
  // the models folder: shown, opened, and moved only to a folder picked in the native dialog
  handleInternal('int:ai-models-open', () => {
    const dir = runtime.modelsDir
    mkdirSync(dir, { recursive: true })
    return shell.openPath(dir)
  })
  handleInternal('int:ai-models-pick', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const opts: OpenDialogOptions = {
      title: 'Folder for AI models',
      defaultPath: runtime.modelsDir,
      properties: ['openDirectory', 'createDirectory']
    }
    const { canceled, filePaths } = await (win
      ? dialog.showOpenDialog(win, opts)
      : dialog.showOpenDialog(opts))
    if (canceled || !filePaths[0]) return null
    const to = filePaths[0]
    await runtime.moveModels(to, () => d.settings.setAiModelsDir(to))
    return to
  })
  handleInternal('int:ai-models-reset', () =>
    runtime.moveModels(defaultModelsDir(), () => d.settings.setAiModelsDir(null))
  )
  handleInternal('int:ai-set-key', async (provider: unknown, key: unknown) => {
    if (!isKeyed(provider) || typeof key !== 'string') throw new Error('Not a provider')
    if (provider === 'google') await checkGeminiKey(key) // one cheap request: say now if it is wrong
    keys.setApiKey(provider, key)
    aiChanged()
    return keys.info()
  })
  handleInternal('int:ai-remove-key', (provider: unknown) => {
    if (!isKeyed(provider)) throw new Error('Not a provider')
    keys.remove(provider)
    aiChanged()
    return keys.info()
  })

  handleInternal('int:ai-signin', (provider: unknown) => {
    if (provider !== 'chatgpt' && provider !== 'openrouter') throw new Error('Not a provider')
    void signin.start(provider)
  })
  // a fixed page, never an address from the page: where to get a free Gemini key
  handleInternal('int:ai-gemini-key-page', () =>
    shell.openExternal('https://aistudio.google.com/apikey')
  )
  handleInternal('int:ai-signin-cancel', () => signin.cancel())
  handleInternal('int:ai-signout', async (provider: unknown) => {
    if (provider === 'chatgpt') await signin.signOutChatgpt()
    else if (provider === 'openrouter') keys.remove('openrouter')
    else throw new Error('Not a provider')
    aiChanged()
    return keys.info()
  })
  handleInternal('int:ai-chatgpt-models', () => chat.chatgptModels().catch(() => []))
  handleInternal('int:ai-chats-clear', () => chat.clearAll())

  app.on('before-quit', () => {
    index.flush()
    runtime.stopAll()
  })
  // app.exit() (a restart) skips before-quit: the servers must not outlive the app
  process.on('exit', () => runtime.stopAll())
  return { features, runtime, router, index, chat, content }
}
