import { useEffect, useRef, useState } from 'react'
import type { LoginSummary } from '../../../../shared/types'
import { ChevronDownIcon, KeyIcon, SearchIcon } from '../../components/icons'
import { Site } from '../Site'
import { EmptyState, Group, Row } from '../ui'

interface Draft {
  id: number | null
  origin: string
  username: string
  password: string
}

const EMPTY: Draft = { id: null, origin: '', username: '', password: '' }
const siteName = (origin: string): string => new URL(origin).host
const ARM_MS = 4000

export function Passwords(): React.JSX.Element {
  const api = window.panesInternal
  const [items, setItems] = useState<LoginSummary[]>([])
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [shown, setShown] = useState<Record<number, string>>({})
  const [draft, setDraft] = useState<Draft | null>(null)
  const [note, setNote] = useState('')
  // A destructive action asks for a second click instead of a native confirm dialog.
  const [armed, setArmed] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const load = (): void => void api.passwordsList().then(setItems)
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps -- load only reads the stable api

  const say = (text: string): void => {
    setNote(text)
    window.setTimeout(() => setNote(''), 3000)
  }

  const arm = (key: string, run: () => void): void => {
    if (armed === key) {
      setArmed(null)
      run()
      return
    }
    setArmed(key)
    window.setTimeout(() => setArmed((a) => (a === key ? null : a)), ARM_MS)
  }

  const toggleShow = async (id: number): Promise<void> => {
    if (id in shown)
      return setShown((s) => {
        const rest = { ...s }
        delete rest[id]
        return rest
      })
    const pw = await api.passwordReveal(id)
    if (pw !== null) setShown((s) => ({ ...s, [id]: pw }))
  }

  const copy = async (text: string, what: string): Promise<void> => {
    await navigator.clipboard.writeText(text)
    say(`${what} copied`)
  }

  const copyPassword = (id: number): void =>
    void api.passwordReveal(id).then((p) => {
      if (p !== null) void copy(p, 'Password')
    })

  const edit = async (item: LoginSummary): Promise<void> => {
    const password = (await api.passwordReveal(item.id)) ?? ''
    setDraft({ id: item.id, origin: item.origin, username: item.username, password })
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    const ok =
      draft.id === null
        ? await api.passwordSave(draft)
        : await api.passwordEdit(draft.id, draft.username, draft.password)
    if (!ok)
      return say(
        'Could not save: check the site address, password, and that this login is not already saved.'
      )
    setDraft(null)
    setShown({})
    load()
  }

  const remove = async (item: LoginSummary): Promise<void> => {
    await api.passwordRemove(item.id)
    setOpenId(null)
    load()
  }

  const importFile = async (f: File | undefined): Promise<void> => {
    if (!f) return
    const { added, skipped } = await api.passwordsImport(await f.text())
    say(`Imported ${added} login${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}`)
    load()
  }

  const exportFile = async (): Promise<void> => {
    const url = URL.createObjectURL(new Blob([await api.passwordsExport()], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'panes-passwords.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const q = query.trim().toLowerCase()
  const rows = q
    ? items.filter(
        (i) => i.origin.toLowerCase().includes(q) || i.username.toLowerCase().includes(q)
      )
    : items

  return (
    <>
      <div className="int-toolbar">
        <label className="int-search">
          <SearchIcon />
          <input
            autoFocus
            placeholder="Search passwords"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button className="int-btn primary" onClick={() => setDraft(EMPTY)}>
          Add login
        </button>
      </div>

      {draft && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Group title={draft.id === null ? 'New login' : 'Edit login'}>
            {draft.id === null && (
              <Row label="Site">
                <input
                  className="int-text pw-input"
                  autoFocus
                  placeholder="github.com"
                  value={draft.origin}
                  onChange={(e) => setDraft({ ...draft, origin: e.target.value })}
                />
              </Row>
            )}
            <Row label="Username">
              <input
                className="int-text pw-input"
                autoFocus={draft.id !== null}
                placeholder="Username or email"
                autoComplete="off"
                value={draft.username}
                onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              />
            </Row>
            <Row label="Password">
              <div className="pw-secret">
                <input
                  className="int-text pw-input"
                  placeholder="Password"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft.password}
                  onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                />
                <button
                  type="button"
                  className="int-btn small"
                  onClick={() =>
                    void api.passwordGenerate().then((password) => setDraft({ ...draft, password }))
                  }
                >
                  Generate
                </button>
              </div>
            </Row>
            <div className="u-row center pw-form-actions">
              <button type="button" className="int-btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="int-btn primary" disabled={!draft.password}>
                Save
              </button>
            </div>
          </Group>
        </form>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<KeyIcon />}
          title={query ? `No logins match "${query.trim()}"` : 'No saved logins yet'}
        >
          {query
            ? 'Try a different site or username.'
            : 'Sign in to a site and Panes will offer to save it, or import from another browser.'}
        </EmptyState>
      ) : (
        <section className="u-section">
          <div className="u-group pw-list">
            {rows.map((item) => {
              const open = openId === item.id
              return (
                <div key={item.id} className={'pw-item' + (open ? ' open' : '')}>
                  <button
                    type="button"
                    className="pw-head"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : item.id)}
                  >
                    <Site favicon={null} title={siteName(item.origin)} url={item.origin} />
                    <span className="u-text">
                      <span className="u-label">{siteName(item.origin)}</span>
                      <span className="u-hint">{item.username || 'No username'}</span>
                    </span>
                    <ChevronDownIcon />
                  </button>
                  {open && (
                    <div className="pw-detail">
                      <div className="pw-field">
                        <span className="pw-key">Username</span>
                        <span className="pw-val">{item.username || 'None'}</span>
                        <button
                          className="int-btn small"
                          disabled={!item.username}
                          onClick={() => void copy(item.username, 'Username')}
                        >
                          Copy
                        </button>
                      </div>
                      <div className="pw-field">
                        <span className="pw-key">Password</span>
                        <span className="pw-val mono">
                          {item.id in shown ? shown[item.id] : '••••••••••'}
                        </span>
                        <button className="int-btn small" onClick={() => void toggleShow(item.id)}>
                          {item.id in shown ? 'Hide' : 'Show'}
                        </button>
                        <button className="int-btn small" onClick={() => copyPassword(item.id)}>
                          Copy
                        </button>
                      </div>
                      <div className="pw-actions">
                        <button className="int-btn small" onClick={() => void edit(item)}>
                          Edit
                        </button>
                        <button
                          className="int-btn small danger"
                          onClick={() => arm(`del${item.id}`, () => void remove(item))}
                        >
                          {armed === `del${item.id}` ? 'Click again to delete' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <p className="u-footer" aria-live="polite">
            {note ||
              'Passwords are encrypted with your operating system account and stay on this computer.'}
          </p>
        </section>
      )}

      <Group title="Manage">
        <button type="button" className="u-row tap" onClick={() => file.current?.click()}>
          <div className="u-text">
            <div className="u-label">Import from CSV</div>
            <div className="u-hint">
              Chrome, Edge, Firefox and most password managers export CSV.
            </div>
          </div>
        </button>
        <button
          type="button"
          className="u-row tap"
          disabled={items.length === 0}
          onClick={() => arm('export', () => void exportFile())}
        >
          <div className="u-text">
            <div className="u-label">
              {armed === 'export' ? 'Click again to export' : 'Export to CSV'}
            </div>
            <div className="u-hint">The file holds your passwords in plain text.</div>
          </div>
        </button>
        <input
          ref={file}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            void importFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </Group>
    </>
  )
}
