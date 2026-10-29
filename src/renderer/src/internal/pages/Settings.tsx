import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, SEARCH_ENGINES } from '../../../../shared/settings'
import type { ClearKind, SearchEngineId, Settings as SettingsData } from '../../../../shared/types'

import { SLIDERS } from '../sliders'
import { Group, Row, Segmented, Select, SliderRow, Toggle } from '../ui'
import { MemorySection } from './MemorySection'
import { SitePermissions } from './SitePermissions'
import { SpacesSection } from './SpacesSection'

const ACCENTS = ['#8b8bff', '#5eb6ff', '#4ade80', '#fbbf24', '#fb7185', '#e879f9']

const CLEAR_OPTIONS: Array<{ kind: ClearKind; label: string }> = [
  { kind: 'history', label: 'Browsing history' },
  { kind: 'cookies', label: 'Cookies and site data' },
  { kind: 'cache', label: 'Cached files' },
  { kind: 'downloads', label: 'Download list' }
]

const RANGES: Array<{ label: string; ms: number | null }> = [
  { label: 'Last hour', ms: 3_600_000 },
  { label: 'Last 24 hours', ms: 86_400_000 },
  { label: 'Last 7 days', ms: 7 * 86_400_000 },
  { label: 'All time', ms: null }
]

export function Settings(): React.JSX.Element {
  const [s, setS] = useState<SettingsData>(DEFAULT_SETTINGS)
  const [kinds, setKinds] = useState<Set<ClearKind>>(new Set(['history']))
  const [range, setRange] = useState(1)
  const [cleared, setCleared] = useState(false)

  useEffect(() => {
    void window.panesInternal.getSettings().then((v) => setS({ ...DEFAULT_SETTINGS, ...v }))
  }, [])

  const update = async (patch: Partial<SettingsData>): Promise<void> => {
    setS((prev) => ({ ...prev, ...patch })) // optimistic; main validates and echoes back
    setS({ ...DEFAULT_SETTINGS, ...(await window.panesInternal.setSettings(patch)) })
  }

  const toggleKind = (k: ClearKind): void =>
    setKinds((prev) => {
      const next = new Set(prev)
      if (!next.delete(k)) next.add(k)
      return next
    })

  const clear = async (): Promise<void> => {
    await window.panesInternal.clearData([...kinds], RANGES[range].ms)
    setCleared(true)
    setTimeout(() => setCleared(false), 2500)
  }

  return (
    <>
      <Group title="Search">
        <Row label="Search engine" hint="Used when you type something that is not a web address.">
          <Select
            label="Search engine"
            value={s.searchEngine}
            options={Object.entries(SEARCH_ENGINES).map(([id, e]) => ({
              value: id as SearchEngineId,
              label: e.name
            }))}
            onChange={(v) => void update({ searchEngine: v })}
          />
        </Row>
        <Row
          label="Search suggestions"
          hint="Send what you type in the command bar to your search engine to get suggestions."
        >
          <Toggle
            label="Search suggestions"
            on={s.searchSuggestions}
            onChange={(v) => void update({ searchSuggestions: v })}
          />
        </Row>
        <Row label="Command bar style" hint="Grow out of the address bar, or open in the middle.">
          <Segmented
            label="Command bar style"
            value={s.searchStyle}
            options={[
              { value: 'dropdown', label: 'Under bar' },
              { value: 'center', label: 'Centered' }
            ]}
            onChange={(v) => void update({ searchStyle: v })}
          />
        </Row>
      </Group>

      <Group title="On startup" footer="Restore brings back the tabs you had open.">
        <Row label="When Panes opens">
          <Segmented
            label="When Panes opens"
            value={s.startup}
            options={[
              { value: 'newtab', label: 'New tab' },
              { value: 'restore', label: 'Restore tabs' }
            ]}
            onChange={(v) => void update({ startup: v })}
          />
        </Row>
      </Group>

      <SpacesSection />

      <Group
        title="Tabs"
        footer="Vertical keeps tabs, spaces and the address bar in a sidebar you can tuck away. Horizontal puts tabs in a row along the top, with spaces at the left end."
      >
        <Row label="Tab layout">
          <Segmented
            label="Tab layout"
            value={s.tabLayout}
            options={[
              { value: 'vertical', label: 'Sidebar' },
              { value: 'horizontal', label: 'Along the top' }
            ]}
            onChange={(v) => void update({ tabLayout: v })}
          />
        </Row>
      </Group>

      <Group
        title="Appearance"
        footer="Accent colour highlights controls, focus rings and the split view glow."
      >
        <Row label="Accent colour">
          <div className="swatches">
            {ACCENTS.map((c) => (
              <button
                key={c}
                className={'swatch' + (s.accent.toLowerCase() === c ? ' on' : '')}
                style={{ background: c }}
                aria-label={c}
                onClick={() => void update({ accent: c })}
              />
            ))}
            <input
              type="color"
              value={s.accent}
              aria-label="Custom accent colour"
              onChange={(e) => void update({ accent: e.target.value })}
            />
          </div>
        </Row>
        <Row
          label="Hide the top bar when the sidebar is collapsed"
          hint="Gives the page the whole window. Move the pointer to the top edge to bring it back."
        >
          <Toggle
            label="Auto-hide top bar"
            on={s.autoHideTopBar}
            onChange={(v) => void update({ autoHideTopBar: v })}
          />
        </Row>
        <Row
          label="Open the sidebar from the left edge"
          hint="With the sidebar collapsed, touching the left edge of the window brings it back, and it tucks away again when the pointer leaves."
        >
          <Toggle
            label="Open the sidebar from the left edge"
            on={s.sidebarHover}
            onChange={(v) => void update({ sidebarHover: v })}
          />
        </Row>
      </Group>

      <Group
        title="Websites"
        footer="Sites that already have a dark theme use it whenever the space is dark. This darkens the ones that do not."
      >
        <Row
          label="Darken websites in dark spaces"
          hint="Colours are inverted on pages without a dark theme. Pictures and video keep their colours."
        >
          <Toggle
            label="Darken websites in dark spaces"
            on={s.darkenSites}
            onChange={(v) => void update({ darkenSites: v })}
          />
        </Row>
      </Group>

      <Group title="Interface size">
        {SLIDERS.map((sl) => (
          <SliderRow
            key={sl.key}
            spec={sl}
            value={s[sl.key]}
            onChange={(v) => void update({ [sl.key]: v })}
          />
        ))}
        <Row label="Address bar shows" hint="What you see in the bar while you are not typing.">
          <Segmented
            label="Address bar shows"
            value={s.urlDisplay}
            options={[
              { value: 'full', label: 'Full address' },
              { value: 'host', label: 'Site name' }
            ]}
            onChange={(v) => void update({ urlDisplay: v })}
          />
        </Row>
        <div className="u-row center">
          <button
            className="int-btn small"
            onClick={() =>
              void update({
                uiScale: DEFAULT_SETTINGS.uiScale,
                density: DEFAULT_SETTINGS.density,
                sidebarWidth: DEFAULT_SETTINGS.sidebarWidth,
                pageMargin: DEFAULT_SETTINGS.pageMargin,
                addressSize: DEFAULT_SETTINGS.addressSize
              })
            }
          >
            Reset interface size
          </button>
        </div>
      </Group>

      <MemorySection s={s} update={update} />

      <SitePermissions />

      <Group title="Privacy" id="privacy">
        <Row
          label="Block ads and trackers"
          hint="Filters requests at the network level on every site."
        >
          <Toggle
            label="Block ads and trackers"
            on={s.adblock}
            onChange={(v) => void update({ adblock: v })}
          />
        </Row>
      </Group>

      <Group
        title="Clear browsing data"
        footer="Cookies and cache are always cleared for all time."
      >
        {CLEAR_OPTIONS.map((o) => (
          <label key={o.kind} className="u-row tap">
            <span className="u-label">{o.label}</span>
            <input
              type="checkbox"
              checked={kinds.has(o.kind)}
              onChange={() => toggleKind(o.kind)}
            />
          </label>
        ))}
        <Row label="Time range">
          <Select
            label="Time range"
            value={range}
            options={RANGES.map((r, i) => ({ value: i, label: r.label }))}
            onChange={setRange}
          />
        </Row>
        <div className="u-row center">
          <button
            className="int-btn danger"
            disabled={kinds.size === 0}
            onClick={() => void clear()}
          >
            {cleared ? 'Cleared' : 'Clear data'}
          </button>
        </div>
      </Group>

      <Group title="Shortcuts">
        {[
          ['Ctrl+T', 'New tab'],
          ['Ctrl+L', 'Address bar'],
          ['Ctrl+\\', 'Split view'],
          ['Alt+Shift+Arrows', 'Move focused pane'],
          ['Ctrl+Shift+A', 'All tabs'],
          ['Ctrl+Tab', 'Fly through tabs, release to land'],
          ['Ctrl+scroll', 'Fly through tabs (not in PDFs)'],
          ['Ctrl+PageDown/Up', 'Next or previous tab'],
          ['Ctrl+D', 'Bookmark'],
          ['Ctrl+F', 'Find in page'],
          ['Ctrl+H', 'History'],
          ['Ctrl+J', 'Downloads'],
          ['Ctrl+B', 'Toggle sidebar'],
          ['Ctrl +/-/0', 'Zoom'],
          ['F12', 'Developer tools']
        ].map(([k, label]) => (
          <Row key={k} label={label}>
            <kbd>{k}</kbd>
          </Row>
        ))}
      </Group>
    </>
  )
}
