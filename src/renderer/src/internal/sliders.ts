import type { AppearanceKey } from '../../../shared/settings'

export interface SliderSpec {
  key: AppearanceKey
  label: string
  hint: string
  format: (v: number) => string
}

const percent = (v: number): string => `${Math.round(v * 100)}%`
const pixels = (v: number): string => `${v}px`

/** The interface-size sliders, shared by the global settings and the per-space overrides. */
export const SLIDERS: SliderSpec[] = [
  {
    key: 'uiScale',
    label: 'Interface size',
    hint: 'Text and icons in the sidebar and pane headers.',
    format: percent
  },
  {
    key: 'density',
    label: 'Density',
    hint: 'Lower is thinner: smaller rows, buttons and spacing.',
    format: percent
  },
  {
    key: 'sidebarWidth',
    label: 'Sidebar width',
    hint: 'How wide the tab sidebar is.',
    format: pixels
  },
  {
    key: 'addressSize',
    label: 'Address bar size',
    hint: 'Height and text size of the address bar.',
    format: percent
  },
  {
    key: 'pageMargin',
    label: 'Page margin',
    hint: 'Space between the page and the window edge.',
    format: pixels
  }
]
