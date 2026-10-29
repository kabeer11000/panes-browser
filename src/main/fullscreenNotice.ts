import { WebContentsView, type BrowserWindow } from 'electron'

const WIDTH = 440
const HEIGHT = 76
const TOP = 18
const SHOW_MS = 3800
const FADE_MS = 400

// A page of its own so the notice needs no bundle: one pill, restyled by two calls.
const PAGE = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;
    font:13px/1.35 system-ui,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;user-select:none}
  #pill{box-sizing:border-box;height:100%;display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:2px;padding:0 20px;border-radius:16px;color:#fff;text-align:center;
    background:rgba(24,24,30,.92);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);
    opacity:0;transform:translateY(-8px);transition:opacity .25s,transform .25s}
  #pill.on{opacity:1;transform:none}
  #pill.off{opacity:0;transition-duration:${FADE_MS}ms}
  b{font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  span{color:rgba(255,255,255,.72)}
  kbd{font:inherit;font-weight:600;padding:1px 7px;border-radius:5px;background:rgba(255,255,255,.16);color:#fff}
  @media (prefers-reduced-motion:reduce){#pill{transition:none}}
</style><div id="pill"><b id="h"></b><span id="t"></span></div><script>
  const pill=document.getElementById('pill')
  window.show=(host,hold)=>{
    document.getElementById('h').textContent=host+' is now full screen'
    document.getElementById('t').innerHTML=hold
      ?'Press and hold <kbd>Esc</kbd> to exit full screen'
      :'Press <kbd>Esc</kbd> to exit full screen'
    pill.className='';void pill.offsetWidth;pill.className='on'
  }
  window.hide=()=>{pill.className='off'}
</script>`

/**
 * The "press Esc to exit full screen" notice every browser shows when a page goes full screen. A
 * small transparent view at the top of the window: it appears with the page, then fades on its own.
 * Pages that grabbed the keyboard (games, remote desktops) need Esc held, and the notice says so.
 */
export class FullscreenNotice {
  private view: WebContentsView | null = null
  private ready: Promise<void> = Promise.resolve()
  private timers: NodeJS.Timeout[] = []

  constructor(private win: BrowserWindow) {
    win.on('resize', () => this.place())
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view
    const view = new WebContentsView({ webPreferences: { sandbox: true } })
    view.setBackgroundColor('#00000000')
    view.setVisible(false)
    this.ready = view.webContents.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(PAGE)
    )
    this.view = view
    return view
  }

  private place(): void {
    if (!this.view || this.win.isDestroyed()) return
    const [w] = this.win.getContentSize()
    this.view.setBounds({ x: Math.round((w - WIDTH) / 2), y: TOP, width: WIDTH, height: HEIGHT })
  }

  show(host: string, hold: boolean): void {
    if (this.win.isDestroyed()) return
    this.clearTimers()
    const view = this.ensureView()
    this.place()
    // Re-adding moves it above the page view, which fills the window while full screen.
    this.win.contentView.addChildView(view)
    void this.ready.then(() => {
      if (!this.view) return
      void view.webContents.executeJavaScript(
        `window.show(${JSON.stringify(host)}, ${hold ? 'true' : 'false'})`
      )
      view.setVisible(true)
    })
    this.timers.push(
      setTimeout(
        () => void view.webContents.executeJavaScript('window.hide()').catch(() => {}),
        SHOW_MS
      ),
      setTimeout(() => view.setVisible(false), SHOW_MS + FADE_MS)
    )
  }

  hide(): void {
    this.clearTimers()
    this.view?.setVisible(false)
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }
}
