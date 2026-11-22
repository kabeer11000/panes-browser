import { WebContentsView, screen, type BrowserWindow } from 'electron'
import { NavSwipe, type NavAction, type NavEvent } from '@shared/navSwipe'
import { setTouchpadNav, type TouchFrame } from './touchpad'
import type { SettingsStore } from './settings'
import type { TabManager } from './tabs'

const SIZE = 64
const INSET = 10

// A page of its own (no bundle): one round badge that slides in from the edge, its ring filling as the fingers travel;
// at the mark it fills with the accent and springs, so lifting is a sure thing. Muted when there is nowhere to go.
const PAGE = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden}
  #b{position:absolute;inset:10px;border-radius:50%;display:grid;place-items:center;color:#fff;
    background:rgba(22,22,28,.9);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14),0 6px 18px rgba(0,0,0,.28);
    opacity:0;transform:scale(.86);transition:opacity .14s,background .16s,transform .32s cubic-bezier(.34,1.56,.64,1)}
  #b.full{background:var(--accent,#8b8bff);transform:scale(1.06);box-shadow:0 8px 22px rgba(0,0,0,.32)}
  #b.none{color:rgba(255,255,255,.4)}
  svg{position:absolute;inset:0}
  #ring{fill:none;stroke:var(--accent,#8b8bff);stroke-width:3;stroke-linecap:round;transform:rotate(-90deg);
    transform-origin:50% 50%}
  #b.full #ring,#b.none #ring{stroke:transparent}
  #i{inset:auto;position:relative;width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.4;
    stroke-linecap:round;stroke-linejoin:round;transition:transform .2s}
</style><div id="b"><svg viewBox="0 0 44 44"><circle id="ring" cx="22" cy="22" r="20.5" pathLength="1"
  stroke-dasharray="0 1"/></svg><svg id="i" viewBox="0 0 24 24"><path id="p"/></svg></div><script>
  const b=document.getElementById('b'),ring=document.getElementById('ring'),p=document.getElementById('p'),
    i=document.getElementById('i')
  const paths={back:'M19 12H5M11 6l-6 6 6 6',forward:'M5 12h14M13 6l6 6-6 6',prevTab:'M4 7h11v10H4zM20 9l-3 3 3 3',
    nextTab:'M9 7h11v10H9zM4 9l3 3-3 3'}
  window.set=(action,progress,accent,able)=>{
    document.documentElement.style.setProperty('--accent',accent)
    p.setAttribute('d',paths[action])
    ring.setAttribute('stroke-dasharray',progress+' 1')
    b.className=!able?'none':progress>=1?'full':''
    b.style.opacity=String(able?Math.min(1,0.3+progress):Math.min(0.7,0.2+progress))
    if(progress<1)b.style.transform='scale('+(0.86+0.12*Math.min(1,progress))+')'
    else b.style.transform=''
    // the arrow leans the way it will go
    const lean=(action==='back'||action==='prevTab'?-1:1)*Math.min(1,progress)*(able?2:0)
    i.style.transform='translateX('+lean+'px)'
  }
  window.hide=()=>{b.style.opacity='0';b.style.transform='scale(.86)'}
</script>`

/**
 * Asks the page whether what is under the pointer can still scroll sideways (a carousel, a wide table, a map), each
 * way: then a sideways swipe that way is that scroll, not back or forward. Runs in its own world, out of the page's
 * sight. Answers `[left, right]`: whether the content can move to show more on its left, and on its right.
 */
const SCROLLS = `((x, y) => {
  const se = document.scrollingElement
  const ox = (el) => (el ? getComputedStyle(el).overflowX : 'visible')
  // the page itself scrolls sideways unless html (or body, whose overflow passes up to the page when html's is
  // visible) hides it: most sites hide a few pixels of overflow, and that must not take the swipe away
  const html = ox(document.documentElement)
  const page = html !== 'visible' ? html : ox(document.body)
  let left = false, right = false
  for (let el = document.elementFromPoint(x, y); el; el = el.parentElement) {
    if (el === document.body && se !== document.body) continue // its overflow is the page's, handled at html
    const root = el === se
    const o = root ? page : ox(el)
    if (root ? o === 'hidden' || o === 'clip' : o !== 'auto' && o !== 'scroll') continue
    if (el.scrollWidth <= el.clientWidth + 1) continue
    if (el.scrollLeft > 0) left = true
    if (el.scrollLeft + el.clientWidth < el.scrollWidth - 1) right = true
  }
  return [left, right]
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
  private shown: { action: NavAction; progress: number; able: boolean } | null = null
  /** Whether the page under the fingers scrolls sideways itself, [left, right]; null until it answers. */
  private pageScrolls: [boolean, boolean] | null = null
  /** Which gesture the answer is for, so a late one from the last swipe is dropped. */
  private gesture = 0
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
    if (!this.tabs.swipeTarget()) {
      // still let the recogniser see the fingers, so a swipe begun elsewhere is not picked up halfway
      this.swipe.touch({ ...f, fingers: f.fingers === 2 ? 3 : f.fingers })
      this.fingers = f.fingers === 2 ? 3 : f.fingers
      this.hide()
      return
    }
    // asked as the fingers land, so the answer is in before a quick flick is over
    if (f.fingers === 2 && this.fingers < 2) this.ask()
    this.fingers = f.fingers
    const e = this.swipe.touch(f)
    if (e) this.handle(e)
  }

  private handle(e: NavEvent): void {
    if (e.kind === 'cancel') return this.hide()
    const history = e.action === 'back' || e.action === 'forward'
    if (history) {
      // the page's own sideways scroll comes first; until it says it has none that way, nothing is shown or done
      // (fingers moving right, back, scroll the content to show its left)
      const scrolls = this.pageScrolls
      if (!scrolls || scrolls[e.action === 'back' ? 0 : 1]) return this.hide()
    }
    // on the board's preview there is no tab row to step through: only back and forward
    if (!history && this.tabs.swipeTarget()?.preview) return this.hide()
    const nav = this.tabs.swipeTarget()?.wc.navigationHistory
    const able =
      e.action === 'back'
        ? !!nav?.canGoBack()
        : e.action === 'forward'
          ? !!nav?.canGoForward()
          : true
    if (e.kind === 'track') return this.show(e.action, e.progress, able)
    this.hide()
    if (!able) return
    // the page measured, which in a split is the pane last used
    if (e.action === 'back') nav?.goBack()
    else if (e.action === 'forward') nav?.goForward()
    else this.tabs.step(e.action === 'prevTab' ? -1 : 1)
  }

  private ask(): void {
    const n = ++this.gesture
    this.pageScrolls = null
    const target = this.tabs.swipeTarget()
    const wc = target?.wc
    const rect = target?.rect
    if (!wc || !rect || this.win.isDestroyed()) {
      this.pageScrolls = [false, false]
      return
    }
    const p = screen.getCursorScreenPoint()
    const c = this.win.getContentBounds()
    const zoom = wc.getZoomFactor() || 1
    const x = (p.x - c.x - rect.x) / zoom
    const y = (p.y - c.y - rect.y) / zoom
    const answer = (v: [boolean, boolean]): void => {
      if (n === this.gesture) this.pageScrolls = v
    }
    wc.executeJavaScriptInIsolatedWorld(1999, [{ code: `${SCROLLS}(${x}, ${y})` }])
      .then((r: unknown) =>
        answer(Array.isArray(r) ? [r[0] === true, r[1] === true] : [false, false])
      )
      .catch(() => answer([false, false]))
    // a page busy running script cannot answer: past a moment, take it as not scrolling sideways
    setTimeout(() => answer(this.pageScrolls ?? [false, false]), 120)
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

  private show(action: NavAction, progress: number, able: boolean): void {
    const rect = this.tabs.swipeTarget()?.rect
    if (!rect || this.win.isDestroyed()) return
    const last = this.shown
    // about 125 frames a second come in; the badge needs a fraction of that
    if (
      last &&
      last.action === action &&
      last.able === able &&
      Math.abs(last.progress - progress) < 0.04 &&
      progress < 1
    )
      return
    const first = !last
    this.shown = { action, progress, able }
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
        .executeJavaScript(`window.set('${action}', ${progress}, ${accent}, ${able})`)
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
