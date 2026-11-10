/**
 * Browser automation for the chat: what the model sees of a page (its controls, numbered), the fixed scripts that
 * find them again, and which actions need the person's Confirm. The scripts are constant strings; the only things
 * put into them are numbers and JSON-encoded values, so nothing a model writes ever runs in a page as code.
 */

export const SNAPSHOT_MAX = 120
export const KEYS = [
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End'
] as const
export type AutoKey = (typeof KEYS)[number]

export interface SnapshotItem {
  ref: number
  role: string
  name: string
  value?: string
  checked?: boolean
  disabled?: boolean
  href?: string
  offscreen?: boolean
}

export interface Snapshot {
  url: string
  title: string
  /** "scrolled px / scrollable px" */
  scroll: string
  items: SnapshotItem[]
  text: string
  more: number
}

/** Labels that send, buy, delete or publish something: the click waits for Confirm. */
const RISKY =
  /\b(buy|pay|purchase|order|checkout|check out|place order|subscribe|donate|delete|remove|erase|send|post|publish|submit|confirm|transfer|withdraw|book|reserve|sign up|register|unsubscribe|cancel|tweet|reply|comment|share|upload|accept|agree|approve|install|log ?out|sign ?out|deactivate|close account)\b/i

export interface Target {
  role: string
  name: string
  type: string
  /** The element is in a form that has a password or card field. */
  sensitiveForm: boolean
  submits: boolean
}

/** Does acting on this element need the person's Confirm? */
export function needsConfirm(t: Target, action: 'click' | 'submit'): boolean {
  // a form with a password or card field: anything that could send it waits
  if (t.sensitiveForm) return true
  // typing then Enter: a search box or an ordinary field, unless the form is a sensitive one (above)
  if (action === 'submit') return false
  if (RISKY.test(t.name)) return true
  // a button that submits a form, unless it plainly searches or moves on
  return t.submits && !/\b(search|find|go|next|continue|more|show|filter|apply)\b/i.test(t.name)
}

/** The page as the model reads it: a header, the numbered controls, then a little of the visible text. */
export function formatSnapshot(s: Snapshot, textCap: number): string {
  const lines = s.items.map((it) => {
    let l = `[${it.ref}] ${it.role}`
    if (it.name) l += ` "${it.name}"`
    if (it.value !== undefined) l += ` value="${it.value}"`
    if (it.checked !== undefined) l += it.checked ? ' checked' : ' unchecked'
    if (it.disabled) l += ' disabled'
    if (it.href) l += ` -> ${it.href}`
    if (it.offscreen) l += ' (below)'
    return l
  })
  const more = s.more > 0 ? `\n(${s.more} more controls further down: scroll to see them)` : ''
  const text = s.text.trim().slice(0, textCap)
  return `<page url="${clean(s.url)}" title="${clean(s.title)}" scroll="${s.scroll}">\nControls:\n${lines.join('\n') || '(none)'}${more}\n\nVisible text:\n${text.replace(/<\/?\s*page\b/gi, '< page')}\n</page>`
}

const clean = (v: string): string => v.replace(/["<>\r\n]/g, ' ').slice(0, 200)

/**
 * Looking things up through shadow roots as well as the page (web components hide their controls from
 * querySelector). Put at the start of every script that finds a numbered control.
 */
const DEEP = `
  const deepAll = (sel) => {
    const out = []
    const walk = (root) => {
      for (const el of root.querySelectorAll(sel)) out.push(el)
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot)
    }
    walk(document)
    return out
  }
  const deepFind = (sel) => deepAll(sel)[0] || null`

/** Number every visible control, mark it with data-panes-ref and describe it. */
export const SNAPSHOT_SCRIPT = (max: number): string => `(() => {
  ${DEEP}
  const MAX = ${Math.max(1, Math.floor(max))}
  for (const e of deepAll('[data-panes-ref]')) e.removeAttribute('data-panes-ref')
  const SEL = 'a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=checkbox],[role=radio],[role=switch],[role=combobox],[role=textbox],[role=searchbox],[role=option],[role=slider],[contenteditable=""],[contenteditable=true],[onclick]'
  const vw = innerWidth, vh = innerHeight
  const cut = (s, n) => { s = String(s || '').replace(/\\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
  const nameOf = (el) => {
    const a = el.getAttribute('aria-label'); if (a) return a
    const lb = el.getAttribute('aria-labelledby')
    if (lb) { const t = lb.split(/\\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' '); if (t.trim()) return t }
    if (el.labels && el.labels.length) return el.labels[0].innerText
    const t = el.innerText; if (t && t.trim()) return t
    const img = el.querySelector && el.querySelector('img[alt]'); if (img && img.alt) return img.alt
    return el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || (el.type === 'submit' || el.type === 'button' ? el.value : '') || el.getAttribute('name') || ''
  }
  const roleOf = (el) => {
    const r = el.getAttribute('role'); if (r) return r
    const tag = el.tagName.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'button' || tag === 'summary') return 'button'
    if (tag === 'select') return 'select'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase()
      if (t === 'checkbox' || t === 'radio') return t
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'button'
      if (t === 'search') return 'searchbox'
      if (t === 'password') return 'password'
      return 'textbox'
    }
    if (el.isContentEditable) return 'textbox'
    return 'button'
  }
  const seen = new Set()
  const found = []
  for (const el of deepAll(SEL)) {
    if (seen.has(el)) continue
    seen.add(el)
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
    if (el.closest('[aria-hidden="true"],[inert]')) continue
    if (r.right < 0 || r.left > vw) continue
    const inView = r.bottom > 0 && r.top < vh
    found.push({ el, r, inView })
  }
  found.sort((a, b) => (Number(b.inView) - Number(a.inView)) || (a.r.top - b.r.top) || (a.r.left - b.r.left))
  const items = []
  let n = 0
  for (const f of found.slice(0, MAX)) {
    const el = f.el
    n += 1
    el.setAttribute('data-panes-ref', String(n))
    const role = roleOf(el)
    const it = { ref: n, role, name: cut(nameOf(el), 80) }
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'select') it.value = cut(el.isContentEditable ? el.innerText : el.value, 80)
    if (role === 'password') it.value = el.value ? '(filled)' : ''
    if (role === 'checkbox' || role === 'radio' || role === 'switch') it.checked = !!(el.checked || el.getAttribute('aria-checked') === 'true')
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') it.disabled = true
    if (role === 'link') { try { const u = new URL(el.href); it.href = cut(u.host + u.pathname, 80) } catch {} }
    if (role === 'select') it.name = cut(it.name.split('\\n')[0], 60) + ' options: ' + cut([...el.options].map((o) => o.text).join(' | '), 200)
    if (!f.inView) it.offscreen = true
    items.push(it)
  }
  const main = document.querySelector('main,article,[role=main]') || document.body
  return {
    url: location.href,
    title: document.title,
    scroll: Math.round(scrollY) + '/' + Math.max(0, Math.round(document.documentElement.scrollHeight - vh)),
    items,
    text: cut(main ? main.innerText : '', 4000),
    more: Math.max(0, found.length - MAX)
  }
})()`

/** Find a numbered control again, bring it into view and say where it is and what it is. */
export const TARGET_SCRIPT = (ref: number): string => `(() => {
  ${DEEP}
  const el = deepFind('[data-panes-ref="${Math.floor(ref)}"]')
  if (!el) return null
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  const r = el.getBoundingClientRect()
  // what is really under the middle of it: a cookie banner, a modal or a sticky bar may be in the way
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2
  let top = document.elementFromPoint(cx, cy)
  while (top && top.shadowRoot) { const inner = top.shadowRoot.elementFromPoint(cx, cy); if (!inner || inner === top) break; top = inner }
  const root = el.getRootNode()
  const same = !top || top === el || el.contains(top) || top.contains(el) || (root.host && (root.host === top || root.host.contains(top)))
  const coveredBy = same ? '' : String(top.getAttribute('aria-label') || top.innerText || top.tagName).replace(/\\s+/g, ' ').trim().slice(0, 50)
  const form = el.closest('form')
  const sensitive = !!(form && form.querySelector('input[type=password],input[autocomplete^="cc-"],input[name*="card" i],input[name*="cvv" i],input[name*="cvc" i]'))
  const tag = el.tagName.toLowerCase()
  const type = String(el.type || '').toLowerCase()
  const submits = (tag === 'button' && (type === 'submit' || (!el.getAttribute('type') && !!form))) || (tag === 'input' && (type === 'submit' || type === 'image'))
  const name = String(el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
  const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? (type === 'search' ? 'searchbox' : type || 'textbox') : tag)
  const ring = document.createElement('div')
  ring.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border-radius:8px;box-shadow:0 0 0 2px rgba(120,110,255,.95),0 0 18px 4px rgba(120,110,255,.45);transition:opacity .5s ease;left:' + (r.left - 3) + 'px;top:' + (r.top - 3) + 'px;width:' + (r.width + 6) + 'px;height:' + (r.height + 6) + 'px'
  document.documentElement.appendChild(ring)
  setTimeout(() => { ring.style.opacity = '0' }, 900)
  setTimeout(() => ring.remove(), 1500)
  // the assistant's pointer: glides from where it was to the control, then a ripple where the click lands
  const prev = window.__panesPointer || { x: innerWidth / 2, y: innerHeight + 40 }
  window.__panesPointer = { x: cx, y: cy }
  const ptr = document.createElement('div')
  ptr.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;left:0;top:0;width:18px;height:18px;transition:transform .32s cubic-bezier(.22,1,.36,1),opacity .4s ease;transform:translate(' + prev.x + 'px,' + prev.y + 'px);filter:drop-shadow(0 1px 3px rgba(0,0,0,.45))'
  ptr.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 1.5l12 6.2-5.2 1.4L6.4 14.6z" fill="#fff" stroke="#6a5cff" stroke-width="1.4" stroke-linejoin="round"/></svg>'
  document.documentElement.appendChild(ptr)
  requestAnimationFrame(() => requestAnimationFrame(() => { ptr.style.transform = 'translate(' + cx + 'px,' + cy + 'px)' }))
  setTimeout(() => {
    const rip = document.createElement('div')
    rip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border-radius:50%;border:2px solid rgba(120,110,255,.9);width:10px;height:10px;left:' + (cx - 5) + 'px;top:' + (cy - 5) + 'px;transition:transform .45s ease-out,opacity .45s ease-out'
    document.documentElement.appendChild(rip)
    requestAnimationFrame(() => { rip.style.transform = 'scale(4)'; rip.style.opacity = '0' })
    setTimeout(() => rip.remove(), 600)
    ptr.style.opacity = '0'
    setTimeout(() => ptr.remove(), 500)
  }, 360)
  return {
    x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, coveredBy,
    role, name, type, tag, submits, sensitiveForm: sensitive,
    password: type === 'password',
    editable: tag === 'textarea' || (tag === 'input' && !['checkbox','radio','submit','button','image','file','range','color'].includes(type)) || el.isContentEditable,
    select: tag === 'select'
  }
})()`

/** Select what is in a text field, so typing replaces it. */
export const SELECT_ALL_SCRIPT = (ref: number): string => `(() => {
  ${DEEP}
  const el = deepFind('[data-panes-ref="${Math.floor(ref)}"]')
  if (!el) return false
  el.focus()
  if (typeof el.select === 'function') el.select()
  else { const s = getSelection(); const r = document.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r) }
  return true
})()`

/** Pick an option of a <select> by its text or value. */
export const SELECT_OPTION_SCRIPT = (ref: number, option: string): string => `(() => {
  ${DEEP}
  const el = deepFind('[data-panes-ref="${Math.floor(ref)}"]')
  if (!el || el.tagName !== 'SELECT') return null
  const want = ${JSON.stringify(option)}.toLowerCase().trim()
  const opts = [...el.options]
  const o = opts.find((x) => x.text.toLowerCase().trim() === want || x.value.toLowerCase() === want) || opts.find((x) => x.text.toLowerCase().includes(want))
  if (!o) return { ok: false, options: opts.map((x) => x.text.trim()).slice(0, 40) }
  el.value = o.value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: true, text: o.text.trim() }
})()`

export const SCROLL_SCRIPT = (dir: 'up' | 'down' | 'top' | 'bottom'): string => `(() => {
  const d = ${JSON.stringify(dir)}
  const h = innerHeight * 0.85
  if (d === 'top') scrollTo({ top: 0, behavior: 'instant' })
  else if (d === 'bottom') scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
  else scrollBy({ top: d === 'down' ? h : -h, behavior: 'instant' })
  return Math.round(scrollY)
})()`

export const MEDIA_ACTIONS = [
  'play',
  'pause',
  'toggle',
  'mute',
  'unmute',
  'skip',
  'speed',
  'restart'
] as const
export type MediaAction = (typeof MEDIA_ACTIONS)[number]

/**
 * Control the video or audio on a page: the one that is playing, else the biggest one. Works on any site that uses
 * a media element (YouTube, Vimeo, news and social sites, podcasts). `amount` is seconds for skip (negative goes
 * back) and the rate for speed. Returns where it ended up, or ok: false when the page has no media.
 */
export const MEDIA_SCRIPT = (action: MediaAction, amount: number): string => `(() => {
  const act = ${JSON.stringify(action)}
  const amt = ${JSON.stringify(amount)}
  const media = [...document.querySelectorAll('video, audio')]
  const area = (m) => { const r = m.getBoundingClientRect(); return r.width * r.height }
  const el = media.find((m) => !m.paused && !m.ended) ?? media.sort((a, b) => area(b) - area(a))[0]
  if (!el) return { ok: false }
  const done = (p) => Promise.resolve(p).catch(() => undefined)
  const work = async () => {
    if (act === 'play') await done(el.play())
    else if (act === 'pause') el.pause()
    else if (act === 'toggle') { if (el.paused) await done(el.play()); else el.pause() }
    else if (act === 'mute') el.muted = true
    else if (act === 'unmute') { el.muted = false; if (el.volume === 0) el.volume = 1 }
    else if (act === 'skip') el.currentTime = Math.max(0, Math.min(el.duration || 1e9, el.currentTime + amt))
    else if (act === 'speed') el.playbackRate = Math.max(0.25, Math.min(3, amt))
    else if (act === 'restart') { el.currentTime = 0; await done(el.play()) }
  }
  return work().then(() => ({
    ok: true,
    paused: el.paused,
    muted: el.muted,
    time: Math.round(el.currentTime),
    duration: Number.isFinite(el.duration) ? Math.round(el.duration) : null,
    rate: el.playbackRate
  }))
})()`

/** Words that say where, not what: left out when a scroll target is matched word by word ("the AI settings"). */
const SCROLL_FILLER = [
  'the',
  'a',
  'an',
  'my',
  'to',
  'of',
  'on',
  'in',
  'for',
  'and',
  'page',
  'part',
  'section',
  'sections',
  'area',
  'setting',
  'settings',
  'option',
  'options',
  'preference',
  'preferences',
  'panel',
  'menu',
  'bit',
  'stuff',
  'thing',
  'where',
  'about',
  'heading',
  'there',
  'down',
  'up',
  'please',
  'go',
  'scroll',
  'bottom',
  'top',
  'list'
]
/** Other names a heading may use for a few common things. */
const SCROLL_ALSO: Record<string, string[]> = {
  ai: ['assistant', 'artificial intelligence', 'model'],
  assistant: ['ai'],
  privacy: ['private', 'security'],
  appearance: ['theme', 'look'],
  theme: ['appearance'],
  download: ['downloads'],
  password: ['passwords', 'autofill'],
  shortcut: ['keyboard', 'keys', 'shortcuts'],
  notification: ['notifications', 'alerts']
}

/** Where a page keeps its comments: tried in turn when the model asks to scroll to "comments". */
const COMMENT_SELECTORS = [
  '#comments',
  'ytd-comments',
  '#disqus_thread',
  '#respond',
  'section[aria-label*="comment" i]',
  '[data-testid*="comment" i]',
  '[id*="comments" i]',
  '[class*="comments" i]'
]

/**
 * Scroll a heading, section or piece of text into view, by what it says. "comments" also finds the comment area
 * of the common sites. Returns what it scrolled to, or ok: false when nothing matches.
 */
export const SCROLL_TO_SCRIPT = (target: string): string => `(() => {
  const want = ${JSON.stringify(target.toLowerCase())}
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase()
  const show = (el, what) => {
    el.scrollIntoView({ block: 'start', behavior: 'instant' })
    return { ok: true, what: what.slice(0, 80), y: Math.round(scrollY) }
  }
  if (/\\bcomments?\\b/.test(want)) {
    for (const sel of ${JSON.stringify(COMMENT_SELECTORS)}) {
      const el = document.querySelector(sel)
      if (el) return show(el, 'the comments')
    }
  }
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 || r.height > 0 }
  // 1. the words as they are: the smallest visible element whose own text holds them (a heading before a section)
  let best = null
  let bestLen = Infinity
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,summary,button,a,label,legend,th,p,span,div,li,section,article')) {
    const t = norm(el.textContent)
    if (!t.includes(want) || t.length >= bestLen || t.length > 400) continue
    if (!visible(el)) continue
    best = el
    bestLen = t.length
  }
  if (best) return show(best, norm(best.textContent))
  // 2. how people say it ("the AI settings", "tor setting", "privacy section"): the words that name the thing, each
  // as a whole word (plurals and a few other names for it too), on headings first, then labels, then links
  const FILLER = new Set(${JSON.stringify(SCROLL_FILLER)})
  const ALSO = ${JSON.stringify(SCROLL_ALSO)}
  // letters and digits only, so each is safe in a pattern as it is
  const keys = want.split(/[^a-z0-9]+/).filter((w) => w && !FILLER.has(w))
  // what the page does have, for another try with the right name
  const heads = () => [...new Set([...document.querySelectorAll('h1,h2,h3,[role=heading],legend,summary')].filter(visible).map((h) => norm(h.textContent)).filter((t) => t && t.length < 60))].slice(0, 40)
  if (!keys.length) return { ok: false, heads: heads() }
  const forms = keys.map((k) => {
    const base = k.length > 3 && k.endsWith('s') ? k.slice(0, -1) : k
    return [base, ...(ALSO[base] || [])].map((w) => new RegExp('(^|[^a-z0-9])' + w + 's?($|[^a-z0-9])'))
  })
  const RANK = [['h1,h2,h3,h4,h5,h6,[role=heading]', 0], ['legend,summary,th,[role=tab]', 1], ['label', 2], ['button,a', 3], ['p,li,span,div,section,article,fieldset', 4]]
  let pick = null
  for (const [sel, rank] of RANK) {
    for (const el of document.querySelectorAll(sel)) {
      const own = norm(el.textContent)
      if (own.length > 200 && rank < 4) continue
      const hay = own + ' ' + norm(el.id).replace(/[-_]/g, ' ') + ' ' + norm(el.getAttribute?.('aria-label'))
      const hits = forms.filter((f) => f.some((re) => re.test(hay))).length
      if (!hits || !visible(el)) continue
      // all the words before some of them, then the kind of element, then the shortest text
      const score = [keys.length - hits, rank, own.length]
      if (!pick || score[0] < pick.score[0] || (score[0] === pick.score[0] && (score[1] < pick.score[1] || (score[1] === pick.score[1] && score[2] < pick.score[2])))) pick = { el, score, own }
    }
  }
  // a link or button with only some of the words is too weak a guess
  if (!pick || (pick.score[0] > 0 && pick.score[1] >= 3)) return { ok: false, heads: heads() }
  return show(pick.el, pick.own || keys.join(' '))
})()`

/** Click a numbered control from inside the page: for one something else covers, where a real click would hit the cover. */
export const CLICK_SCRIPT = (ref: number): string => `(() => {
  ${DEEP}
  const el = deepFind('[data-panes-ref="${Math.floor(ref)}"]')
  if (!el) return false
  el.focus && el.focus({ preventScroll: true })
  el.click()
  return true
})()`

/**
 * Resolves once the page has stopped changing (no DOM changes for \`idle\` ms), or after \`max\` ms: how long to wait
 * after an action instead of a fixed pause. A page that is still loading is waited for by the caller.
 */
export const QUIET_SCRIPT = (idle: number, max: number): string => `new Promise((resolve) => {
  let timer
  const done = () => { obs.disconnect(); clearTimeout(timer); clearTimeout(cap); resolve(true) }
  const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, ${Math.floor(idle)}) })
  obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
  timer = setTimeout(done, ${Math.floor(idle)})
  const cap = setTimeout(done, ${Math.floor(max)})
})`
