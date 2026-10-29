import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_SETTINGS } from '../../../../shared/settings'
import type { Settings, Space, SpacePatch, SpaceUi } from '../../../../shared/types'
import { SpaceAvatar } from '../../components/SpaceAvatar'
import { SpaceIdentity } from '../../components/SpaceIdentity'
import { ThemePicker } from '../../components/ThemePicker'
import { SLIDERS } from '../sliders'
import { Group, Row, Segmented, SliderRow, Toggle } from '../ui'

/** Create, theme, rename and delete spaces, and give each one its own interface settings. */
export function SpacesSection(): React.JSX.Element {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [global, setGlobal] = useState<Settings>(DEFAULT_SETTINGS)
  const [confirming, setConfirming] = useState(false)

  const reload = useCallback(async () => {
    setSpaces(await window.panesInternal.spacesList())
  }, [])

  useEffect(() => {
    void window.panesInternal.spacesList().then(setSpaces)
    void window.panesInternal.getSettings().then((s) => setGlobal({ ...DEFAULT_SETTINGS, ...s }))
  }, [])

  const space = spaces.find((s) => s.id === selectedId) ?? spaces[0]

  // Optimistic: the wheel and sliders must follow the pointer, so state updates before main confirms.
  const patch = (p: SpacePatch): void => {
    if (!space) return
    setSpaces((all) => all.map((s) => (s.id === space.id ? { ...s, ...p } : s)))
    void window.panesInternal.spaceUpdate(space.id, p)
  }

  if (!space) return <></>

  const customUi = Object.keys(space.ui).length > 0
  const setUi = (ui: SpaceUi): void => patch({ ui })

  return (
    <>
      <Group
        title="Spaces"
        id="spaces"
        footer="Each space keeps its own tabs, colours and, if you like, its own interface settings."
      >
        <div className="space-cards" role="tablist" aria-label="Spaces">
          {spaces.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === space.id}
              className={'space-card' + (s.id === space.id ? ' active' : '')}
              style={{ ['--sc' as string]: s.color }}
              onClick={() => {
                setSelectedId(s.id)
                setConfirming(false)
              }}
            >
              <SpaceAvatar color={s.color} color2={s.color2} icon={s.icon} size={40} />
              <span>{s.name}</span>
            </button>
          ))}
          <button
            type="button"
            className="space-card add"
            onClick={async () => {
              const created = await window.panesInternal.spaceCreate()
              await reload()
              setSelectedId(created.id)
            }}
          >
            <span className="space-card-plus" aria-hidden="true">
              +
            </span>
            <span>New space</span>
          </button>
        </div>
      </Group>

      <Group
        title={space.name}
        footer="Colours the sidebar and window while you are in this space."
      >
        <Row label="Name and icon" stacked>
          <SpaceIdentity
            space={space}
            onName={(name) => patch({ name })}
            onIcon={(icon) => patch({ icon })}
          />
        </Row>
        <Row label="Theme" stacked>
          <ThemePicker
            color={space.color}
            color2={space.color2}
            tint={space.tint}
            grain={space.grain}
            mode={space.mode}
            onChange={patch}
          />
        </Row>
      </Group>

      <Group
        title="Interface for this space"
        footer="Off uses the global interface settings above."
      >
        <Row
          label="Own interface settings"
          hint="Give this space its own sidebar width, density and address bar."
        >
          <Toggle
            label="Own interface settings"
            on={customUi}
            onChange={(on) =>
              setUi(
                on
                  ? {
                      uiScale: global.uiScale,
                      density: global.density,
                      sidebarWidth: global.sidebarWidth,
                      addressSize: global.addressSize,
                      pageMargin: global.pageMargin,
                      urlDisplay: global.urlDisplay
                    }
                  : {}
              )
            }
          />
        </Row>
        {customUi &&
          SLIDERS.map((sl) => (
            <SliderRow
              key={sl.key}
              spec={sl}
              showHint={false}
              value={space.ui[sl.key] ?? global[sl.key]}
              onChange={(v) => setUi({ ...space.ui, [sl.key]: v })}
            />
          ))}
        {customUi && (
          <Row label="Address bar shows">
            <Segmented
              label="Address bar shows"
              value={space.ui.urlDisplay ?? global.urlDisplay}
              options={[
                { value: 'full', label: 'Full address' },
                { value: 'host', label: 'Site name' }
              ]}
              onChange={(v) => setUi({ ...space.ui, urlDisplay: v })}
            />
          </Row>
        )}
      </Group>

      {spaces.length > 1 && (
        <Group>
          <div className="u-row center">
            <button
              type="button"
              className="int-btn danger"
              onClick={async () => {
                if (!confirming) return setConfirming(true)
                await window.panesInternal.spaceDelete(space.id)
                setConfirming(false)
                setSelectedId(null)
                await reload()
              }}
            >
              {confirming ? 'Close its tabs and delete this space' : 'Delete space'}
            </button>
          </div>
        </Group>
      )}
    </>
  )
}
