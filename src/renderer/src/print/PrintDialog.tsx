import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PrintApi, PrintInit } from '@shared/types'
import {
  COPIES_MAX,
  CUSTOM_MARGIN_MAX_MM,
  PAPER_IDS,
  PDF_DESTINATION,
  SCALE_MAX,
  SCALE_MIN,
  parsePageRanges,
  type PrintOptions
} from '@shared/print'
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from '@renderer/components/icons'
import { Group, Row, Segmented, Select, Toggle } from '@renderer/internal/ui'
import { Pages } from './Pages'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

declare global {
  interface Window {
    printApi: PrintApi
  }
}

const PREVIEW_DELAY_MS = 250
const EASE = [0.22, 1, 0.36, 1] as const
const TRANSITION_MS = 220
const PAD = 56 // space around the sheets, in CSS pixels; keep in step with .pr-sheets padding
const SHEET_MAX = 820 // the automatic zoom never draws a sheet wider than this, so it reads as paper
const PX_PER_PT = 96 / 72
const ZOOM_STEP = 1.2
const ZOOM_MIN = 0.25
const ZOOM_MAX = 4

type Zoom = 'auto' | 'page' | number

/** The choices that change the preview; the rest (printer, pages, copies, colour) do not. */
const layoutKey = (o: PrintOptions): string =>
  JSON.stringify([
    o.landscape,
    o.paper,
    o.margins,
    o.customMarginMm,
    o.scale,
    o.headerFooter,
    o.background,
    o.simplify,
    o.noImages,
    o.lightBackground
  ])

const num = (v: string, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(Number(v))
  return v !== '' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

const host = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** A small number field with steppers, for copies, scale and margins. */
function Stepper({
  value,
  min,
  max,
  step = 1,
  unit,
  label,
  onChange
}: {
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  label: string
  onChange: (v: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null) // what is being typed, until it is committed
  const commit = (v: string): void => {
    setDraft(null)
    onChange(num(v, min, max, value))
  }
  return (
    <div className="pr-step" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`Less ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        &minus;
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget.value)}
      />
      {unit && <span>{unit}</span>}
      <button
        type="button"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        +
      </button>
    </div>
  )
}

/**
 * Ctrl+P: the whole window becomes the print view. The sheets as they will print sit on a quiet backdrop on the left,
 * the choices are docked on the right in the same grouped lists as Settings. Main owns printing and saving; the sheets
 * are drawn here from the PDF main makes.
 */
export function PrintDialog(): React.JSX.Element | null {
  const api = window.printApi
  const reduce = useReducedMotion()
  const [init, setInit] = useState<PrintInit | null>(null)
  const [o, setO] = useState<PrintOptions | null>(null)
  const [shown, setShown] = useState(false)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<Array<[number, number]>>([])
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState<Zoom>('auto')
  const [stage, setStage] = useState<{ w: number; h: number }>({ w: 800, h: 600 })
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [slow, setSlow] = useState(false)
  const [more, setMore] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const mac = navigator.platform.startsWith('Mac')
  const seq = useRef(0)
  const task = useRef<PDFDocumentLoadingTask | null>(null) // the one behind the sheets on screen

  const open = useCallback((): void => {
    void api.init().then((i) => {
      setDoc(null)
      setSizes([])
      setPage(1)
      setZoom('auto')
      setNote(null)
      setBusy(false)
      setInit(i)
      setO(i?.options ?? null)
      setLoading(!!i)
      setShown(!!i)
      root.current?.focus()
    })
  }, [api])

  useEffect(() => {
    open()
    return api.onOpen(open)
  }, [api, open])

  // closing plays the opening backwards, then main takes the view away
  const close = useCallback((): void => {
    setShown(false)
    setTimeout(() => api.close(), reduce ? 0 : TRANSITION_MS + 10)
  }, [api, reduce])

  // the area the sheets are laid out in, for the fit zooms
  useEffect(() => {
    if (!scroller) return
    const ro = new ResizeObserver(([e]) =>
      setStage({ w: e.contentRect.width, h: e.contentRect.height })
    )
    ro.observe(scroller)
    return () => ro.disconnect()
  }, [scroller])

  // a shimmer only when a render is slow enough to notice
  useEffect(() => {
    if (!loading) return
    const t = setTimeout(() => setSlow(true), 300)
    return () => clearTimeout(t)
  }, [loading])

  const key = o ? layoutKey(o) : ''
  const ready = !!o
  useEffect(() => {
    if (!ready) return
    const mine = ++seq.current
    const t = setTimeout(() => {
      setSlow(false)
      setLoading(true)
      void api.preview(o!).then(async (r) => {
        if (mine !== seq.current) return // a newer choice has been asked for since
        if (!r) {
          setLoading(false)
          return setNote('The preview could not be made')
        }
        const bytes = Uint8Array.from(atob(r.pdf), (c) => c.charCodeAt(0))
        const loading = pdfjs.getDocument({ data: bytes })
        const next = await loading.promise
        const dims = await Promise.all(
          Array.from({ length: next.numPages }, async (_, i) => {
            const v = (await next.getPage(i + 1)).getViewport({ scale: 1 })
            return [v.width, v.height] as [number, number]
          })
        )
        if (mine !== seq.current) return void loading.destroy()
        setNote(null)
        setSizes(dims)
        setLoading(false)
        void task.current?.destroy()
        task.current = loading
        setDoc(next)
      })
    }, PREVIEW_DELAY_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the preview follows the layout choices only
  }, [api, key, ready])

  const fitWidth = sizes[0] ? (stage.w - PAD * 2) / sizes[0][0] : PX_PER_PT
  const fitPage = sizes[0] ? Math.min(fitWidth, (stage.h - PAD * 2) / sizes[0][1]) : PX_PER_PT
  const auto = sizes[0] ? Math.min(fitWidth, SHEET_MAX / sizes[0][0]) : PX_PER_PT
  const scale = Math.max(0.1, zoom === 'auto' ? auto : zoom === 'page' ? fitPage : (zoom as number))
  const step = (f: number): void =>
    setZoom(Math.min(ZOOM_MAX * PX_PER_PT, Math.max(ZOOM_MIN * PX_PER_PT, scale * f)))

  const goTo = useCallback(
    (n: number): void => {
      scroller
        ?.querySelector<HTMLElement>(`.pr-sheet[data-page="${n}"]`)
        ?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
    },
    [scroller, reduce]
  )

  const rangeError = useMemo(() => {
    if (!o || o.allPages) return null
    if (!o.pages.trim()) return 'empty' // nothing typed yet: not an error to show, but nothing to print
    const r = parsePageRanges(o.pages, sizes.length || undefined)
    return r.ok ? null : r.error
  }, [o, sizes.length])

  const chosenPages = useMemo(() => {
    if (!o || o.allPages) return sizes.length
    const r = parsePageRanges(o.pages, sizes.length || undefined)
    return r.ok ? r.ranges.reduce((n, x) => n + x.to - x.from + 1, 0) : 0
  }, [o, sizes.length])

  const run = useCallback((): void => {
    if (!o || rangeError || busy) return
    setBusy(true)
    setNote(null)
    void api.run(o).then((r) => {
      setBusy(false)
      if (r.ok) close()
      else if (r.message) setNote(r.message)
    })
  }, [api, o, rangeError, busy, close])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = (e.target as HTMLElement | null)?.closest('input, [role="listbox"]')
      if (e.key === 'Escape' && !typing) close()
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run()
      else if (!typing && (e.key === 'PageDown' || e.key === 'PageUp')) {
        e.preventDefault()
        goTo(Math.min(sizes.length, Math.max(1, page + (e.key === 'PageDown' ? 1 : -1))))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, run, goTo, page, sizes.length])

  if (!init || !o) return null
  const toPdf = o.destination === PDF_DESTINATION
  const set = (patch: Partial<PrintOptions>): void => setO({ ...o, ...patch })

  const system = (): void => {
    if (busy) return
    setBusy(true)
    setNote(null)
    void api.system(o).then((r) => {
      setBusy(false)
      if (r.ok) close()
      else if (r.message) setNote(r.message)
    })
  }

  const destinations = [
    { value: PDF_DESTINATION, label: 'Save as PDF' },
    ...[...init.printers]
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
      .map((p) => ({ value: p.name, label: p.displayName }))
  ]
  const sheets = o.copies * chosenPages
  const summary =
    sizes.length === 0
      ? 'Preparing the preview'
      : chosenPages === 0
        ? 'Choose the pages to print'
        : toPdf
          ? `${chosenPages} ${chosenPages === 1 ? 'page' : 'pages'}`
          : `${sheets} ${sheets === 1 ? 'sheet' : 'sheets'} of paper`

  return (
    <motion.div
      className="pr"
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Print"
      initial={false}
      animate={shown ? { opacity: 1 } : { opacity: 0 }}
      transition={{ duration: reduce ? 0 : TRANSITION_MS / 1000, ease: EASE }}
    >
      <div className="pr-bg" aria-hidden>
        {init.snapshot && <img src={init.snapshot} alt="" />}
      </div>

      <header className="pr-top">
        {!mac && (
          <div className="winctl">
            {(['close', 'minimize', 'maximize'] as const).map((a) => (
              <button
                key={a}
                className={'wc ' + a.slice(0, 3)}
                aria-label={a}
                onClick={() => api.windowControl(a)}
              />
            ))}
          </div>
        )}
        <div className="pr-title">
          <h1 title={init.title || init.url}>{init.title || host(init.url)}</h1>
          <p>
            {host(init.url)}
            {sizes.length > 0 && (
              <>
                <i aria-hidden>&middot;</i>
                {sizes.length} {sizes.length === 1 ? 'page' : 'pages'}
              </>
            )}
          </p>
        </div>
        <button type="button" className="pr-icon" aria-label="Close" onClick={close}>
          <CloseIcon />
        </button>
      </header>

      <motion.div
        className="pr-stage"
        initial={false}
        animate={shown ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: reduce ? 0 : TRANSITION_MS / 1000, ease: EASE }}
      >
        <div className="pr-scroll" ref={setScroller}>
          {doc && sizes.length > 0 && (
            <Pages
              doc={doc}
              sizes={sizes}
              scale={scale}
              dim={loading}
              onPage={setPage}
              scroller={scroller}
            />
          )}
        </div>
        {!doc && !note && <div className="pr-ghost" aria-hidden />}
        {slow && loading && doc && <div className="pr-shimmer" aria-hidden />}
        {!doc && note && <p className="pr-empty">{note}</p>}

        {sizes.length > 0 && (
          <div className="pr-dock" role="toolbar" aria-label="Preview">
            <button
              type="button"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => goTo(page - 1)}
            >
              <ChevronUpIcon />
            </button>
            <output aria-live="polite">
              {page} <span>/ {sizes.length}</span>
            </output>
            <button
              type="button"
              aria-label="Next page"
              disabled={page >= sizes.length}
              onClick={() => goTo(page + 1)}
            >
              <ChevronDownIcon />
            </button>
            <i aria-hidden />
            <button type="button" aria-label="Zoom out" onClick={() => step(1 / ZOOM_STEP)}>
              &minus;
            </button>
            <button
              type="button"
              className="pr-pct"
              aria-label="Fit the page"
              title={zoom === 'page' ? 'Back to reading size' : 'Fit the whole page'}
              onClick={() => setZoom(zoom === 'page' ? 'auto' : 'page')}
            >
              {Math.round((scale / PX_PER_PT) * 100)}%
            </button>
            <button type="button" aria-label="Zoom in" onClick={() => step(ZOOM_STEP)}>
              +
            </button>
          </div>
        )}
      </motion.div>

      <motion.aside
        className="pr-side"
        initial={false}
        animate={shown ? { opacity: 1, x: 0 } : { opacity: 0, x: reduce ? 0 : 16 }}
        transition={{ duration: reduce ? 0 : TRANSITION_MS / 1000, ease: EASE }}
      >
        <div className="pr-form">
          <Group>
            <Row label="Destination">
              <Select
                label="Destination"
                value={o.destination}
                options={destinations}
                onChange={(v) => set({ destination: v })}
              />
            </Row>
            {!toPdf && (
              <Row label="Copies">
                <Stepper
                  label="Copies"
                  value={o.copies}
                  min={1}
                  max={COPIES_MAX}
                  onChange={(v) => set({ copies: v })}
                />
              </Row>
            )}
            {!toPdf && (
              <Row label="Colour">
                <Segmented
                  label="Colour"
                  value={o.color ? 'c' : 'bw'}
                  options={[
                    { value: 'c', label: 'Colour' },
                    { value: 'bw', label: 'Mono' }
                  ]}
                  onChange={(v) => set({ color: v === 'c' })}
                />
              </Row>
            )}
          </Group>

          <Group>
            <Row label="Pages">
              <Segmented
                label="Pages"
                value={o.allPages ? 'all' : 'some'}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'some', label: 'Custom' }
                ]}
                onChange={(v) => set({ allPages: v === 'all' })}
              />
            </Row>
            <AnimatePresence initial={false}>
              {!o.allPages && (
                <motion.div
                  className="pr-reveal"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.18, ease: EASE }}
                >
                  <div className="pr-range">
                    <input
                      type="text"
                      value={o.pages}
                      placeholder={`e.g. 1-3, 5 (of ${sizes.length || '?'})`}
                      aria-label="Pages to print"
                      aria-invalid={!!rangeError && rangeError !== 'empty'}
                      autoFocus
                      spellCheck={false}
                      onChange={(e) => set({ pages: e.target.value })}
                    />
                    {rangeError && rangeError !== 'empty' && (
                      <small className="pr-err">{rangeError}</small>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <Row label="Layout">
              <Segmented
                label="Layout"
                value={o.landscape ? 'l' : 'p'}
                options={[
                  { value: 'p', label: 'Portrait' },
                  { value: 'l', label: 'Landscape' }
                ]}
                onChange={(v) => set({ landscape: v === 'l' })}
              />
            </Row>
          </Group>

          <Group title="Clean up the page">
            <Row label="Simplify" hint="Just the article, set in clean type">
              <Toggle label="Simplify" on={o.simplify} onChange={(v) => set({ simplify: v })} />
            </Row>
            <Row label="Remove images">
              <Toggle
                label="Remove images"
                on={o.noImages}
                onChange={(v) => set({ noImages: v })}
              />
            </Row>
            <Row label="Light background" hint="Prints dark pages on white">
              <Toggle
                label="Light background"
                on={o.lightBackground}
                onChange={(v) => set({ lightBackground: v })}
              />
            </Row>
          </Group>

          <button
            type="button"
            className="pr-more"
            aria-expanded={more}
            onClick={() => setMore(!more)}
          >
            More settings
            <ChevronDownIcon />
          </button>
          <AnimatePresence initial={false}>
            {more && (
              <motion.div
                className="pr-reveal"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.2, ease: EASE }}
              >
                <Group>
                  <Row label="Paper size">
                    <Select
                      label="Paper size"
                      value={o.paper}
                      options={PAPER_IDS.map((p) => ({ value: p, label: p }))}
                      onChange={(v) => set({ paper: v })}
                    />
                  </Row>
                  <Row label="Margins">
                    <Select
                      label="Margins"
                      value={o.margins}
                      options={[
                        { value: 'default', label: 'Default' },
                        { value: 'minimum', label: 'Minimum' },
                        { value: 'none', label: 'None' },
                        { value: 'custom', label: 'Custom' }
                      ]}
                      onChange={(v) => set({ margins: v })}
                    />
                  </Row>
                  {o.margins === 'custom' && (
                    <Row label="Margin size">
                      <Stepper
                        label="Margin"
                        unit="mm"
                        value={o.customMarginMm}
                        min={0}
                        max={CUSTOM_MARGIN_MAX_MM}
                        onChange={(v) => set({ customMarginMm: v })}
                      />
                    </Row>
                  )}
                  <Row label="Scale">
                    <Stepper
                      label="Scale"
                      unit="%"
                      step={10}
                      value={o.scale}
                      min={SCALE_MIN}
                      max={SCALE_MAX}
                      onChange={(v) => set({ scale: v })}
                    />
                  </Row>
                  <Row label="Headers and footers">
                    <Toggle
                      label="Headers and footers"
                      on={o.headerFooter}
                      onChange={(v) => set({ headerFooter: v })}
                    />
                  </Row>
                  <Row label="Background graphics">
                    <Toggle
                      label="Background graphics"
                      on={o.background}
                      onChange={(v) => set({ background: v })}
                    />
                  </Row>
                </Group>
              </motion.div>
            )}
          </AnimatePresence>

          <button type="button" className="pr-link" disabled={busy} onClick={system}>
            Print using the system dialog
          </button>
          {!init.remembers && (
            <p className="pr-note">Choices made in a private tab are not kept.</p>
          )}
        </div>

        <footer className="pr-foot">
          <div className="pr-sum">
            {note && doc ? <span className="pr-err">{note}</span> : summary}
          </div>
          <button type="button" className="pr-btn" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="pr-btn primary"
            disabled={!!rangeError || busy || sizes.length === 0}
            onClick={run}
          >
            {busy ? (toPdf ? 'Saving' : 'Printing') : toPdf ? 'Save' : 'Print'}
          </button>
        </footer>
      </motion.aside>
    </motion.div>
  )
}
