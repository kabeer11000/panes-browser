import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  buildResults,
  inlineCompletion,
  type LocalSuggestion,
  type SearchResult
} from '@shared/search'
import type { Settings, TabInfo } from '@shared/types'
import {
  BookmarkIcon,
  CanvasIcon,
  ChatIcon,
  DownloadIcon,
  GlobeIcon,
  GridIcon,
  HistoryIcon,
  IncognitoIcon,
  KeyIcon,
  PinIcon,
  PipIcon,
  PlusIcon,
  PrintIcon,
  ReaderIcon,
  ReloadIcon,
  SearchIcon,
  SettingsIcon,
  SoftwareIcon,
  SpeakerIcon,
  SplitIcon,
  TorIcon
} from './icons'

export interface Anchor {
  left: number
  top: number
  width: number
  height: number
  /** The address bar's corner radius, so the popover grows out of it with the same corners. */
  radius: number
}

interface Props {
  tabs: TabInfo[]
  active: TabInfo | null
  engineName: string
  variant: Settings['searchStyle']
  /** The address bar the popover grows out of (popover variant). */
  anchor: Anchor | null
  onClose: () => void
  /** Quick actions are carried out by the app shell. */
  onAction: (id: string) => void
  /** What the field starts with, instead of the active tab's address. */
  initial?: string
  /**
   * Hand the picked address or search to the caller (the canvas) instead of opening it; an open tab's result
   * gives its address.
   */
  onPick?: (text: string) => void
}

const REMOTE_DEBOUNCE_MS = 110
const POPOVER_MIN_WIDTH = 560
const EDGE = 8

function ResultIcon({ r }: { r: SearchResult }): React.JSX.Element {
  // A favicon that fails to load would show the browser's broken-image mark; remember it and fall back instead.
  const [failed, setFailed] = useState<string | null>(null)
  if (r.favicon && failed !== r.favicon) {
    return (
      <img
        className="pal-fav"
        src={r.favicon}
        alt=""
        onError={() => setFailed(r.favicon ?? null)}
      />
    )
  }
  switch (r.kind) {
    case 'search':
    case 'suggestion':
      return <SearchIcon />
    case 'action':
      switch (r.actionId) {
        case 'new-tab':
        case 'duplicate':
          return <PlusIcon />
        case 'new-private':
          return <IncognitoIcon />
        case 'new-tor':
          return <TorIcon />
        case 'pin':
          return <PinIcon />
        case 'mute':
          return <SpeakerIcon muted />
        case 'reader':
          return <ReaderIcon />
        case 'reload':
        case 'hard-reload':
          return <ReloadIcon />
        case 'pip':
          return <PipIcon />
        case 'history':
          return <HistoryIcon />
        case 'bookmarks':
        case 'bookmark':
          return <BookmarkIcon />
        case 'downloads':
          return <DownloadIcon />
        case 'passwords':
          return <KeyIcon />
        case 'software':
          return <SoftwareIcon />
        case 'grid':
        case 'stack':
          return <GridIcon />
        case 'privacy':
          return <IncognitoIcon />
        case 'settings':
        case 'ai-settings':
        case 'ai-setup':
          return <SettingsIcon />
        case 'canvas':
          return <CanvasIcon />
        case 'chat':
          return <ChatIcon />
        case 'print':
        case 'save-pdf':
          return <PrintIcon />
        case 'split':
          return <SplitIcon />
        default:
          return r.actionId?.startsWith('settings-') ? <SettingsIcon /> : <SearchIcon />
      }
    default:
      // a page with no icon of its own: a quiet, greyed-out globe, like any browser's
      return (
        <span className="pal-noicon">
          <GlobeIcon />
        </span>
      )
  }
}

/** A short label for results that are not plain pages. */
const KIND_LABEL: Partial<Record<SearchResult['kind'], string>> = {
  tab: 'Switch to tab',
  similar: 'Similar',
  bookmark: 'Bookmark',
  action: 'Action'
}

/**
 * The command bar. As a popover it grows out of the address bar (the input takes the bar's place
 * and the list opens beneath it); as a dialog it sits in the middle of the page.
 * Enter opens in this tab, Alt+Enter in a new tab, Ctrl+Enter beside the current tab.
 */
export function SearchPalette({
  tabs,
  active,
  engineName,
  variant,
  anchor,
  onClose,
  onAction,
  initial,
  onPick
}: Props): React.JSX.Element {
  const [shown, setShown] = useState(initial ?? active?.url ?? '') // what the input displays, completion included
  const [typed, setTyped] = useState('') // what the user actually typed
  const [dirty, setDirty] = useState(false) // the prefilled address is not a search until edited
  const [sel, setSel] = useState(0)
  const [local, setLocal] = useState<LocalSuggestion[]>([])
  const [remote, setRemote] = useState<string[]>([])
  const [similar, setSimilar] = useState<LocalSuggestion[]>([]) // AI: pages that match by meaning
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [forward, setForward] = useState(false) // the last edit was typing forward, not deleting

  const effective = dirty ? typed.trim() : ''

  useEffect(() => {
    inputRef.current?.select()
    window.api.aiWarm() // the meaning search is ready by the first keystroke
  }, [])

  useEffect(() => {
    let alive = true
    void window.api.suggestLocal(effective).then((r) => alive && setLocal(r))
    return () => {
      alive = false
    }
  }, [effective])

  useEffect(() => {
    if (!effective) return
    let alive = true
    const timer = setTimeout(
      () => void window.api.suggestRemote(effective).then((r) => alive && setRemote(r)),
      REMOTE_DEBOUNCE_MS
    )
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [effective])

  // Pages that match by meaning (AI). They arrive on their own, after the ones that match by letters, and
  // are left out when the answer is slow: until one comes, what was shown stays.
  useEffect(() => {
    if (effective.length < 3) return
    let alive = true
    const shown = [...tabs.map((t) => t.url), ...local.map((l) => l.url)]
    void window.api.suggestSemantic(effective, shown).then((r) => alive && setSimilar(r))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effective, local])

  // Chrome-style inline completion: finish a site name you are typing, with the rest selected.
  const completion = useMemo(
    () => (dirty && forward ? inlineCompletion(typed, local) : null),
    [dirty, forward, typed, local]
  )
  useEffect(() => {
    const input = inputRef.current
    if (!completion || !input || document.activeElement !== input) return
    if (input.value.toLowerCase() !== typed.toLowerCase()) return // the user kept typing
    input.value = completion
    input.setSelectionRange(typed.length, completion.length)
    setShown(completion)
  }, [completion, typed])

  const results = useMemo(
    () =>
      buildResults({
        query: effective,
        tabs,
        activeId: active?.id ?? null,
        local,
        remote: effective ? remote : [],
        semantic: effective.length >= 3 ? similar : [],
        engineName
      }),
    [effective, tabs, active?.id, local, remote, similar, engineName]
  )
  const current = Math.min(sel, Math.max(0, results.length - 1))

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const run = (r: SearchResult | undefined, how: 'current' | 'tab' | 'split'): void => {
    const text = shown.trim()
    if (onPick) {
      const picked = !r
        ? text
        : r.kind === 'tab'
          ? (tabs.find((t) => t.id === r.tabId)?.url ?? text)
          : r.kind === 'go' || r.kind === 'search' || r.kind === 'action'
            ? text
            : (r.url ?? r.title)
      if (picked) onPick(picked)
      return onClose()
    }
    if (!r) {
      if (text) window.api.navigate(text) // nothing matched: treat the text as an address or search
      return onClose()
    }
    if (r.kind === 'tab') {
      window.api.activateTab(r.tabId as number)
      return onClose()
    }
    if (r.kind === 'action') return onAction(r.actionId as string)
    const target = r.kind === 'go' || r.kind === 'search' ? text : (r.url ?? r.title)
    if (how === 'tab') window.api.createTab(target)
    else if (how === 'split') window.api.openInSplit(target)
    else window.api.navigate(target)
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    const last = results.length - 1
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      setSel(current >= last ? 0 : current + 1)
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      setSel(current <= 0 ? last : current - 1)
    } else if (e.key === 'Enter') {
      run(results[current], e.altKey ? 'tab' : e.ctrlKey || e.metaKey ? 'split' : 'current')
    } else if (e.key === 'Tab' && results[current]) {
      // complete to the highlighted result so you can keep refining it
      const r = results[current]
      const text = r.kind === 'tab' || r.kind === 'action' ? r.title : (r.url ?? r.title)
      setForward(false)
      setShown(text)
      setTyped(text)
      setDirty(true)
    } else if (e.key === 'Escape') {
      return onClose()
    } else {
      return
    }
    e.preventDefault()
  }

  const popover = variant === 'dropdown' && anchor
  const panelStyle = popover
    ? (() => {
        const room = window.innerWidth - EDGE * 2
        const width = Math.min(Math.max(anchor.width, POPOVER_MIN_WIDTH), room) // a full-width top bar is matched edge to edge
        // a bar wider than the popover is centred under, a narrow one (the sidebar's) is grown out of
        const left = anchor.width > width ? anchor.left + (anchor.width - width) / 2 : anchor.left
        return {
          left: Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE)),
          // the popover sits in the page area, which the out-bar shifts down by --slide-y: take that back out, live
          top: `calc(${anchor.top}px - var(--slide-y, 0px))`,
          width,
          '--pal-r': `${anchor.radius}px`
        } as React.CSSProperties
      })()
    : undefined

  return (
    <motion.div
      className={'pal-backdrop' + (popover ? ' popover' : '')}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className={'pal' + (popover ? ' popover' : '')}
        style={panelStyle}
        role="dialog"
        aria-label="Search or enter address"
        initial={{ opacity: 0, y: popover ? -4 : -10, scale: popover ? 0.99 : 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="pal-input" style={popover ? { height: anchor.height } : undefined}>
          <SearchIcon />
          <input
            ref={inputRef}
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-activedescendant={results.length ? `pal-opt-${current}` : undefined}
            defaultValue={active?.url ?? ''}
            placeholder="Search or enter address"
            spellCheck={false}
            onChange={(e) => {
              const v = e.target.value
              setForward(v.length > typed.length) // typing forward, not deleting
              setTyped(v)
              setShown(v)
              setDirty(true)
              setSel(0)
            }}
            onKeyDown={onKeyDown}
          />
        </div>

        <div className="pal-list" id="pal-list" role="listbox" ref={listRef}>
          {results.map((r, i) => (
            <div
              key={r.id}
              id={`pal-opt-${i}`}
              role="option"
              aria-selected={i === current}
              data-index={i}
              className={'pal-row' + (i === current ? ' selected' : '')}
              // keep focus in the input while clicking
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => i !== current && setSel(i)}
              onClick={(e) =>
                run(r, e.altKey ? 'tab' : e.ctrlKey || e.metaKey ? 'split' : 'current')
              }
            >
              <span className="pal-icon">
                <ResultIcon r={r} />
              </span>
              <span className="pal-title">
                <span className="pal-name">{r.title}</span>
                {r.subtitle && <span className="pal-sub">{r.subtitle}</span>}
              </span>
              {KIND_LABEL[r.kind] && <span className="pal-kind">{KIND_LABEL[r.kind]}</span>}
            </div>
          ))}
          {results.length === 0 && (
            <div className="pal-empty">Type to search or enter an address.</div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
