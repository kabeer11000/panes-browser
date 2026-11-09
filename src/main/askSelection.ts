import { is } from '@electron-toolkit/utils'
import {
  app,
  clipboard,
  ipcMain,
  WebContentsView,
  type BrowserWindow,
  type IpcMainEvent,
  type WebContents
} from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import {
  askPrompt,
  continueDraft,
  languageName,
  placeNear,
  sanitizeReport,
  type AskAction,
  type SelectionReport
} from '@shared/ask'
import type { AskShow, ChatStreamEvent } from '@shared/types'
import type { ChatService } from './ai/chat'
import { paintView } from './chromeTheme'

const PAD = 14 // room around a card for its shadow, so the view never clips it
const CHIP = { width: 304, height: 32 + PAD * 2 }
const CARD = { width: 408, height: 360 } // fixed: a native view that is resized shows its old frame until it repaints
const SHOW_GAP = 8 - PAD // the card itself ends up 8px from the text; the view's transparent edge overlaps a little
const IDLE_CLOSE_MS = 60_000 // the two small pages are given back when nothing has been selected for a while
const ACTIONS: readonly AskAction[] = ['ask', 'explain', 'translate', 'summarise']

interface Deps {
  win: BrowserWindow
  chat: ChatService
  /** Where the page behind a web contents sits, or null when nothing may be offered for it (private, Tor, hidden). */
  host: (wc: WebContents) => { view: { x: number; y: number }; zoom: number } | null
  /** The page on screen. */
  active: () => WebContents | null
  /** AI is on, has a model to answer, and the person has not turned this off. */
  enabled: () => boolean
  /** Open the chat panel with this in its box. */
  continueInChat: (draft: string) => void
}

interface Source {
  wc: WebContents
  report: SelectionReport
}

interface Turn {
  id: string
  action: AskAction
  question?: string
  answer: string
}

/**
 * Select text on a page and a small chip offers Ask, Explain, Translate and Summarise; the answer shows in a card
 * beside the selection. Both are views of Panes' own above the page, placed from the selection's rectangles, so
 * the page gets nothing added to it (see preload/selection.ts). Never offered for private or Tor tabs, for text
 * fields, or while AI is off; those cases never reach a model.
 */
export class AskSelection {
  private chip: WebContentsView | null = null
  private card: WebContentsView | null = null
  private source: Source | null = null
  private turn: Turn | null = null
  private focusNext = false
  private idle: NodeJS.Timeout | null = null
  /** What each view was last told to show, and whether its page has mounted (it asks with ask:ready). */
  private shown = new Map<'chip' | 'card', AskShow>()
  private ready = new Set<'chip' | 'card'>()

  constructor(private d: Deps) {
    ipcMain.on('sel:report', (e, raw: unknown) => this.report(e, raw))
    const mine = (e: IpcMainEvent): 'chip' | 'card' | null =>
      e.sender === this.chip?.webContents
        ? 'chip'
        : e.sender === this.card?.webContents
          ? 'card'
          : null
    ipcMain.on('ask:run', (e, action: unknown, question: unknown) => {
      if (mine(e) && ACTIONS.includes(action as AskAction))
        this.run(
          action as AskAction,
          typeof question === 'string' ? question.slice(0, 500) : undefined
        )
    })
    ipcMain.on('ask:ready', (e) => {
      const kind = mine(e)
      if (!kind) return
      this.ready.add(kind)
      const data = this.shown.get(kind)
      if (data) e.sender.send('ask:show', data)
    })
    ipcMain.on('ask:stop', (e) => mine(e) && this.stop())
    ipcMain.on('ask:close', (e) => mine(e) && this.close(true))
    ipcMain.on('ask:copy', (e) => {
      if (mine(e) && this.turn?.answer) clipboard.writeText(this.turn.answer)
    })
    ipcMain.on('ask:continue', (e) => {
      if (!mine(e) || !this.source || !this.turn) return
      this.d.continueInChat(
        continueDraft(this.turn.action, this.source.report.text, this.turn.question)
      )
      this.close(false)
    })
    d.win.on('resize', () => this.close(false))
  }

  /** Whether either view is showing. */
  get visible(): boolean {
    return !!(this.chip?.getVisible() || this.card?.getVisible())
  }

  /** The page behind the offer changed (another tab, an overlay): drop the offer if it is no longer on screen. */
  sync(): void {
    if (this.source && (this.source.wc.isDestroyed() || this.source.wc !== this.d.active()))
      this.close(false)
  }

  /** Ctrl+Shift+Y: offer now, for the current selection, with the keyboard on the chip. */
  offerNow(): void {
    const wc = this.d.active()
    if (!wc || !this.d.host(wc)) return
    this.focusNext = true
    wc.send('sel:poll')
  }

  private report(e: IpcMainEvent, raw: unknown): void {
    const wc = e.sender
    if (raw === null) {
      if (this.source?.wc === wc && !this.turn) this.close(false)
      return
    }
    if (this.card?.getVisible()) return // an answer is on screen: it stays until closed
    const host = this.d.host(wc)
    const report = host ? sanitizeReport(raw) : null
    if (!host || !report || wc !== this.d.active() || !this.d.enabled()) {
      this.focusNext = false
      return
    }
    this.source = { wc, report }
    this.turn = null
    this.showChip(host)
  }

  // ---- views ----

  private ensure(kind: 'chip' | 'card'): WebContentsView {
    const have = kind === 'chip' ? this.chip : this.card
    if (have && !have.webContents.isDestroyed()) return have
    const view = new WebContentsView({
      webPreferences: { sandbox: true, preload: join(__dirname, '../preload/ask.js') }
    })
    view.setBackgroundColor('#00000000')
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && dev) void view.webContents.loadURL(`${dev}/ask.html?v=${kind}`)
    else
      void view.webContents.loadFile(join(__dirname, '../renderer/ask.html'), {
        query: { v: kind }
      })
    // a view that had the keyboard and lost it (a click on the page, another window) closes the offer
    view.webContents.on('blur', () => {
      if (view.getVisible()) this.close(false)
    })
    if (kind === 'chip') this.chip = view
    else this.card = view
    return view
  }

  private show(
    kind: 'chip' | 'card',
    host: { view: { x: number; y: number }; zoom: number },
    data: Omit<AskShow, 'below'>
  ): void {
    if (!this.source || this.d.win.isDestroyed()) return
    const view = this.ensure(kind)
    const [width, height] = this.d.win.getContentSize()
    const size = kind === 'chip' ? CHIP : CARD
    const at = placeNear(
      kind,
      this.source.report,
      host.view,
      host.zoom,
      { width, height },
      size,
      SHOW_GAP
    )
    view.setBounds({ x: at.x, y: at.y, width: size.width, height: size.height })
    this.d.win.contentView.addChildView(view) // on top of the page views
    paintView(view.webContents)
    view.setVisible(true)
    const full = { ...data, below: at.below }
    this.shown.set(kind, full)
    if (this.ready.has(kind)) view.webContents.send('ask:show', full)
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
  }

  private showChip(host: { view: { x: number; y: number }; zoom: number }): void {
    if (!this.source) return
    this.card?.setVisible(false)
    this.show('chip', host, {
      action: 'ask',
      preview: this.source.report.text.slice(0, 80),
      needsQuestion: false
    })
    if (this.focusNext) {
      this.focusNext = false
      this.chip?.webContents.focus()
    }
  }

  /** Hide both; `refocus` gives the keyboard back to the page (Esc), else the page already has it. */
  close(refocus: boolean): void {
    this.stop()
    this.focusNext = false
    const wc = this.source?.wc
    this.chip?.setVisible(false)
    this.card?.setVisible(false)
    this.turn = null
    this.source = null
    if (refocus && wc && !wc.isDestroyed()) wc.focus()
    if (!this.idle)
      this.idle = setTimeout(() => {
        this.idle = null
        if (!this.visible) this.dispose()
      }, IDLE_CLOSE_MS)
  }

  private dispose(): void {
    for (const view of [this.chip, this.card]) {
      if (!view) continue
      if (!this.d.win.isDestroyed()) this.d.win.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close()
    }
    this.chip = this.card = null
    this.ready.clear()
    this.shown.clear()
  }

  // ---- running ----

  private run(action: AskAction, question?: string): void {
    const src = this.source
    const host = src && this.d.host(src.wc)
    if (!src || !host || !this.d.enabled()) return this.close(false)
    this.stop()
    this.chip?.setVisible(false)
    const wantsQuestion = action === 'ask' && !question?.trim()
    this.turn = { id: randomUUID(), action, question, answer: '' }
    this.show('card', host, {
      action,
      preview: src.report.text.slice(0, 160),
      needsQuestion: wantsQuestion
    })
    this.card?.webContents.focus()
    if (wantsQuestion) return
    const turn = this.turn
    const card = this.card
    const sink = {
      isDestroyed: (): boolean => !card || card.webContents.isDestroyed() || this.turn !== turn,
      webContents: {
        send: (channel: string, ...args: unknown[]): void => {
          const ev = args[0] as ChatStreamEvent
          if (this.turn !== turn || !card || card.webContents.isDestroyed()) return
          if (ev.kind === 'text') turn.answer += ev.text
          card.webContents.send(channel, ev)
        }
      }
    }
    const prompt = askPrompt(action, src.report.text, {
      question,
      language: languageName(app.getLocale()),
      page: src.wc.getTitle()
    })
    void this.d.chat.send(sink, {
      turnId: turn.id,
      messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: prompt }] }],
      chips: [],
      mode: 'popover'
    })
  }

  private stop(): void {
    if (this.turn) this.d.chat.stop(this.turn.id)
  }
}
