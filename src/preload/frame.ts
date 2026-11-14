import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { PASSKEY_SHIM } from '@shared/passkeys'

// Every frame of every tab, at document start, in the page's own world (see shared/passkeys.ts).
webFrame.executeJavaScript(PASSKEY_SHIM).catch(() => undefined)

/**
 * What the page is told about its permissions. Electron answers a page's look at a permission with yes or no only,
 * so a site set to "ask" read as "denied" (and many sites then said "you blocked this" and never asked), and a page
 * was never told when an answer changed, so it had to be reloaded. This puts Panes' own setting behind
 * navigator.permissions.query and Notification.permission, and fires the statuses' `change` when the setting changes,
 * so a page that listens (calls, maps) carries on at once.
 */
function permissionShim(bridge: {
  setting: (kind: string) => Promise<'allow' | 'block' | 'ask' | null>
  onChange: (cb: () => void) => void
}): void {
  const KIND: Record<string, string> = {
    camera: 'camera',
    microphone: 'microphone',
    geolocation: 'location',
    notifications: 'notifications',
    push: 'notifications',
    'clipboard-read': 'clipboard',
    midi: 'midi',
    'window-management': 'windows',
    'window-placement': 'windows'
  }
  const STATE = { allow: 'granted', block: 'denied', ask: 'prompt' } as const
  const perms = globalThis.Permissions?.prototype
  if (!perms?.query) return
  const nativeQuery = perms.query
  const watched = new Map<string, Set<WeakRef<PermissionStatus>>>()
  const show = (status: PermissionStatus, state: PermissionState): boolean => {
    if (status.state === state) return false
    Object.defineProperty(status, 'state', { configurable: true, get: () => state })
    return true
  }
  perms.query = function query(this: Permissions, desc: PermissionDescriptor) {
    return nativeQuery.call(this, desc).then(async (status) => {
      const kind = KIND[desc?.name]
      if (!kind) return status
      const setting = await bridge.setting(kind).catch(() => null)
      if (setting) show(status, STATE[setting])
      let set = watched.get(kind)
      if (!set) watched.set(kind, (set = new Set()))
      set.add(new WeakRef(status))
      return status
    })
  }
  // Notification.permission is read synchronously: it holds the setting as last fetched
  let notify: 'allow' | 'block' | 'ask' | null = null
  const N = globalThis.Notification
  const nativePermission = N && Object.getOwnPropertyDescriptor(N, 'permission')?.get
  const fetchNotify = (): void =>
    void bridge
      .setting('notifications')
      .then((s) => (notify = s))
      .catch(() => undefined)
  if (nativePermission) {
    Object.defineProperty(N, 'permission', {
      configurable: true,
      enumerable: true,
      get() {
        if (!notify) return nativePermission.call(N)
        return notify === 'allow' ? 'granted' : notify === 'block' ? 'denied' : 'default'
      }
    })
    fetchNotify()
  }
  bridge.onChange(() => {
    fetchNotify()
    for (const [kind, set] of watched) {
      void bridge
        .setting(kind)
        .then((setting) => {
          if (!setting) return
          for (const ref of set) {
            const status = ref.deref()
            if (!status) set.delete(ref)
            else if (show(status, STATE[setting])) status.dispatchEvent(new Event('change'))
          }
        })
        .catch(() => undefined)
    }
  })
}

if (/^https?:$/.test(location.protocol)) {
  try {
    contextBridge.executeInMainWorld({
      func: permissionShim,
      args: [
        {
          setting: (kind: string) => ipcRenderer.invoke('perm:setting', kind),
          onChange: (cb: () => void) => void ipcRenderer.on('perm:changed', () => cb())
        }
      ]
    })
  } catch {
    // a frame torn down as it started: nothing to tell
  }
}
