import { WebContentsView, screen, type BrowserWindow } from 'electron'
import { NavSwipe, type NavAction, type NavEvent } from '@shared/navSwipe'
import { setTouchpadNav, type TouchFrame } from './touchpad'
import type { SettingsStore } from './settings'
import type { TabManager } from './tabs'

const SIZE = 64
const INSET = 10

// A page of its own (no bundle): one round badge that slides in from the edge and fills as the fingers travel.
const PAGE = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden}
  #b{position:absolute;inset:8px;border-radius:50%;display:grid;place-items:center;
    background:rgba(24,24,30,.86);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);color:#fff;
    opacity:0;transition:opacity .12s,background .12s}
  #b.full{background:var(--accent,#8b8bff)}
  svg{position:absolute;inset:0}
  #ring{fill:none;stroke:var(--accent,#8b8bff);stroke-width:3;stroke-linecap:round;transform:rotate(-90deg);
    transform-origin:50% 50%}
  #b.full #ring{stroke:transparent}
  #i{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;
    stroke-linejoin:round}
</style><div id="b"><svg viewBox="0 0 48 48"><circle id="ring" cx="24" cy="24" r="22.5" pathLength="1"
  stroke-dasharray="0 1"/></svg><svg id="i" viewBox="0 0 24 24"><path id="p"/></svg></div><script>
  const b=document.getElementById('b'),ring=document.getElementById('ring'),p=document.getElementById('p')
  const paths={back:'M15 5l-7 7 7 7',forward:'M9 5l7 7-7 7',prevTab:'M4 7h11v10H4zM20 9l-3 3 3 3',
    nextTab:'M9 7h11v10H9zM4 9l3 3-3 3'}
  window.set=(action,progress,accent)=>{
    document.documentElement.style.setProperty('--accent',accent)
    p.setAttribute('d',paths[action])
    ring.setAttribute('stroke-dasharray',progress+' 1')
    b.className=progress>=1?'full':''
    b.style.opacity=String(Math.min(1,0.25+progress))
  }
  window.hide=()=>{b.style.opacity='0'}
</script>`

/**
 * Asks the page whether what is under the pointer can still scroll sideways the way the fingers are going (a
 * carousel, a wide table, a map): then a sideways swipe is that scroll, not back or forward. Runs in its own world,
 * out of the page's sight. `dir` is -1 when the content would move to show what is on its left.
 */
const SCROLLS = `((x, y, dir) => {
  for (let el = document.elementFromPoint(x, y); el; el = el.parentElement) {
    const root = el === document.scrollingElement || el === document.body
    const o = getComputedStyle(el).overflowX
    if (!root && o !== 'auto' && o !== 'scroll') continue
    if (el.scrollWidth <= el.clientWidth + 1) continue
    if (dir < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true
  }
  return false
})`

/**
 * The tab view's two-finger touchpad swipes (Windows, from the raw contacts; see shared/navSwipe.ts): sideways for
 * back and forward, in from the pad's left or right edge for the previous or next tab. A badge at that side of the
 * page follows the fingers; lifting past the mark acts. Each is on or off in Settings.
 */
export class NavGestures {
  private swipe = new NavSwipe()
  private view: WebContentsView | null = null
  private ready: Promise<void> = Promise.resolve()
  private shown: { action: NavAction; progress: number } | null = null
  /** This gesture's sideways scroll belongs to the page (null: not asked yet, or not a history swipe). */
  private pageScrolls: boolean | null = null
  private asking = false
  private on = false
  private fingers = 0

  constructor(
    private readonly win: BrowserWindow,
    private readonly tabs: TabManager,
    private readonly settings: SettingsStore
  ) {
    settings.onChange(() => this.apply())
    win.on('closed', () => (this.view = null))
    // after startup: the raw input reader loads a native module
    setTimeout(() => this.apply(), 3000)
  }

  private apply(): void {
    if (process.platform !== 'win32' || this.win.isDestroyed()) return
    const s = this.settings.get()
    this.swipe.history = s.swipeHistory
    this.swipe.tabs = s.swipeTabs
    const want = s.swipeHistory || s.swipeTabs
    if (want === this.on) return
    this.on = want
    setTouchpadNav(this.win, want ? (f) => this.frame(f) : null)
    if (!want) this.hide()
  }

  private frame(f: TouchFrame): void {
    if (!this.tabs.pageShowing()) {
      // still let the recogniser see the fingers, so a swipe begun elsewhere is not picked up halfway
      this.swipe.touch({ ...f, fingers: f.fingers === 2 ? 3 : f.fingers })
      this.fingers = f.fingers === 2 ? 3 : f.fingers
      this.hide()
      return
    }
    if (f.fingers === 2 && this.fingers < 2) this.pageScrolls = null
    this.fingers = f.fingers
    const e = this.swipe.touch(f)
    if (e) this.handle(e)
  }

  private handle(e: NavEvent): void {
    if (e.kind === 'cancel') return this.hide()
    const history = e.action === 'back' || e.action === 'forward'
    if (history && this.pageScrolls !== false) {
      // the page's own sideways scroll comes first; until it says it has none, nothing is shown or done
      if (this.pageScrolls === null && !this.asking) this.ask(e.action)
      if (e.kind === 'commit') this.hide()
      return
    }
    if (e.kind === 'track') return this.show(e.action, e.progress)
    this.hide()
    if (e.action === 'back') this.tabs.back()
    else if (e.action === 'forward') this.tabs.forward()
    else this.tabs.step(e.action === 'prevTab' ? -1 : 1)
  }

  private ask(action: NavAction): void {
    const wc = this.tabs.activeContents()
    const rect = this.tabs.activeRect()
    if (!wc || !rect || this.win.isDestroyed()) {
      this.pageScrolls = false
      return
    }
    const p = screen.getCursorScreenPoint()
    const c = this.win.getContentBounds()
    const zoom = wc.getZoomFactor() || 1
    const x = (p.x - c.x - rect.x) / zoom
    const y = (p.y - c.y - rect.y) / zoom
    this.asking = true
    // fingers moving right (back) scroll the content to show its left
    const dir = action === 'back' ? -1 : 1
    wc.executeJavaScriptInIsolatedWorld(1999, [{ code: `${SCROLLS}(${x}, ${y}, ${dir})` }])
      .then((scrolls: unknown) => (this.pageScrolls = scrolls === true))
      .catch(() => (this.pageScrolls = false))
      .finally(() => (this.asking = false))
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view
    const view = new WebContentsView({ webPreferences: { sandbox: true } })
    view.setBackgroundColor('#00000000')
    view.setVisible(false)
    this.ready = view.webContents
      .loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE))
      .catch(() => {})
    this.view = view
    return view
  }

  private show(action: NavAction, progress: number): void {
    const rect = this.tabs.activeRect()
    if (!rect || this.win.isDestroyed()) return
    const last = this.shown
    // about 125 frames a second come in; the badge needs a fraction of that
    if (last && last.action === action && Math.abs(last.progress - progress) < 0.04 && progress < 1)
      return
    const first = !last
    this.shown = { action, progress }
    const view = this.ensureView()
    const left = action === 'back' || action === 'prevTab'
    // slides in from the page's edge as the fingers travel
    const slide = Math.round((1 - Math.min(1, progress)) * -SIZE * 0.6)
    view.setBounds({
      x: Math.round(left ? rect.x + INSET + slide : rect.x + rect.width - SIZE - INSET - slide),
      y: Math.round(rect.y + (rect.height - SIZE) / 2),
      width: SIZE,
      height: SIZE
    })
    // re-adding puts it above the page views
    if (first) this.win.contentView.addChildView(view)
    const accent = JSON.stringify(this.settings.get().accent || '#8b8bff')
    void this.ready.then(() => {
      if (!this.view || !this.shown) return
      void view.webContents
        .executeJavaScript(`window.set('${action}', ${progress}, ${accent})`)
        .catch(() => {})
      if (first) view.setVisible(true)
    })
  }

  private hide(): void {
    if (!this.shown) return
    this.shown = null
    const view = this.view
    if (!view) return
    void view.webContents.executeJavaScript('window.hide()').catch(() => {})
    view.setVisible(false)
  }
}
