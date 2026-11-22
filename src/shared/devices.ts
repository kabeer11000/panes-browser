/**
 * The device chooser (main/devices.ts): what a site asking for a USB, HID, serial or Bluetooth device is shown. Picking
 * a device in it is the permission, as in Chrome.
 */

export type DeviceKind = 'hid' | 'usb' | 'serial' | 'bluetooth'

/** What the chooser asks for, in words. */
export const DEVICE_WORD: Record<DeviceKind, string> = {
  hid: 'a device',
  usb: 'a USB device',
  serial: 'a serial port',
  bluetooth: 'a Bluetooth device'
}

/** The most the chooser lists (a native dialog of buttons; anything past this is very rarely the one). */
export const MAX_CHOICES = 12

export interface DeviceChoice {
  id: string
  name?: string
  vendorId?: number | string
  productId?: number | string
}

const hex4 = (v: number | string | undefined): string | null => {
  if (v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseInt(v, 16)
  return Number.isFinite(n) ? n.toString(16).padStart(4, '0') : null
}

/** A device's name as people know it, else its vendor and product numbers. */
export function deviceLabel(d: DeviceChoice): string {
  const name = d.name?.replace(/\s+/g, ' ').trim()
  if (name) return name
  const v = hex4(d.vendorId)
  const p = hex4(d.productId)
  return v && p ? `Unknown device (${v}:${p})` : 'Unknown device'
}

/** The labels for a list, in order: two devices of the same name are told apart by a number. */
export function choiceLabels(list: readonly DeviceChoice[]): string[] {
  const labels = list.slice(0, MAX_CHOICES).map(deviceLabel)
  const seen = new Map<string, number>()
  const total = new Map<string, number>()
  for (const l of labels) total.set(l, (total.get(l) ?? 0) + 1)
  return labels.map((l) => {
    if ((total.get(l) ?? 0) < 2) return l
    const n = (seen.get(l) ?? 0) + 1
    seen.set(l, n)
    return `${l} (${n})`
  })
}

/**
 * Permission checks a page makes before asking for a device. Answered yes: they only let the request reach the
 * chooser, where picking a device is the permission.
 */
export const CHOOSER_CHECKS: ReadonlySet<string> = new Set(['hid', 'serial', 'usb', 'bluetooth'])
