import { useCallback, useEffect, useState } from 'react'
import { APPEARANCE_LIMITS, DEFAULT_SETTINGS } from '../../../../shared/settings'
import type { Settings, Space, SpacePatch, SpaceUi } from '../../../../shared/types'
import { ThemePicker } from '../../components/ThemePicker'
import { SLIDERS } from '../sliders'

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

  const customUi = !!space && Object.keys(space.ui).length > 0
  const setUi = (ui: SpaceUi): void => patch({ ui })

  if (!space) return <></>

  return (
    <section className="int-section" id="spaces">
      <h2>Spaces</h2>

      <div className="space-tabs" role="tablist" aria-label="Spaces">
        {spaces.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === space.id}
            className={'space-tab' + (s.id === space.id ? ' active' : '')}
            onClick={() => {
              setSelectedId(s.id)
              setConfirming(false)
            }}
          >
            <span
              className="dot"
              style={{
                background: s.color2 ? `linear-gradient(135deg, ${s.color}, ${s.color2})` : s.color
              }}
            />
            {s.name}
          </button>
        ))}
        <button
          type="button"
          className="space-tab add"
          onClick={async () => {
            const created = await window.panesInternal.spaceCreate()
            await reload()
            setSelectedId(created.id)
          }}
        >
          New space
        </button>
      </div>

      <div className="int-field column">
        <div>
          <div className="int-label">Name</div>
        </div>
        <input
          className="int-text"
          value={space.name}
          maxLength={24}
          spellCheck={false}
          aria-label="Space name"
          onChange={(e) =>
            setSpaces((all) =>
              all.map((s) => (s.id === space.id ? { ...s, name: e.target.value } : s))
            )
          }
          onBlur={(e) => e.target.value.trim() && patch({ name: e.target.value })}
        />
      </div>

      <div className="int-field column">
        <div>
          <div className="int-label">Theme</div>
          <div className="int-sub">Colours the sidebar and window while you are in this space.</div>
        </div>
        <ThemePicker
          color={space.color}
          color2={space.color2}
          tint={space.tint}
          grain={space.grain}
          mode={space.mode}
          onChange={patch}
        />
      </div>

      <div className="int-field column">
        <div className="int-field-head">
          <div>
            <div className="int-label">Own interface settings</div>
            <div className="int-sub">
              Give this space its own sidebar width, density and address bar. Off uses the global
              settings.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={customUi}
            className={'toggle' + (customUi ? ' on' : '')}
            onClick={() =>
              setUi(
                customUi
                  ? {}
                  : {
                      uiScale: global.uiScale,
                      density: global.density,
                      sidebarWidth: global.sidebarWidth,
                      addressSize: global.addressSize,
                      pageMargin: global.pageMargin,
                      urlDisplay: global.urlDisplay
                    }
              )
            }
          >
            <span />
          </button>
        </div>

        {customUi &&
          SLIDERS.map((sl) => {
            const { min, max, step } = APPEARANCE_LIMITS[sl.key]
            const value = space.ui[sl.key] ?? global[sl.key]
            return (
              <div key={sl.key} className="int-field inner">
                <div>
                  <div className="int-label">{sl.label}</div>
                </div>
                <div className="slider">
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onChange={(e) => setUi({ ...space.ui, [sl.key]: Number(e.target.value) })}
                  />
                  <span className="slider-value">{sl.format(value)}</span>
                </div>
              </div>
            )
          })}
        {customUi && (
          <div className="int-field inner">
            <div>
              <div className="int-label">Address bar shows</div>
            </div>
            <select
              value={space.ui.urlDisplay ?? global.urlDisplay}
              onChange={(e) =>
                setUi({ ...space.ui, urlDisplay: e.target.value as Settings['urlDisplay'] })
              }
            >
              <option value="full">Full address</option>
              <option value="host">Site name only</option>
            </select>
          </div>
        )}
      </div>

      {spaces.length > 1 && (
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
      )}
    </section>
  )
}
