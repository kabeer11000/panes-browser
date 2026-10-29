import { useEffect, useState } from 'react'
import {
  IDLE_CHOICES_MIN,
  MAX_LOADED_CHOICES,
  MEMORY_PRESETS,
  normalizeSites,
  presetOf,
  type MemoryPreset
} from '../../../../shared/memory'
import { resolveMode, type PerformanceMode } from '../../../../shared/performance'
import type { MemoryStats, Settings } from '../../../../shared/types'
import { Group, Row, Segmented, Select, Toggle } from '../ui'

const PRESET_LABEL: Record<MemoryPreset | 'custom', string> = {
  relaxed: 'Relaxed',
  balanced: 'Balanced',
  aggressive: 'Maximum',
  custom: 'Custom'
}

const idleLabel = (m: number): string =>
  m < 60 ? `${m} minute${m === 1 ? '' : 's'}` : `${m / 60} hour${m === 60 ? '' : 's'}`

interface Props {
  s: Settings
  update: (patch: Partial<Settings>) => Promise<void>
}

/** Memory saver: unloads background tabs, with a preset on top of the individual controls. */
export function MemorySection({ s, update }: Props): React.JSX.Element {
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [freed, setFreed] = useState<number | null>(null)
  // Text being typed; null while showing the saved list.
  const [draft, setDraft] = useState<string | null>(null)
  const sites = draft ?? s.neverUnloadSites.join('\n')

  const refresh = (): void => void window.panesInternal.memoryStats().then(setStats)
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 4000)
    return () => clearInterval(t)
  }, [])

  const preset = presetOf(s)
  // Chromium's process switches are read once at launch, so a change waits for a restart.
  const needsRestart =
    !!stats && resolveMode(s.performanceMode, stats.totalGb * 1024 ** 3) !== stats.runningMode
  const free = async (): Promise<void> => {
    setFreed(await window.panesInternal.memoryFree())
    refresh()
    setTimeout(() => setFreed(null), 3000)
  }
  const saveSites = (): void => {
    const list = normalizeSites(sites.split(/[\n,]+/))
    setDraft(null)
    void update({ neverUnloadSites: list })
  }

  return (
    <Group
      title="Memory"
      footer="Unloaded tabs keep their title, icon and a snapshot, and reload when you open them. Tabs that are playing sound, loading, in picture in picture, or on screen are never unloaded."
    >
      <Row
        label="Performance"
        hint="Efficient lets tabs on the same site share one process: about a quarter less memory and half the processes, with less separation between those tabs. Auto chooses Efficient on computers with 8 GB of memory or less."
      >
        <Segmented
          label="Performance"
          value={s.performanceMode}
          options={(
            [
              ['auto', 'Auto'],
              ['balanced', 'Balanced'],
              ['efficient', 'Efficient']
            ] as Array<[PerformanceMode, string]>
          ).map(([value, label]) => ({ value, label }))}
          onChange={(v) => void update({ performanceMode: v })}
        />
      </Row>
      {needsRestart && (
        <Row label="Restart to apply" hint="Your tabs come back as they were.">
          <button
            className="int-btn primary small"
            onClick={() => void window.panesInternal.restart()}
          >
            Restart Panes
          </button>
        </Row>
      )}
      <Row
        label="Memory saver"
        hint="Unload background tabs you are not using. Helps most on computers with little memory."
      >
        <Toggle
          label="Memory saver"
          on={s.memorySaver}
          onChange={(v) => void update({ memorySaver: v })}
        />
      </Row>
      {s.memorySaver && (
        <>
          <Row
            label="Level"
            hint="Presets for the two settings below. Change either and it becomes Custom."
          >
            <Segmented
              label="Memory saver level"
              value={preset === 'custom' ? 'balanced' : preset}
              options={(Object.keys(MEMORY_PRESETS) as MemoryPreset[]).map((p) => ({
                value: p,
                label: PRESET_LABEL[p]
              }))}
              onChange={(p) => void update({ ...MEMORY_PRESETS[p] })}
            />
          </Row>
          <Row label="Unload a tab after" hint="How long a background tab can go unused first.">
            <Select
              label="Unload a tab after"
              value={s.unloadIdleMin}
              options={IDLE_CHOICES_MIN.map((m) => ({ value: m as number, label: idleLabel(m) }))}
              onChange={(v) => void update({ unloadIdleMin: v })}
            />
          </Row>
          <Row
            label="Most tabs kept loaded"
            hint="Past this number the least recently used tabs unload at once, whatever their age."
          >
            <Select
              label="Most tabs kept loaded"
              value={s.maxLoadedTabs}
              options={MAX_LOADED_CHOICES.map((n) => ({
                value: n as number,
                label: n === 0 ? 'No limit' : `${n} tabs`
              }))}
              onChange={(v) => void update({ maxLoadedTabs: v })}
            />
          </Row>
          <Row
            label="Unload other spaces quickly"
            hint="Tabs in spaces you are not using unload after 2 minutes."
          >
            <Toggle
              label="Unload other spaces quickly"
              on={s.unloadOtherSpaces}
              onChange={(v) => void update({ unloadOtherSpaces: v })}
            />
          </Row>
          <Row
            label="Never unload these sites"
            hint="One per line, such as meet.google.com. Subdomains match too."
            stacked
          >
            <textarea
              className="int-text"
              rows={3}
              spellCheck={false}
              value={sites}
              aria-label="Never unload these sites"
              placeholder="figma.com"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={saveSites}
            />
          </Row>
        </>
      )}
      <Row
        label={stats ? `Panes is using ${stats.usedMb} MB` : 'Panes is using ...'}
        hint={stats ? `${stats.loaded} tabs loaded, ${stats.unloaded} unloaded.` : undefined}
      >
        <button className="int-btn small" onClick={() => void free()}>
          {freed === null ? 'Free memory now' : `Unloaded ${freed}`}
        </button>
      </Row>
    </Group>
  )
}
