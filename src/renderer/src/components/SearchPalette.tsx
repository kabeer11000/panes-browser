import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  buildResults,
  inlineCompletion,
  rankTabs,
  type LocalSuggestion,
  type SearchResult
} from '@shared/search'
import type { Settings, TabInfo } from '@shared/types'
import { parseInvite } from '@shared/share/crypto'
import { takeTypeAhead } from '@renderer/typeAhead'
import { useGlider } from '@renderer/hooks/useGlider'
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
import { SiteIcon } from './SiteIcon'

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
  /** AI is on: its actions (chat, ask about selection) are offered. */
  ai?: boolean
  /** Actions not offered here (on the board: "Canvas view"). */
  hide?: readonly string[]
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
  /** An open tab picked where onPick is used (the canvas): go to that tab, instead of opening its address again. */
  onPickTab?: (id: number) => void
  /** Pictures of the tabs (by id): the recent strip and the picked tab's preview show them. */
  thumbs?: Record<number, string>
}

const REMOTE_DEBOUNCE_MS = 110
/** Tabs in the recent strip, shown before anything is typed (Alt+1 .. Alt+5 jump to them). */
const RECENT_COUNT = 5
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
        case 'join-invite':
          return <GridIcon />
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
/**
 * What was typed and left, per bar and tab: clicking away keeps it, as Chrome's address bar does, until Escape, a
 * pick, or the page moving on. Kept for this run of the window only.
 */
const drafts = new Map<string, string>()

export function SearchPalette({
  tabs,
  active,
  engineName,
  variant,
  ai = true,
  hide,
  anchor,
  onClose,
  onAction,
  initial,
  onPick,
  onPickTab,
  thumbs
}: Props): React.JSX.Element {
  const [openedAt] = useState(() => Date.now())
  const draftKey = `${onPick ? 'board' : variant}:${active?.id ?? 'none'}:${active?.url ?? ''}`
  /** Closed on purpose (Escape, a pick): what was typed is not kept. */
  const finished = useRef(false)
  const done = (): void => {
    finished.current = true
    drafts.delete(draftKey)
    onClose()
  }
  const [shown, setShown] = useState(initial ?? active?.url ?? '') // what the input displays, completion included
  const [typed, setTyped] = useState('') // what the user actually typed
  const [dirty, setDirty] = useState(false) // the prefilled address is not a search until edited
  const [sel, setSel] = useState(0)
  const pointerAt = useRef<{ x: number; y: number } | null>(null)
  const [local, setLocal] = useState<LocalSuggestion[]>([])
  const [remote, setRemote] = useState<string[]>([])
  const [similar, setSimilar] = useState<LocalSuggestion[]>([]) // AI: pages that match by meaning
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [forward, setForward] = useState(false) // the last edit was typing forward, not deleting

  const effective = dirty ? typed.trim() : ''
  // a shared space's invite on the clipboard (one not joined yet): offered first, as Chrome offers a link you copied
  const [clipInvite, setClipInvite] = useState<string | null>(null)
  useEffect(() => {
    void window.api.share?.clipboardInvite().then(setClipInvite)
  }, [])
  const typedInvite =
    effective && (/^panes:\/\/join\//i.test(effective) || parseInvite(effective)) ? effective : null
  const joinLink = typedInvite ?? (!effective ? clipInvite : null)
  // once per popover: React may run the mount effect again later (StrictMode, a Suspense boundary showing again), and
  // a second run would select away, or overwrite, what has been typed by then
  const mounted = useRef(false)

  // a layout effect: autoFocus gives the input the keyboard at commit, and a key landing before a passive effect
  // would be overwritten by the buffer or selected away
  useLayoutEffect(() => {
    if (mounted.current) return
    mounted.current = true
    const input = inputRef.current
    // what was typed straight after Ctrl+T, before this was here, is the start of the search
    const ahead = takeTypeAhead()
    // what was typed here before and left (clicked away from) comes back, caret at its end
    const left = !ahead && !initial ? drafts.get(draftKey) : undefined
    const start = ahead || left
    if (input && start) {
      input.value = start
      input.setSelectionRange(start.length, start.length)
      setTyped(start)
      setShown(start)
      setDirty(true)
      setForward(!!ahead)
    } else input?.select()
    window.api.aiWarm() // the meaning search is ready by the first keystroke
  }, [])

  const typedRef = useRef({ typed, dirty })
  useEffect(() => {
    typedRef.current = { typed, dirty }
  })
  useEffect(
    () => () => {
      const { typed: t, dirty: d } = typedRef.current
      if (finished.current) return
      if (d && t.trim()) drafts.set(draftKey, t)
      else drafts.delete(draftKey)
    },
    [draftKey]
  )

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

  const listed = useMemo(
    () =>
      buildResults({
        query: effective,
        tabs,
        activeId: active?.id ?? null,
        local,
        remote: effective ? remote : [],
        semantic: effective.length >= 3 ? similar : [],
        engineName,
        now: openedAt,
        ai,
        hide
      }),
    [effective, tabs, active?.id, local, remote, similar, engineName, openedAt, ai, hide]
  )
  // before anything is typed: the tabs used last, as pictures, above the list (and not repeated in it)
  const recent = useMemo(
    () =>
      effective || onPick
        ? []
        : rankTabs(tabs, '', active?.id ?? null, openedAt)
            .tabs.filter((t, i, all) => all.findIndex((x) => x.url === t.url) === i) // one per page
            .slice(0, RECENT_COUNT),
    [effective, onPick, tabs, active?.id, openedAt]
  )
  const results = useMemo(() => {
    const inStrip = new Set(recent.map((t) => t.url))
    const out = listed.filter((r) => r.kind !== 'tab' || !inStrip.has(r.url ?? ''))
    if (!joinLink) return out
    const join: SearchResult = {
      id: 'join-invite',
      kind: 'action',
      actionId: 'join-invite',
      title: typedInvite
        ? 'Join this shared space'
        : 'Join the shared space from the link you copied',
      subtitle: 'A board you edit together, live',
      url: joinLink
    }
    // an invite typed or pasted is not a page to go to or a search
    return [
      join,
      ...(typedInvite ? out.filter((r) => r.kind !== 'go' && r.kind !== 'search') : out)
    ]
  }, [listed, recent, joinLink, typedInvite])
  /** A tab clearly meant by what was typed is first: Enter switches to it, so no site name is filled in. */
  const tabFirst = results[0]?.kind === 'tab' && !!effective

  // Chrome-style inline completion: finish a site name you are typing, with the rest selected.
  const completion = useMemo(
    () => (dirty && forward && !tabFirst ? inlineCompletion(typed, local) : null),
    [dirty, forward, typed, local, tabFirst]
  )
  useEffect(() => {
    const input = inputRef.current
    if (!completion || !input || document.activeElement !== input) return
    if (input.value.toLowerCase() !== typed.toLowerCase()) return // the user kept typing
    input.value = completion
    input.setSelectionRange(typed.length, completion.length)
    setShown(completion)
  }, [completion, typed])

  const current = Math.min(sel, Math.max(0, results.length - 1))
  const gliderRef = useRef<HTMLSpanElement>(null)
  useGlider(
    listRef,
    gliderRef,
    '.pal-row.selected',
    `${current}|${results.length}|${results[current]?.kind}|${results[current]?.title}`
  )

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const switchTo = (id: number): void => {
    if (onPickTab) onPickTab(id)
    else window.api.activateTab(id)
    done()
  }
  const run = (r: SearchResult | undefined, how: 'current' | 'tab' | 'split'): void => {
    const text = shown.trim()
    // the space is joined and shown (main: the same as an invite link opened any other way)
    if (r?.actionId === 'join-invite' && r.url) {
      window.api.navigate(r.url)
      return done()
    }
    if (r?.kind === 'action') {
      finished.current = true
      drafts.delete(draftKey)
      return onAction(r.actionId as string) // the same in the canvas as on a tab
    }
    if (onPick && r?.kind === 'tab' && onPickTab) return switchTo(r.tabId as number)
    if (onPick) {
      const picked = !r
        ? text
        : r.kind === 'tab'
          ? (tabs.find((t) => t.id === r.tabId)?.url ?? text)
          : r.kind === 'go' || r.kind === 'search'
            ? text
            : (r.url ?? r.title)
      if (picked) onPick(picked)
      return done()
    }
    if (!r) {
      if (text) window.api.navigate(text) // nothing matched: treat the text as an address or search
      return done()
    }
    if (r.kind === 'tab') return switchTo(r.tabId as number)
    const target = r.kind === 'go' || r.kind === 'search' ? text : (r.url ?? r.title)
    if (how === 'tab') window.api.createTab(target)
    else if (how === 'split') window.api.openInSplit(target)
    else window.api.navigate(target)
    done()
  }

  /** Put text in the field (the input is uncontrolled), leaving the list as it is. */
  const fill = (text: string): void => {
    if (inputRef.current) inputRef.current.value = text
    setShown(text)
  }
  /** Moving the pick with the keys puts its address or suggestion in the field, to edit before opening. */
  const pick = (i: number): void => {
    setSel(i)
    const r = results[i]
    const base = dirty ? typed : (initial ?? active?.url ?? '')
    fill(
      !r || r.kind === 'go' || r.kind === 'search' || r.kind === 'action'
        ? base
        : (r.url ?? r.title)
    )
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    const last = results.length - 1
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      pick(current >= last ? 0 : current + 1)
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      pick(current <= 0 ? last : current - 1)
    } else if (e.key === 'Enter' && e.shiftKey) {
      // what was typed, as a search or an address, even with a tab matching it at the top
      run(
        results.find((r) => r.kind === 'go' || r.kind === 'search'),
        e.altKey ? 'tab' : 'current'
      )
    } else if (e.key === 'Enter') {
      run(results[current], e.altKey ? 'tab' : e.ctrlKey || e.metaKey ? 'split' : 'current')
    } else if (e.altKey && /^[1-9]$/.test(e.key) && recent[Number(e.key) - 1]) {
      switchTo(recent[Number(e.key) - 1].id)
    } else if (e.key === 'Tab' && results[current]) {
      // complete to the highlighted result so you can keep refining it
      const r = results[current]
      const text = r.kind === 'tab' || r.kind === 'action' ? r.title : (r.url ?? r.title)
      setForward(false)
      fill(text)
      setTyped(text)
      setDirty(true)
    } else if (e.key === 'Escape') {
      return done()
    } else {
      return
    }
    e.preventDefault()
  }

  const popover = variant === 'dropdown' && anchor
  // a bar low in the window (the preview's toolbar set at the bottom) has the popover rise from it instead
  const up = !!popover && anchor.top + anchor.height / 2 > window.innerHeight * 0.6
  const panelStyle = popover
    ? (() => {
        const room = window.innerWidth - EDGE * 2
        const width = Math.min(Math.max(anchor.width, POPOVER_MIN_WIDTH), room) // a full-width top bar is matched edge to edge
        // a bar wider than the popover is centred under, a narrow one (the sidebar's) is grown out of
        const left = anchor.width > width ? anchor.left + (anchor.width - width) / 2 : anchor.left
        return {
          left: Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE)),
          // the popover sits in the page area, which the out-bar shifts down by --slide-y: take that back out, live
          top: up ? undefined : `calc(${anchor.top}px - var(--slide-y, 0px))`,
          bottom: up ? window.innerHeight - anchor.top - anchor.height : undefined,
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
        className={'pal' + (popover ? ' popover' : '') + (up ? ' up' : '')}
        style={panelStyle}
        role="dialog"
        aria-label="Search or enter address"
        // grows from the bar it hangs off (or drops in, centred), on a quick spring; leaves faster than it came
        initial={{ opacity: 0, y: up ? 6 : popover ? -6 : -12, scale: popover ? 0.97 : 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{
          opacity: 0,
          y: up ? 4 : -4,
          scale: 0.98,
          transition: { duration: 0.1, ease: [0.3, 0, 0.2, 1] }
        }}
        transition={{
          type: 'spring',
          visualDuration: 0.22,
          bounce: 0.18,
          opacity: { duration: 0.1 }
        }}
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
            defaultValue={initial ?? active?.url ?? ''}
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

        {recent.length > 0 && (
          <div className="pal-recent" aria-label="Recent tabs">
            {recent.map((t, i) => (
              <button
                key={t.id}
                type="button"
                className="pal-recent-tab"
                title={`${t.title || t.url} (Alt+${i + 1})`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => switchTo(t.id)}
              >
                <span className="pal-recent-pic">
                  {thumbs?.[t.id] ? (
                    <img src={thumbs[t.id]} alt="" />
                  ) : (
                    <SiteIcon className="pal-recent-fav" src={t.favicon} />
                  )}
                  <kbd>{i + 1}</kbd>
                </span>
                <span className="pal-recent-name">{t.title || t.url}</span>
              </button>
            ))}
          </div>
        )}
        <div className="pal-list" id="pal-list" role="listbox" ref={listRef}>
          <span className="pal-glider" ref={gliderRef} aria-hidden="true" />
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
              onMouseMove={(e) => {
                // only a real move of the pointer picks: the list scrolling under a resting pointer (as the arrow
                // keys move the pick) sends a move too, which used to pull the pick back to the item under it
                const at = pointerAt.current
                pointerAt.current = { x: e.screenX, y: e.screenY }
                // and the first one only says where the pointer rests: the list growing under it (as you type,
                // after clicking the address) sends that, and taking it as a pick sent Enter to a history row
                if (!at || (at.x === e.screenX && at.y === e.screenY)) return
                if (i !== current) setSel(i)
              }}
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
              {r.kind === 'tab' && thumbs?.[r.tabId as number] && (
                // the tab as it looks: easier to tell two tabs of one site apart
                <img className="pal-preview" src={thumbs[r.tabId as number]} alt="" />
              )}
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
