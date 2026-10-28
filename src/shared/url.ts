const DEFAULT_SEARCH = 'https://duckduckgo.com/?q='
const ALLOWED_SCHEMES = new Set(['http', 'https', 'file', 'panes'])
const LOCAL = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#]|$)/i
const DOMAIN = /^[^\s/?#:@]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i

/** Turn address bar input into a loadable URL, or a search URL. Empty stays empty. */
export function resolveInput(raw: string, search = DEFAULT_SEARCH): string {
  const s = raw.trim()
  if (!s) return ''
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s)
  if (scheme) {
    return ALLOWED_SCHEMES.has(scheme[1].toLowerCase()) ? s : search + encodeURIComponent(s)
  }
  if (/\s/.test(s)) return search + encodeURIComponent(s)
  if (LOCAL.test(s)) return 'http://' + s
  if (DOMAIN.test(s)) return 'https://' + s
  return search + encodeURIComponent(s)
}

/** Short label for a URL: host without www, falling back to the raw string. */
export function displayHost(url: string): string {
  try {
    const u = new URL(url)
    return u.host.replace(/^www\./, '') || url
  } catch {
    return url
  }
}
