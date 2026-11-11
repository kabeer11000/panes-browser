import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type {
  ImportAllResult,
  ImportItem,
  ImportProgress,
  ImportSource,
  SearchEngineId
} from '@shared/types'
import type { PasswordExportResult } from '@shared/passwordExport'
import { takeImportSources } from '@renderer/internal/pages/importSources'

type Phase = 'ready' | 'running' | 'done'

/** Where a guided password export stands, per browser. */
type Pw =
  | { kind: 'opened' | 'watching' | 'unsupported' }
  | { kind: 'imported'; added: number; deleted: boolean }
  | { kind: 'timeout' }

const ALL: ImportItem[] = ['bookmarks', 'history', 'search', 'tabs']

/**
 * The step's state lives here, outside the component: the person can go on to the next step and come back (the
 * step is shown afresh each time) and find the import as it stands, still running or done, never offered twice.
 */
interface Store {
  sources: ImportSource[] | null
  lookFailed: boolean
  phase: Phase
  rows: Record<string, ImportProgress>
  /** The import threw (no tally at all). */
  failed: boolean
  pw: Record<string, Pw>
}
let store: Store = {
  sources: null,
  lookFailed: false,
  phase: 'ready',
  rows: {},
  failed: false,
  pw: {}
}
const listeners = new Set<() => void>()
const set = (f: (s: Store) => Store): void => {
  store = f(store)
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const useStore = (): Store => useSyncExternalStore(subscribe, () => store)

/** Told when an import took a search engine over, so the later steps show it (Welcome keeps the settings). */
let searchTaken: (id: SearchEngineId) => void = () => undefined

const blank = (s: { id: string; name: string }): ImportProgress => ({
  id: s.id,
  name: s.name,
  state: 'reading',
  bookmarks: 0,
  history: 0,
  tabs: 0
})

/** Import from every browser, or only `only` (a retry). Rows fill in live from the progress main streams. */
function runImport(only?: string[]): void {
  const api = window.panesInternal
  const { sources, phase } = store
  if (!sources || phase === 'running') return
  const ids = new Set(only ?? sources.map((s) => s.id))
  set((s) => ({
    ...s,
    phase: 'running',
    failed: false,
    rows: {
      ...s.rows,
      ...Object.fromEntries(sources.filter((x) => ids.has(x.id)).map((x) => [x.id, blank(x)]))
    }
  }))
  const off = api.onImportProgress((p) =>
    set((s) => ({ ...s, rows: { ...s.rows, [p.id]: { ...s.rows[p.id], ...p } } }))
  )
  // whatever is still "reading" once the run is over did not come back: it failed, it is not left spinning
  const settle = (result: ImportAllResult | null): void =>
    set((s) => {
      const rows = { ...s.rows }
      for (const r of result?.sources ?? []) {
        rows[r.id] = {
          ...rows[r.id],
          ...r,
          state: r.error ? (r.error === 'locked' ? 'locked' : 'failed') : 'done'
        }
      }
      for (const id of ids)
        if (rows[id]?.state === 'reading') rows[id] = { ...rows[id], state: 'failed' }
      return { ...s, rows, phase: 'done', failed: !result }
    })
  api
    .importEverything(ALL, only)
    .then((result) => {
      settle(result)
      if (result.search) searchTaken(result.search)
    })
    .catch(() => settle(null))
    .finally(off)
}

let pwListening = false
/** The outcome of a guided password export: listened for once for the page's life, so moving between steps loses none. */
function listenForPasswords(): void {
  if (pwListening) return
  pwListening = true
  window.panesInternal.onPasswordsImported((r: PasswordExportResult) => {
    if (!r.sourceId) return
    const id = r.sourceId
    set((s) => ({
      ...s,
      pw: {
        ...s.pw,
        [id]: r.timedOut
          ? { kind: 'timeout' }
          : { kind: 'imported', added: r.added, deleted: r.deleted }
      }
    }))
  })
}

async function exportPasswords(id: string): Promise<void> {
  listenForPasswords()
  // one browser is watched for at a time (main starts afresh): any other still waiting is not any more
  set((s) => ({
    ...s,
    pw: Object.fromEntries(
      Object.entries(s.pw).filter(([, v]) => v.kind !== 'opened' && v.kind !== 'watching')
    )
  }))
  try {
    const { status } = await window.panesInternal.importPasswordsFrom(id)
    set((s) => ({ ...s, pw: { ...s.pw, [id]: { kind: status } } }))
  } catch {
    set((s) => ({ ...s, pw: { ...s.pw, [id]: { kind: 'unsupported' } } }))
  }
}

function stopWaiting(id: string): void {
  window.panesInternal.cancelPasswordsWatch()
  set((s) => {
    const pw = { ...s.pw }
    delete pw[id]
    return { ...s, pw }
  })
}

/** A number that rolls up to its value when it changes, so a finished import feels like a tally landing. */
function Count({ n }: { n: number }): React.JSX.Element {
  const [shown, setShown] = useState(n)
  const from = useRef(n)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / 420)
      setShown(Math.round(a + (n - a) * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(tick)
      else from.current = n
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [n])
  return <>{shown.toLocaleString()}</>
}

function Dot({ state }: { state: ImportProgress['state'] }): React.JSX.Element {
  if (state === 'reading') return <span className="wl-imp-spin" aria-label="Reading" />
  if (state === 'done')
    return (
      <svg className="wl-imp-tick" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 13l4 4L19 7" />
      </svg>
    )
  return <span className="wl-imp-warn" aria-hidden="true" />
}

/** What came over from one browser, and what did not and why. */
function Tally({ r }: { r: ImportProgress }): React.JSX.Element {
  if (r.state === 'reading') return <>Reading…</>
  const counts = (
    <>
      {!!r.bookmarks && (
        <em>
          <Count n={r.bookmarks} /> bookmarks
        </em>
      )}
      {!!r.history && (
        <em>
          <Count n={r.history} /> history
        </em>
      )}
      {!!r.tabs && (
        <em>
          <Count n={r.tabs} /> tabs
        </em>
      )}
    </>
  )
  const any = !!(r.bookmarks || r.history || r.tabs)
  if (r.state === 'locked')
    return (
      <>
        {counts}
        <em>Close it to bring the rest</em>
      </>
    )
  if (r.state === 'failed') return <>{any ? counts : <em>Could not read it</em>}</>
  return (
    <>
      {counts}
      {r.historyLocked && <em>History: close it first</em>}
      {!any && !r.historyLocked && <em>Nothing new</em>}
    </>
  )
}

/** The line under the list once a run is over, from what actually came over. */
function summary(rows: ImportProgress[], failed: boolean): { text: string; ok: boolean } {
  if (failed) return { text: 'Something went wrong reading your browsers.', ok: false }
  const total = rows.reduce((n, r) => n + r.bookmarks + r.history + r.tabs, 0)
  const held = rows.some((r) => r.state === 'locked' || r.historyLocked)
  if (!total)
    return held
      ? { text: 'Nothing came over yet: close the browsers marked and retry.', ok: false }
      : { text: 'Nothing new to bring over.', ok: true }
  if (held)
    return { text: 'Most of it is in. Close the browsers marked to bring the rest.', ok: true }
  return { text: 'Done — your bookmarks, history and open tabs are in.', ok: true }
}

/** One browser's password export: the button, then where it stands. */
function PasswordRow({ s, pw }: { s: ImportSource; pw: Pw | undefined }): React.JSX.Element {
  const waiting = pw?.kind === 'opened' || pw?.kind === 'watching'
  return (
    <li className="wl-imp-pwitem">
      <button
        type="button"
        className="wl-imp-pwbtn"
        disabled={waiting}
        onClick={() => void exportPasswords(s.id)}
      >
        {pw?.kind === 'imported' || pw?.kind === 'timeout' ? 'Again from' : 'From'} {s.name}
      </button>
      <span className="wl-imp-pwnote" role="status">
        {pw?.kind === 'opened' && (
          <>
            Export them on the page {s.name} just opened; Panes picks the file up from Downloads.{' '}
            <button type="button" className="wl-imp-link" onClick={() => stopWaiting(s.id)}>
              Stop waiting
            </button>
          </>
        )}
        {pw?.kind === 'watching' && (
          <>
            Could not open {s.name}. In it: {s.passwordExport}. Panes picks the file up from
            Downloads.{' '}
            <button type="button" className="wl-imp-link" onClick={() => stopWaiting(s.id)}>
              Stop waiting
            </button>
          </>
        )}
        {pw?.kind === 'unsupported' && (
          <>
            In {s.name}: {s.passwordExport}. Then import the file in Settings.
          </>
        )}
        {pw?.kind === 'imported' && (
          <>
            {pw.added ? `${pw.added.toLocaleString()} passwords added` : 'No new passwords'}
            {pw.deleted
              ? ', and the exported file deleted.'
              : '. Delete the exported file in Downloads: it holds them in plain text.'}
          </>
        )}
        {pw?.kind === 'timeout' && <>Nothing was exported, so nothing came over.</>}
      </span>
    </li>
  )
}

/**
 * The first-run import, one click: every browser found is read at once (bookmarks, history, open tabs, search),
 * each row filling in live. A browser that is running and holds its files can be retried once closed. Passwords
 * are their own thing — a browser only hands them over through its own export, which is offered after, per
 * browser. The manual file import stays in Settings for anything unusual.
 */
export function ImportStep({
  onSearch
}: {
  /** An import took this search engine over. */
  onSearch: (id: SearchEngineId) => void
}): React.JSX.Element {
  const { sources, lookFailed, phase, rows, failed, pw } = useStore()
  useEffect(() => {
    searchTaken = onSearch
  }, [onSearch])

  useEffect(() => {
    if (store.sources) return
    void takeImportSources().then(
      (found) => set((s) => ({ ...s, sources: found, lookFailed: false })),
      () => set((s) => ({ ...s, sources: [], lookFailed: true }))
    )
  }, [])

  if (!sources) return <p className="wl-lede">Looking for your other browsers…</p>
  if (sources.length === 0)
    return (
      <p className="wl-lede">
        {lookFailed
          ? 'Could not look for your other browsers. You can import from them later in Settings.'
          : 'No other browser found on this computer. You can still import a file later in Settings.'}
      </p>
    )

  const shown = sources.map((s) => rows[s.id] ?? null)
  const retryable = (r: ImportProgress | null): boolean =>
    !!r && (r.state === 'locked' || r.state === 'failed' || !!r.historyLocked)
  const sum =
    phase === 'done'
      ? summary(
          shown.filter((r) => r !== null),
          failed
        )
      : null

  return (
    <div className="wl-imp">
      <ul className="wl-imp-list">
        {sources.map((s, i) => {
          const r = shown[i]
          const warn = r && (r.state === 'locked' || r.state === 'failed' || r.historyLocked)
          return (
            <li key={s.id} className="wl-imp-row">
              <span className="wl-imp-icon">
                {r ? (
                  <Dot state={r.historyLocked && r.state === 'done' ? 'locked' : r.state} />
                ) : (
                  <span className="wl-imp-idle" />
                )}
              </span>
              <span className="wl-imp-name">{s.name}</span>
              <span className={'wl-imp-tally' + (warn ? ' warn' : '')}>
                {r ? <Tally r={r} /> : 'Ready'}
              </span>
              {phase === 'done' && retryable(r) && (
                <button type="button" className="wl-imp-retry" onClick={() => runImport([s.id])}>
                  Retry
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <AnimatePresence mode="wait">
        {phase !== 'done' ? (
          <motion.button
            key="go"
            type="button"
            className="wl-imp-go"
            disabled={phase === 'running'}
            onClick={() => runImport()}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {phase === 'running' ? 'Bringing it over…' : 'Import everything'}
          </motion.button>
        ) : (
          <motion.div
            key="pw"
            className="wl-imp-after"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {sum && (
              <p className={'wl-imp-check' + (sum.ok ? '' : ' warn')}>
                {sum.text}
                {failed && (
                  <>
                    {' '}
                    <button type="button" className="wl-imp-link" onClick={() => runImport()}>
                      Try again
                    </button>
                  </>
                )}
              </p>
            )}
            <div className="wl-imp-pw">
              <p>
                <b>Passwords</b> come straight from the other browser&rsquo;s own export, so they
                stay safe. Pick one to bring over:
              </p>
              <ul className="wl-imp-pwlist">
                {sources.map((s) => (
                  <PasswordRow key={s.id} s={s} pw={pw[s.id]} />
                ))}
              </ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
