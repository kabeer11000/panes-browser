import { useEffect, useState } from 'react'
import { dumpMailto, dumpText, type TabDump } from '../../../../shared/dumps'
import { Group, Row } from '../ui'

const when = (ms: number): string =>
  new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

/** Saved sessions: the tabs that were open at one moment, to bring back as a group or send on. */
export function Sessions(): React.JSX.Element {
  const api = window.panesInternal
  const [items, setItems] = useState<TabDump[]>([])
  const [renaming, setRenaming] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState('')

  const load = (): void => void api.dumpsList().then(setItems)
  useEffect(load, [api])

  const save = async (close: boolean): Promise<void> => {
    const dump = await api.dumpSave(close)
    setNote(dump ? `Saved ${dump.tabs.length} tabs.` : 'There are no web pages open to save.')
    load()
  }
  const copy = (d: TabDump): void => {
    void navigator.clipboard.writeText(dumpText(d)).then(() => setNote(`Copied "${d.name}".`))
  }
  const finishRename = (d: TabDump): void => {
    setRenaming(null)
    if (draft.trim() && draft.trim() !== d.name) void api.dumpRename(d.id, draft.trim()).then(load)
  }

  return (
    <Group
      title="Saved sessions"
      footer={
        note ||
        'Ctrl+Shift+D saves every open tab. A session opens again as a group, and can be sent by email.'
      }
    >
      <Row label="Save the tabs open now" hint="Of the space you are in">
        <span className="u-actions">
          <button className="int-btn small" onClick={() => void save(false)}>
            Save
          </button>
          <button className="int-btn small" onClick={() => void save(true)}>
            Save and close them
          </button>
        </span>
      </Row>
      {items.map((d) => {
        const mail = dumpMailto(d)
        return (
          <Row key={d.id} label={d.name} hint={`${d.tabs.length} tabs, ${when(d.time)}`}>
            <span className="u-actions">
              {renaming === d.id ? (
                <input
                  className="u-input"
                  autoFocus
                  value={draft}
                  maxLength={80}
                  aria-label="Session name"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => finishRename(d)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') finishRename(d)
                    else if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <>
                  <button className="int-btn small" onClick={() => void api.dumpOpen(d.id)}>
                    Open
                  </button>
                  {mail ? (
                    <a className="int-btn small" href={mail}>
                      Email
                    </a>
                  ) : (
                    <button
                      className="int-btn small"
                      title="Too many tabs for an email link: copy the list instead"
                      onClick={() => copy(d)}
                    >
                      Copy for email
                    </button>
                  )}
                  <button className="int-btn small" onClick={() => copy(d)}>
                    Copy
                  </button>
                  <button
                    className="int-btn small"
                    onClick={() => {
                      setDraft(d.name)
                      setRenaming(d.id)
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="int-btn small danger"
                    onClick={() => void api.dumpRemove(d.id).then(load)}
                  >
                    Delete
                  </button>
                </>
              )}
            </span>
          </Row>
        )
      })}
    </Group>
  )
}
