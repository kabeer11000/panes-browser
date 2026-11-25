import { APPEARANCE_LIMITS, SEARCH_ENGINES } from '../settings'
import type { Settings } from '../types'

/**
 * Panes' own settings the assistant may read and change when asked ("turn on frosted glass", "make everything a
 * bit bigger"). Only how Panes looks and behaves day to day: never privacy or blocking (a model must not be able to
 * turn protection off), where files go, AI keys, or debugging. Model output is untrusted, so every change is checked
 * here before it is made. Pure, so it is tested.
 */

type Kind =
  | { type: 'boolean' }
  | { type: 'enum'; values: readonly string[] }
  | { type: 'number'; min: number; max: number }
  | { type: 'color' }

interface Entry {
  /** What it is, in the words of the Settings page. */
  label: string
  kind: Kind
}

const range = (k: keyof typeof APPEARANCE_LIMITS): Kind => ({
  type: 'number',
  min: APPEARANCE_LIMITS[k].min,
  max: APPEARANCE_LIMITS[k].max
})
const BOOL: Kind = { type: 'boolean' }
const oneOf = (...values: string[]): Kind => ({ type: 'enum', values })

export const AI_SETTINGS = {
  frostedGlass: { label: 'Frosted glass (translucent, blurred bars and menus)', kind: BOOL },
  tooltips: { label: 'Tooltips on buttons', kind: BOOL },
  accent: { label: 'Accent colour (a hex colour like #8b8bff)', kind: { type: 'color' } },
  uiScale: { label: 'Interface size (1 is normal)', kind: range('uiScale') },
  density: { label: 'Spacing (1 is normal, lower is tighter)', kind: range('density') },
  addressSize: { label: 'Address bar size (1 is normal)', kind: range('addressSize') },
  pageMargin: { label: 'Margin around pages, in pixels', kind: range('pageMargin') },
  sidebarWidth: { label: 'Sidebar width, in pixels', kind: range('sidebarWidth') },
  pageZoom: {
    label: 'Default page zoom (0 is 100%, each step 1.2 times)',
    kind: range('pageZoom')
  },
  tabLayout: { label: 'Tab layout', kind: oneOf('vertical', 'horizontal') },
  autoHideTopBar: { label: 'Hide the top bar when the sidebar is collapsed', kind: BOOL },
  sidebarHover: { label: 'Open the sidebar from the left edge', kind: BOOL },
  fullWidthAddress: { label: 'Address bar spans the whole row', kind: BOOL },
  urlDisplay: {
    label: 'Address bar shows the full address or the site',
    kind: oneOf('full', 'host')
  },
  frozenBlur: { label: 'Page blur behind overlays', kind: oneOf('off', 'slight', 'strong') },
  newTabPhoto: { label: 'Photo on the new tab page', kind: BOOL },
  newTabDither: { label: 'Dithered look on the new tab photo', kind: BOOL },
  darkenSites: { label: 'Darken websites in dark spaces', kind: BOOL },
  searchEngine: { label: 'Search engine', kind: oneOf(...Object.keys(SEARCH_ENGINES)) },
  searchSuggestions: { label: 'Search suggestions while typing', kind: BOOL },
  startup: {
    label: 'When Panes opens: restore tabs or a new tab',
    kind: oneOf('restore', 'newtab')
  },
  browseWith: { label: 'Browse with tabs or the canvas board', kind: oneOf('tabs', 'canvas') },
  previewBar: { label: 'Where the board preview toolbar sits', kind: oneOf('top', 'bottom') },
  memorySaver: { label: 'Memory saver (unload tabs not used for a while)', kind: BOOL }
} as const satisfies Partial<Record<keyof Settings, Entry>>

export type AiSettingKey = keyof typeof AI_SETTINGS

const isKey = (k: string): k is AiSettingKey => Object.hasOwn(AI_SETTINGS, k)

const show = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v))

/** The settings the assistant may change, each with what it is, its current value and what it takes. */
export function describeSettings(s: Settings): string {
  return (Object.keys(AI_SETTINGS) as AiSettingKey[])
    .map((k) => {
      const e: Entry = AI_SETTINGS[k]
      const takes =
        e.kind.type === 'boolean'
          ? 'true or false'
          : e.kind.type === 'enum'
            ? e.kind.values.join(' | ')
            : e.kind.type === 'number'
              ? `${e.kind.min} to ${e.kind.max}`
              : 'a hex colour'
      return `${k} = ${show(s[k])} (${e.label}; takes ${takes})`
    })
    .join('\n')
}

export type SettingChange =
  | { ok: true; key: AiSettingKey; value: Settings[AiSettingKey]; label: string }
  | { ok: false; error: string }

/** A change the assistant asked for, checked: a known key and a value it takes (text such as "true" or "1.1" is read). */
export function checkSettingChange(key: unknown, value: unknown): SettingChange {
  if (typeof key !== 'string' || !isKey(key))
    return {
      ok: false,
      error: `key must be one of: ${Object.keys(AI_SETTINGS).join(', ')} (call get_settings)`
    }
  const e: Entry = AI_SETTINGS[key]
  const ok = (v: unknown): SettingChange => ({
    ok: true,
    key,
    value: v as Settings[AiSettingKey],
    label: e.label
  })
  const bad = (what: string): SettingChange => ({ ok: false, error: `${key} takes ${what}` })
  switch (e.kind.type) {
    case 'boolean': {
      const v = value === 'true' ? true : value === 'false' ? false : value
      return typeof v === 'boolean' ? ok(v) : bad('true or false')
    }
    case 'enum': {
      const v = typeof value === 'string' ? value.trim().toLowerCase() : value
      return typeof v === 'string' && e.kind.values.includes(v)
        ? ok(v)
        : bad(e.kind.values.join(' | '))
    }
    case 'number': {
      const v = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
      return typeof v === 'number' && Number.isFinite(v) && v >= e.kind.min && v <= e.kind.max
        ? ok(v)
        : bad(`a number from ${e.kind.min} to ${e.kind.max}`)
    }
    case 'color': {
      const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
      return /^#?[0-9a-f]{6}$/.test(v)
        ? ok(v.startsWith('#') ? v : `#${v}`)
        : bad('a hex colour like #8b8bff')
    }
  }
}
