import { useEffect, useState } from 'react'
import { SEARCH_ENGINES } from '@shared/settings'
import type { ImportItem, ImportResult, ImportSource } from '@shared/types'
import { Group, Row, Select } from '@renderer/internal/ui'
import { takeImportSources } from './importSources'

const ITEMS: Array<{ item: ImportItem; label: string }> = [
  { item: 'bookmarks', label: 'Bookmarks' },
  { item: 'history', label: 'History' },
  { item: 'search', label: 'Search engine' }
]

const n = (count: number, one: string, many = one + 's'): string =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`

function describe(r: ImportResult, browser: string): string {
  if (!r.ok) {
    if (r.error === 'locked')
      return `Close ${browser} and try again: it keeps its files locked while it runs.`
    if (r.error === 'missing') return 'That profile is not there any more. Pick another one.'
    return `Could not read ${browser}'s files.`
  }
  const parts = [n(r.bookmarks, 'bookmark'), n(r.history, 'page') + ' of history']
  return (
    `Brought over ${parts.join(' and ')}.` +
    (r.search ? ` Searching with ${SEARCH_ENGINES[r.search].name}.` : '')
  )
}

/** Import from another browser: in Settings, and as a step of the welcome page. */
export function ImportSection(): React.JSX.Element {
  const api = window.panesInternal
  const [sources, setSources] = useState<ImportSource[] | null>(null)
  const [sourceId, setSourceId] = useState('')
  const [profile, setProfile] = useState('')
  const [items, setItems] = useState<Set<ImportItem>>(new Set(['bookmarks', 'history', 'search']))
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [passwords, setPasswords] = useState<'' | 'imported' | 'deleted'>('')
  const [passwordNote, setPasswordNote] = useState('')
  const [fileNote, setFileNote] = useState('')

  useEffect(() => {
    void takeImportSources().then((list) => {
      setSources(list)
      setSourceId(list[0]?.id ?? '')
      setProfile(list[0]?.profiles[0]?.dir ?? '')
    })
  }, [api])

  const source = sources?.find((s) => s.id === sourceId)
  const chosen = ITEMS.filter(
    (i) => items.has(i.item) && (i.item !== 'search' || source?.canSearch)
  )

  const pickSource = (id: string): void => {
    setSourceId(id)
    setProfile(sources?.find((s) => s.id === id)?.profiles[0]?.dir ?? '')
    setStatus('')
  }
  const toggle = (item: ImportItem): void =>
    setItems((prev) => {
      const next = new Set(prev)
      if (!next.delete(item)) next.add(item)
      return next
    })

  const run = async (): Promise<void> => {
    if (!source) return
    setBusy(true)
    setStatus('')
    try {
      const r = await api.importRun(
        source.id,
        profile,
        chosen.map((i) => i.item)
      )
      setStatus(describe(r, source.name))
    } finally {
      setBusy(false)
    }
  }

  const importPasswords = async (): Promise<void> => {
    const r = await api.importPasswordsFile()
    if (!r) return
    setPasswords('imported')
    setPasswordNote(
      `Imported ${n(r.added, 'password')}${r.skipped ? `, skipped ${r.skipped.toLocaleString()}` : ''}. The file holds them in plain text, so delete it now.`
    )
  }
  const deleteCsv = async (): Promise<void> => {
    const ok = await api.deleteImportedPasswordsFile()
    setPasswords(ok ? 'deleted' : 'imported')
    setPasswordNote(
      ok ? 'The CSV file is deleted.' : 'Could not delete the CSV file. Delete it yourself.'
    )
  }

  const importBookmarksFile = async (): Promise<void> => {
    const added = await api.importBookmarksFile()
    if (added !== null) setFileNote(`Brought over ${n(added, 'bookmark')}.`)
  }

  const passwordButton =
    passwords === 'imported' ? (
      <button className="int-btn danger small" onClick={() => void deleteCsv()}>
        Delete the CSV
      </button>
    ) : (
      <button className="int-btn small" onClick={() => void importPasswords()}>
        Choose file
      </button>
    )

  if (!sources) return <></>
  return (
    <Group
      title="Import from another browser"
      footer="Signed-in sites, open tabs and extensions do not come over: sign in to each site once. Nothing leaves this computer."
    >
      {source ? (
        <>
          <Row label="Browser">
            <Select
              label="Browser"
              value={sourceId}
              options={sources.map((s) => ({
                value: s.id,
                label: s.isDefault ? `${s.name} (default)` : s.name
              }))}
              onChange={pickSource}
            />
          </Row>
          {source.profiles.length > 1 && (
            <Row label="Profile" hint="One at a time. Run it again for another profile.">
              <Select
                label="Profile"
                value={profile}
                options={source.profiles.map((p) => ({ value: p.dir, label: p.name }))}
                onChange={setProfile}
              />
            </Row>
          )}
          {ITEMS.filter((i) => i.item !== 'search' || source.canSearch).map((i) => (
            <label key={i.item} className="u-row tap">
              <span className="u-label">{i.label}</span>
              <input type="checkbox" checked={items.has(i.item)} onChange={() => toggle(i.item)} />
            </label>
          ))}
          <Row label={busy ? 'Importing...' : status || `Import from ${source.name}`}>
            <button
              className="int-btn primary small"
              disabled={busy || chosen.length === 0}
              onClick={() => void run()}
            >
              Import
            </button>
          </Row>
          <Row
            label="Passwords"
            hint={passwordNote || `${source.passwordExport} Then pick the file here.`}
          >
            {passwordButton}
          </Row>
        </>
      ) : (
        <Row
          label="No other browser found"
          hint="Export your bookmarks or passwords from it and pick the file below."
        />
      )}
      <Row
        label="Bookmarks file"
        hint={fileNote || 'An HTML bookmarks export from any browser, Safari and Arc included.'}
      >
        <button className="int-btn small" onClick={() => void importBookmarksFile()}>
          Choose file
        </button>
      </Row>
      {!source && (
        <Row
          label="Passwords file"
          hint={passwordNote || 'A CSV export from a browser or password manager.'}
        >
          {passwordButton}
        </Row>
      )}
    </Group>
  )
}
