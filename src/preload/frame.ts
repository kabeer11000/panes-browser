import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { PASSKEY_SHIM } from '@shared/passkeys'
import { notifyShim } from '@shared/notify'
import { captureShim } from '@shared/capture'
import { webShareShim } from '@shared/webShare'
import { unseenShim } from '@shared/unseen'

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

// Global Privacy Control (the setting): the page can read it as navigator.globalPrivacyControl, before its own scripts
// run; the request header says it too (main/identity.ts). Off, it is not there at all, as in Chrome.
if (/^https?:$/.test(location.protocol) && ipcRenderer.sendSync('privacy:signal') === true) {
  try {
    contextBridge.executeInMainWorld({
      func: () =>
        Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', {
          get: () => true,
          configurable: true,
          enumerable: true
        })
    })
  } catch {
    // a frame torn down as it started
  }
}

if (/^https?:$/.test(location.protocol)) {
  try {
    // passed itself, run from its source text in the page's world (see notifyShim below)
    contextBridge.executeInMainWorld({
      func: captureShim,
      args: [
        {
          report: (data: string) => ipcRenderer.send('capture:report', data),
          onStop: (cb: (kinds: string[]) => void) =>
            void ipcRenderer.on('capture:stop', (_e, kinds: string[]) => cb(kinds))
        }
      ]
    })
  } catch {
    // a frame torn down as it started
  }
  try {
    // painted out of sight for a board picture, the page is not told it was shown (see shared/unseen.ts); main
    // waits for the reply before showing it, so the hold is in place first
    contextBridge.executeInMainWorld({
      func: unseenShim,
      args: [
        {
          onHold: (cb: (on: boolean, shown?: boolean) => void) =>
            void ipcRenderer.on('unseen:hold', (_e, on: boolean, shown?: boolean) => {
              cb(on, shown)
              ipcRenderer.send('unseen:held')
            })
        }
      ]
    })
  } catch {
    // a frame torn down as it started
  }
  try {
    contextBridge.executeInMainWorld({
      // run from its source text in the page's world, so it is passed itself (a wrapper would call a name that
      // does not exist there); its second parameter defaults to that world's globalThis
      func: notifyShim,
      args: [{ report: (data: string) => ipcRenderer.send('notify:report', data) }]
    })
  } catch {
    // a frame torn down as it started
  }
  // Picture in picture is Chromium's own floating window, as in Chrome (the page's button or Panes'): main only hears
  // which tab has it (the events reach this world too: the DOM is shared), so that tab is kept loaded and marked.
  document.addEventListener(
    'enterpictureinpicture',
    () => ipcRenderer.send('pip:native', true),
    true
  )
  // Its "back to tab" button closes the window and the video plays on; its X pauses it (as in Chrome). Read a moment
  // later: the pause can land just after the event.
  document.addEventListener(
    'leavepictureinpicture',
    (e) => {
      const v = e.target
      setTimeout(
        () =>
          ipcRenderer.send(
            'pip:native',
            false,
            v instanceof HTMLVideoElement && !v.paused && !v.ended
          ),
        200
      )
    },
    true
  )
  // navigator.share (Electron has none): Panes' own share menu, from the top frame only
  if (window === window.top)
    try {
      contextBridge.executeInMainWorld({
        func: webShareShim,
        args: [{ share: (data: string) => ipcRenderer.invoke('web:share', data) }]
      })
    } catch {
      // a frame torn down as it started
    }
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
