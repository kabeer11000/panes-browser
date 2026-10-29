/** What the page's picker prints (through the console) when an element was chosen; empty after it, for a cancel. */
export const ZAP_PREFIX = '__panes_zap__'

/**
 * Runs in the page while you choose what to hide: the element under the pointer is outlined, a click picks
 * it (and is swallowed, so the page does not act on it), Esc cancels. It reports a selector short enough to
 * read and specific enough to match just that element. Nothing is changed in the page itself.
 */
export const ZAP_SCRIPT = `(() => {
  if (window.__panesZap) return window.__panesZap.stop('')
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:rgba(255,80,80,.22);outline:2px solid #ff5050;border-radius:4px;left:0;top:0;width:0;height:0'
  const tip = document.createElement('div')
  tip.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;left:50%;top:14px;transform:translateX(-50%);padding:7px 14px;border-radius:999px;background:#1b1b22;color:#fff;font:600 13px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)'
  tip.textContent = 'Click what to hide. Esc to cancel.'
  document.documentElement.append(box, tip)
  let target = null
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\\\$&'))
  const unique = (sel) => { try { return document.querySelectorAll(sel).length === 1 } catch { return false } }
  const part = (el) => {
    if (el.id && unique('#' + esc(el.id))) return '#' + esc(el.id)
    const tag = el.tagName.toLowerCase()
    const classes = [...el.classList].filter((c) => !/\\d{3,}|^[a-z]{1,2}-?[A-Za-z0-9_-]{6,}$/.test(c)).slice(0, 2)
    let s = tag + classes.map((c) => '.' + esc(c)).join('')
    const parent = el.parentElement
    if (parent && parent.querySelectorAll(':scope > ' + s).length > 1) {
      s += ':nth-child(' + (Array.prototype.indexOf.call(parent.children, el) + 1) + ')'
    }
    return s
  }
  const selector = (el) => {
    const parts = []
    let cur = el
    while (cur && cur !== document.documentElement && parts.length < 5) {
      parts.unshift(part(cur))
      const sel = parts.join(' > ')
      if (unique(sel)) return sel
      cur = cur.parentElement
    }
    return parts.join(' > ')
  }
  const move = (e) => {
    target = e.target
    if (!(target instanceof Element) || target === box || target === tip) return
    const r = target.getBoundingClientRect()
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px'
    box.style.width = r.width + 'px'; box.style.height = r.height + 'px'
  }
  const stop = (picked) => {
    document.removeEventListener('mousemove', move, true)
    document.removeEventListener('click', click, true)
    document.removeEventListener('keydown', key, true)
    document.removeEventListener('mousedown', swallow, true)
    document.removeEventListener('mouseup', swallow, true)
    box.remove(); tip.remove()
    delete window.__panesZap
    console.log('${ZAP_PREFIX}' + picked)
  }
  const swallow = (e) => { e.preventDefault(); e.stopPropagation() }
  const click = (e) => { swallow(e); stop(target instanceof Element ? selector(target) : '') }
  const key = (e) => { if (e.key === 'Escape') { swallow(e); stop('') } }
  document.addEventListener('mousemove', move, true)
  document.addEventListener('click', click, true)
  document.addEventListener('keydown', key, true)
  document.addEventListener('mousedown', swallow, true)
  document.addEventListener('mouseup', swallow, true)
  window.__panesZap = { stop }
})()`
