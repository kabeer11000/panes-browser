/**
 * HTTPS-first (Chrome's HTTPS upgrades): a plain http: page is asked for over https: first, and only if that fails is
 * it loaded as it was asked. Here: which addresses are worth trying, and what to try.
 */

/** Names that are never on the public internet: their https: is someone's router or nothing (and cannot be checked). */
const LOCAL =
  /(^|\.)(localhost|local|lan|home|internal|intranet|corp|test|example|invalid|home\.arpa|onion)$/i

/** The https: address to try first for an http: page, or null when it should load as it is. */
export function httpsUpgrade(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'http:') return null
  const host = u.hostname
  // an address of its own port is a service on that port (a dev server, a device): https there means nothing
  if (u.port && u.port !== '80') return null
  // a bare IP, a one-word name (an intranet host), a local name: kept as asked
  if (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.startsWith('[') ||
    !host.includes('.') ||
    LOCAL.test(host)
  )
    return null
  u.protocol = 'https:'
  return u.toString()
}

/** The host an address is for (its name, no port), for remembering which sites stay on http this run. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}
