import {
  clipboard,
  ClipboardItem,
  net,
  WebContentsView,
  type BrowserWindow,
  type NativeImage,
  type Rectangle,
  type WebContents
} from 'electron'
import { randomBytes } from 'crypto'
import {
  boxOf,
  boxPolygon,
  isTap,
  LENS_UPLOAD,
  multipartFile,
  REGION_TEXT_MAX,
  regionTextInPage,
  scalePts,
  type Box,
  type Pt
} from '@shared/circle'
import type { TabKind } from '@shared/tabkind'

const LENS_TIMEOUT_MS = 20_000

/** A world of our own in the page: the page's scripts cannot see or change what reads its text. */
const WORLD = 1207

interface Target {
  wc: WebContents
  /** Where the page's view sits in the window. */
  bounds: Rectangle
  kind: TabKind
}

interface Deps {
  win: BrowserWindow
  /** The page on screen (the canvas preview's when it is open), or null. */
  target: () => Target | null
  /** Open a new tab next to this one: an address, or words to search for. */
  open: (input: string) => void
  /** Open the chat panel with this in its box. */
  ask: (text: string) => void
}

type Offer = { action: 'copy' | 'search' | 'lens' | 'ask' } | { pts: Pt[] } | null

// The overlay: a page of its own (no bundle, no preload), driven from here with executeJavaScript. Each call that
// waits for the person returns a promise that settles when they act; Esc settles it with null.
const PAGE = `<!doctype html><meta charset="utf-8"><style>
:root{color-scheme:dark;--a:#7aa2ff;--b:#c77dff;--c:#ff7eb6;--d:#ffd166}
html,body{margin:0;height:100%;overflow:hidden;cursor:crosshair;user-select:none;
  font:13px/1.35 system-ui,'Segoe UI',sans-serif;color:#fff}
#shot{position:absolute;inset:0;width:100%;height:100%;object-fit:fill}
#dim{position:absolute;inset:0;background:rgb(8 8 14/.38);transition:background .25s}
body.picked #dim{background:transparent}
svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
#veil{fill:rgb(8 8 14/.5);opacity:0;transition:opacity .25s}
body.picked #veil{opacity:1}
#stroke{fill:none;stroke:url(#g);stroke-width:4;stroke-linecap:round;stroke-linejoin:round;
  filter:drop-shadow(0 0 6px var(--b)) drop-shadow(0 0 14px rgb(122 162 255/.6))}
body.picked #stroke{fill:rgb(255 255 255/.04)}
#edge{position:absolute;inset:0;pointer-events:none;border-radius:2px;padding:3px;
  background:conic-gradient(from var(--r,0deg),var(--a),var(--b),var(--c),var(--d),var(--a));
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;
  animation:spin 2.4s linear infinite,fade .5s ease-out both;opacity:.9}
body.picked #edge{opacity:0;transition:opacity .3s}
@property --r{syntax:'<angle>';inherits:false;initial-value:0deg}
@keyframes spin{to{--r:360deg}}
@keyframes fade{from{opacity:0}}
#hint{position:absolute;left:50%;top:16px;translate:-50% 0;padding:8px 14px;border-radius:999px;
  background:rgb(20 20 28/.86);box-shadow:0 6px 24px rgb(0 0 0/.35),inset 0 0 0 1px rgb(255 255 255/.12);
  pointer-events:none;white-space:nowrap;animation:drop .35s cubic-bezier(.2,1.2,.3,1) both}
body.picked #hint{opacity:0;transition:opacity .2s}
@keyframes drop{from{opacity:0;translate:-50% -10px}}
#scan{position:absolute;pointer-events:none;border-radius:10px;overflow:hidden;display:none}
#scan::after{content:'';position:absolute;inset:0;
  background:linear-gradient(100deg,transparent 30%,rgb(255 255 255/.28) 50%,transparent 70%);
  background-size:250% 100%;animation:sweep 1s linear infinite}
@keyframes sweep{from{background-position:120% 0}to{background-position:-120% 0}}
#bar{position:absolute;display:none;width:min(420px,calc(100% - 24px));padding:10px;border-radius:14px;
  background:rgb(22 22 30/.97);box-shadow:0 12px 40px rgb(0 0 0/.45),inset 0 0 0 1px rgb(255 255 255/.12);
  cursor:default;animation:pop .28s cubic-bezier(.2,1.2,.3,1) both}
@keyframes pop{from{opacity:0;scale:.96}}
#text{max-height:3.9em;overflow:hidden;color:rgb(255 255 255/.82);margin:0 2px 10px;white-space:pre-wrap;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
#text:empty{display:none}
#acts{display:flex;gap:6px;flex-wrap:wrap}
button{font:inherit;color:#fff;border:0;border-radius:9px;padding:7px 12px;cursor:pointer;
  background:rgb(255 255 255/.09);box-shadow:inset 0 0 0 1px rgb(255 255 255/.1);transition:background .12s}
button:hover,button:focus-visible{background:rgb(255 255 255/.18);outline:none}
button.main{background:linear-gradient(120deg,var(--a),var(--b));box-shadow:none}
button.main:hover,button.main:focus-visible{filter:brightness(1.12)}
button[hidden]{display:none}
#x{margin-left:auto;padding:7px 10px}
#toast{position:absolute;left:50%;bottom:28px;translate:-50% 0;padding:8px 14px;border-radius:999px;
  background:rgb(20 20 28/.92);display:none;animation:drop .25s ease-out both}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
<img id="shot" alt=""><div id="dim"></div>
<svg><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#7aa2ff"/><stop offset=".35" stop-color="#c77dff"/><stop offset=".7" stop-color="#ff7eb6"/><stop offset="1" stop-color="#ffd166"/>
<animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur="3s" repeatCount="indefinite"/>
</linearGradient><mask id="m"><rect width="100%" height="100%" fill="#fff"/><path id="hole" fill="#000"/></mask></defs>
<rect id="veil" width="100%" height="100%" mask="url(#m)"/><path id="stroke"/></svg>
<div id="edge"></div><div id="hint">Circle, scribble or tap anything &middot; Esc to close</div>
<div id="scan"></div>
<div id="bar" role="dialog" aria-label="Circle to search"><div id="text"></div><div id="acts">
<button class="main" data-a="search">Search</button><button data-a="lens">Search image</button>
<button data-a="copy">Copy</button><button data-a="ask">Ask AI</button>
<button id="x" data-a="close" aria-label="Close">&#x2715;</button></div></div>
<div id="toast"></div>
<script>
const $=(id)=>document.getElementById(id)
let pts=[],drawing=false,waiter=null
const d=(p,close)=>p.length?'M'+p.map(q=>q.x.toFixed(1)+' '+q.y.toFixed(1)).join('L')+(close?'Z':''):''
const settle=(v)=>{const w=waiter;waiter=null;if(w)w(v)}
window.setShot=(url)=>{$('shot').src=url}
addEventListener('pointerdown',(e)=>{
  if(e.button!==0||e.target.closest('#bar'))return
  drawing=true;pts=[{x:e.clientX,y:e.clientY}]
  document.body.classList.remove('picked');$('bar').style.display='none';$('scan').style.display='none'
  $('stroke').setAttribute('d',d(pts));document.body.setPointerCapture?.(e.pointerId)
})
addEventListener('pointermove',(e)=>{
  if(!drawing)return
  for(const c of e.getCoalescedEvents?.()??[e])pts.push({x:c.clientX,y:c.clientY})
  $('stroke').setAttribute('d',d(pts))
})
addEventListener('pointerup',()=>{
  if(!drawing)return
  drawing=false
  $('stroke').setAttribute('d',d(pts,true));$('hole').setAttribute('d',d(pts,true))
  document.body.classList.add('picked')
  settle({pts})
})
addEventListener('keydown',(e)=>{
  if(e.key==='Escape'){e.preventDefault();settle(null)}
  else if(e.key==='Enter'&&$('bar').style.display==='block'&&!e.target.closest('button')){e.preventDefault();settle({action:'search'})}
  else if((e.ctrlKey||e.metaKey)&&e.key==='c'&&$('bar').style.display==='block'){e.preventDefault();settle({action:'copy'})}
})
$('acts').addEventListener('click',(e)=>{
  const a=e.target.closest('button')?.dataset.a;if(!a)return
  settle(a==='close'?null:{action:a})
})
window.lasso=()=>new Promise((r)=>{waiter=r})
const place=(el,b,w,h)=>{
  const W=innerWidth,H=innerHeight
  el.style.left=Math.max(12,Math.min(W-w-12,b.x+b.width/2-w/2))+'px'
  const below=b.y+b.height+12
  el.style.top=(below+h<H-12?below:Math.max(12,b.y-h-12))+'px'
}
window.outline=(b)=>{
  const p=[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}]
  $('stroke').setAttribute('d',d(p,true));$('hole').setAttribute('d',d(p,true));document.body.classList.add('picked')
}
window.scan=(b)=>{const s=$('scan');Object.assign(s.style,{display:'block',left:b.x+'px',top:b.y+'px',width:b.width+'px',height:b.height+'px'})}
window.offer=(b,text,canAsk,canSearch,lensFirst)=>{
  $('scan').style.display='none'
  $('text').textContent=text
  document.querySelector('[data-a=ask]').hidden=!canAsk||!text
  document.querySelector('[data-a=search]').hidden=!canSearch||!text
  document.querySelector('[data-a=lens]').classList.toggle('main',lensFirst)
  document.querySelector('[data-a=search]').classList.toggle('main',!lensFirst)
  const bar=$('bar');bar.style.display='block'
  place(bar,b,bar.offsetWidth,bar.offsetHeight)
  ;(bar.querySelector('button.main:not([hidden])')||bar.querySelector('button:not([hidden])')).focus()
  return new Promise((r)=>{waiter=r})
}
window.toast=(t)=>{$('bar').style.display='none';const s=$('toast');s.textContent=t;s.style.display='block'}
</script>`

/**
 * Circle to search (Ctrl+Shift+S, or shake the mouse over a page): a frozen picture of the page with a lasso over it.
 * What is circled (or tapped) is read from the page's own text and offered: search it, copy it, ask the assistant
 * about it, or send the picture of it to Google Lens. Nothing leaves Panes until one of those is chosen.
 */
export class CircleSearch {
  private view: WebContentsView | null = null
  private running = false

  constructor(private d: Deps) {
    d.win.on('resize', () => this.close())
  }

  get open(): boolean {
    return this.running
  }

  async start(): Promise<void> {
    if (this.running || this.d.win.isDestroyed()) return
    const t = this.d.target()
    if (!t || t.wc.isDestroyed() || t.bounds.width < 40 || t.bounds.height < 40) return
    this.running = true
    const stop = (): void => this.close()
    // the page leaving: not a same-document change (a hash, a history push), which a page makes on its own
    const left = (d: { isMainFrame: boolean; isSameDocument: boolean }): void => {
      if (d.isMainFrame && !d.isSameDocument) stop()
    }
    t.wc.on('did-start-navigation', left)
    t.wc.once('destroyed', stop)
    try {
      await this.run(t)
    } catch {
      // the overlay or the page went away: nothing to finish
    } finally {
      t.wc.removeListener('did-start-navigation', left)
      t.wc.removeListener('destroyed', stop)
      this.close()
    }
  }

  close(): void {
    const v = this.view
    this.view = null
    this.running = false
    if (!v) return
    if (!this.d.win.isDestroyed()) this.d.win.contentView.removeChildView(v)
    if (!v.webContents.isDestroyed()) v.webContents.close()
    if (!this.d.win.isDestroyed()) this.d.win.webContents.focus()
  }

  private async run(t: Target): Promise<void> {
    const shot = await t.wc.capturePage()
    if (!this.running) return
    const view = new WebContentsView({ webPreferences: { sandbox: true, javascript: true } })
    this.view = view
    view.setBackgroundColor('#00000000')
    view.setBounds(t.bounds)
    await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`)
    if (!this.running) return
    const js = <T>(code: string): Promise<T> =>
      view.webContents.executeJavaScript(code) as Promise<T>
    await js(
      `setShot(${JSON.stringify(`data:image/jpeg;base64,${shot.toJPEG(88).toString('base64')}`)})`
    )
    this.d.win.contentView.addChildView(view)
    view.webContents.focus()

    const zoom = t.wc.getZoomFactor() || 1
    const normal = t.kind === 'normal'
    let picked = await js<{ pts: Pt[] } | null>('lasso()')
    while (picked && this.running) {
      const pts = picked.pts
      const tap = isTap(pts)
      let box = boxOf(pts)
      if (!tap) await js(`scan(${JSON.stringify(box)})`)
      const poly = scalePts(tap ? boxPolygon(box) : pts, 1 / zoom)
      const at = tap
        ? { x: (box.x + box.width / 2) / zoom, y: (box.y + box.height / 2) / zoom }
        : null
      const found = await t.wc
        .executeJavaScriptInIsolatedWorld(WORLD, [
          {
            code: `(${regionTextInPage.toString()})(${JSON.stringify(poly)}, ${JSON.stringify(at)}, ${REGION_TEXT_MAX})`
          }
        ])
        .catch(() => ({ text: '', box: null }) as ReturnType<typeof regionTextInPage>)
      if (!this.running) return
      if (found.box) {
        box = {
          x: found.box.x * zoom,
          y: found.box.y * zoom,
          width: found.box.width * zoom,
          height: found.box.height * zoom
        }
        await js(`outline(${JSON.stringify(box)})`)
      }
      const text = found.text.trim()
      const offer = await js<Offer>(
        `offer(${JSON.stringify(box)}, ${JSON.stringify(text.slice(0, 600))}, ${normal}, true, ${!!found.media || !text})`
      )
      if (!offer) return
      if ('pts' in offer) {
        picked = offer
        continue
      }
      await this.act(offer.action, text, crop(shot, box, t.bounds), t, js)
      return
    }
  }

  private async act(
    action: 'copy' | 'search' | 'lens' | 'ask',
    text: string,
    image: NativeImage,
    t: Target,
    js: <T>(code: string) => Promise<T>
  ): Promise<void> {
    if (action === 'copy') {
      if (text) await clipboard.writeText(text)
      else
        await clipboard.write([
          new ClipboardItem({
            'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' })
          })
        ])
      await js(`toast(${JSON.stringify(text ? 'Text copied' : 'Picture copied')})`)
      await new Promise((r) => setTimeout(r, 650))
    } else if (action === 'search') {
      this.close()
      this.d.open(text.replace(/\s+/g, ' ').slice(0, 300))
    } else if (action === 'ask') {
      this.close()
      this.d.ask(text)
    } else {
      await js(`toast('Searching the picture...')`)
      const url = await lens(t.wc, image)
      this.close()
      if (url) this.d.open(url)
    }
  }
}

/** The part of the page picture inside `box` (window pixels of the view), at the picture's own resolution. */
function crop(shot: NativeImage, box: Box, bounds: Rectangle): NativeImage {
  const size = shot.getSize()
  const k = size.width / Math.max(1, bounds.width)
  const x = Math.max(0, Math.floor(box.x * k))
  const y = Math.max(0, Math.floor(box.y * k))
  const width = Math.max(1, Math.min(size.width - x, Math.ceil(box.width * k)))
  const height = Math.max(1, Math.min(size.height - y, Math.ceil(box.height * k)))
  return shot.crop({ x, y, width, height })
}

/**
 * Upload a picture to Google Lens from the page's own session (its proxy, Tor's for a Tor tab, and its cookies) and
 * return the results page it redirects to, or null.
 */
async function lens(wc: WebContents, image: NativeImage): Promise<string | null> {
  const boundary = `----panes${randomBytes(12).toString('hex')}`
  const body = multipartFile(
    'encoded_image',
    'circle.jpg',
    'image/jpeg',
    image.toJPEG(90),
    boundary
  )
  // net.request, not fetch: Electron's fetch either refuses a redirect it is told not to follow or, following it,
  // does not say where it went; the results page's address is all that is needed
  return new Promise((resolve) => {
    const done = (url: string | null): void => {
      clearTimeout(timer)
      resolve(url && /^https:\/\/(www\.)?google\.[a-z.]+\//.test(url) ? url : null)
    }
    const timer = setTimeout(() => {
      req.abort()
      done(null)
    }, LENS_TIMEOUT_MS)
    const req = net.request({
      method: 'POST',
      url: LENS_UPLOAD,
      session: wc.session,
      redirect: 'manual'
    })
    req.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`)
    req.on('redirect', (_status, _method, url) => {
      req.abort()
      done(url)
    })
    req.on('response', () => done(null))
    req.on('error', () => done(null))
    req.end(Buffer.from(body))
  })
}
