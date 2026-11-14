/**
 * Passkeys without the autofill they assume. A login page asks for passkey autofill as it loads
 * (`navigator.credentials.get({ mediation: 'conditional' })`), meaning "offer my passkeys in the username field's
 * suggestions". Chrome does that quietly; Electron has no such suggestions, so the request goes straight to Windows,
 * whose passkey dialog then opens by itself on every login page. The same goes for a site upgrading a password to a
 * passkey after login (`create` with `mediation: 'conditional'`).
 *
 * This runs in each page's own world before its scripts (preload/frame.ts) and says conditional mediation is not
 * available, which every site already handles: it shows its "Sign in with a passkey" button instead, and a click on
 * that (an ordinary request) still opens the Windows dialog as it should. A conditional request made anyway waits,
 * as it would with nothing picked, until the page aborts it.
 */
export const PASSKEY_SHIM = `(() => {
  const PKC = window.PublicKeyCredential
  const creds = navigator.credentials
  if (!PKC || !creds) return
  const define = (o, k, v) => { try { Object.defineProperty(o, k, { value: v, configurable: true, writable: true }) } catch {} }
  define(PKC, 'isConditionalMediationAvailable', function isConditionalMediationAvailable() { return Promise.resolve(false) })
  if (typeof PKC.getClientCapabilities === 'function') {
    const caps = PKC.getClientCapabilities.bind(PKC)
    define(PKC, 'getClientCapabilities', function getClientCapabilities() {
      return caps().then((c) => Object.assign({}, c, { conditionalGet: false, conditionalCreate: false }))
    })
  }
  const aborted = (s) => (s && s.reason) || new DOMException('The operation was aborted.', 'AbortError')
  const get = creds.get.bind(creds)
  define(Object.getPrototypeOf(creds), 'get', function get_(o) {
    if (o && o.mediation === 'conditional' && o.publicKey) {
      return new Promise((_, reject) => {
        const s = o.signal
        if (!s) return
        if (s.aborted) reject(aborted(s))
        else s.addEventListener('abort', () => reject(aborted(s)), { once: true })
      })
    }
    return get(o)
  })
  const create = creds.create.bind(creds)
  define(Object.getPrototypeOf(creds), 'create', function create_(o) {
    if (o && o.mediation === 'conditional' && o.publicKey)
      return Promise.reject(new DOMException('Not allowed.', 'NotAllowedError'))
    return create(o)
  })
})()`
