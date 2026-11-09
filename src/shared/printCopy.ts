import { escapeHtml, normalizeOptions, remembered, type PrintOptions } from './print'

export { escapeHtml }

// ---- remembered per site ----

/** The site a page belongs to, for remembering options per site; '' for anything that is not a web page. */
export function hostKey(url: string): string {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.replace(/^www\./, '') : ''
  } catch {
    return ''
  }
}

/** Defaults, then what was last used anywhere, then what was last used on this site; each layer checked on the way in. */
export function mergeOptions(
  last: Partial<PrintOptions> | undefined,
  site: Partial<PrintOptions> | undefined
): PrintOptions {
  return normalizeOptions(site, normalizeOptions(last))
}

export const HOSTS_MAX = 150

/** `hosts` with this site's options set and moved to the end; the least recently used go past HOSTS_MAX. */
export function rememberHost(
  hosts: Record<string, Partial<PrintOptions>>,
  host: string,
  o: PrintOptions
): Record<string, Partial<PrintOptions>> {
  if (!host) return hosts
  const next = { ...hosts }
  delete next[host]
  next[host] = remembered(o)
  const keys = Object.keys(next)
  for (const k of keys.slice(0, Math.max(0, keys.length - HOSTS_MAX))) delete next[k]
  return next
}

// ---- a copy of the page, simplified or restyled for print ----

/** Whether the options need a copy of the page rather than the page itself. */
export const needsCopy = (o: PrintOptions): boolean => o.simplify || o.noImages || o.lightBackground

/** Style added to the copy only: pictures off, a white page with dark text. */
export function printCss(o: PrintOptions): string {
  let css = ''
  if (o.noImages)
    css +=
      'img,picture,svg,video,canvas,iframe,object,embed{display:none!important}*{background-image:none!important}'
  if (o.lightBackground)
    css +=
      'html,body{background:#fff!important}*{background-color:transparent!important;color:#111!important;text-shadow:none!important;box-shadow:none!important}a{color:#0b4fb3!important}'
  return css
}

/**
 * Run in the page to read the text worth printing. It only reads: nothing in the page changes. What comes back is
 * rebuilt from a short list of tags and attributes, so it holds no script, style or event handler.
 */
export const READER_SCRIPT = `(() => {
  const ok = new Set(['P','H1','H2','H3','H4','H5','H6','UL','OL','LI','BLOCKQUOTE','PRE','CODE','EM','STRONG','B','I','A','IMG','FIGURE','FIGCAPTION','TABLE','THEAD','TBODY','TR','TH','TD','BR','HR','SUP','SUB'])
  const skip = new Set(['SCRIPT','STYLE','NAV','ASIDE','FOOTER','FORM','IFRAME','NOSCRIPT','BUTTON','SVG','CANVAS','VIDEO','AUDIO','SELECT','TEXTAREA','INPUT','DIALOG'])
  const esc = (s) => s.replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';')
  const web = (u) => (/^https?:/i.test(u) ? u : '')
  let budget = 400000
  const walk = (n) => {
    if (budget <= 0) return ''
    if (n.nodeType === 3) { const t = esc(n.nodeValue || ''); budget -= t.length; return t }
    if (n.nodeType !== 1 || skip.has(n.tagName) || n.hidden || n.getAttribute('aria-hidden') === 'true') return ''
    if (getComputedStyle(n).display === 'none') return ''
    const inner = [...n.childNodes].map(walk).join('')
    if (!ok.has(n.tagName)) return inner
    const tag = n.tagName.toLowerCase()
    if (tag === 'img') {
      const src = web(n.currentSrc || n.src || '')
      return src ? '<img src="' + esc(src) + '" alt="' + esc(n.alt || '') + '">' : ''
    }
    if (tag === 'br' || tag === 'hr') return '<' + tag + '>'
    if (tag === 'a') { const h = web(n.href || ''); return h ? '<a href="' + esc(h) + '">' + inner + '</a>' : inner }
    return '<' + tag + '>' + inner + '</' + tag + '>'
  }
  const len = (e) => (e.innerText || '').length
  let root = [...document.querySelectorAll('article, main, [role=main]')].sort((a, b) => len(b) - len(a))[0]
  if (!root || len(root) < 400) {
    let best = 0
    for (const e of document.querySelectorAll('div, section')) {
      const score = [...e.children].filter((c) => c.tagName === 'P').reduce((s, c) => s + len(c), 0)
      if (score > best) { best = score; root = e }
    }
  }
  root = root || document.body
  return { title: document.title || '', url: location.href, html: walk(root) }
})()`

/** Run in the page: the page as it is now, without scripts and with its own address as the base. */
export const COPY_SCRIPT = `(() => {
  const c = document.documentElement.cloneNode(true)
  c.querySelectorAll('script, noscript').forEach((e) => e.remove())
  const b = document.createElement('base')
  b.href = location.href
  const head = c.querySelector('head')
  if (head) head.prepend(b)
  return '<!doctype html>' + c.outerHTML
})()`

const READER_CSS = `
body{margin:0 auto;max-width:42em;padding:0 1em;color:#111;background:#fff;font:12pt/1.6 Georgia,'Times New Roman',serif;overflow-wrap:break-word}
header{margin:0 0 1.6em;padding-bottom:.8em;border-bottom:1px solid #bbb;font:9pt/1.4 'Segoe UI',Arial,sans-serif;color:#555}
header h1{margin:0 0 .3em;font:700 20pt/1.25 Georgia,'Times New Roman',serif;color:#000}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.4em 0 .5em;break-after:avoid;font-family:'Segoe UI',Arial,sans-serif}
p{margin:0 0 1em;orphans:3;widows:3}
img{display:block;max-width:100%;max-height:3in;width:auto;height:auto;margin:.8em auto;break-inside:avoid}
:is(p,div,span,figure,a)>img:has(+img),:is(p,div,span,figure,a)>img+img{display:inline-block;max-height:1.5in;margin:2px}
figure{margin:1em 0}figcaption{font:9pt 'Segoe UI',Arial,sans-serif;color:#555}
blockquote{margin:1em 0;padding-left:1em;border-left:3px solid #ccc;color:#333}
pre{white-space:pre-wrap;font:10pt Consolas,monospace;background:#f4f4f4;padding:.6em}
code{font-family:Consolas,monospace}
a{color:#0b4fb3}
table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.2em .5em}`

/** The simplified page as a document of its own: no script may run in it, pictures may load. */
export function readerDocument(
  r: { title: string; url: string; html: string },
  date: string
): string {
  const title = escapeHtml(r.title || r.url)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'">
<style>${READER_CSS}</style></head><body>
<header>${/<h1[\s>]/i.test(r.html) ? '' : `<h1>${title}</h1>`}${escapeHtml(r.url)}<br>${escapeHtml(date)}</header>
${r.html}
</body></html>`
}
