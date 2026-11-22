import {
  app,
  BrowserWindow,
  dialog,
  webContents,
  type Session,
  type WebContents,
  type WebFrameMain
} from 'electron'
import {
  choiceLabels,
  DEVICE_WORD,
  MAX_CHOICES,
  type DeviceChoice,
  type DeviceKind
} from '@shared/devices'

/** How long Bluetooth devices are searched for before the list is shown (they turn up one by one). */
const BLUETOOTH_SCAN_MS = 2500

const hostOf = (origin: string): string => {
  try {
    return new URL(origin).host || origin
  } catch {
    return origin
  }
}

/** The page and site a device request came from. */
function asker(frame: WebFrameMain | null): { wc: WebContents | null; origin: string } {
  if (!frame || frame.isDestroyed()) return { wc: null, origin: '' }
  return { wc: webContents.fromFrame(frame) ?? null, origin: frame.origin }
}

/** The chooser: the devices found, one to pick or Cancel. Resolves with the picked device's id, or null. */
async function choose(
  wc: WebContents | null,
  kind: DeviceKind,
  origin: string,
  list: readonly DeviceChoice[]
): Promise<string | null> {
  const win = (wc && BrowserWindow.fromWebContents(wc)) || BrowserWindow.getAllWindows()[0]
  const what = DEVICE_WORD[kind]
  const site = hostOf(origin)
  if (list.length === 0) {
    const opts = {
      type: 'info' as const,
      buttons: ['OK'],
      title: `Connect ${what}`,
      message: `${site} wants to connect to ${what}`,
      detail: 'No compatible devices found. Plug it in or turn it on, then try again on the site.'
    }
    await (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))
    return null
  }
  const shown = list.slice(0, MAX_CHOICES)
  const opts = {
    type: 'question' as const,
    buttons: [...choiceLabels(shown), 'Cancel'],
    cancelId: shown.length,
    defaultId: shown.length,
    noLink: false, // on Windows, the devices are a list of large choices rather than a row of buttons
    title: `Connect ${what}`,
    message: `${site} wants to connect to ${what}`,
    detail: 'Pick one to let the site use it.'
  }
  const { response } = await (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))
  return response < shown.length ? shown[response].id : null
}

/**
 * Chrome's device choosers for WebHID, WebUSB, Web Serial and Web Bluetooth, which Electron leaves to the app (with no
 * handler, every such request failed). The device picked stays allowed for that site in this session.
 */
export function installDevicePickers(session: Session): void {
  const granted = new Set<string>()
  const key = (origin: string, kind: string, id: string): string => `${origin} ${kind} ${id}`
  const pick = (
    kind: DeviceKind,
    wc: WebContents | null,
    origin: string,
    list: DeviceChoice[],
    answer: (id: string | null) => void
  ): void => {
    void choose(wc, kind, origin, list)
      .then((id) => {
        if (id) granted.add(key(origin, kind, id))
        answer(id)
      })
      .catch(() => answer(null))
  }

  session.on('select-hid-device', (e, details, callback) => {
    e.preventDefault()
    const { wc, origin } = asker(details.frame)
    const list = details.deviceList.map((d) => ({
      id: d.deviceId,
      name: d.name,
      vendorId: d.vendorId,
      productId: d.productId
    }))
    pick('hid', wc, origin, list, (id) => (id ? callback(id) : callback()))
  })
  session.on('select-usb-device', (e, details, callback) => {
    e.preventDefault()
    const { wc, origin } = asker(details.frame)
    const list = details.deviceList.map((d) => ({
      id: d.deviceId,
      name: d.productName,
      vendorId: d.vendorId,
      productId: d.productId
    }))
    pick('usb', wc, origin, list, (id) => (id ? callback(id) : callback()))
  })
  session.on('select-serial-port', (e, portList, wc, callback) => {
    e.preventDefault()
    const list = portList.map((p) => ({
      id: p.portId,
      name: p.displayName || p.portName,
      vendorId: p.vendorId,
      productId: p.productId
    }))
    pick('serial', wc, new URL(wc.getURL()).origin, list, (id) => callback(id ?? ''))
  })
  session.setDevicePermissionHandler((details) => {
    const d = details.device as { deviceId?: string; portId?: string }
    const id = d.deviceId ?? d.portId
    return !!id && granted.has(key(details.origin, details.deviceType, id))
  })
}

/** Web Bluetooth's chooser, per page: devices are reported as they are found, so it waits a moment, then asks. */
export function installBluetoothPicker(): void {
  app.on('web-contents-created', (_e, wc) => {
    let pending: {
      list: DeviceChoice[]
      answer: (id: string) => void
      timer: NodeJS.Timeout
    } | null = null
    wc.on('select-bluetooth-device', (e, devices, callback) => {
      e.preventDefault()
      const list = devices.map((d) => ({ id: d.deviceId, name: d.deviceName }))
      if (pending) {
        pending.list = list
        pending.answer = callback
        return
      }
      const now = (pending = {
        list,
        answer: callback,
        timer: setTimeout(() => {
          pending = null
          if (wc.isDestroyed()) return
          void choose(wc, 'bluetooth', new URL(wc.getURL()).origin, now.list)
            .then((id) => now.answer(id ?? ''))
            .catch(() => now.answer(''))
        }, BLUETOOTH_SCAN_MS)
      })
    })
  })
}
