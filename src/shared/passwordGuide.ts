/**
 * The small window that walks the person through another browser's password export (main/passwordGuide.ts): a page
 * of its own, made here from the browser's steps (shared/importers.ts), so it needs no build of its own. Pure, so it
 * is tested.
 */

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  )

/** What the guide says at the bottom: still waiting for the file, or how it went. */
export type GuideStatus =
  { kind: 'waiting' } | { kind: 'imported'; added: number; deleted: boolean } | { kind: 'timeout' }

export function guideStatusText(s: GuideStatus): string {
  if (s.kind === 'waiting') return 'Waiting for the file in Downloads...'
  if (s.kind === 'timeout') return 'Nothing was exported, so nothing came over.'
  const n = s.added
  const what =
    n === 0
      ? 'No new passwords'
      : n === 1
        ? '1 password added'
        : `${n.toLocaleString('en')} passwords added`
  return s.deleted
    ? `${what}, and the file deleted.`
    : `${what}. Delete the file in Downloads: it is plain text.`
}

export interface GuideTheme {
  scheme: 'dark' | 'light'
  /** The window's colour variables (chromeTheme.ts), so the guide wears the same colours. */
  vars: Record<string, string>
}

/** The guide's page: the steps, numbered, and a status line main updates (window.setStatus). */
export function guideHtml(browser: string, steps: string[], theme: GuideTheme): string {
  const vars = Object.entries(theme.vars)
    .filter(([k]) => /^--[a-z0-9-]+$/i.test(k))
    .map(([k, v]) => `${k}:${String(v).replace(/[;{}<>]/g, '')}`)
    .join(';')
  const dark = theme.scheme === 'dark'
  const all = [...steps, 'Panes brings them in and deletes the file. You can close this then.']
  return `<!doctype html><html data-scheme="${dark ? 'dark' : 'light'}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Export from ${escapeHtml(browser)}</title><style>
:root{${vars};color-scheme:${dark ? 'dark' : 'light'}}
*{box-sizing:border-box}
body{margin:0;padding:18px 18px 16px;font:13px/1.45 system-ui,'Segoe UI',sans-serif;
background:var(--popover-bg,${dark ? '#1c1c22' : '#fff'});color:var(--fg,${dark ? '#f2f2f4' : '#16161a'});
-webkit-user-select:none;user-select:none;-webkit-app-region:drag;overflow:hidden}
h1{margin:0 0 4px;padding-right:28px;font-size:15px;font-weight:650;letter-spacing:-.01em}
p{margin:0 0 14px;color:var(--fg-dim,${dark ? '#a1a1aa' : '#5b5b66'})}
ol{margin:0;padding:0;list-style:none;counter-reset:s}
li{counter-increment:s;display:flex;gap:10px;margin:0 0 10px}
li::before{content:counter(s);flex:none;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;
background:var(--accent,#8b8bff);color:var(--accent-fg,#fff);font-size:11px;font-weight:700}
li:last-child{color:var(--fg-dim,${dark ? '#a1a1aa' : '#5b5b66'})}
#status{margin-top:14px;padding:9px 12px;border-radius:10px;background:var(--surface,${dark ? '#26262e' : '#f1f1f4'})}
#status.done{background:color-mix(in srgb,#2fa86a 22%,transparent)}
button{-webkit-app-region:no-drag;position:absolute;top:10px;right:10px;width:26px;height:26px;border:0;border-radius:50%;
background:none;color:inherit;font-size:16px;cursor:pointer;opacity:.6}button:hover{opacity:1;background:var(--surface,#0002)}
</style></head><body>
<button type="button" aria-label="Close" onclick="window.close()">&times;</button>
<h1>Export your passwords from ${escapeHtml(browser)}</h1>
<p>${escapeHtml(browser)} asks for them itself; Panes never reads its files.</p>
<ol>${all.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
<div id="status" role="status">${escapeHtml(guideStatusText({ kind: 'waiting' }))}</div>
<script>window.setStatus=function(t,done){var e=document.getElementById('status');e.textContent=t;e.className=done?'done':''}</script>
</body></html>`
}
