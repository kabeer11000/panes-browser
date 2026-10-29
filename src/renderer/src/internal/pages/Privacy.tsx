import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS } from '../../../../shared/settings'
import { Group, Row } from '../ui'
import { TorSection } from './TorSection'

/** Private browsing and Tor, together on a page of their own rather than inside Settings. */
export function Privacy(): React.JSX.Element {
  const api = window.panesInternal
  const [snowflake, setSnowflake] = useState(DEFAULT_SETTINGS.torSnowflake)
  useEffect(() => {
    void api.getSettings().then((s) => setSnowflake(s.torSnowflake))
  }, [api])

  return (
    <>
      <Group
        title="Private tab"
        footer="Nothing is kept: no history, no saved tabs, and its cookies are erased when the last private tab closes. Passwords are not offered or saved. It does not hide you from the sites you visit or your network; Tor, below, does."
      >
        <Row label="New private tab" hint="Ctrl+Shift+N">
          <button className="int-btn small" onClick={() => void api.privateNewTab()}>
            Open
          </button>
        </Row>
      </Group>
      <TorSection
        snowflake={snowflake}
        onSnowflake={(v) => {
          setSnowflake(v)
          void api.setSettings({ torSnowflake: v })
        }}
      />
    </>
  )
}
