import { useEffect, useMemo, useState } from 'react'
import { displayHost } from '@shared/url'
import {
  DEFAULT_READER_PREFS,
  READER_SIZE,
  readerKey,
  readerScreenDocument,
  readerSource,
  readingMinutes,
  resolvedTheme,
  sanitizeReaderPrefs,
  themeColors,
  type ReaderArticle,
  type ReaderFont,
  type ReaderPrefs,
  type ReaderTheme,
  type ReaderWidth
} from '@shared/reader'
import { BackIcon, CanvasIcon } from '@renderer/components/icons'

const PREFS_KEY = 'panes-reader'
const loadPrefs = (): ReaderPrefs => {
  try {
    return sanitizeReaderPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null'))
  } catch {
    return DEFAULT_READER_PREFS
  }
}

const FONTS: Array<[ReaderFont, string]> = [
  ['serif', 'Serif'],
  ['sans', 'Sans']
]
const WIDTHS: Array<[ReaderWidth, string]> = [
  ['narrow', 'Narrow'],
  ['medium', 'Medium'],
  ['wide', 'Wide']
]
const THEMES: Array<[ReaderTheme, string]> = [
  ['auto', 'Auto'],
  ['light', 'Light'],
  ['sepia', 'Sepia'],
  ['dark', 'Dark']
]

function Seg<T extends string>(props: {
  label: string
  value: T
  options: Array<[T, string]>
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <div className="seg" role="group" aria-label={props.label}>
      {props.options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          className={v === props.value ? 'on' : ''}
          aria-pressed={v === props.value}
          onClick={() => props.onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/**
 * panes://reader: the article main/reader.ts read from the page, in a frame where no script may run (its HTML comes
 * from the page). The choices around it are kept in this page's own storage (a private tab's storage is thrown away).
 */
export function Reader(): React.JSX.Element {
  const key = readerKey(location.href)
  const source = readerSource(location.href)
  const [article, setArticle] = useState<(ReaderArticle & { canvas: boolean }) | null | 'loading'>(
    key ? 'loading' : null
  )
  const [prefs, setPrefs] = useState(loadPrefs)
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const [placed, setPlaced] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle')

  useEffect(() => {
    if (key) void window.panesInternal.readerGet(key).then(setArticle)
  }, [key])
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = (): void => setDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  useEffect(() => {
    if (article && article !== 'loading') document.title = article.title || article.url
  }, [article])

  const update = (patch: Partial<ReaderPrefs>): void =>
    setPrefs((p) => {
      const next = sanitizeReaderPrefs({ ...p, ...patch })
      localStorage.setItem(PREFS_KEY, JSON.stringify(next)) // idempotent, so a second StrictMode call is harmless
      return next
    })

  const ready = article && article !== 'loading' ? article : null
  const minutes = ready ? readingMinutes(ready.html) : 0
  const meta = ready ? `${displayHost(ready.url)}${minutes ? ` · ${minutes} min read` : ''}` : ''
  const doc = useMemo(
    () => (ready ? readerScreenDocument(ready, prefs, dark, meta) : ''),
    [ready, prefs, dark, meta]
  )
  const theme = resolvedTheme(prefs.theme, dark)
  const c = themeColors(theme)
  const style = {
    '--rd-bg': c.bg,
    '--rd-fg': c.fg,
    '--rd-dim': c.dim,
    '--rd-rule': c.rule
  } as React.CSSProperties

  const toCanvas = async (): Promise<void> => {
    if (!key || placed === 'busy') return
    setPlaced('busy')
    setPlaced((await window.panesInternal.readerToCanvas(key)) ? 'done' : 'failed')
  }

  return (
    <div className="rd" data-theme={theme} style={style}>
      <div className="rd-bar" role="toolbar" aria-label="Reader">
        <button
          type="button"
          className="rd-btn"
          title="Back to the page (Ctrl+Shift+E)"
          onClick={() => void window.panesInternal.readerExit()}
        >
          <BackIcon />
          <span>Page</span>
        </button>
        <span className="rd-meta">{meta}</span>
        <div className="rd-size" role="group" aria-label="Text size">
          <button
            type="button"
            className="rd-btn"
            aria-label="Smaller text"
            disabled={prefs.size <= READER_SIZE.min}
            onClick={() => update({ size: prefs.size - READER_SIZE.step })}
          >
            A-
          </button>
          <output aria-live="polite">{prefs.size}</output>
          <button
            type="button"
            className="rd-btn"
            aria-label="Larger text"
            disabled={prefs.size >= READER_SIZE.max}
            onClick={() => update({ size: prefs.size + READER_SIZE.step })}
          >
            A+
          </button>
        </div>
        <Seg
          label="Font"
          value={prefs.font}
          options={FONTS}
          onChange={(font) => update({ font })}
        />
        <Seg
          label="Width"
          value={prefs.width}
          options={WIDTHS}
          onChange={(width) => update({ width })}
        />
        <Seg
          label="Theme"
          value={prefs.theme}
          options={THEMES}
          onChange={(theme) => update({ theme })}
        />
        {ready?.canvas && (
          <button
            type="button"
            className="rd-btn"
            disabled={placed === 'busy' || placed === 'done'}
            onClick={() => void toCanvas()}
          >
            <CanvasIcon />
            <span>
              {placed === 'done'
                ? 'On the canvas'
                : placed === 'failed'
                  ? 'Could not add, try again'
                  : 'Add to canvas'}
            </span>
          </button>
        )}
      </div>
      {ready ? (
        <iframe
          className="rd-frame"
          title={ready.title || 'Article'}
          // no allow-scripts: the article's HTML comes from the page; links open in a new tab
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={doc}
        />
      ) : article === null ? (
        <div className="rd-gone">
          <p>This article is no longer in memory.</p>
          {source && (
            <a className="rd-btn" href={source}>
              Open the page
            </a>
          )}
        </div>
      ) : null}
    </div>
  )
}
