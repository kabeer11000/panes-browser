import { useReducedMotion } from 'motion/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { flushSync } from 'react-dom'
import {
  addFrame,
  addNote,
  boundsOf,
  CARD_H,
  CARD_MAX_H,
  CARD_MAX_W,
  CARD_MIN_H,
  CARD_MIN_W,
  CARD_W,
  cardBox,
  GAP,
  deleteFrame,
  deleteNote,
  dropCards,
  emptyState,
  fitView,
  frameAt,
  freeSpot,
  isVirtual,
  moveFrame,
  moveToFrame,
  nearestCard,
  NOTE_COLORS,
  NOTE_MAX_W,
  NOTE_MIN_H,
  NOTE_MIN_W,
  OTHER_ID,
  dropNote,
  fitFrames,
  noteHeight,
  patchNote,
  placeCard,
  resetCardSize,
  fitVideoCards,
  resizeCard,
  resizeNote,
  unsizeFrame,
  reconcileSaved,
  regridFrame,
  removeVirtual,
  renameFrame,
  resizeFrame,
  setCardView,
  setFrameColor,
  setItem,
  groupInto,
  syncTabs,
  tidy,
  type Box,
  addLoose,
  collapseOld,
  expandFrame,
  hostClusters,
  shownCards,
  type CanvasState,
  type TabLite,
  type Viewport,
  seatSplit,
  setPreview,
  liftSections
} from '@shared/ai/canvas'
import { arrangeSplit, splitBox, splitEdge, splitMembers } from '@shared/ai/split'
import { leaves, type LayoutNode } from '@shared/layout'
import { suggestPlacement, placeItem, noteOf } from '@shared/ai/canvasPlace'
import {
  boardMenu,
  cardMenu,
  markMenu,
  noteMenu,
  sectionMenu,
  selectionMenu
} from '@shared/ai/canvasMenu'
import { classifyFile, classifyPaste, csvRows } from '@shared/ai/canvasPaste'
import {
  itemFor,
  ITEM_TEXT_MAX,
  kindOf,
  pdfSource,
  type Placement,
  posterFor,
  type CanvasItem,
  type CanvasPageContent
} from '@shared/ai/canvasItems'
import {
  addConnector,
  connectorsOf,
  deleteConnectors,
  endBox,
  endKey,
  objectAt,
  patchConnector,
  pruneConnectors,
  setConnectorEnd,
  type CanvasConnector,
  type End
} from '@shared/ai/connectors'
import { keepAspect, snapAngle, snapBox, type Snap } from '@shared/ai/snap'
import type { Space, TabInfo } from '@shared/types'
import { SpaceSwitcher } from '@renderer/components/SpaceSwitcher'
import { WindowControls } from '@renderer/components/WindowControls'
import { displayHost } from '@shared/url'
import { tabTitle } from '@renderer/tabTitle'
import { CardView, FrameBar, FrameView, NoteView } from './Cards'
import { pickStreams, streamCap } from '@shared/ai/tabStream'
import { isCapturing } from '@shared/capture'
import { attentionLabel } from '@shared/attention'
import { TabFavicon } from '@renderer/components/TabFavicon'
import { alreadyOpen, quickFind, type FindItem } from '@shared/ai/quickFind'
import { quickAction } from '@shared/ai/sites'
import { anchorAt, askSearch } from './askSearch'
import { ExpandIcon, SearchGlyph, UnsplitIcon } from './icons'
import { HistoryIcon } from '@renderer/components/icons'
import { Connectors, type ConnectorsHandle, type Style } from './Connectors'
import type { CardModel } from './model'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { PlayingItem } from './PlayingItem'
import { useDismiss } from './useDismiss'
import { Expanded, type ExpandSource } from './Expanded'
import { useFinder } from './useFinder'
import { useBoardClip } from './useBoardClip'
import { dispatchClip, getClip } from '@renderer/tabClip'
import { useAsk } from './useAsk'
import { AskDock } from './AskDock'
import { Marks } from './Marks'
import { CommandMenu, type Command } from './CommandMenu'
import { HistoryList } from './HistoryList'
import { boardDigest } from '@shared/ai/canvasDigest'
import {
  addPreset,
  PRESET_IDS,
  PRESETS,
  presetAsk,
  presetBox,
  type PresetId
} from '@shared/ai/canvasPresets'
import { MarkBar } from './MarkBar'
import {
  addBlock,
  addShape,
  addStroke,
  alignMarks,
  contentBoxes,
  deleteMarks,
  distributeMarks,
  duplicateMarks,
  groupMarks,
  isBlock,
  isShape,
  MARK_TEXT_MAX,
  markAt,
  markBox,
  marksOf,
  moveMarks,
  patchMark,
  reorderMarks,
  SHAPE_KINDS,
  tableText,
  TEXT_SIZES,
  toggleCheck,
  ungroupMarks,
  withGroups,
  type BlockKind,
  type CanvasMark,
  type MarkPatch,
  type ShapeKind
} from '@shared/ai/canvasMarks'
import {
  applyBoardTool,
  boardSummary,
  checkBoardCall,
  refToken,
  type Ref
} from '@shared/ai/canvasTools'
import type { AskTurn } from './useAsk'
import { Toolbar, type Tool } from './Toolbar'

/** Room for a frame's title row, in screen px: a popover that has to go below the frame's top sits under it. */
const FRAME_HEAD_PX = 44
import { MAX_K, MIN_K, useViewport } from './useViewport'
import './canvas.css'

interface Props {
  /** Chrome (the sidebar or the top bar) is out over the board: it blurs and dims. */
  dim?: boolean
  tabs: TabInfo[]
  activeId: number | null
  thumbs: Record<number, string>
  spaceId: number
  /** Leave the canvas; `pick` is the tab to show (null: stay on the one that is open). */
  onExit: (pick: number | null) => void
  /** The tabs shown side by side (split view), if any: they sit on the board as one split card. */
  layout?: LayoutNode | null
  /** For the space switcher in the board's top bar: each space has its own board. */
  spaces?: Space[]
  spaceDir?: number
}

type Phase = 'loading' | 'entering' | 'open' | 'leaving'

/**
 * The space whose board is up. A board made while another space's is still up (the board is keyed by its space,
 * and a new one renders before the old one goes) is a swap: it holds the place opaque while it loads and fades in,
 * instead of showing the page behind it (the new space's blank tab) for a moment and then flying a page into a card.
 */
let boardSpace: number | null = null
/** No board has opened yet in this run (the first one may be Panes coming back onto the board after a restart). */
let firstBoardOfRun = true
/** A file on its way onto the board: what it is called, and how to keep a copy of it or read it as text. */
interface Incoming {
  name: string
  mime: string
  /** A file with no card of its own still goes on as a link to it (a download), instead of being refused. */
  other?: boolean
  keep: () => Promise<{ file: string; name: string } | null>
  read: () => Promise<string>
}
type Pos = Map<string, { x: number; y: number }>

interface Item {
  key: string
  el: HTMLElement
}
type Gesture =
  | { kind: 'pan'; samples: Array<{ t: number; x: number; y: number }>; lx: number; ly: number }
  | { kind: 'marquee'; x0: number; y0: number; base: Set<string> }
  | { kind: 'draw'; wx: number; wy: number }
  | { kind: 'stroke'; pen: 'pen' | 'marker'; pts: number[] }
  | { kind: 'shape'; shape: ShapeKind; x0: number; y0: number }
  | {
      /** Moving drawn marks (with their groups); Alt leaves the originals and moves copies. */
      kind: 'marks'
      ids: string[]
      sx: number
      sy: number
      moved: boolean
      copy: boolean
      els: SVGElement[]
      ldx: number
      ldy: number
    }
  | {
      /** Resizing or turning a drawn mark. */
      kind: 'markop'
      op: 'resize' | 'rotate'
      id: string
      sx: number
      sy: number
      start: CanvasMark
      moved: boolean
    }
  | {
      /** Drawing a connector, or moving one end of one (`existing`). `fixed` is the end that stays. */
      kind: 'connect'
      fixed: End
      which: 'from' | 'to'
      existing: string | null
      sx: number
      sy: number
      moved: boolean
      end: End | null
      /** A plain line (the L tool): straight, no arrowheads, whatever the connector style is. */
      line: boolean
    }
  | {
      kind: 'item'
      what: 'card' | 'frame' | 'note'
      id: string
      cards: number[]
      sx: number
      sy: number
      shift: boolean
      moved: boolean
      items: Item[]
      target: string | null
      /** The move last shown (snapped while Shift is held): the drop uses the same. */
      ldx: number
      ldy: number
      /** Dropping here opens the dragged card beside this one (its left or right edge). */
      splitTo?: { id: number; edge: 'left' } | null
      /** The cards dragged are a split view: they stay side by side, loose. */
      split?: boolean
      /** The rest of the selection that goes along: its notes and drawings (cards are in `cards`). */
      notes?: string[]
      marks?: string[]
    }
  | {
      kind: 'nresize'
      id: string
      dir: string
      start: Box
      sx: number
      sy: number
      el: HTMLElement | null
      w: number
      h: number | null
    }
  | {
      kind: 'resize'
      id: string
      dir: string
      start: Box
      sx: number
      sy: number
      el: HTMLElement | null
      box: Box
    }
  | {
      kind: 'cresize'
      id: number
      dir: string
      start: Box
      sx: number
      sy: number
      el: HTMLElement | null
      box: Box
    }

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const UNDO_MAX = 60
const DRAG_PX = 4
const MARGIN = 360
const DOCK_W = 380
const DOCK_MIN = 300
const DOCK_MAX = 720
const LOD_K = 0.22
const SAVE_MS = 700
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const isEditable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

const positionsOf = (s: CanvasState, off?: Pos): Pos => {
  const out: Pos = new Map()
  for (const c of s.cards) out.set(`c${c.id}`, { x: c.x, y: c.y })
  for (const f of s.frames) out.set(`f${f.id}`, { x: f.x, y: f.y })
  // the split view's box glides with its cards
  const box = s.split ? splitBox(s, s.split) : null
  if (box) out.set('split', { x: box.x, y: box.y })
  if (off) {
    for (const [k, d] of off) {
      const p = out.get(k)
      if (p) out.set(k, { x: p.x + d.x, y: p.y + d.y })
    }
  }
  return out
}

/** A selection key ('c:12', 'f:f2', 'n:n3', 'm:m4') as an object reference. */
const parseKey = (k: string): Ref | null => {
  const id = k.slice(2)
  if (k[0] === 'c') return { kind: 'card', id: Number(id) }
  if (k[0] === 'f') return { kind: 'frame', id }
  if (k[0] === 'n') return { kind: 'note', id }
  if (k[0] === 'm') return { kind: 'mark', id }
  return null
}

const keyOf = (el: HTMLElement): string | null =>
  el.dataset.cid
    ? `c${el.dataset.cid}`
    : el.dataset.fid
      ? `f${el.dataset.fid}`
      : el.dataset.splitbox !== undefined
        ? 'split'
        : null

/** A web page's shape in its tab: the screen's, kept between 4:3 and 21:9 (a portrait or odd screen gives 16:10). */
function pageAspect(): number {
  const ar = window.screen.availWidth / Math.max(1, window.screen.availHeight)
  return ar >= 4 / 3 && ar <= 21 / 9 ? Math.round(ar * 100) / 100 : 16 / 10
}

export function Canvas({
  tabs,
  activeId,
  thumbs,
  spaceId,
  spaces = [],
  spaceDir = 1,
  onExit,
  dim = false,
  layout = null
}: Props): React.JSX.Element {
  const reduced = !!useReducedMotion()
  const moveRef = useRef<(v: Viewport) => void>(() => undefined)
  const shutRef = useRef<() => void>(() => undefined)
  const vp = useViewport({ x: 0, y: 0, k: 1 }, (v) => {
    moveRef.current(v)
    shutRef.current()
  })
  const { root, grid, layer } = vp
  const lastView = useRef<Viewport | null>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const marquee = useRef<HTMLDivElement>(null)
  const drawBox = useRef<HTMLDivElement>(null)
  const [st, setStState] = useState<CanvasState | null>(null)
  const stRef = useRef<CanvasState | null>(null)
  const [phase, setPhaseState] = useState<Phase>('loading')
  const [swap] = useState(() => boardSpace !== null && boardSpace !== spaceId)
  const phaseRef = useRef<Phase>('loading')
  const [vis, setVis] = useState<Set<number>>(new Set())
  // the instant find's words (null: closed) and which of its matches is picked
  const [quick, setQuick] = useState<string | null>(null)
  const [quickAt, setQuickAt] = useState(0)
  const inViewTimer = useRef<number | undefined>(undefined)
  /** The tab cards on screen now (no margin), as last told to main: only these may play live (tab streams). */
  const [onScreen, setOnScreen] = useState<Set<number>>(new Set())
  const spaceIdRef = useRef(spaceId)
  useLayoutEffect(() => {
    spaceIdRef.current = spaceId
  }, [spaceId])
  const [sel, setSelState] = useState<Set<string>>(new Set())
  const selRef = useRef(sel)
  const [tool, setTool] = useState<Tool>('select')
  const toolRef = useRef<Tool>('select')
  const [editing, setEditing] = useState<string | null>(null)
  const [zoomPct, setZoomPct] = useState(100)
  const [toast, setToast] = useState<{
    text: string
    undo?: () => void
    label?: string
    key: number
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const spaceHeld = useRef(false)
  const [lod, setLod] = useState(false)
  const [ghostId, setGhostId] = useState<number | null>(activeId)
  const [fresh, setFresh] = useState<Set<number>>(new Set())
  const [chips, setChips] = useState<Set<number>>(new Set())
  const [ctx, setCtx] = useState<{
    x: number
    y: number
    title?: string
    items: MenuEntry[]
    onPick: (id: string) => void
  } | null>(null)
  const closeContext = useCallback(() => setCtx(null), [])
  // `live`: open straight onto the live page (something the assistant just opened for the person)
  // the open preview covers its card (it has grown over it): only then is the card hidden, so the two cross-fade
  const [expandedCovers, setExpandedCovers] = useState(false)
  const [expanded, setExpanded] = useState<{
    id: number
    from: ExpandSource['from']
    live?: boolean
  } | null>(null)
  const expandedRef = useRef(false)
  const expandRef = useRef<(id: number, live?: boolean) => void>(() => undefined)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [contents, setContents] = useState<Record<number, CanvasPageContent>>({})
  const asked = useRef(new Map<number, string>())
  const [locals, setLocals] = useState<Record<string, string>>({})
  const flyRef = useRef<number[] | null>(null)
  const promptRef = useRef<HTMLInputElement>(null)
  const [ranks, setRanks] = useState<Map<number, number>>(new Map())
  const pendingFlip = useRef<{ before: Pos; stagger: boolean } | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  const bootRef = useRef('')
  const tries = useRef(new Map<string, number>())
  const conn = useRef<ConnectorsHandle>(null)
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rounded')
  const shapeKindRef = useRef(shapeKind)
  useEffect(() => {
    shapeKindRef.current = shapeKind
  }, [shapeKind])
  const [markEdit, setMarkEdit] = useState<string | null>(null)
  /** The key that started typing into a selected shape or note (it is the first character). */
  const [firstKey, setFirstKey] = useState<string | null>(null)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [history, setHistory] = useState<Array<{ label: string; t: number }> | null>(null)
  const openHistory = (): void =>
    setHistory(undoStack.current.map((x) => ({ label: x.label, t: x.t })).reverse())
  const draft = useRef<SVGPathElement>(null)
  /** Steps that can be taken back, newest last: what was done, when, and the board before it. */
  // `revert`: what the step did outside the board (tabs pasted or moved), taken back with it
  const undoStack = useRef<
    Array<{ label: string; state: CanvasState; t: number; revert?: () => void }>
  >([])
  const [undoDepth, setUndoDepth] = useState(0)
  const [toolConfirm, setToolConfirm] = useState<{
    text: string
    answer: (ok: boolean) => void
  } | null>(null)
  const [freshLink, setFreshLink] = useState<string | null>(null)
  const [linkStyle, setLinkStyle] = useState<Style>({ shape: 'curved', heads: 'end' })
  const linkStyleRef = useRef(linkStyle)
  const guides = useRef<SVGSVGElement>(null)
  /** Something new asked for at a spot of the board (screen point in the root, and where on the board). */
  // `fill`: a blank tab's card that was clicked: what is typed goes into that tab, in that spot
  const [newAt, setNewAt] = useState<{
    sx: number
    sy: number
    wx: number
    wy: number
    fill?: number
  } | null>(null)
  /** A tab opened from the board: its card goes where it was asked for. */
  const placeNext = useRef<{ x: number; y: number; t: number } | null>(null)
  const lastPointer = useRef<{ x: number; y: number } | null>(null)
  const hovFrame = useRef<string | undefined>(undefined)
  const splitRef = useRef<number[]>([])
  const expandedNow = useRef<number | null>(null)

  const [bench, setBench] = useState<TabInfo[]>([])
  const allTabs = useMemo(() => (bench.length ? [...tabs, ...bench] : tabs), [tabs, bench])
  // What plays on this board: every tab that has made sound since the board opened stays listed while it is paused
  // (a paused video is silent, yet you want it back), until its tab closes or it is dismissed; the one playing now
  // first, then the most recent.
  const [heard, setHeard] = useState<number[]>([])
  const [forgot, setForgot] = useState<Set<number>>(new Set())
  // a tab in a call (camera, microphone or screen in use) is listed like one playing, silent or not
  const audibleKey = tabs
    .filter((t) => t.audible || t.playing || isCapturing(t.capture))
    .map((t) => t.id)
    .join(',')
  const [lastAudible, setLastAudible] = useState('')
  if (audibleKey !== lastAudible) {
    // a tab that starts playing again is listed again, at the front
    setLastAudible(audibleKey)
    const now = audibleKey ? audibleKey.split(',').map(Number) : []
    if (now.length) {
      setHeard((h) => [...now, ...h.filter((id) => !now.includes(id))].slice(0, 12))
      if (now.some((id) => forgot.has(id)))
        setForgot((f) => new Set([...f].filter((id) => !now.includes(id))))
    }
  }
  const playing = useMemo(() => {
    const live = new Map(tabs.map((t) => [t.id, t]))
    return heard
      .map((id) => live.get(id))
      .filter((t): t is TabInfo => !!t && !forgot.has(t.id))
      .sort(
        (a, b) =>
          Number(isCapturing(b.capture)) - Number(isCapturing(a.capture)) ||
          Number(b.audible && !b.muted) - Number(a.audible && !a.muted)
      )
  }, [tabs, heard, forgot])
  const [playList, setPlayList] = useState(false)
  const playBox = useRef<HTMLDivElement>(null)
  useDismiss(
    playList,
    playBox,
    useCallback(() => setPlayList(false), [])
  )
  const forgetPlaying = useCallback((id: number): void => {
    setForgot((f) => new Set(f).add(id))
  }, [])
  const tabsRef = useRef(allTabs)
  useLayoutEffect(() => {
    tabsRef.current = allTabs
  }, [allTabs])
  const byId = useMemo(() => new Map(allTabs.map((t) => [t.id, t])), [allTabs])
  // Cards take their content's own shape, never one sized by hand (see fitVideoCards): a video what its stream
  // reports (16:9 until then), a web page the screen's (how it looks in its tab), not a tall card that crops it.
  // Documents, pictures and saved items keep theirs. Applied with every change to the board, and when a stream
  // reports a new shape.
  const videoAspects = useRef<Record<number, number>>({})
  const videoAspectOf = useCallback((c: { id: number; url: string }): number | null => {
    const known = videoAspects.current[c.id]
    if (known) return known
    const kind = kindOf(c.url)
    if (kind === 'video') return 16 / 9
    if (kind !== 'page' || isVirtual(c.id) || pdfSource(c.url) !== c.url) return null
    return pageAspect()
  }, [])
  // the last frame each live card showed, by tab, with the address it was at (a page that moved on drops it)
  const [stills, setStills] = useState<Record<number, { url: string; src: string }>>({})
  const onStill = useCallback((id: number, src: string): void => {
    const url = tabsRef.current.find((t) => t.id === id)?.url ?? ''
    setStills((prev) => ({ ...prev, [id]: { url, src } }))
  }, [])
  // Playing tabs play live on their cards (tab streams): on screen only, capped, never the tab open in the preview
  // (its real page shows there), none zoomed out. Main keeps exactly these pages painting. A paused one keeps the
  // last frame it streamed (stills).
  const openTab = expanded
    ? isVirtual(expanded.id)
      ? (st?.items[String(expanded.id)]?.tab ?? null)
      : expanded.id
    : null
  // tabs with something new waiting (messages, notifications), most first: the board's inbox
  const waiting = useMemo(
    () =>
      tabs
        .filter((t) => !t.private && !t.tor && (t.attention.count > 0 || t.attention.unseen))
        .sort((a, b) => b.attention.count - a.attention.count),
    [tabs]
  )
  const calls = useMemo(
    () => new Set(tabs.filter((t) => isCapturing(t.capture)).map((t) => t.id)),
    [tabs]
  )
  const streamKey = pickStreams({
    // a video playing without sound (muted, or quiet) plays live on its card too
    tabs: tabs.map((t) => ({ ...t, audible: t.audible || !!t.playing, call: calls.has(t.id) })),
    onScreen,
    open: openTab,
    zoomedOut: lod,
    cap: streamCap(navigator)
  }).join(',')
  const streams = useMemo(
    () => new Set(streamKey ? streamKey.split(',').map(Number) : []),
    [streamKey]
  )
  useEffect(() => {
    window.api.canvas.streaming?.([...streams])
  }, [streams])
  useEffect(() => () => window.api.canvas.streaming?.([]), [])
  const markFresh = useCallback((ids: number[]): void => {
    if (ids.length === 0) return
    setFresh((prev) => new Set([...prev, ...ids]))
    window.setTimeout(
      () =>
        setFresh((prev) => {
          const next = new Set(prev)
          for (const id of ids) next.delete(id)
          return next
        }),
      1600
    )
  }, [])

  const setPhase = useCallback((p: Phase): void => {
    phaseRef.current = p
    setPhaseState(p)
  }, [])
  const setSel = useCallback((s: Set<string>): void => {
    selRef.current = s
    setSelState(s)
  }, [])
  // The frame's popover closes once the board moves or anything is dragged, and stays closed for that selection:
  // clicking the frame again (a new selection) brings it back.
  const [barShut, setBarShut] = useState<Set<string> | null>(null)
  const shutBar = (): void => {
    if ([...selRef.current].some((k) => k[0] === 'f')) setBarShut(selRef.current)
  }
  useLayoutEffect(() => {
    shutRef.current = shutBar
  })
  const setToolBoth = useCallback((t: Tool): void => {
    toolRef.current = t
    setTool(t)
  }, [])

  const lite = useCallback((): TabLite[] => {
    // a tab that only holds a card's live page (a web result, an assistant's page) is that card, not another one
    const backing = new Set(
      Object.values(stRef.current?.items ?? {}).flatMap((it) =>
        it.tab !== undefined ? [it.tab] : []
      )
    )
    return tabsRef.current
      .filter((t) => !backing.has(t.id))
      .map((t) => ({ id: t.id, url: t.url, private: t.private || t.tor }))
  }, [])
  // Where the board is on screen. Measuring it during a pan or drag, right after the board was moved, makes the
  // browser lay the whole board out again then and there; so it is measured when it resizes (after layout, free)
  // and when a gesture starts, and read from here.
  const rootRect = useRef({ left: 0, top: 0, w: 0, h: 0 })
  const measureRoot = (): void => {
    const r = root.current?.getBoundingClientRect()
    if (r) rootRect.current = { left: r.left, top: r.top, w: r.width, h: r.height }
  }
  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new ResizeObserver(measureRoot)
    ro.observe(el)
    return () => ro.disconnect()
    // measureRoot only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const size = (): { w: number; h: number } => {
    if (rootRect.current.w === 0) measureRoot()
    return rootRect.current
  }

  // ---- visibility (only cards near the screen are mounted) ----
  const updateVisible = useCallback((v: Viewport): void => {
    const s = stRef.current
    const { w, h } = size()
    if (!s || w === 0) return
    const view: Box = {
      x: (-v.x - MARGIN) / v.k,
      y: (-v.y - MARGIN) / v.k,
      w: (w + MARGIN * 2) / v.k,
      h: (h + MARGIN * 2) / v.k
    }
    const next = new Set<number>()
    for (const c of s.cards) {
      const cw = c.w ?? CARD_W
      const ch = c.h ?? CARD_H
      if (c.x < view.x + view.w && c.x + cw > view.x && c.y < view.y + view.h && c.y + ch > view.y)
        next.add(c.id)
    }
    setVis((prev) => {
      if (prev.size === next.size && [...next].every((i) => prev.has(i))) return prev
      return next
    })
    // main takes fresh pictures only of the tabs on screen; told once the view has settled
    window.clearTimeout(inViewTimer.current)
    inViewTimer.current = window.setTimeout(() => {
      const shown = new Set(
        (stRef.current?.cards ?? [])
          .filter((c) => c.id > 0 && c.x < view.x + view.w && c.x + (c.w ?? CARD_W) > view.x)
          .filter((c) => c.y < view.y + view.h && c.y + (c.h ?? CARD_H) > view.y)
          .map((c) => c.id)
      )
      window.api.canvas.inView?.(spaceIdRef.current, [...shown])
      setOnScreen((prev) =>
        prev.size === shown.size && [...shown].every((i) => prev.has(i)) ? prev : shown
      )
    }, 300)
  }, [])

  const saveSoon = useCallback((): void => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const s = stRef.current
      if (s && phaseRef.current !== 'loading') {
        window.api.canvas.save(spaceId, {
          ...s,
          boot: bootRef.current,
          view: lastView.current,
          open: expandedNow.current
        })
      }
    }, SAVE_MS)
  }, [spaceId])

  const onMove = useCallback(
    (v: Viewport): void => {
      lastView.current = v
      updateVisible(v)
      setZoomPct(Math.round(v.k * 100))
      setLod(v.k < LOD_K)
      saveSoon()
    },
    [updateVisible, saveSoon]
  )
  useEffect(() => {
    moveRef.current = onMove
  }, [onMove])

  // ---- state edits ----
  /** Keep `state` as the board before a step called `label`. `merge`: the same step again right away (a key held
   * down, nudging) adds to the last one instead of making another. */
  const record = useCallback(
    (label: string, state: CanvasState, merge = false, revert?: () => void): void => {
      const now = Date.now()
      const top = undoStack.current[undoStack.current.length - 1]
      if (merge && top && top.label === label && now - top.t < 1200) {
        top.t = now
        return
      }
      undoStack.current = [
        ...undoStack.current.slice(-(UNDO_MAX - 1)),
        { label, state, t: now, revert }
      ]
      setUndoDepth(undoStack.current.length)
    },
    []
  )
  const edit = useCallback(
    (
      fn: (s: CanvasState) => CanvasState,
      o: { flip?: boolean; stagger?: boolean; off?: Pos; undo?: string; merge?: boolean } = {}
    ): boolean => {
      const cur = stRef.current
      if (!cur) return false
      // sections hug what is in them after every change; connectors to what went go too
      const next = pruneConnectors(fitFrames(fitVideoCards(fn(cur), videoAspectOf)))
      if (next === cur) return false
      if (o.undo) record(o.undo, cur, o.merge)
      if (o.flip) pendingFlip.current = { before: positionsOf(cur, o.off), stagger: !!o.stagger }
      stRef.current = next
      setStState(next)
      saveSoon()
      return true
    },
    [saveSoon, record, videoAspectOf]
  )

  const onVideoAspect = useCallback(
    (id: number, ar: number): void => {
      const was = videoAspects.current[id]
      if (was !== undefined && Math.abs(was - ar) < 0.03) return
      videoAspects.current[id] = ar
      edit((s) => s) // the change itself is the fit, in edit
    },
    [edit]
  )
  /** A card back to its natural size: its video's shape for a video, else the default (a click on its edge). */
  const fitCardSize = useCallback(
    (id: number): void => {
      const s = stRef.current
      const c = s?.cards.find((x) => x.id === id)
      if (!s || !c) return
      // already at it (the second click of a double click): no step to undo
      const n = fitVideoCards(resetCardSize(s, id), videoAspectOf).cards.find((x) => x.id === id)
      if (n && n.w === c.w && n.h === c.h && n.fit === c.fit) return
      edit((s0) => resetCardSize(s0, id), {
        flip: true,
        undo: videoAspectOf(c) !== null ? 'Fitted card' : 'Reset card size'
      })
    },
    [edit, videoAspectOf]
  )

  const pushUndo = useCallback(
    (label: string): void => {
      if (stRef.current) record(label, stRef.current)
    },
    [record]
  )
  /**
   * Go back `steps` steps (1: the last one); returns what the last of them was, or null when there is nothing to
   * take back. The board that comes back is matched to the tabs open now: a tab closed since is not brought back as a
   * card, and one opened since keeps its card.
   */
  const undo = useCallback(
    (steps = 1): string | null => {
      const cur = stRef.current
      const at = undoStack.current.length - steps
      if (steps < 1 || at < 0 || !cur) return null
      const top = undoStack.current[at]
      undoStack.current
        .splice(at)
        .reverse()
        .forEach((x) => x.revert?.())
      setUndoDepth(undoStack.current.length)
      pendingFlip.current = { before: positionsOf(cur), stagger: false }
      const back = pruneConnectors(fitFrames(syncTabs(top.state, lite()).state))
      stRef.current = back
      setStState(back)
      saveSoon()
      return top.label
    },
    [saveSoon, lite]
  )

  const clearDrag = (): void => {
    root.current
      ?.querySelectorAll<HTMLElement>('[data-cid],[data-fid],[data-nid],[data-splitbox]')
      .forEach((el) => {
        el.style.translate = ''
        el.classList.remove('lifted')
      })
    root.current?.querySelectorAll('.drop').forEach((el) => el.classList.remove('drop'))
  }

  // After a state change: put dragged things back to rest, and glide everything that moved from where it was.
  useLayoutEffect(() => {
    updateVisible(vp.get())
    const p = pendingFlip.current ?? (flyRef.current ? { before: new Map(), stagger: false } : null)
    pendingFlip.current = null
    if (!p || !st) return
    clearDrag()
    if (reduced || !root.current) return
    const after = positionsOf(st)
    const fly = flyRef.current
    flyRef.current = null
    const prompt = promptRef.current?.closest('.cv-prompt')?.getBoundingClientRect()
    // a frame and its cards move together: they share the delay of their frame's turn
    const turn = new Map(st.frames.map((f, i) => [f.id, i]))
    const frameOfCard = new Map(st.cards.map((c) => [c.id, c.frame]))
    const delayOf = (el: HTMLElement): number => {
      if (!p.stagger) return 0
      const fid = el.dataset.fid ?? frameOfCard.get(Number(el.dataset.cid))
      return Math.min((fid ? (turn.get(fid) ?? 0) : 0) * 45, 220)
    }
    if (p.stagger) {
      root.current
        .querySelector('.cv-links')
        ?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], {
          duration: 900,
          easing: 'ease-out'
        })
    }
    root.current
      .querySelectorAll<HTMLElement>('[data-cid],[data-fid],[data-splitbox]')
      .forEach((el) => {
        const key = keyOf(el)
        const to = key && after.get(key)
        if (!key || !to) return
        const from = p.before.get(key)
        const flyAt = fly ? fly.indexOf(Number(el.dataset.cid)) : -1
        if (!from && flyAt >= 0 && prompt && el.dataset.cid) {
          // a result flies out of the prompt: small and near it first, then springs to its place
          const r = el.getBoundingClientRect()
          const k = vp.get().k
          const dx = (prompt.left + prompt.width / 2 - (r.left + r.width / 2)) / k
          const dy = (prompt.top + prompt.height / 2 - (r.top + r.height / 2)) / k
          el.animate(
            [
              { translate: `${dx}px ${dy}px`, scale: '0.12', opacity: 0 },
              { opacity: 1, offset: 0.25 },
              { translate: '0px 0px', scale: '1', opacity: 1 }
            ],
            {
              duration: 720,
              easing: 'cubic-bezier(0.2, 1.18, 0.32, 1)',
              delay: 40 + flyAt * 70,
              fill: 'backwards'
            }
          )
          return
        }
        if (!from) {
          el.animate(
            [
              { opacity: 0, scale: '0.94' },
              { opacity: 1, scale: '1' }
            ],
            {
              duration: 280,
              easing: EASE,
              delay: delayOf(el),
              fill: 'backwards'
            }
          )
          return
        }
        const dx = from.x - to.x
        const dy = from.y - to.y
        if (dx === 0 && dy === 0) return
        el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], {
          duration: p.stagger ? 560 : 300,
          easing: EASE,
          delay: delayOf(el),
          fill: 'backwards'
        })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st])

  // ---- names from the model for frames the board just made ----
  const nameFrames = useCallback(
    async (ids: string[]): Promise<void> => {
      for (const id of ids) {
        const s = stRef.current
        const f = s?.frames.find((x) => x.id === id)
        if (!s || !f || f.pinned || f.kind !== 'topic') continue
        const members = s.cards.filter((c) => c.frame === id).map((c) => c.id)
        const was = f.name
        const name = await window.api.canvas.name(spaceId, members)
        if (!name) continue
        edit((cur) => ({
          ...cur,
          frames: cur.frames.map((x) =>
            x.id === id && !x.pinned && x.name === was ? { ...x, name } : x
          )
        }))
      }
    },
    [spaceId, edit]
  )

  // ---- tidy up ----
  const runTidy = useCallback(
    async (rearrange = false): Promise<void> => {
      if (!stRef.current) return
      setBusy(true)
      try {
        const res = await window.api.canvas.cluster(spaceId)
        const before = new Set(stRef.current.frames.map((f) => f.id))
        edit((s) => tidy(s, lite(), res.groups, rearrange), {
          flip: true,
          stagger: true,
          undo: 'Arranged the board'
        })
        const next = stRef.current
        if (next) {
          void nameFrames(
            next.frames.filter((f) => !before.has(f.id) && f.kind === 'topic').map((f) => f.id)
          )
          const { w, h } = size()
          const vv = vp.get()
          const boxes = contentBoxes(next)
          const anyInSight = boxes.some(
            (b) =>
              (b.x + b.w) * vv.k + vv.x > 0 &&
              (b.y + b.h) * vv.k + vv.y > 0 &&
              b.x * vv.k + vv.x < w &&
              b.y * vv.k + vv.y < h
          )
          if (rearrange || !anyInSight) {
            vp.animateTo(fitView(boundsOf(boxes), w, h, 80, 1))
          }
        }
      } finally {
        setBusy(false)
      }
    },
    [spaceId, edit, lite, nameFrames, vp]
  )

  // the preview that was open when the board was last saved: it opens again once the board is up
  const reopen = useRef<number | null>(null)
  // ---- load, reconcile, first layout, then open ----
  useEffect(() => {
    let alive = true
    boardSpace = spaceId
    window.api.canvas.open(spaceId)
    void (async () => {
      const saved = await window.api.canvas.load(spaceId)
      if (!alive) return
      reopen.current = saved?.state?.open ?? null
      const boot = saved?.boot ?? ''
      bootRef.current = boot
      const tabsNow = lite()
      let s = saved?.state
        ? reconcileSaved(liftSections(saved.state), tabsNow, boot)
        : emptyState(boot)
      const had = s.frames.length > 0
      const synced = syncTabs(s, tabsNow)
      s = fitVideoCards(pruneConnectors(synced.state), videoAspectOf)
      let firstNames: string[] = []
      if (!had) {
        const res = await window.api.canvas.cluster(spaceId)
        if (!alive) return
        s = tidy(s, tabsNow, res.groups)
        firstNames = s.frames.filter((f) => f.kind === 'topic').map((f) => f.id)
      }
      stRef.current = s
      setStState(s)
      const { w, h } = size()
      const everything = contentBoxes(s)
      const all = boundsOf(everything)
      const active = s.cards.find((c) => c.id === activeId)
      let v = s.view
      const onScreen = (b: Box | undefined, vv: Viewport): boolean =>
        !!b &&
        b.x * vv.k + vv.x > 0 &&
        b.y * vv.k + vv.y > 0 &&
        (b.x + b.w) * vv.k + vv.x < w &&
        (b.y + b.h) * vv.k + vv.y < h
      // a saved view that shows none of the board (another window size, everything moved) is not kept
      const inSight = (vv: Viewport): boolean =>
        everything.some(
          (b) =>
            (b.x + b.w) * vv.k + vv.x > 0 &&
            (b.y + b.h) * vv.k + vv.y > 0 &&
            b.x * vv.k + vv.x < w &&
            b.y * vv.k + vv.y < h
        )
      // opened from the tab view, the tab you were on is brought into sight; Panes coming back onto the board after
      // a restart keeps exactly where you were
      const fromTabs = !(firstBoardOfRun && (await window.api.getState()).canvas)
      firstBoardOfRun = false
      if (!alive) return
      if (!v || !inSight(v) || (fromTabs && active && !onScreen(cardBox(active), v))) {
        const fit = fitView(all, w, h, 72, 1)
        v =
          fit.k >= 0.42 || !active
            ? fit
            : {
                k: 0.7,
                x: w / 2 - (active.x + CARD_W / 2) * 0.7,
                y: h / 2 - (active.y + CARD_H / 2) * 0.7
              }
      }
      vp.set(v)
      updateVisible(v)
      if (active) {
        const ax = active.x + CARD_W / 2
        const ay = active.y + CARD_H / 2
        const order = [...s.cards].sort(
          (a, b) => Math.hypot(a.x - ax, a.y - ay) - Math.hypot(b.x - ax, b.y - ay)
        )
        setRanks(new Map(order.map((c, i) => [c.id, i])))
      }
      markFresh(synced.added)
      setPhase('entering')
      void nameFrames(firstNames)
    })()
    return () => {
      alive = false
      window.clearTimeout(saveTimer.current)
      const s = stRef.current
      if (s && phaseRef.current !== 'loading') {
        window.api.canvas.save(spaceId, {
          ...s,
          boot: bootRef.current,
          view: vp.get(),
          open: expandedNow.current
        })
      }
      if (boardSpace === spaceId) boardSpace = null
      window.api.canvas.close(spaceId)
    }
    // once per space: the component is keyed by it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The entrance: the page you were on shrinks into its card while the rest of the board comes in around it.
  useLayoutEffect(() => {
    if (phase !== 'entering') return
    const g = ghost.current
    const s = stRef.current
    const card = s?.cards.find((c) => c.id === activeId)
    const { w, h } = size()
    if (swap && !reduced) {
      // a space switch: the board's own entrance (its cards rise) is all there is
      const t = window.setTimeout(() => setPhase('open'), 460)
      return () => window.clearTimeout(t)
    }
    if (!g || !card || reduced) {
      setPhase('open')
      return
    }
    const v = vp.get()
    const to = {
      left: card.x * v.k + v.x,
      top: card.y * v.k + v.y,
      width: (card.w ?? CARD_W) * v.k,
      height: (card.h ?? CARD_H) * v.k
    }
    const a = g.animate(
      [
        {
          left: '0px',
          top: '0px',
          width: `${w}px`,
          height: `${h}px`,
          borderRadius: '12px',
          opacity: 1
        },
        { ...px(to), borderRadius: '8px', opacity: 1, offset: 0.82 },
        { ...px(to), borderRadius: '8px', opacity: 0 }
      ],
      { duration: 260, easing: EASE, fill: 'forwards' }
    )
    const t = window.setTimeout(() => setPhase('open'), 220)
    a.onfinish = () => setPhase('open')
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === 'entering'])

  // ---- leaving: the chosen card grows into the page ----
  const leave = useCallback(
    (pick: number | null): void => {
      if (phaseRef.current === 'leaving' || phaseRef.current === 'loading') {
        if (phaseRef.current === 'loading') onExit(pick)
        return
      }
      const id = pick ?? activeId
      const s = stRef.current
      const card = id !== null ? s?.cards.find((c) => c.id === id) : undefined
      const g = ghost.current
      const { w, h } = size()
      const v = vp.get()
      const to = card
        ? {
            left: card.x * v.k + v.x,
            top: card.y * v.k + v.y,
            width: (card.w ?? CARD_W) * v.k,
            height: (card.h ?? CARD_H) * v.k
          }
        : null
      const seen =
        !!to && to.left < w && to.top < h && to.left + to.width > 0 && to.top + to.height > 0
      vp.stop()
      if (reduced || !g || !to || !seen) {
        onExit(pick)
        return
      }
      flushSync(() => setGhostId(id))
      setPhase('leaving')
      g.getAnimations().forEach((x) => x.cancel())
      const a = g.animate(
        [
          { ...px(to), borderRadius: '8px', opacity: 1 },
          {
            left: '0px',
            top: '0px',
            width: `${w}px`,
            height: `${h}px`,
            borderRadius: '12px',
            opacity: 1
          }
        ],
        { duration: 230, easing: EASE, fill: 'forwards' }
      )
      a.onfinish = () => onExit(pick)
    },
    [activeId, onExit, reduced, setPhase, vp]
  )
  const leaveRef = useRef(leave)
  useLayoutEffect(() => {
    leaveRef.current = leave
  }, [leave])

  // The assistant opened something the person asked for: its tab is behind the board, so as soon as its card is
  // on the board it is brought into view and opened in the preview, live (Pop out makes it a tab on screen).
  const showTab = useRef<{ id: number; at: number } | null>(null)
  const showNowRef = useRef<() => void>(() => undefined)
  useEffect(
    () =>
      window.api.canvas.onShowTab((id) => {
        showTab.current = { id, at: Date.now() }
        showNowRef.current()
      }),
    []
  )
  // A page on the board opened a link in a new tab: its card goes beside the page's, joined by an arrow, and the
  // preview moves on to it
  const linkOpened = useRef<{ from: number; id: number; at: number } | null>(null)
  /** The board with the new page's card beside the page it came from, and an arrow between them. */
  const withLink = useCallback(
    (s0: CanvasState, link: { from: number; id: number }): CanvasState => {
      const src = s0.cards.find((c) => c.id === link.from)
      if (!src || !s0.cards.some((c) => c.id === link.id)) return s0
      // a little lower for each link already opened from the same page
      const n = connectorsOf(s0).filter(
        (k) => k.from.kind === 'card' && k.from.id === link.from
      ).length
      const at = { x: src.x + CARD_W * 1.5 + 72, y: src.y + CARD_H / 2 + n * (CARD_H + GAP) }
      const next = placeCard(s0, link.id, at)
      return (
        addConnector(next, { kind: 'card', id: link.from }, { kind: 'card', id: link.id })?.state ??
        next
      )
    },
    []
  )
  const linkNow = useCallback((): void => {
    const link = linkOpened.current
    const s0 = stRef.current
    if (!link || !s0 || Date.now() - link.at > 8000 || !s0.cards.some((c) => c.id === link.id))
      return
    linkOpened.current = null
    edit((cur) => withLink(cur, link), { flip: true })
    setSel(new Set([`c:${link.id}`]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withLink])
  useEffect(
    () =>
      window.api.canvas.onLinkOpened((from, id) => {
        linkOpened.current = { from, id, at: Date.now() }
        showTab.current = { id, at: Date.now() }
        linkNow() // its card may be on the board already (the tabs' update came first)
      }),
    [linkNow]
  )
  // Ctrl+Shift+K again (main sends the command to App, which tells us)
  useEffect(() => {
    const off = (e: Event): void => {
      const pick = (e as CustomEvent<{ pick?: number }>).detail?.pick
      leaveRef.current(typeof pick === 'number' ? pick : null)
    }
    window.addEventListener('panes:canvas-exit', off)
    return () => window.removeEventListener('panes:canvas-exit', off)
  }, [])

  // ---- keep up with the tabs ----
  const sig =
    allTabs
      .map((t) => `${t.id}|${t.private || t.tor ? 1 : 0}|${t.private || t.tor ? '' : t.url}`)
      .join(',') +
    // a tab taken over as a card's live page stops being a card of its own
    `#${Object.values(st?.items ?? {})
      .flatMap((it) => (it.tab !== undefined ? [it.tab] : []))
      .join(',')}`
  useEffect(() => {
    if (phaseRef.current === 'loading') return
    let added: number[] = []
    let placed: number | null = null
    edit((s) => {
      const r = syncTabs(s, lite())
      added = r.added
      const link = linkOpened.current
      if (link && Date.now() - link.at < 8000 && added.includes(link.id)) {
        linkOpened.current = null
        placed = link.id
        return withLink(r.state, link)
      }
      const want = placeNext.current
      if (want && Date.now() - want.t < 8000) {
        const id = added.find((i) => !r.state.cards.find((c) => c.id === i)?.private)
        if (id !== undefined) {
          placeNext.current = null
          if (showTab.current?.id === id) showTab.current = null
          placed = id
          return placeCard(r.state, id, want)
        }
      }
      return r.state.cards === s.cards && r.state.frames === s.frames && added.length === 0
        ? s
        : r.state
    })
    markFresh(added)
    if (placed !== null) setSel(new Set([`c:${placed}`]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, phase === 'loading'])

  // A tab that landed in Other is placed where its meaning says, once the index has read its page.
  useEffect(() => {
    if (phase === 'loading') return
    let busyNow = false
    const tick = async (): Promise<void> => {
      const s = stRef.current
      if (busyNow || !s || phaseRef.current === 'leaving') return
      const loose = s.cards.filter(
        (c) =>
          c.frame === OTHER_ID &&
          !c.manual &&
          !c.private &&
          /^https?:/i.test(c.url) &&
          (tries.current.get(`${c.id}|${c.url}`) ?? 0) < 4
      )
      if (loose.length === 0) return
      busyNow = true
      try {
        const frames: Record<string, number[]> = {}
        for (const f of s.frames) {
          if (f.kind === 'topic' || f.kind === 'user') {
            frames[f.id] = s.cards.filter((c) => c.frame === f.id).map((c) => c.id)
          }
        }
        for (const c of loose.slice(0, 3)) {
          const key = `${c.id}|${c.url}`
          const to = await window.api.canvas.assign(spaceId, c.id, frames)
          if (to && stRef.current?.frames.some((f) => f.id === to)) {
            markFresh([c.id])
            edit((cur) => moveToFrame(cur, c.id, to), { flip: true })
          } else tries.current.set(key, (tries.current.get(key) ?? 0) + 1)
        }
      } finally {
        busyNow = false
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 4000)
    return () => window.clearInterval(timer)
  }, [phase === 'loading', spaceId, edit])

  // ---- actions ----
  const toastNow = useCallback((text: string, undo?: () => void, label = 'Undo'): void => {
    setToast({ text, undo, label, key: Date.now() })
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 6500)
    return () => window.clearTimeout(t)
  }, [toast])
  // cut, copy, duplicate, paste (keys below; pasteAt and canPaste are also for the board menu)
  const boardClip = useBoardClip({
    spaceId,
    root,
    st,
    stRef,
    edit,
    record,
    selRef,
    setSel,
    byId,
    toastNow
  })

  const closeCards = useCallback(
    (all: number[]): void => {
      if (all.length === 0) return
      const ids = all.filter((i) => !isVirtual(i))
      const gone = all.filter(isVirtual)
      if (gone.length) edit((s) => removeVirtual(s, gone), { flip: true })
      if (ids.length === 0) {
        setSel(new Set())
        return
      }
      const undoable = ids.filter((i) => {
        const t = byId.get(i)
        return t && !t.private && !t.tor
      }).length
      for (const id of ids) window.api.closeTab(id)
      setSel(new Set())
      toastNow(
        ids.length === 1 ? 'Closed 1 tab' : `Closed ${ids.length} tabs`,
        undoable > 0 ? () => window.api.canvas.reopen(undoable) : undefined
      )
    },
    [byId, edit, setSel, toastNow]
  )

  const deleteLinks = useCallback(
    (ids: string[]): void => {
      const s = stRef.current
      if (!s || ids.length === 0) return
      const gone = connectorsOf(s).filter((c) => ids.includes(c.id))
      if (!edit((cur) => deleteConnectors(cur, ids))) return
      setSel(
        new Set([...selRef.current].filter((k) => !(k[0] === 'k' && ids.includes(k.slice(2)))))
      )
      toastNow(gone.length === 1 ? 'Deleted connector' : `Deleted ${gone.length} connectors`, () =>
        edit((cur) => {
          const have = new Set(connectorsOf(cur).map((c) => c.id))
          const back: CanvasConnector[] = gone.filter((c) => !have.has(c.id))
          return back.length ? { ...cur, connectors: [...connectorsOf(cur), ...back] } : cur
        })
      )
    },
    [edit, setSel, toastNow]
  )

  const deleteSelected = useCallback((): void => {
    const keys = [...selRef.current]
    const links = keys.filter((k) => k[0] === 'k').map((k) => k.slice(2))
    if (links.length) deleteLinks(links)
    const s0 = stRef.current
    // a deleted section takes its cards with it (their tabs close, as a deleted card's does)
    const frames = new Set(keys.filter((k) => k[0] === 'f').map((k) => k.slice(2)))
    const cards = [
      ...new Set([
        ...keys.filter((k) => k[0] === 'c').map((k) => Number(k.slice(2))),
        ...(s0?.cards ?? []).filter((c) => c.frame !== null && frames.has(c.frame)).map((c) => c.id)
      ])
    ]
    // frames, notes and drawings go as one step (locked drawings stay)
    const marks = keys
      .filter((k) => k[0] === 'm')
      .map((k) => k.slice(2))
      .filter((id) => !marksOf(s0 ?? emptyState()).find((m) => m.id === id)?.locked)
    const n = keys.filter((k) => k[0] === 'f' || k[0] === 'n').length + marks.length
    if (n > 0)
      edit(
        (s) => {
          let next = deleteMarks(s, marks)
          for (const k of keys) {
            if (k[0] === 'f') next = deleteFrame(next, k.slice(2))
            else if (k[0] === 'n') next = deleteNote(next, k.slice(2))
          }
          return next
        },
        { undo: n === 1 ? 'Deleted 1 item' : `Deleted ${n} items` }
      )
    if (cards.length) closeCards(cards)
    else setSel(new Set())
  }, [closeCards, deleteLinks, edit, setSel])

  const centerOn = (b: Box, k?: number): Viewport => {
    const { w, h } = size()
    const kk = k ?? vp.get().k
    return { k: kk, x: w / 2 - (b.x + b.w / 2) * kk, y: h / 2 - (b.y + b.h / 2) * kk }
  }
  const fitAll = (): void => {
    const s = stRef.current
    const { w, h } = size()
    if (s) vp.animateTo(fitView(boundsOf(contentBoxes(s)), w, h, 80, 1))
  }
  const fitSelection = (): void => {
    const s = stRef.current
    if (!s) return
    const boxes = [...selRef.current].flatMap((k) => {
      const r = parseKey(k)
      const b = r ? endBox(s, r.kind === 'card' ? r : { kind: r.kind, id: r.id }) : null
      return b ? [b] : []
    })
    const { w, h } = size()
    if (boxes.length) vp.animateTo(fitView(boundsOf(boxes), w, h, 120, 1.2))
  }
  /** Bring `b` into sight if it is not; returns the view the board ends at (it glides there). */
  const reveal = (b: Box): Viewport => {
    const { w, h } = size()
    const v = vp.get()
    const x = b.x * v.k + v.x
    const y = b.y * v.k + v.y
    if (x < 40 || y < 40 || x + b.w * v.k > w - 40 || y + b.h * v.k > h - 120) {
      const to = centerOn(b)
      vp.animateTo(to, 320)
      return to
    }
    return v
  }
  const stepZoom = (f: number): void => {
    const { w, h } = size()
    const v = vp.get()
    const k = clamp(v.k * f, MIN_K, MAX_K)
    const r = k / v.k
    vp.animateTo({ k, x: w / 2 - (w / 2 - v.x) * r, y: h / 2 - (h / 2 - v.y) * r }, 220)
  }

  const startRename = useCallback((id: string): void => setEditing(id), [])
  const onRename = useCallback(
    (id: string, name: string | null): void => {
      setEditing((cur) => (cur === id ? null : cur))
      if (name !== null) edit((s) => renameFrame(s, id, name), { undo: 'Renamed a section' })
    },
    [edit]
  )
  const onNoteSize = useCallback(
    (id: string, textH: number): void =>
      void edit((s0) => {
        const n = s0.notes.find((x) => x.id === id)
        if (!n) return s0
        const h = noteHeight(textH, n.minH)
        return Math.abs(h - n.h) < 1 ? s0 : patchNote(s0, id, { h })
      }),
    [edit]
  )
  const onNoteText = useCallback(
    (id: string, text: string | null): void => {
      setEditing((cur) => (cur === id ? null : cur))
      if (text !== null)
        edit((s) => patchNote(s, id, { text: text.slice(0, 600) }), { undo: 'Edited a note' })
    },
    [edit]
  )
  const onNoteColor = useCallback(
    (id: string): void =>
      void edit(
        (s) => ({
          ...s,
          notes: s.notes.map((n) =>
            n.id === id ? { ...n, color: (n.color + 1) % NOTE_COLORS } : n
          )
        }),
        { undo: 'Recoloured a note' }
      ),
    [edit]
  )

  // ---- drawings: what the selection bar and the keys do to the selected marks ----
  const selMarkIds = (): string[] => {
    const s0 = stRef.current
    const ids = [...selRef.current].filter((k) => k[0] === 'm').map((k) => k.slice(2))
    return s0 ? withGroups(s0, ids) : ids
  }
  const groupSel = useCallback(
    (on: boolean): void => {
      const ids = selMarkIds()
      if (on) edit((s0) => groupMarks(s0, ids)?.state ?? s0, { undo: 'Grouped' })
      else edit((s0) => ungroupMarks(s0, ids), { undo: 'Ungrouped' })
    },
    [edit]
  )
  const duplicateSel = useCallback((): void => {
    const s0 = stRef.current
    if (!s0) return
    const dup = duplicateMarks(s0, selMarkIds())
    if (edit(() => dup.state, { undo: 'Duplicated' })) setSel(new Set(dup.ids.map((i) => `m:${i}`)))
  }, [edit, setSel])
  const patchSel = (p: MarkPatch, label = 'Restyled'): void => {
    const ids = selMarkIds()
    edit((s0) => ids.reduce((n, id) => patchMark(n, id, p), s0), { undo: label })
  }
  /** A block, a heading or a body text in the middle of what is on screen, selected and (for text) being typed. */
  const addBlockAt = (
    kind: BlockKind | 'heading' | 'body',
    where?: { x: number; y: number }
  ): void => {
    const s0 = stRef.current
    if (!s0 || phaseRef.current !== 'open') return
    const v = vp.get()
    const at = where ?? {
      x: (size().w / 2 - v.x) / v.k - 150,
      y: (size().h * 0.42 - v.y) / v.k - 60
    }
    const made =
      kind === 'heading' || kind === 'body' ? addShape(s0, 'text', at, at) : addBlock(s0, kind, at)
    if (!made) return toastNow('The board has as many drawings as it can hold')
    let next = made.state
    if (kind === 'heading' || kind === 'body')
      next = patchMark(next, made.id, {
        size: TEXT_SIZES[kind],
        w: kind === 'heading' ? 360 : 280,
        h: kind === 'heading' ? 48 : 36
      })
    // into free space near the middle, never on top of what is there
    const m = marksOf(next).find((x) => x.id === made.id)!
    const spot = freeSpot({ w: m.w, h: m.h }, contentBoxes(s0), at, 24)
    next = patchMark(next, made.id, spot)
    edit(() => next, { undo: 'Added a block' })
    setSel(new Set([`m:${made.id}`]))
    if (kind !== 'table' && kind !== 'checklist') setMarkEdit(made.id)
    setToolBoth('select')
  }

  /** Start typing into the one selected shape, label or note (`key`: what was typed first). False when that is not what is selected. */
  const typeInto = (key: string | null): boolean => {
    const keys = [...selRef.current]
    const s0 = stRef.current
    if (keys.length !== 1 || !s0) return false
    const [k] = keys
    if (k[0] === 'n') {
      setFirstKey(key)
      setEditing(k.slice(2))
      return true
    }
    if (k[0] !== 'm') return false
    const m = marksOf(s0).find((x) => x.id === k.slice(2))
    if (!m || m.pts || m.locked || isBlock(m.kind)) return false
    setFirstKey(key)
    setMarkEdit(m.id)
    return true
  }

  // ---- keyboard ----
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.key === ' ' && !isEditable(e.target)) {
        spaceHeld.current = true
        root.current?.classList.add('hand')
        e.preventDefault()
        return
      }
      if (isEditable(e.target) || phaseRef.current !== 'open' || expandedRef.current) return
      const s = stRef.current
      if (!s) return
      const mod = e.ctrlKey || e.metaKey
      const sel1 = [...selRef.current]
      const selMarks = sel1.filter((k) => k[0] === 'm').map((k) => k.slice(2))
      const lastCard = (): number | null => {
        const c = sel1.filter((k) => k[0] === 'c').pop()
        return c ? Number(c.slice(2)) : activeId
      }
      const arrows: Record<string, 'left' | 'right' | 'up' | 'down'> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down'
      }
      if (e.key === 'Escape') {
        // Esc forgets a pending cut, then clears the selection or the tool; leaving the board is the Back to tabs
        // button's job
        if (getClip()?.mode === 'cut') dispatchClip({ type: 'escape' })
        else if (selRef.current.size > 0) setSel(new Set())
        else if (toolRef.current !== 'select') setToolBoth('select')
      } else if (arrows[e.key] && !mod && selMarks.length > 0) {
        // drawings selected: the arrows nudge them (Shift: 10), one undo step for a run of presses
        const d = e.shiftKey ? 10 : 1
        const dir = arrows[e.key]
        const dx = dir === 'left' ? -d : dir === 'right' ? d : 0
        const dy = dir === 'up' ? -d : dir === 'down' ? d : 0
        edit((s0) => moveMarks(s0, withGroups(s0, selMarks), dx, dy), {
          undo: 'Nudged',
          merge: true
        })
      } else if (arrows[e.key] && !mod && !e.shiftKey) {
        const boxes = s.cards.map((c) => ({ id: c.id, ...cardBox(c) }))
        const from = lastCard()
        const to = from === null ? (boxes[0]?.id ?? null) : nearestCard(boxes, from, arrows[e.key])
        const card = s.cards.find((c) => c.id === to)
        if (card) {
          setSel(new Set([`c:${card.id}`]))
          reveal(cardBox(card))
        }
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'w') {
        // Ctrl+W on the board closes the selected card's tab (with undo); nothing selected, nothing closes
        e.preventDefault()
        const cards = sel1.filter((k) => k[0] === 'c').map((k) => Number(k.slice(2)))
        if (cards.length) closeCards(cards)
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setQuick((q) => q ?? '')
      } else if ((e.key === '/' && !mod) || (mod && !e.shiftKey && e.key.toLowerCase() === 'k')) {
        setCmdOpen(true)
      } else if (!mod && !e.altKey && e.key.length === 1 && typeInto(e.key)) {
        // one shape, label or note selected: typing writes in it, the key is the first character
      } else if (e.key === 'Enter') {
        const cards = sel1.filter((k) => k[0] === 'c')
        if (typeInto(null)) return e.preventDefault()
        if (cards.length === 1) expandRef.current(Number(cards[0].slice(2)))
        else if (sel1.length === 1 && sel1[0][0] === 'f') startRename(sel1[0].slice(2))
      } else if (e.key === 'F2') {
        const f = sel1.find((k) => k[0] === 'f')?.slice(2)
        const c = sel1.find((k) => k[0] === 'c')
        const inFrame = c ? s.cards.find((x) => String(x.id) === c.slice(2))?.frame : null
        const id = f ?? inFrame
        if (id) startRename(id)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel1.length) deleteSelected()
      } else if (e.key === '+' || e.key === '=') stepZoom(1.25)
      else if (e.key === '-' || e.key === '_') stepZoom(0.8)
      else if (e.shiftKey && e.code === 'Digit1') fitAll()
      else if (e.shiftKey && e.code === 'Digit2') fitSelection()
      else if (mod && e.key.toLowerCase() === 'a') {
        setSel(
          new Set([
            ...s.cards.map((c) => `c:${c.id}`),
            ...s.notes.map((n) => `n:${n.id}`),
            ...marksOf(s).map((m) => `m:${m.id}`)
          ])
        )
      } else if (mod && e.key.toLowerCase() === 'g') {
        if (selMarks.length) groupSel(!e.shiftKey)
      } else if (!mod && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase()
        if (k === 'v') setToolBoth('select')
        else if (k === 'h') setToolBoth('hand')
        else if (k === 'f') setToolBoth('frame')
        else if (k === 'n' || k === 's') setToolBoth('note')
        else if (k === 'c') setToolBoth('connector')
        else if (k === 'l') setToolBoth('line')
        else if (k === 'p') setToolBoth('pen')
        else if (k === 'm') setToolBoth('marker')
        else if (k === 't') setToolBoth('text')
        else if (k === 'r') {
          setShapeKind('rounded')
          setToolBoth('shape')
        } else if (k === 'o') {
          setShapeKind('ellipse')
          setToolBoth('shape')
        } else if (k === 'x') {
          setShapeKind((cur) => SHAPE_KINDS[(SHAPE_KINDS.indexOf(cur) + 1) % SHAPE_KINDS.length])
          setToolBoth('shape')
        } else return
      } else if (!mod && !e.altKey && e.shiftKey && e.key.toLowerCase() === 't') {
        void runTidy(false)
      } else if (!mod && !e.altKey && e.shiftKey && e.key.toLowerCase() === 'm') {
        // everything playing on the board goes quiet (or, when nothing plays, what was muted comes back)
        window.api.muteSpace(spaceId)
      } else if (
        mod &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x')
      ) {
        // selected text keeps its own copy; Ctrl+V arrives as the paste event below
        if (window.getSelection()?.toString() || !boardClip.copy(e.key.toLowerCase() === 'x'))
          return
      } else if (mod && e.key.toLowerCase() === 'z') {
        const said = undo()
        toastNow(said ? `Undid: ${said}` : 'Nothing to undo')
      } else if (mod && e.key.toLowerCase() === 'd') {
        // the browser's Ctrl+D (bookmark) never applies on the board (main leaves it to the board)
        if (!boardClip.duplicate() && selMarks.length) duplicateSel()
      } else return
      e.preventDefault()
    }
    const up = (e: KeyboardEvent): void => {
      if (e.key === ' ') {
        spaceHeld.current = false
        root.current?.classList.remove('hand')
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, deleteSelected, runTidy, startRename, groupSel, duplicateSel])

  // ---- something new: Ctrl+T (main asks), and a link or text pasted onto the board ----
  const askNew = useCallback(
    (sx?: number, sy?: number): void => {
      const r = root.current?.getBoundingClientRect()
      if (!r || phaseRef.current !== 'open') return
      const x = sx ?? r.width / 2
      const y = sy ?? r.height * 0.42
      const v = vp.get()
      setNewAt({ sx: x, sy: y, wx: (x - v.x) / v.k, wy: (y - v.y) / v.k })
    },
    [root, vp]
  )
  useEffect(() => window.api.canvas.onNew(() => askNew()), [askNew])
  // a blank tab made some other way (the sidebar's New tab): the board asks what goes in it
  useEffect(() => {
    const ask = (): void => askNew()
    window.addEventListener('panes:canvas-new', ask)
    return () => window.removeEventListener('panes:canvas-new', ask)
  }, [askNew])
  /** A private or Tor window is on screen: nothing is kept or fetched for the board. */
  const privateNow = (): boolean => {
    const a = tabsRef.current.find((t) => t.id === activeId)
    return !!a && (a.private || a.tor)
  }
  /** Where the pointer last was on the board, else the middle of the view. */
  const pointOrMiddle = (): { x: number; y: number } => {
    const v = vp.get()
    const r = root.current?.getBoundingClientRect()
    return (
      lastPointer.current ?? {
        x: ((r?.width ?? 0) / 2 - v.x) / v.k,
        y: ((r?.height ?? 0) / 2 - v.y) / v.k
      }
    )
  }
  /**
   * Put what was pasted or dropped at `at` (board units), each thing as the card it should be: a picture or PDF as a
   * document (a copy is kept), a CSV as a table, source code as a code block, text as a note, a task list as a
   * checklist, an address as a link card that unfurls (no tab is made). One undo step for the lot.
   */
  const putAt = async (
    at: { x: number; y: number },
    files: Incoming[],
    text: string
  ): Promise<number> => {
    let p = { ...at }
    const step = (): { x: number; y: number } => {
      const q = p
      p = { x: p.x + 32, y: p.y + 32 }
      return q
    }
    type Put = (s0: CanvasState) => { state: CanvasState; key: string }
    const made: Put[] = []
    const card =
      (item: CanvasItem, q: { x: number; y: number }): Put =>
      (s0) => {
        const r = addLoose(s0, item, { point: q })
        return { state: r.state, key: `c:${r.id}` }
      }
    const block =
      (kind: BlockKind, t: string, q: { x: number; y: number }): Put =>
      (s0) => {
        const r = addBlock(s0, kind, q, t.slice(0, MARK_TEXT_MAX))
        if (!r) return { state: s0, key: '' }
        const m = marksOf(r.state).find((x) => x.id === r.id)!
        const spot = freeSpot({ w: m.w, h: m.h }, contentBoxes(s0), q, 24)
        return { state: patchMark(r.state, r.id, spot), key: `m:${r.id}` }
      }
    const note =
      (t: string, q: { x: number; y: number }): Put =>
      (s0) => {
        const n = addNote(s0, { x: q.x - 92, y: q.y - 66 }, s0.notes.length)
        return { state: patchNote(n.state, n.id, { text: t.slice(0, 600) }), key: `n:${n.id}` }
      }
    const fileUrl = (path: string): string => `file:///${encodeURI(path.replace(/\\/g, '/'))}`
    for (const f of files.slice(0, 12)) {
      const as = classifyFile(f.name, f.mime)
      if (!as || as === 'image' || as === 'pdf') {
        // a picture or PDF is shown from a kept copy (or the download itself); another file only as a link to it
        const kept = as || f.other ? await f.keep() : null
        if (!kept) {
          toastNow(
            !as
              ? `${f.name || 'That file'} cannot go on the board`
              : privateNow()
                ? 'Files are not kept in a private window'
                : `Could not keep ${f.name}`
          )
          continue
        }
        const url = fileUrl(kept.file)
        made.push(
          card(
            as
              ? { ...itemFor(url, kept.name, { kind: as }), file: kept.file, placement: 'document' }
              : { ...itemFor(url, kept.name, { kind: 'page' }), placement: 'document' },
            step()
          )
        )
        continue
      }
      const body = await f.read()
      if (as === 'table') made.push(block('table', tableText(csvRows(body).slice(0, 80)), step()))
      else if (as === 'code') made.push(block('code', body, step()))
      else
        made.push(
          card(
            {
              kind: 'answer',
              url: '',
              title: f.name,
              site: '',
              text: body,
              source: 'answer',
              placement: 'note'
            },
            step()
          )
        )
    }
    if (files.length === 0 && text.trim()) {
      const as = classifyPaste(text)
      if (as.kind === 'link') made.push(card(itemFor(as.url, '', { source: 'web' }), step()))
      else if (as.kind === 'note') made.push(note(as.text, step()))
      else made.push(block(as.kind, as.text, step()))
    }
    if (made.length === 0) return 0
    const keys: string[] = []
    edit(
      (s0) =>
        made.reduce((s1, fn) => {
          const r = fn(s1)
          if (r.key) keys.push(r.key)
          return r.state
        }, s0),
      { flip: true, undo: files.length ? 'Dropped onto the board' : 'Pasted' }
    )
    setSel(new Set(keys))
    const first = stRef.current?.cards.find((c) => `c:${c.id}` === keys[0])
    if (first) reveal(cardBox(first))
    return keys.length
  }
  /** A file dropped or pasted, as putAt takes it. */
  const incoming = (f: File): Incoming => ({
    name: f.name,
    mime: f.type,
    keep: () => (privateNow() ? Promise.resolve(null) : window.api.canvas.store(f)),
    read: () => f.text()
  })
  /** A download, from the download shelf's "Show in canvas" (main has checked the path is a finished download). */
  const putDownload = async (args: unknown): Promise<string> => {
    const a = (args ?? {}) as { file?: unknown; name?: unknown }
    if (typeof a.file !== 'string' || phaseRef.current === 'loading')
      return 'Error: the board is not ready.'
    const file = a.file
    const name = typeof a.name === 'string' && a.name ? a.name : (file.split(/[\\/]/).pop() ?? file)
    const n = await putAt(
      pointOrMiddle(),
      [
        {
          name,
          mime: '',
          other: true,
          keep: async () => ({ file, name }),
          read: async () => {
            const r = await window.api.canvas.bytes({ file })
            return r ? new TextDecoder().decode(r.data) : ''
          }
        }
      ],
      ''
    )
    return n ? 'Added.' : 'Error: that file could not go on the board.'
  }
  const putRef = useRef(putAt)
  const incomingRef = useRef(incoming)
  const putDownloadRef = useRef(putDownload)
  useLayoutEffect(() => {
    putRef.current = putAt
    incomingRef.current = incoming
    putDownloadRef.current = putDownload
  })
  useEffect(() => {
    const paste = (e: ClipboardEvent): void => {
      if (isEditable(e.target) || phaseRef.current !== 'open' || expandedRef.current) return
      const files = [...(e.clipboardData?.files ?? [])]
      const text = e.clipboardData?.getData('text/plain') ?? ''
      // cards held with Ctrl+C / Ctrl+X, or several addresses: see useBoardClip
      if (files.length === 0 && boardClip.onPaste(text, pointOrMiddle())) return e.preventDefault()
      if (files.length === 0 && !text.trim()) return
      e.preventDefault()
      void putRef.current(pointOrMiddle(), files.map(incomingRef.current), text)
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- wheel: pan, or zoom with Ctrl (a pinch arrives as Ctrl + wheel) ----
  useEffect(() => {
    const el = root.current
    if (!el) return
    const wheel = (e: WheelEvent): void => {
      if ((e.target as HTMLElement).closest('textarea,.cv-expand')) return
      e.preventDefault()
      e.stopPropagation() // App turns Ctrl + wheel into the tab stack
      if (phaseRef.current !== 'open') return
      vp.stop()
      const unit = e.deltaMode === 1 ? 16 : 1
      if (e.ctrlKey || e.metaKey) {
        if (rootRect.current.w === 0) measureRoot()
        const r = rootRect.current
        vp.zoomAt(
          Math.exp(-clamp(e.deltaY * unit, -40, 40) * 0.0095),
          e.clientX - r.left,
          e.clientY - r.top
        )
      } else {
        const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX
        const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY
        vp.panBy(-dx * unit, -dy * unit)
      }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [vp])

  // ---- pointer gestures ----
  const world = (cx: number, cy: number): { x: number; y: number; sx: number; sy: number } => {
    if (rootRect.current.w === 0) measureRoot()
    const r = rootRect.current
    const v = vp.get()
    const sx = cx - r.left
    const sy = cy - r.top
    return { x: (sx - v.x) / v.k, y: (sy - v.y) / v.k, sx, sy }
  }

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (phaseRef.current !== 'open' || e.button === 2) return
    // the board may have moved without resizing (top bar, sidebar): once per gesture, before anything moves
    measureRoot()
    const t = e.target as HTMLElement
    if (
      t.closest(
        '.cv-bar,.cv-toast,.cv-confirm,.cv-expand,.cv-top,.cv-new,.cv-fbar,.cv-dock,.cv-dock-handle,.cv-playing,.cv-ctx,button,input,textarea,a[href]'
      )
    )
      return
    const s = stRef.current
    if (!s) return
    vp.stop()
    const w = world(e.clientX, e.clientY)
    // the split view's label is its handle: it lifts the split view's cards
    const cardEl =
      t.closest<HTMLElement>('[data-cid]') ??
      (t.closest('[data-splithead]') && splitRef.current.length
        ? root.current!.querySelector<HTMLElement>(`[data-cid="${splitRef.current[0]}"]`)
        : null)
    const headEl = t.closest<HTMLElement>('[data-fhead]')
    const noteEl = t.closest<HTMLElement>('[data-nid]')
    const handleEl = (t as Element).closest?.('[data-handle]') as SVGElement | null
    const kendEl = (t as Element).closest?.('[data-kend]') as SVGElement | null
    const linkEl = (t as Element).closest?.('[data-kid]') as HTMLElement | SVGElement | null
    const pan = e.button === 1 || toolRef.current === 'hand' || spaceHeld.current
    const base = e.shiftKey ? new Set(selRef.current) : new Set<string>()
    // a section moves by its fill as well as its title (Shift-drag inside one draws a selection box instead)
    const bodyFrame =
      !e.shiftKey && !e.altKey && toolRef.current === 'select' && !cardEl && !noteEl && !headEl
        ? frameAt(s, w.x, w.y)
        : null
    const connect = (
      fixed: End,
      which: 'from' | 'to',
      existing: string | null,
      line = false
    ): void => {
      e.preventDefault()
      conn.current?.hover(null)
      const gg: Gesture = {
        kind: 'connect',
        fixed,
        which,
        existing,
        sx: e.clientX,
        sy: e.clientY,
        moved: false,
        end: null,
        line
      }
      gesture.current = gg
      root.current!.setPointerCapture(e.pointerId)
      const move = (ev: PointerEvent): void => onGestureMove(ev)
      const end = (ev: PointerEvent): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        onGestureEnd(ev)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    }
    const crzEl = t.closest<HTMLElement>('[data-crz]')
    if (!pan && crzEl) {
      const cid = Number(crzEl.dataset.crzc)
      const c = s.cards.find((x) => x.id === cid)
      if (c) {
        e.preventDefault()
        e.stopPropagation()
        const box = cardBox(c)
        gesture.current = {
          kind: 'cresize',
          id: c.id,
          dir: crzEl.dataset.crz ?? 'se',
          start: box,
          sx: e.clientX,
          sy: e.clientY,
          el: root.current!.querySelector<HTMLElement>(`[data-cid="${c.id}"]`),
          box
        }
        root.current!.setPointerCapture(e.pointerId)
        root.current!.classList.add('resizing')
        const move = (ev: PointerEvent): void => onGestureMove(ev)
        const end = (ev: PointerEvent): void => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', end)
          window.removeEventListener('pointercancel', end)
          onGestureEnd(ev)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', end)
        window.addEventListener('pointercancel', end)
        return
      }
    }
    const nrzEl = t.closest<HTMLElement>('[data-nrz]')
    if (!pan && nrzEl) {
      const n = s.notes.find((x) => x.id === nrzEl.dataset.nrzn)
      if (n) {
        e.preventDefault()
        e.stopPropagation()
        gesture.current = {
          kind: 'nresize',
          id: n.id,
          dir: nrzEl.dataset.nrz ?? 'se',
          start: { x: n.x, y: n.y, w: n.w, h: n.h },
          sx: e.clientX,
          sy: e.clientY,
          el: root.current!.querySelector<HTMLElement>(`[data-nid="${n.id}"]`),
          w: n.w,
          h: null
        }
        root.current!.setPointerCapture(e.pointerId)
        root.current!.classList.add('resizing')
        const move = (ev: PointerEvent): void => onGestureMove(ev)
        const end = (ev: PointerEvent): void => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', end)
          window.removeEventListener('pointercancel', end)
          onGestureEnd(ev)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', end)
        window.addEventListener('pointercancel', end)
        return
      }
    }
    const rzEl = t.closest<HTMLElement>('[data-rz]')
    if (!pan && rzEl) {
      const f = s.frames.find((x) => x.id === rzEl.dataset.rzf)
      if (f) {
        e.preventDefault()
        const box = { x: f.x, y: f.y, w: f.w, h: f.h }
        gesture.current = {
          kind: 'resize',
          id: f.id,
          dir: rzEl.dataset.rz ?? 'se',
          start: box,
          sx: e.clientX,
          sy: e.clientY,
          el: root.current!.querySelector<HTMLElement>(`[data-fid="${f.id}"]`),
          box
        }
        root.current!.setPointerCapture(e.pointerId)
        root.current!.classList.add('resizing')
        const move = (ev: PointerEvent): void => onGestureMove(ev)
        const end = (ev: PointerEvent): void => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', end)
          window.removeEventListener('pointercancel', end)
          onGestureEnd(ev)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', end)
        window.addEventListener('pointercancel', end)
        return
      }
    }
    if (!pan && handleEl) {
      const d = handleEl.dataset
      const from: End | null =
        d.hkind === 'card'
          ? { kind: 'card', id: Number(d.hid) }
          : d.hkind === 'note' || d.hkind === 'frame' || d.hkind === 'mark'
            ? { kind: d.hkind, id: d.hid ?? '' }
            : null
      if (from) return connect(from, 'to', null)
    }
    if (!pan && kendEl) {
      const id = kendEl.dataset.kid ?? ''
      const c = connectorsOf(s).find((x) => x.id === id)
      const which = kendEl.dataset.kend === 'from' ? 'from' : 'to'
      if (c) return connect(which === 'from' ? c.to : c.from, which, id)
    }
    if (!pan && (toolRef.current === 'connector' || toolRef.current === 'line')) {
      return connect(
        objectAt(s, w) ?? { kind: 'point', x: w.x, y: w.y },
        'to',
        null,
        toolRef.current === 'line'
      )
    }
    if (!pan && linkEl && !cardEl && !noteEl && !headEl) {
      const key = `k:${linkEl.dataset.kid}`
      if (e.shiftKey) {
        const next = new Set(selRef.current)
        if (!next.delete(key)) next.add(key)
        setSel(next)
      } else setSel(new Set([key]))
      return
    }
    // ---- drawing tools and drawn marks ----
    const beginG = (gg: Gesture): void => {
      gesture.current = gg
      root.current!.setPointerCapture(e.pointerId)
      const move = (ev: PointerEvent): void => onGestureMove(ev)
      const end = (ev: PointerEvent): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        onGestureEnd(ev)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    }
    const tl = toolRef.current
    const grip = t.closest<SVGElement>('[data-mh]')
    if (!pan && grip) {
      const m = marksOf(s).find((x) => x.id === grip.dataset.mid)
      if (m && !m.locked) {
        beginG({
          kind: 'markop',
          op: grip.dataset.mh === 'rotate' ? 'rotate' : 'resize',
          id: m.id,
          sx: e.clientX,
          sy: e.clientY,
          start: m,
          moved: false
        })
        return
      }
    }
    if (!pan && (tl === 'pen' || tl === 'marker')) {
      beginG({ kind: 'stroke', pen: tl, pts: [w.x, w.y] })
      return
    }
    if (!pan && tl === 'shape') {
      beginG({ kind: 'shape', shape: shapeKindRef.current, x0: w.x, y0: w.y })
      return
    }
    if (!pan && tl === 'text') {
      e.preventDefault()
      const made = addShape(s, 'text', { x: w.x, y: w.y }, { x: w.x, y: w.y })
      if (made) {
        pushUndo('Added text')
        edit(() => made.state)
        setSel(new Set([`m:${made.id}`]))
        setMarkEdit(made.id)
      }
      setToolBoth('select')
      return
    }
    // drawings are above cards and notes: one under the pointer is picked first, with its group
    if (!pan && tl === 'select' && !headEl && !linkEl) {
      const mk = markAt(s, w.x, w.y, 6 / vp.get().k)
      if (mk) {
        e.preventDefault()
        const mine = withGroups(s, [mk.id]).map((id) => `m:${id}`)
        const had = selRef.current.has(`m:${mk.id}`)
        let next: Set<string>
        if (e.shiftKey) {
          next = new Set(selRef.current)
          for (const k of mine)
            if (had) next.delete(k)
            else next.add(k)
        } else next = had ? new Set(selRef.current) : new Set(mine)
        setSel(next)
        if (mk.locked || (e.shiftKey && had)) return
        const ids = [...next].filter((k) => k[0] === 'm').map((k) => k.slice(2))
        const movable = ids.filter((id) => !marksOf(s).find((m) => m.id === id)?.locked)
        // drawings in a selection with cards or notes: the whole selection moves together, as from a card
        const selCards = [...next].filter((k) => k[0] === 'c').map((k) => Number(k.slice(2)))
        const selNotes = [...next].filter((k) => k[0] === 'n').map((k) => k.slice(2))
        if (!e.altKey && (selCards.length || selNotes.length)) {
          beginG({
            kind: 'item',
            what: selCards.length ? 'card' : 'note',
            id: selCards.length ? String(selCards[0]) : selNotes[0],
            cards: selCards,
            notes: selCards.length ? selNotes : selNotes.slice(1),
            marks: withGroups(s, movable),
            sx: e.clientX,
            sy: e.clientY,
            shift: false,
            moved: false,
            items: [],
            target: null,
            ldx: 0,
            ldy: 0
          })
          return
        }
        beginG({
          kind: 'marks',
          ids: movable,
          sx: e.clientX,
          sy: e.clientY,
          moved: false,
          copy: e.altKey,
          els: [],
          ldx: 0,
          ldy: 0
        })
        return
      }
    }
    let g: Gesture
    if (pan) {
      g = {
        kind: 'pan',
        samples: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }],
        lx: e.clientX,
        ly: e.clientY
      }
      root.current!.classList.add('grabbing')
      root.current!.setPointerCapture(e.pointerId)
    } else if (cardEl || headEl || noteEl || bodyFrame) {
      const what = cardEl ? 'card' : headEl || (!noteEl && bodyFrame) ? 'frame' : 'note'
      const id =
        cardEl?.dataset.cid ?? headEl?.dataset.fhead ?? noteEl?.dataset.nid ?? bodyFrame?.id ?? ''
      const key = `${what[0]}:${id}`
      const inSplit = what === 'card' && splitRef.current.includes(Number(id))
      // a thing in a selection of several takes all of it along: cards, notes, drawings, moved as one
      const bulk = selRef.current.has(key) && selRef.current.size > 1 && !inSplit && what !== 'frame'
      const picked = (p: string): string[] =>
        [...selRef.current].filter((k) => k[0] === p).map((k) => k.slice(2))
      const group = bulk
        ? picked('c').map(Number)
        : inSplit
          ? [...splitRef.current]
          : what === 'card'
            ? [Number(id)]
            : []
      g = {
        kind: 'item',
        what,
        id,
        cards: group,
        notes: bulk ? picked('n').filter((n) => what !== 'note' || n !== id) : [],
        marks: bulk ? withGroups(s, picked('m')) : [],
        sx: e.clientX,
        sy: e.clientY,
        shift: e.shiftKey,
        moved: false,
        items: [],
        target: null,
        ldx: 0,
        ldy: 0
      }
    } else if (toolRef.current === 'frame' || e.altKey) {
      g = { kind: 'draw', wx: w.x, wy: w.y }
      root.current!.setPointerCapture(e.pointerId)
    } else if (toolRef.current === 'note') {
      e.preventDefault() // the click must not move focus off the note about to be written
      const r = addNote(stRef.current!, { x: w.x - 92, y: w.y - 66 }, stRef.current!.notes.length)
      edit(() => r.state, { undo: 'Added a note' })
      setSel(new Set([`n:${r.id}`]))
      setEditing(r.id)
      setToolBoth('select')
      return
    } else {
      g = { kind: 'marquee', x0: w.sx, y0: w.sy, base }
      if (!e.shiftKey) setSel(new Set())
      root.current!.setPointerCapture(e.pointerId)
    }
    gesture.current = g
    const move = (ev: PointerEvent): void => onGestureMove(ev)
    const end = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      onGestureEnd(ev)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const onGestureMove = (e: PointerEvent): void => {
    const g = gesture.current
    const s = stRef.current
    if (!g || !s) return
    const v = vp.get()
    if (g.kind === 'stroke') {
      const w = world(e.clientX, e.clientY)
      const last = g.pts.length
      if (Math.hypot(w.x - g.pts[last - 2], w.y - g.pts[last - 1]) >= 1.5 / v.k)
        g.pts.push(w.x, w.y)
      if (draft.current) {
        let d = `M${g.pts[0]} ${g.pts[1]}`
        for (let i = 2; i < g.pts.length; i += 2) d += `L${g.pts[i]} ${g.pts[i + 1]}`
        draft.current.setAttribute('d', d)
        draft.current.style.strokeWidth = g.pen === 'marker' ? '14' : '3'
      }
    } else if (g.kind === 'shape') {
      const w = world(e.clientX, e.clientY)
      if (draft.current) {
        draft.current.style.strokeWidth = '2'
        draft.current.setAttribute('d', `M${g.x0} ${g.y0}H${w.x}V${w.y}H${g.x0}Z`)
      }
    } else if (g.kind === 'marks') {
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_PX) return
      if (!g.moved) {
        g.moved = true
        const want = new Set(g.ids)
        g.els = [
          ...root.current!.querySelectorAll<SVGElement>('.cv-marks [data-mid]:not([data-mh])')
        ].filter((el) => want.has(el.dataset.mid ?? ''))
        root.current!.classList.add('dragging')
      }
      let dx = (e.clientX - g.sx) / v.k
      let dy = (e.clientY - g.sy) / v.k
      // Shift: line up with what is around (edges and middles), else with the grid
      const sn = e.shiftKey ? snapMarks(s, g.ids, dx, dy, v.k) : null
      if (sn) {
        dx += sn.dx
        dy += sn.dy
      }
      drawGuides(sn)
      g.ldx = dx
      g.ldy = dy
      for (const el of g.els) el.style.translate = `${dx}px ${dy}px`
      if (!g.copy) conn.current?.drag(new Map(g.ids.map((id) => [`m${id}`, { x: dx, y: dy }])))
    } else if (g.kind === 'markop') {
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_PX) return
      if (!g.moved) {
        g.moved = true
        pushUndo('Changed a drawing')
      }
      const dx = (e.clientX - g.sx) / v.k
      const dy = (e.clientY - g.sy) / v.k
      const m = g.start
      if (g.op === 'resize') {
        let w2 = m.w + dx
        let h2 = isBlock(m.kind) || m.kind === 'text' ? m.h : m.h + dy
        if (e.shiftKey && m.w > 0 && m.h > 0 && !isBlock(m.kind) && m.kind !== 'text') {
          const r = m.w / m.h
          if (Math.abs(dx) > Math.abs(dy)) h2 = w2 / r
          else w2 = h2 * r
        }
        // a text label resized by hand wraps at its new width from then on
        edit((st) =>
          patchMark(st, g.id, m.kind === 'text' ? { w: w2, wrap: true } : { w: w2, h: h2 })
        )
      } else {
        const r = rootRect.current
        const cx = (m.x + m.w / 2) * v.k + v.x + r.left
        const cy = (m.y + m.h / 2) * v.k + v.y + r.top
        let deg = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90
        if (e.shiftKey) deg = Math.round(deg / 15) * 15
        edit((st) => patchMark(st, g.id, { rot: deg }))
      }
    } else if (g.kind === 'pan') {
      vp.panBy(e.clientX - g.lx, e.clientY - g.ly)
      g.lx = e.clientX
      g.ly = e.clientY
      const now = e.timeStamp
      g.samples.push({ t: now, x: e.clientX, y: e.clientY })
      while (g.samples.length > 2 && now - g.samples[0].t > 90) g.samples.shift()
    } else if (g.kind === 'marquee') {
      const w = world(e.clientX, e.clientY)
      const x = Math.min(g.x0, w.sx)
      const y = Math.min(g.y0, w.sy)
      const el = marquee.current
      if (el) {
        el.style.display = 'block'
        el.style.transform = `translate(${x}px, ${y}px)`
        el.style.width = `${Math.abs(w.sx - g.x0)}px`
        el.style.height = `${Math.abs(w.sy - g.y0)}px`
      }
      const box: Box = {
        x: (x - v.x) / v.k,
        y: (y - v.y) / v.k,
        w: Math.abs(w.sx - g.x0) / v.k,
        h: Math.abs(w.sy - g.y0) / v.k
      }
      const next = new Set(g.base)
      for (const c of s.cards) if (hit(box, cardBox(c))) next.add(`c:${c.id}`)
      for (const n of s.notes) if (hit(box, n)) next.add(`n:${n.id}`)
      for (const m of marksOf(s)) if (hit(box, markBox(m))) next.add(`m:${m.id}`)
      const cur = selRef.current
      if (next.size !== cur.size || [...next].some((k) => !cur.has(k))) setSel(next)
    } else if (g.kind === 'connect') {
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_PX) return
      g.moved = true
      const w = world(e.clientX, e.clientY)
      const target = objectAt(s, w, { skip: endKey(g.fixed) })
      let p = { x: w.x, y: w.y }
      if (!target && e.shiftKey) {
        const fb = g.fixed.kind === 'point' ? null : endBox(s, g.fixed)
        const from = g.fixed.kind === 'point' ? g.fixed : fb ? centerOf(fb) : p
        p = snapAngle(from, p)
      }
      g.end = target ?? { kind: 'point', x: p.x, y: p.y }
      conn.current?.draft({
        from: g.which === 'to' ? g.fixed : g.end,
        to: g.which === 'to' ? g.end : g.fixed,
        target,
        hide: g.existing
      })
    } else if (g.kind === 'cresize') {
      const dx = (e.clientX - g.sx) / v.k
      const dy = (e.clientY - g.sy) / v.k
      const b = g.start
      let x0 = b.x
      let y0 = b.y
      let x1 = b.x + b.w
      let y1 = b.y + b.h
      if (g.dir.includes('w')) x0 = Math.max(x1 - CARD_MAX_W, Math.min(x1 - CARD_MIN_W, x0 + dx))
      if (g.dir.includes('e')) x1 = Math.min(x0 + CARD_MAX_W, Math.max(x0 + CARD_MIN_W, x1 + dx))
      if (g.dir.includes('n')) y0 = Math.max(y1 - CARD_MAX_H, Math.min(y1 - CARD_MIN_H, y0 + dy))
      if (g.dir.includes('s')) y1 = Math.min(y0 + CARD_MAX_H, Math.max(y0 + CARD_MIN_H, y1 + dy))
      let box: Box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
      if (e.shiftKey && g.dir.length === 2) {
        const anchor = {
          x: g.dir.includes('w') ? b.x + b.w : b.x,
          y: g.dir.includes('n') ? b.y + b.h : b.y
        }
        box = keepAspect(b, box, anchor)
      }
      g.box = box
      if (g.el) {
        g.el.style.transform = `translate3d(${box.x}px, ${box.y}px, 0)`
        g.el.style.width = `${box.w}px`
        g.el.style.height = `${box.h}px`
      }
    } else if (g.kind === 'nresize') {
      const dx = (e.clientX - g.sx) / v.k
      const dy = (e.clientY - g.sy) / v.k
      if (g.dir.includes('e')) g.w = Math.min(NOTE_MAX_W, Math.max(NOTE_MIN_W, g.start.w + dx))
      if (g.dir.includes('s')) g.h = Math.max(NOTE_MIN_H, g.start.h + dy)
      if (e.shiftKey && g.dir === 'se') g.h = (g.w * g.start.h) / g.start.w
      if (g.el) {
        g.el.style.width = `${g.w}px`
        if (g.h !== null) g.el.style.height = `${g.h}px`
      }
    } else if (g.kind === 'resize') {
      const dx = (e.clientX - g.sx) / v.k
      const dy = (e.clientY - g.sy) / v.k
      const b = g.start
      let x0 = b.x
      let y0 = b.y
      let x1 = b.x + b.w
      let y1 = b.y + b.h
      if (g.dir.includes('w')) x0 = Math.min(x1 - 200, x0 + dx)
      if (g.dir.includes('e')) x1 = Math.max(x0 + 200, x1 + dx)
      if (g.dir.includes('n')) y0 = Math.min(y1 - 120, y0 + dy)
      if (g.dir.includes('s')) y1 = Math.max(y0 + 120, y1 + dy)
      let box: Box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
      if (e.shiftKey && g.dir.length === 2) {
        const anchor = {
          x: g.dir.includes('w') ? b.x + b.w : b.x,
          y: g.dir.includes('n') ? b.y + b.h : b.y
        }
        box = keepAspect(b, box, anchor)
      }
      g.box = box
      if (g.el) {
        g.el.style.transform = `translate3d(${box.x}px, ${box.y}px, 0)`
        g.el.style.width = `${box.w}px`
        g.el.style.height = `${box.h}px`
      }
    } else if (g.kind === 'draw') {
      const w = world(e.clientX, e.clientY)
      const el = drawBox.current
      if (el) {
        const x0 = g.wx * v.k + v.x
        const y0 = g.wy * v.k + v.y
        el.style.display = 'block'
        el.style.transform = `translate(${Math.min(x0, w.sx)}px, ${Math.min(y0, w.sy)}px)`
        el.style.width = `${Math.abs(w.sx - x0)}px`
        el.style.height = `${Math.abs(w.sy - y0)}px`
      }
    } else {
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_PX) return
      if (!g.moved) {
        g.moved = true
        root.current!.setPointerCapture(e.pointerId)
        const key = `${g.what[0]}:${g.id}`
        const asGroup =
          g.what === 'card' &&
          g.cards.length > 1 &&
          g.cards.every((c) => splitRef.current.includes(c))
        if (asGroup) setSel(new Set(g.cards.map((c) => `c:${c}`)))
        else if (g.what === 'card' && !selRef.current.has(key)) {
          setSel(new Set([key]))
          g.cards = [Number(g.id)]
        } else if (g.what !== 'card' && !selRef.current.has(key)) setSel(new Set([key]))
        const want: string[] = []
        if (g.what === 'card') for (const id of g.cards) want.push(`[data-cid="${id}"]`)
        if (asGroup) want.push('[data-splitbox]')
        else if (g.what === 'frame') {
          want.push(`[data-fid="${g.id}"]`)
          for (const c of s.cards) if (c.frame === g.id) want.push(`[data-cid="${c.id}"]`)
          for (const n of s.notes) if (n.frame === g.id) want.push(`[data-nid="${n.id}"]`)
        } else want.push(`[data-nid="${g.id}"]`)
        if (g.what === 'note') for (const id of g.cards) want.push(`[data-cid="${id}"]`)
        for (const n of g.notes ?? []) want.push(`[data-nid="${n}"]`)
        for (const m of g.marks ?? []) want.push(`.cv-marks [data-mid="${m}"]:not([data-mh])`)
        // a split view whose cards all move (a section dragged, or a selection taking them) goes with them
        const moving = new Set(
          g.what === 'frame' ? s.cards.filter((c) => c.frame === g.id).map((c) => c.id) : g.cards
        )
        if (
          !asGroup &&
          splitRef.current.length >= 2 &&
          splitRef.current.every((id) => moving.has(id))
        )
          want.push('[data-splitbox]')
        g.items = [...root.current!.querySelectorAll<HTMLElement>(want.join(','))].map((el) => ({
          key:
            keyOf(el) ??
            (el.dataset.splitbox !== undefined
              ? 'split'
              : el.dataset.mid !== undefined
                ? `m${el.dataset.mid}`
                : `n${el.dataset.nid}`),
          el
        }))
        for (const it of g.items) it.el.classList.add('lifted')
        root.current!.classList.add('dragging')
        shutBar()
      }
      let dx = (e.clientX - g.sx) / v.k
      let dy = (e.clientY - g.sy) / v.k
      // Shift: line up with what is around (edges and middles), else with the grid
      const sn = e.shiftKey ? snapMove(s, g, dx, dy, v.k) : null
      if (sn) {
        dx += sn.dx
        dy += sn.dy
      }
      drawGuides(sn)
      g.ldx = dx
      g.ldy = dy
      for (const it of g.items) it.el.style.translate = `${dx}px ${dy}px`
      conn.current?.drag(new Map(g.items.map((it) => [it.key, { x: dx, y: dy }])))
      if (
        g.what === 'card' &&
        g.cards.length === 1 &&
        !g.notes?.length &&
        !g.marks?.length &&
        !splitRef.current.includes(g.cards[0])
      ) {
        // dropped on another page: the two join in split view, on that half of it
        const w0 = world(e.clientX, e.clientY)
        const over = objectAt(s, w0, { skip: `c${g.cards[0]}` })
        const oc = over?.kind === 'card' ? s.cards.find((c) => c.id === over.id) : undefined
        const edge =
          oc && !oc.private && canTab(g.cards[0]) && canTab(oc.id) ? splitEdge(oc, w0) : null
        const next = oc && edge ? { id: oc.id, edge } : null
        if (next?.id !== g.splitTo?.id || next?.edge !== g.splitTo?.edge) {
          root.current
            ?.querySelectorAll('.split-into')
            .forEach((n) => n.classList.remove('split-into'))
          if (next)
            root.current?.querySelector(`[data-cid="${next.id}"]`)?.classList.add('split-into')
          g.splitTo = next
        }
      }
      if (g.what === 'card' && !g.splitTo) {
        const w = world(e.clientX, e.clientY)
        const f = frameAt(s, w.x, w.y)
        const priv = byId.get(g.cards[0])?.private || byId.get(g.cards[0])?.tor
        const ok = f && (f.kind === 'private') === !!priv ? f.id : null
        if (ok !== g.target) {
          if (g.target)
            root.current?.querySelector(`[data-fid="${g.target}"]`)?.classList.remove('drop')
          if (ok) root.current?.querySelector(`[data-fid="${ok}"]`)?.classList.add('drop')
          g.target = ok
        }
      }
    }
  }

  const onGestureEnd = (e: PointerEvent): void => {
    const g = gesture.current
    gesture.current = null
    const el = root.current
    if (!g || !el) return
    el.classList.remove('grabbing', 'dragging')
    if (g.kind === 'stroke') {
      draft.current?.setAttribute('d', '')
      const made = addStroke(stRef.current!, g.pen, g.pts, g.pen === 'marker' ? 4 : 0)
      if (made) {
        pushUndo(g.pen === 'marker' ? 'Highlighted' : 'Drew a line')
        edit(() => made.state)
      }
    } else if (g.kind === 'shape') {
      draft.current?.setAttribute('d', '')
      const w = world(e.clientX, e.clientY)
      const made = addShape(
        stRef.current!,
        g.shape,
        { x: g.x0, y: g.y0 },
        { x: w.x, y: w.y },
        { square: e.shiftKey }
      )
      if (made) {
        pushUndo('Drew a shape')
        edit(() => made.state)
        setSel(new Set([`m:${made.id}`]))
        setToolBoth('select')
      }
    } else if (g.kind === 'marks') {
      el.classList.remove('dragging')
      if (!g.moved) return
      drawGuides(null)
      conn.current?.drag(null)
      for (const m of g.els) m.style.translate = ''
      const dx = g.ldx
      const dy = g.ldy
      if (g.copy) {
        const dup = duplicateMarks(stRef.current!, g.ids, 0)
        if (edit(() => moveMarks(dup.state, dup.ids, dx, dy), { undo: 'Duplicated' }))
          setSel(new Set(dup.ids.map((i) => `m:${i}`)))
      } else
        edit((s0) => moveMarks(s0, g.ids, dx, dy), {
          undo: g.ids.length === 1 ? 'Moved a drawing' : `Moved ${g.ids.length} drawings`
        })
    } else if (g.kind === 'markop') {
      // already applied while dragging
    } else if (g.kind === 'pan') {
      const a = g.samples[0]
      const b = g.samples[g.samples.length - 1]
      const dt = b.t - a.t
      if (dt > 8 && e.timeStamp - b.t < 80) vp.fling((b.x - a.x) / dt, (b.y - a.y) / dt)
    } else if (g.kind === 'marquee') {
      if (marquee.current) marquee.current.style.display = 'none'
    } else if (g.kind === 'cresize') {
      el.classList.remove('resizing')
      const box = g.box
      // a click on the edge, not a drag: the card takes its natural size (a video its video's shape)
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_PX) {
        fitCardSize(g.id)
        setSel(new Set([`c:${g.id}`]))
      } else if (!edit((s) => resizeCard(s, g.id, box), { undo: 'Resized a card' }) && g.el) {
        const c = stRef.current?.cards.find((x) => x.id === g.id)
        if (c) {
          const cb = cardBox(c)
          g.el.style.transform = `translate3d(${cb.x}px, ${cb.y}px, 0)`
          g.el.style.width = `${cb.w}px`
          g.el.style.height = `${cb.h}px`
        }
      }
      setSel(new Set([`c:${g.id}`]))
    } else if (g.kind === 'nresize') {
      el.classList.remove('resizing')
      const w = g.w
      const h = g.h
      edit((s) => resizeNote(s, g.id, h === null ? { w } : { w, h }), { undo: 'Resized a note' })
      // the size the board now has, set here: clearing it and leaving it to React left a note with no width at all
      // (one character wide) whenever the size came out the same and React had nothing to change
      const n = stRef.current?.notes.find((x) => x.id === g.id)
      if (g.el && n) {
        g.el.style.width = `${n.w}px`
        g.el.style.height = `${n.h}px`
      }
      setSel(new Set([`n:${g.id}`]))
    } else if (g.kind === 'resize') {
      el.classList.remove('resizing')
      const box = g.box
      if (!edit((s) => resizeFrame(s, g.id, box), { undo: 'Resized a section' }) && g.el) {
        const f = stRef.current?.frames.find((x) => x.id === g.id)
        if (f) {
          g.el.style.transform = `translate3d(${f.x}px, ${f.y}px, 0)`
          g.el.style.width = `${f.w}px`
          g.el.style.height = `${f.h}px`
        }
      }
    } else if (g.kind === 'connect') {
      conn.current?.draft(null)
      if (g.existing) {
        const id = g.existing
        if (g.moved && g.end)
          edit((s) => setConnectorEnd(s, id, g.which, g.end!), { undo: 'Moved an arrow' })
        setSel(new Set([`k:${id}`]))
        return
      }
      if (!g.moved || !g.end) return
      const r = addConnector(
        stRef.current!,
        g.fixed,
        g.end,
        g.line ? { shape: 'straight', heads: 'none' } : linkStyleRef.current
      )
      if (r) {
        edit(() => r.state, { undo: g.line ? 'Drew a line' : 'Drew an arrow' })
        setFreshLink(r.id)
        setSel(new Set([`k:${r.id}`]))
      }
      if (toolRef.current === 'connector' || toolRef.current === 'line') setToolBoth('select')
    } else if (g.kind === 'draw') {
      if (drawBox.current) drawBox.current.style.display = 'none'
      const w = world(e.clientX, e.clientY)
      const box: Box = {
        x: Math.min(g.wx, w.x),
        y: Math.min(g.wy, w.y),
        w: Math.abs(w.x - g.wx),
        h: Math.abs(w.y - g.wy)
      }
      if (box.w > 60 && box.h > 60) {
        const r = addFrame(stRef.current!, box, 'Frame', true)
        flushSync(() => edit(() => r.state, { flip: true, undo: 'Made a section' }))
        setSel(new Set([`f:${r.id}`]))
        setEditing(r.id)
      }
      setToolBoth('select')
    } else {
      const key = `${g.what[0]}:${g.id}`
      if (!g.moved) {
        if (g.shift) {
          const next = new Set(selRef.current)
          if (!next.delete(key)) next.add(key)
          setSel(next)
        } else setSel(new Set([key]))
        return
      }
      drawGuides(null)
      const dx = g.ldx
      const dy = g.ldy
      const w = world(e.clientX, e.clientY)
      const off: Pos = new Map(g.items.map((it) => [it.key, { x: dx, y: dy }]))
      // the rest of a selection dragged along: its notes and drawings move by the same
      const extraNotes = g.notes ?? []
      const extraMarks = g.marks ?? []
      const alsoMoved = (s: CanvasState): CanvasState =>
        moveMarks(
          extraNotes.reduce((acc, n) => dropNote(acc, n, dx, dy), s),
          extraMarks,
          dx,
          dy
        )
      const count =
        g.cards.length + extraNotes.length + extraMarks.length + (g.what === 'note' ? 1 : 0)
      const movedLabel =
        count > 1
          ? `Moved ${count} things`
          : g.what === 'note'
            ? 'Moved a note'
            : 'Moved a card'
      conn.current?.drag(null)
      let changed: boolean
      root.current?.querySelectorAll('.split-into').forEach((n) => n.classList.remove('split-into'))
      const splitTo = g.splitTo
      const asSplit =
        g.what === 'card' &&
        splitRef.current.length >= 2 &&
        g.cards.length === splitRef.current.length &&
        g.cards.every((c) => splitRef.current.includes(c))
      if (g.what === 'card' && splitTo) {
        // the two become one split card here on the board; the canvas stays open
        changed = false
        void joinOnBoard(g.cards[0], splitTo)
      } else if (asSplit && (frameAt(stRef.current!, w.x, w.y)?.kind ?? 'private') !== 'private') {
        const into = frameAt(stRef.current!, w.x, w.y)!.id
        changed = edit((s) => seatSplit(s, splitRef.current, into, dx, dy), {
          flip: true,
          off,
          undo: 'Moved split view'
        })
      } else if (asSplit) {
        const first = stRef.current?.cards.find((c) => c.id === splitRef.current[0])
        changed = edit(
          (s) =>
            arrangeSplit(
              s,
              splitRef.current,
              first ? { x: first.x + dx, y: first.y + dy } : undefined
            ),
          { flip: true, off }
        )
      } else if (g.what === 'card')
        changed = edit((s) => alsoMoved(dropCards(s, g.cards, dx, dy, w)), {
          flip: true,
          off,
          undo: movedLabel
        })
      else if (g.what === 'frame')
        changed = edit((s) => moveFrame(s, g.id, dx, dy), {
          flip: true,
          off,
          undo: 'Moved a section'
        })
      else
        changed = edit(
          (s) => alsoMoved(g.cards.length ? dropCards(dropNote(s, g.id, dx, dy), g.cards, dx, dy, w) : dropNote(s, g.id, dx, dy)),
          { undo: movedLabel }
        )
      // drawings were moved by translate, not by the board's own re-layout: let them go
      for (const it of g.items) if (it.el instanceof SVGElement) it.el.style.translate = ''
      if (!changed || g.what === 'note') {
        if (g.what === 'note') clearDrag()
        else
          for (const it of g.items) {
            it.el.classList.remove('lifted')
            it.el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], {
              duration: 240,
              easing: EASE
            })
            it.el.style.translate = ''
          }
        el.querySelectorAll('.drop').forEach((n) => n.classList.remove('drop'))
      }
    }
  }

  // ---- what each card shows ----
  const modelFor = (card: { id: number }): CardModel | null => {
    if (!st) return null
    const virtual = isVirtual(card.id)
    const item: CanvasItem | undefined = virtual ? st.items[String(card.id)] : undefined
    const tab = virtual
      ? item?.tab !== undefined
        ? byId.get(item.tab)
        : undefined
      : byId.get(card.id)
    if (!virtual && !tab) return null
    const base = {
      id: card.id,
      tor: false,
      audible: !!tab?.audible,
      playing: !!(tab?.playing ?? tab?.audible),
      asleep: !!tab?.unloaded,
      muted: !!tab?.muted,
      ringing: tab?.attention.call === 'ringing',
      camera: !!tab?.capture.camera,
      mic: !!tab?.capture.mic,
      screen: !!tab?.capture.screen,
      attnCount: tab?.attention.count ?? 0,
      attnNew: !!tab && (tab.attention.unseen || tab.attention.count > 0),
      current: !!tab && tab.id === activeId,
      isTab: !virtual,
      streaming: false,
      reader: false,
      toggle: false,
      site: '',
      title: '',
      favicon: tab?.favicon ?? undefined,
      loading: !!tab?.loading,
      blank: !!tab && !tab.url
    }
    if (virtual && !item) return { ...base, kind: 'pending' }
    if (tab && (tab.private || tab.tor)) {
      // its own title and site, on this screen only: never saved, never given to a model, never in an export
      return {
        ...base,
        kind: 'private',
        tor: tab.tor,
        title: tab.title || (tab.tor ? 'Tor tab' : 'Private tab'),
        site: tab.url ? displayHost(tab.url) : ''
      }
    }
    const url = item?.url ?? tab?.url ?? ''
    const c = tab ? contents[tab.id] : undefined
    const kind = item ? item.kind : c?.pdf ? 'pdf' : kindOf(url)
    const local = item?.file ? locals[item.file] : undefined
    const text = c?.text || item?.text
    const image =
      kind === 'image'
        ? (local ?? (item?.file ? undefined : url))
        : kind === 'video'
          ? ((tab && stills[tab.id]?.url === tab.url ? stills[tab.id].src : undefined) ??
            item?.image ??
            c?.image ??
            posterFor(url) ??
            undefined)
          : c?.image || item?.image || undefined
    return {
      ...base,
      kind,
      title: tab ? tabTitle(tab) : (item?.title ?? ''),
      site: c?.site || item?.site || (url ? displayHost(url) : ''),
      image,
      text,
      snap: tab ? (thumbs[tab.id] ?? benchThumbs[tab.id]) : undefined,
      pdf:
        kind === 'pdf' ? (item?.file ? { file: item.file } : { url: pdfSource(url) }) : undefined,
      pages: item?.pages,
      placement: item?.placement,
      chip: chips.has(card.id),
      streaming: kind === 'answer' && !item?.text,
      ...readerOf(
        kind === 'page',
        c ? !c.app && c.text.length >= 120 : !!item?.text && item.text.length >= 60,
        !!(c?.text || item?.text),
        !!(tab && (thumbs[tab.id] ?? benchThumbs[tab.id])),
        st.views?.[url]
      )
    }
  }
  const modelForRef = useRef<(card: { id: number }) => CardModel | null>(() => null)
  /** Every card as words to find it by (title, site, address, the page's text when read). */
  const findItems = (model: (card: { id: number }) => CardModel | null): FindItem[] =>
    (st?.cards ?? []).flatMap((c) => {
      const m = model(c)
      if (!m || m.kind === 'pending') return []
      const tab = byId.get(c.id)
      return [
        {
          id: c.id,
          title: m.title ?? '',
          site: m.site ?? '',
          url: tab?.url ?? c.url,
          text: tab ? contents[tab.id]?.text?.slice(0, 4000) : undefined
        }
      ]
    })
  // ---- the instant find (Ctrl+F): matches light up as you type, the rest dims, the board glides to the one picked ----
  const quickHits = useMemo(
    () => (quick ? quickFind(findItems(modelFor), quick) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quick, st, allTabs, contents]
  )
  const quickPick = quickHits.length ? quickHits[Math.min(quickAt, quickHits.length - 1)] : null
  useEffect(() => {
    const el = root.current
    if (!el) return
    const on = !!quick
    el.classList.toggle('quick', on)
    const hits = new Set(quickHits)
    for (const c of el.querySelectorAll<HTMLElement>('[data-cid]'))
      c.classList.toggle('hit', on && hits.has(Number(c.dataset.cid)))
  }, [quick, quickHits, vis])
  useEffect(() => {
    if (quickPick === null) return
    const card = stRef.current?.cards.find((c) => c.id === quickPick)
    if (!card) return
    reveal(cardBox(card))
    setSel(new Set([`c:${card.id}`]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickPick])
  useLayoutEffect(() => {
    modelForRef.current = modelFor
  })

  // ---- how a card is placed: note, document or live page (never makes a tab by itself) ----
  const seenPlacement = useRef(new Map<number, string>())
  const byIdRef = useRef(byId)
  useLayoutEffect(() => {
    byIdRef.current = byId
  })
  const placeAs = useCallback(
    async (id: number, to: Placement): Promise<void> => {
      const s0 = stRef.current
      if (!s0) return
      const virtual = isVirtual(id)
      const item = virtual ? s0.items[String(id)] : undefined
      const tab = virtual
        ? item?.tab !== undefined
          ? byIdRef.current.get(item.tab)
          : undefined
        : byIdRef.current.get(id)
      if (tab && (tab.private || tab.tor)) return
      const url = item?.url ?? tab?.url ?? ''
      if (item && (to !== 'note' || item.kind === 'answer')) {
        edit((s1) => setItem(s1, id, placeItem(item, to)), { flip: true })
        markFresh([id])
        return
      }
      if (to !== 'note') return
      const src = item ?? (tab ? itemFor(url, tabTitle(tab), { tab: tab.id, source: 'tab' }) : null)
      if (!src) return
      // a pending note card appears beside the page right away; its text arrives when the summary is done
      let noteId = id
      if (!item) {
        const made = addLoose(stRef.current ?? s0, noteOf(src, undefined, true), { cards: [id] })
        noteId = made.id
        edit(() => made.state, { flip: true, undo: 'Made a note' })
        flyRef.current = [noteId]
      } else {
        edit((s1) => setItem(s1, id, noteOf(src, undefined, true)), {
          flip: true,
          undo: 'Made a note'
        })
        markFresh([id])
      }
      const summary =
        (await window.api.canvas.summarize(
          item?.tab !== undefined || !virtual ? { tab: item?.tab ?? id } : { url }
        )) ?? undefined
      edit((s1) => setItem(s1, noteId, noteOf(src, summary)))
      markFresh([noteId])
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edit, markFresh, toastNow]
  )

  // a new card the prompt made gets the quiet chip for a while, and an unsure page may ask a model
  useEffect(() => {
    const items = st?.items
    if (!items) return
    for (const [k, it] of Object.entries(items)) {
      const id = Number(k)
      const key = `${it.placement ?? ''}|${it.kind}`
      if (!it.placement || seenPlacement.current.get(id) === key) continue
      const first = !seenPlacement.current.has(id)
      seenPlacement.current.set(id, key)
      setChips((p) => new Set(p).add(id))
      window.setTimeout(
        () =>
          setChips((p) => {
            const n = new Set(p)
            n.delete(id)
            return n
          }),
        9000
      )
      if (
        first &&
        it.source === 'web' &&
        it.kind === 'page' &&
        !suggestPlacement({ kind: it.kind, url: it.url }).confident
      ) {
        void window.api.canvas
          .placement({ url: it.url, title: it.title, text: it.text ?? '' })
          .then((p) => {
            if (p && p !== it.placement && stRef.current?.items[k]?.placement === it.placement)
              void placeAs(id, p)
          })
      }
    }
  }, [st?.items, placeAs])

  // ---- opening a card to read it ----
  const showNow = (): void => {
    const want = showTab.current
    if (!want || phaseRef.current !== 'open') return
    if (Date.now() - want.at > 15_000) {
      showTab.current = null
      return
    }
    const card = stRef.current?.cards.find((c) => c.id === want.id)
    if (!card) return // its card comes with the next sync of the tabs
    showTab.current = null
    if (expandedNow.current === card.id) return // already open in the preview
    const v = reveal(cardBox(card)) // the card's place once the board has glided to it
    setSel(new Set([`c:${card.id}`]))
    setExpanded({
      id: card.id,
      live: true,
      from: {
        x: card.x * v.k + v.x,
        y: card.y * v.k + v.y,
        w: (card.w ?? CARD_W) * v.k,
        h: (card.h ?? CARD_H) * v.k
      }
    })
  }
  useLayoutEffect(() => {
    showNowRef.current = showNow
  })
  useEffect(() => {
    showNowRef.current()
  }, [st])
  const expand = (id: number, forceLive?: boolean): void => {
    const s = stRef.current
    const card = s?.cards.find((c) => c.id === id)
    const m = modelForRef.current({ id })
    if (!s || !card || !m || m.kind === 'pending') return
    const v = vp.get()
    setSel(new Set([`c:${id}`]))
    // an empty tab has nothing to read: ask what to open in it, right where its card is
    if (m.blank && phaseRef.current === 'open') {
      const wx = card.x + (card.w ?? CARD_W) / 2
      const wy = card.y + (card.h ?? CARD_H) / 2
      setNewAt({ sx: wx * v.k + v.x, sy: wy * v.k + v.y, wx, wy, fill: id })
      return
    }
    // a page last looked at live opens live again, and a call always does (its reader text is no use)
    const url = isVirtual(id) ? s.items[String(id)]?.url : byId.get(id)?.url
    setExpanded({
      id,
      live: forceLive ?? (calls.has(id) || (!!url && s.previews?.[url] === 'live')),
      from: {
        x: card.x * v.k + v.x,
        y: card.y * v.k + v.y,
        w: (card.w ?? CARD_W) * v.k,
        h: (card.h ?? CARD_H) * v.k
      }
    })
  }
  useLayoutEffect(() => {
    expandRef.current = expand
  })
  useEffect(() => {
    expandedRef.current = expanded !== null
    expandedNow.current = expanded?.id ?? null
    saveSoon() // the open preview comes back after a restart
  }, [expanded, saveSoon])
  // Panes closing: whatever has not been saved yet (a move in the last moment) is saved now, not lost
  useEffect(() => {
    const now = (): void => {
      const s0 = stRef.current
      if (!s0 || phaseRef.current === 'loading') return
      window.clearTimeout(saveTimer.current)
      window.api.canvas.save(spaceId, {
        ...s0,
        boot: bootRef.current,
        view: lastView.current ?? vp.get(),
        open: expandedNow.current
      })
    }
    window.addEventListener('pagehide', now)
    window.addEventListener('beforeunload', now)
    return () => {
      window.removeEventListener('pagehide', now)
      window.removeEventListener('beforeunload', now)
    }
  }, [spaceId, vp])
  // the preview that was open when Panes closed opens again, once the board is up
  useEffect(() => {
    if (phase !== 'open' || reopen.current === null) return
    const id = reopen.current
    reopen.current = null
    if (stRef.current?.cards.some((c) => c.id === id)) expandRef.current(id)
  }, [phase])
  const onExpand = useCallback((id: number): void => expandRef.current(id), [])
  const onPreviewLive = useCallback(
    (url: string, live: boolean): void => void edit((s0) => setPreview(s0, url, live)),
    [edit]
  )
  const goToTab = (id: number): void => {
    const item = stRef.current?.items[String(id)]
    const tabId = isVirtual(id) ? item?.tab : id
    if (tabId !== undefined) leaveRef.current(tabId)
    else if (item?.url) {
      window.api.createTab(item.url)
      leaveRef.current(null)
    }
  }

  // the board's own size follows the window (the chrome folds away around it): what is in the middle stays there
  useEffect(() => {
    const el = root.current
    if (!el) return
    let last = { w: 0, h: 0 }
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width
      const h = e.contentRect.height
      setStage({ w, h })
      if (last.w > 0 && phaseRef.current !== 'loading') {
        const v = vp.get()
        vp.set({ ...v, x: v.x + (w - last.w) / 2, y: v.y + (h - last.h) / 2 })
      }
      last = { w, h }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [vp, root])

  // pages say what they are about: a headline, a picture, the first lines (read from the tab, one at a time)
  const contentKey = allTabs
    .filter((t) => !t.private && !t.tor && !t.unloaded && !t.loading && /^https?:/i.test(t.url))
    .map((t) => `${t.id}|${t.url}|${t.title}`)
    .join('\n')
  useEffect(() => {
    if (phase === 'loading') return
    const todo = tabsRef.current.filter(
      (t) =>
        !t.private &&
        !t.tor &&
        !t.unloaded &&
        !t.loading &&
        /^https?:/i.test(t.url) &&
        kindOf(t.url) === 'page' &&
        asked.current.get(t.id) !== `${t.url}\n${t.title}`
    )
    if (todo.length === 0) return
    let dead = false
    void (async () => {
      for (const t of todo) {
        if (dead) return
        const got = await window.api.canvas.content(t.id)
        asked.current.set(t.id, `${t.url}\n${t.title}`)
        if (got && !dead) setContents((prev) => ({ ...prev, [t.id]: got }))
      }
    })()
    return () => {
      dead = true
    }
  }, [contentKey, phase])

  // A link put on the board unfurls once: its title, first lines and picture are read and kept with the card, so it
  // reads offline later too. Not for a private window, and never for a card that is a tab.
  const unfurled = useRef(new Set<string>())
  useEffect(() => {
    if (!st || privateNow()) return
    const todo = Object.entries(st.items).filter(
      ([k, i]) =>
        i.kind === 'page' &&
        !i.text &&
        i.tab === undefined &&
        /^https?:/i.test(i.url) &&
        !unfurled.current.has(k)
    )
    if (todo.length === 0) return
    for (const [k] of todo) unfurled.current.add(k)
    void (async () => {
      for (const [k, i] of todo) {
        const d = await window.api.canvas.reader({ url: i.url })
        if (!d) continue
        const text = d.blocks
          .flatMap((b) => (b.t === 'img' ? [] : [b.text]))
          .join('\n\n')
          .slice(0, ITEM_TEXT_MAX)
        const img = d.blocks.find((b) => b.t === 'img')
        edit((s0) => {
          const cur = s0.items[k]
          if (!cur || cur.text) return s0
          return setItem(s0, Number(k), {
            ...cur,
            title: d.title || cur.title,
            site: d.site || cur.site,
            text: text || undefined,
            image: cur.image ?? (img && img.t === 'img' ? img.src : undefined)
          })
        })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.items])

  // downloaded pictures are read through main and shown from memory
  const items = st?.items
  const localsRef = useRef(locals)
  useEffect(() => {
    localsRef.current = locals
  }, [locals])
  useEffect(() => {
    if (!items) return
    const want = Object.values(items)
      .filter((i) => i.kind === 'image' && i.file && !localsRef.current[i.file])
      .map((i) => i.file as string)
    if (want.length === 0) return
    let dead = false
    void (async () => {
      for (const file of want) {
        const r = await window.api.canvas.bytes({ file })
        if (dead || !r) continue
        const url = URL.createObjectURL(new Blob([r.data as BlobPart], { type: r.mime }))
        setLocals((prev) => ({ ...prev, [file]: url }))
      }
    })()
    return () => {
      dead = true
    }
  }, [items])
  useEffect(
    () => () => {
      for (const u of Object.values(localsRef.current)) URL.revokeObjectURL(u)
    },
    []
  )

  // ---- the prompt ----
  const showBox = (b: Box): void => {
    const { w, h } = size()
    const v = vp.get()
    const x = b.x * v.k + v.x
    const y = b.y * v.k + v.y
    const inside = x > 40 && y > 40 && x + b.w * v.k < w - 40 && y + b.h * v.k < h - 110
    if (!inside) vp.animateTo(fitView(b, w, h, 110, 1), 460)
  }
  const finder = useFinder({
    spaceId,
    getState: () => stRef.current,
    edit,
    tabs: () => tabsRef.current,
    privateMode: () => {
      const a = tabsRef.current.find((t) => t.id === activeId)
      return !!a && (a.private || a.tor)
    },
    anchor: () => {
      const v = vp.get()
      const { w, h } = size()
      return { x: (w / 2 - v.x) / v.k - 400, y: (h * 0.4 - v.y) / v.k - 260 }
    },
    fly: (ids) => {
      flyRef.current = ids
    },
    show: showBox,
    select: (ids) => setSel(new Set(ids.map((i) => `c:${i}`))),
    say: (t) => toastNow(t)
  })
  // the conversation lives in a dock on the right; the board changes only when the person adds something to it,
  // or asks the assistant to work the board
  const selectedTabs = useMemo(
    () =>
      [...sel].flatMap((k) => {
        if (!k.startsWith('c:')) return []
        const id = Number(k.slice(2))
        const tab = isVirtual(id) ? st?.items[String(id)]?.tab : id
        return typeof tab === 'number' ? [tab] : []
      }),
    [sel, st]
  )
  // private while a private or Tor page is the one open in the preview (not because the tab view's tab behind the
  // board is one): AI and saved conversations step aside for it
  const privateWin = (() => {
    const open = expanded
      ? isVirtual(expanded.id)
        ? (st?.items[String(expanded.id)]?.tab ?? null)
        : expanded.id
      : null
    const a = open === null ? undefined : allTabs.find((t) => t.id === open)
    return !!a && (a.private || a.tor)
  })()
  const asker = useAsk({
    space: spaceId,
    tabs: allTabs,
    selected: selectedTabs,
    ephemeral: privateWin,
    extra: () => {
      const s0 = stRef.current
      if (!s0) return ''
      const open = tabsRef.current.filter((t) => !t.private && !t.tor)
      const board = boardSummary(
        s0,
        tabsRef.current.map((t) => ({
          id: t.id,
          url: t.url,
          title: t.aiTitle ?? t.title,
          private: t.private || t.tor
        })),
        [],
        2500
      )
      // background to look things up in, not news to report: a small model given counts and lists recites them
      // ("the user has 5 tabs about ..."), so it gets no counts, no "nothing is selected", and is told how to use it
      const context = [
        `On your canvas board right now:\n${board.replace(/\n?Nothing is selected\.$/, '') || 'Nothing yet.'}`,
        `Your open tabs:\n${
          open
            .slice(0, 40)
            .map(
              (t) =>
                `- ${(t.aiTitle ?? t.title) || 'New tab'}${t.url ? ` (${t.url.slice(0, 120)})` : ''}`
            )
            .join('\n') || 'None.'
        }`
      ]
      const lines: string[] = []
      for (const k of selRef.current) {
        if (!k.startsWith('c:')) continue
        const it = s0.items[k.slice(2)]
        if (it && it.kind !== 'pdf' && it.kind !== 'image' && (it.text || it.title))
          lines.push(
            `- ${it.title || it.site} (${it.url || 'a note on the board'}): ${(it.text ?? '').slice(0, 1500)}`
          )
      }
      if (lines.length) context.push(`Cards you have selected on the board:\n${lines.join('\n')}`)
      context.push(
        'The above is only for questions about the board or the tabs; any other question, answer from what you know. Answer the question itself, briefly, talking to the person as "you". Do not describe, list or count the board or the tabs unless that is what was asked.'
      )
      return context.join('\n\n')
    }
  })

  // ---- the conversation as a column the board makes room for ----
  const dockInput = useRef<HTMLTextAreaElement>(null)
  /** Open the conversation with the cursor in its box (it mounts with the dock: focused once it is there). */
  const askInDock = (): void => {
    asker.show()
    requestAnimationFrame(() => requestAnimationFrame(() => dockInput.current?.focus()))
  }
  // its width is the person's, per space (a convenience: kept in this browser only)
  const dockKey = `panes.canvas.dockW.${spaceId}`
  const [dockW, setDockW] = useState(() => {
    try {
      const v = Number(localStorage.getItem(dockKey))
      return v >= DOCK_MIN && v <= DOCK_MAX ? v : DOCK_W
    } catch {
      return DOCK_W
    }
  })
  const dockShown = Math.min(dockW, Math.max(0, stage.w - 120))
  const resizeDock = useCallback(
    (w: number): void => {
      const v = Math.min(DOCK_MAX, Math.max(DOCK_MIN, w))
      setDockW(v)
      try {
        localStorage.setItem(dockKey, String(v))
      } catch {
        // kept for this visit only
      }
    },
    [dockKey]
  )
  // opening it glides the board left by half its width (what was in the middle stays in the middle of the room
  // left), closing glides it back; the board itself keeps its size, so nothing is laid out again
  const dockWas = useRef(false)
  useEffect(() => {
    if (asker.open === dockWas.current) return
    dockWas.current = asker.open
    if (phaseRef.current !== 'open') return
    const v = vp.get()
    const dx = (asker.open ? -1 : 1) * Math.round(dockShown / 2)
    if (reduced) vp.set({ ...v, x: v.x + dx })
    else vp.animateTo({ ...v, x: v.x + dx }, 320)
    // only the opening and closing move the board
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asker.open])
  const askerRef = useRef(asker)
  useEffect(() => {
    askerRef.current = asker
  })
  const chatReadyRef = useRef(false)
  const [chatReady, setChatReady] = useState(false)
  useEffect(() => {
    const look = (): void =>
      void window.api.chatInfo().then((i) => {
        chatReadyRef.current = !!i.enabled && !!i.target && !i.block
        setChatReady(chatReadyRef.current)
      })
    look()
    return window.api.onChatChanged(look)
  }, [])
  const onPrompt = (q: string): void => {
    const a = tabsRef.current.find((t) => t.id === activeId)
    const privateWin = !!a && (a.private || a.tor)
    const address = /^(https?:\/\/\S+|(?:[\w-]+\.)+[a-z]{2,}(?:\/\S*)?)$/i.test(q.trim())
    // "search X on youtube", "open github": the browser does these itself, with or without a model
    if (!privateWin && quickAction(q)) {
      asker.ask(q)
      return
    }
    if (privateWin || address || !chatReadyRef.current) {
      asker.close()
      finder.run(q)
    } else asker.ask(q)
  }
  // a source or link in the conversation opens in the board's own preview, live: the board stays the place you are
  const openSource = (url: string, tab?: number): void => {
    const s0 = stRef.current
    const card =
      tab !== undefined
        ? s0?.cards.find((c) => c.id === tab)
        : s0?.cards.find((c) => {
            const it = isVirtual(c.id) ? s0.items[String(c.id)] : undefined
            return (it?.url ?? byId.get(c.id)?.url) === url
          })
    if (card) {
      reveal(cardBox(card))
      expandRef.current(card.id, true)
      return
    }
    const id = finder.openLink(url)
    if (id !== null) window.setTimeout(() => expandRef.current(id, true), 420)
  }
  // ---- the assistant works the board: each tool call is one step that can be taken back ----
  const toolConfirmRef = useRef<((ok: boolean) => void) | null>(null)
  const askConfirm = useCallback(
    (text: string): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        const answer = (ok: boolean): void => {
          toolConfirmRef.current = null
          setToolConfirm(null)
          resolve(ok)
        }
        toolConfirmRef.current = answer
        setToolConfirm({ text, answer })
      }),
    []
  )
  const runToolRef = useRef<(name: string, args: unknown) => Promise<string>>(
    async () => 'Error: the board is not ready.'
  )
  useEffect(() => {
    runToolRef.current = async (name, args) => {
      const chk = checkBoardCall(name, args)
      if (!chk.ok) return `Error: ${chk.error}`
      const s0 = stRef.current
      if (!s0 || phaseRef.current === 'loading') return 'Error: the board is not ready.'
      const tabsNow = tabsRef.current.map((t) => ({
        id: t.id,
        url: t.url,
        title: t.aiTitle ?? t.title,
        private: t.private || t.tor
      }))
      const selTokens = [...selRef.current].flatMap((k) => {
        const r = parseKey(k)
        return r ? [refToken(r)] : []
      })
      if (chk.value.name === 'get_board') return boardSummary(s0, tabsNow, selTokens)
      const v0 = vp.get()
      const mid = { x: (size().w / 2 - v0.x) / v0.k - 300, y: (size().h / 2 - v0.y) / v0.k - 200 }
      const r = applyBoardTool(s0, chk.value, tabsNow, mid)
      if (r.result.startsWith('Error')) return r.result
      if (r.confirm && !(await askConfirm(r.confirm.text)))
        return 'The person said no, so nothing was removed.'
      const done = (said: string, result = said): string => {
        if (said) askerRef.current.did(said)
        return result
      }
      if (r.effect?.kind === 'tidy') {
        pushUndo('AI: arranged the board')
        await runTidy(r.effect.all)
        return done(r.said, 'Arranged the board by topic.')
      }
      if (r.effect?.kind === 'arrange') {
        pushUndo(`AI: arranged by ${r.effect.by}`)
        if (r.effect.by === 'topic') await runTidy(false)
        else
          edit((st) => tidy(st, lite(), hostClusters(lite()), false), { flip: true, stagger: true })
        return done(r.said, `Arranged by ${r.effect.by}.`)
      }
      if (r.effect) {
        const ids = r.effect.ids
        const keys = ids.map((x) => (x.kind === 'card' ? `c:${x.id}` : `${x.kind[0]}:${x.id}`))
        if (r.effect.kind === 'select') setSel(new Set(keys))
        const boxes = ids.flatMap((x) => {
          const c = x.kind === 'card' ? s0.cards.find((y) => y.id === x.id) : undefined
          const f = x.kind === 'frame' ? s0.frames.find((y) => y.id === x.id) : undefined
          const n = x.kind === 'note' ? s0.notes.find((y) => y.id === x.id) : undefined
          return c ? [cardBox(c)] : f ? [f] : n ? [n] : []
        })
        const b = boundsOf(boxes)
        if (b) showBox(b)
        return r.result
      }
      pushUndo(`AI: ${r.said.charAt(0).toLowerCase()}${r.said.slice(1)}`)
      edit(() => r.state, { flip: true, stagger: true })
      return done(r.said, `${r.said}.`)
    }
  })
  useEffect(
    () =>
      window.api.canvas.onTool((id, name, args) => {
        // add_file comes from main only (a download): it is not a tool any model is given
        const run =
          name === 'add_file' ? putDownloadRef.current(args) : runToolRef.current(name, args)
        void run.then((text) => window.api.canvas.toolResult(id, text))
      }),
    []
  )
  // a stopped turn must not leave a question hanging
  useEffect(() => {
    if (!asker.streaming) toolConfirmRef.current?.(false)
  }, [asker.streaming])

  /** Put a part of an answer on the board as a note next to the cards it came from, with arrows back to them. */
  const addToCanvas = (text: string, turn: AskTurn): void => {
    const s0 = stRef.current
    if (!s0 || !text.trim()) return
    const near = turn.tabs.filter((id) => s0.cards.some((c) => c.id === id))
    const v0 = vp.get()
    const point = { x: (size().w / 2 - v0.x) / v0.k - 120, y: (size().h * 0.4 - v0.y) / v0.k - 150 }
    pushUndo('Added to the canvas')
    let id = 0
    edit(
      (st) => {
        const item: CanvasItem = {
          kind: 'answer',
          url: '',
          title: turn.q,
          site: '',
          text,
          source: 'answer',
          placement: 'note'
        }
        const r = addLoose(st, item, { cards: near, point })
        id = r.id
        let n = r.state
        for (const from of near.slice(0, 4)) {
          const c = addConnector(n, { kind: 'card', id: from }, { kind: 'card', id: r.id })
          if (c) n = c.state
        }
        return n
      },
      { flip: true }
    )
    flyRef.current = [id]
    markFresh([id])
    const c = stRef.current?.cards.find((x) => x.id === id)
    if (c) showBox(cardBox(c))
  }
  // one editing session is one step back: the board as it was when typing started (a shape that grew included)
  const editStart = useRef<CanvasState | null>(null)
  useEffect(() => {
    if (markEdit) editStart.current = stRef.current
  }, [markEdit])
  // nothing being edited any more: the key that started the last edit is forgotten
  const idle = !markEdit && !editing
  const [wasIdle, setWasIdle] = useState(idle)
  if (idle !== wasIdle) {
    setWasIdle(idle)
    if (idle) setFirstKey(null)
  }
  const onMarkText = useCallback(
    (id: string, text: string | null): void => {
      setMarkEdit((cur) => (cur === id ? null : cur))
      if (text === null) return
      const before = editStart.current
      // a text label left empty is not kept (a shape or block keeps its box)
      const m = marksOf(stRef.current ?? emptyState()).find((x) => x.id === id)
      const was = before && marksOf(before).find((x) => x.id === id)
      if (m?.kind === 'text' && !text.trim()) edit((s0) => deleteMarks(s0, [id]))
      else edit((s0) => patchMark(s0, id, { text }))
      if (before && (was?.text ?? '') !== text) record('Edited text', before)
    },
    [edit, record]
  )
  /** A label wants another size as it is typed or restyled (no step of its own: it goes with the edit). */
  const onMarkFit = useCallback(
    (id: string, size: { w?: number; h?: number }): void =>
      void edit((s0) => patchMark(s0, id, size)),
    [edit]
  )
  const onMarkToggle = useCallback(
    (id: string, line: number): void =>
      void edit(
        (s0) => {
          const m = marksOf(s0).find((x) => x.id === id)
          return m ? patchMark(s0, id, { text: toggleCheck(m.text ?? '', line) }) : s0
        },
        { undo: 'Ticked an item' }
      ),
    [edit]
  )
  /** Open a folded results frame back into its cards. */
  const fanOut = useCallback(
    (id: string): void => {
      pushUndo('Opened a pile')
      edit((s0) => expandFrame(s0, id), { flip: true })
    },
    [edit, pushUndo]
  )
  // older results fold into piles: the latest two requests stay open
  const resultFrames = st?.frames.filter((f) => f.kind === 'result').length ?? 0
  useEffect(() => {
    if (resultFrames > 2) edit((s0) => collapseOld(s0), { flip: true })
  }, [resultFrames, edit])
  const pulse = (el: Element | null): void => {
    if (!el) return
    el.classList.add('pulse')
    window.setTimeout(() => el.classList.remove('pulse'), 1600)
  }

  // the pill's title: its card comes into view, selected, with a pulse
  const goToPlaying = (id: number): void => {
    const c = stRef.current?.cards.find((x) => x.id === id)
    if (!c) return
    if (calls.has(id)) return expandRef.current(id, true) // a call: straight into it
    reveal(cardBox(c))
    setSel(new Set([`c:${c.id}`]))
    window.setTimeout(() => pulse(root.current?.querySelector(`[data-cid="${c.id}"]`) ?? null), 380)
  }

  // AI off or unconfigured is not a dead end: finding by words and grouping by site still work, and one button turns AI on
  const [aiOff, setAiOff] = useState(false)
  useEffect(() => {
    const ask = (): void => void window.api.chatInfo().then((i) => setAiOff(!i.enabled))
    ask()
    return window.api.onChatChanged(ask)
  }, [])
  const aiAvailable = !aiOff && chatReady && !privateWin
  useEffect(() => {
    if (!aiAvailable && asker.open) asker.close()
  }, [aiAvailable, asker])

  const firstMsRef = useRef<number | null>(null)
  useEffect(() => {
    firstMsRef.current = finder.firstMs
  }, [finder.firstMs])
  const runRef = useRef(finder.run)
  useEffect(() => {
    runRef.current = finder.run
  }, [finder.run])

  // ---- DEV only: a way to measure with 150 tabs ----
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as Record<string, unknown>
    w.__canvasBench = {
      fake: async (n: number): Promise<void> => {
        const out: TabInfo[] = []
        for (let i = 0; i < n; i++) {
          const id = 1_000_000 + i
          out.push({
            id,
            url: `https://site${i % 17}.example/page${i}`,
            title: `Benchmark page ${i} about topic ${i % 9}`,
            favicon: null,
            loading: false,
            private: false,
            tor: false,
            pinned: false,
            capture: { camera: false, mic: false, screen: false },
            groupId: null,
            pip: false,
            unloaded: false,
            audible: false,
            muted: false,
            attention: { count: 0, unseen: false, call: null } as TabInfo['attention'],
            aiTitle: null,
            bookmarked: false,
            canGoBack: false,
            canGoForward: false
          })
          const c = new OffscreenCanvas(480, 300)
          const g = c.getContext('2d')!
          g.fillStyle = `hsl(${(i * 37) % 360} 40% 45%)`
          g.fillRect(0, 0, 480, 300)
          g.fillStyle = '#fff8'
          for (let j = 0; j < 12; j++) g.fillRect(24, 24 + j * 22, 300 - ((i * j) % 120), 12)
          const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
          benchThumbs[id] = URL.createObjectURL(blob)
        }
        setBench(out)
      },
      pan: (dx: number, dy: number) => vp.panBy(dx, dy),
      zoom: (f: number, x: number, y: number) => vp.zoomAt(f, x, y),
      view: () => vp.get(),
      set: (v: Viewport) => vp.set(v),
      tidy: () => runTidy(true),
      prompt: (q: string) => runRef.current(q),
      ask: (q: string) => askerRef.current.ask(q),
      tool: (n: string, a: unknown) => runToolRef.current(n, a),
      undo: () => undo(),
      /** n shapes and blocks spread over the board, in one step (to measure). */
      shapes: (n: number) =>
        edit((s0) => {
          let s1 = s0
          for (let i = 0; i < n; i++) {
            const x = (i % 20) * 220
            const y = Math.floor(i / 20) * 160 + 2000
            const r =
              i % 10 === 9
                ? addBlock(s1, 'checklist', { x, y })
                : addShape(
                    s1,
                    SHAPE_KINDS[i % SHAPE_KINDS.length],
                    { x, y },
                    { x: x + 180, y: y + 110 },
                    { text: i % 3 ? `Step ${i}` : '', fill: i % 8 }
                  )
            if (r) s1 = r.state
          }
          return s1
        }),
      state: () => stRef.current,
      firstMs: () => firstMsRef.current,
      mounted: () => root.current?.querySelectorAll('[data-cid]').length ?? 0,
      cards: () => stRef.current?.cards.length ?? 0
    }
    return () => {
      delete w.__canvasBench
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- connectors ----
  const onLinkLabel = useCallback(
    (id: string, text: string | null): void => {
      setEditing((cur) => (cur === id ? null : cur))
      if (text !== null)
        edit((s0) => patchConnector(s0, id, { label: text }), { undo: 'Labelled an arrow' })
    },
    [edit]
  )
  const onLinkPatch = useCallback(
    (id: string, patch: Partial<Style>): void => {
      // the next connector is drawn the way the last one was styled
      linkStyleRef.current = { ...linkStyleRef.current, ...patch }
      setLinkStyle(linkStyleRef.current)
      edit((s0) => patchConnector(s0, id, patch), { undo: 'Restyled an arrow' })
    },
    [edit]
  )
  // the dots for drawing a connector show on the object under the pointer (and a little around it)
  const onHover = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (root.current && !gesture.current) {
      const r = root.current.getBoundingClientRect()
      const v = vp.get()
      lastPointer.current = {
        x: (e.clientX - r.left - v.x) / v.k,
        y: (e.clientY - r.top - v.y) / v.k
      }
    }
    if (gesture.current || phaseRef.current !== 'open' || expandedRef.current) return
    const tl = toolRef.current
    if ((tl !== 'select' && tl !== 'connector') || spaceHeld.current || e.buttons !== 0) return
    const t = e.target as Element
    if (t.closest?.('[data-handle]')) return
    if (t.closest?.('.cv-bar,.cv-toast,.cv-kbar,.cv-confirm')) {
      conn.current?.hover(null)
      return
    }
    const s0 = stRef.current
    if (!s0) return
    const w = world(e.clientX, e.clientY)
    lastPointer.current = { x: w.x, y: w.y }
    const overFill =
      tl === 'select' &&
      !e.shiftKey &&
      !t.closest?.('[data-cid],[data-nid],[data-fhead],[data-kid],[data-rz]') &&
      !!frameAt(s0, w.x, w.y)
    root.current?.classList.toggle('over-frame', overFill)
    const hf =
      tl === 'select' && !t.closest?.('[data-cid],[data-nid]')
        ? frameAt(s0, w.x, w.y)?.id
        : undefined
    if (hf !== hovFrame.current) {
      if (hovFrame.current)
        root.current?.querySelector(`[data-fid="${hovFrame.current}"]`)?.classList.remove('hov')
      if (hf) root.current?.querySelector(`[data-fid="${hf}"]`)?.classList.add('hov')
      hovFrame.current = hf
    }
    const k = vp.get().k
    const pad = 26 * Math.min(2.6, Math.max(1, 0.62 / k))
    conn.current?.hover(objectAt(s0, w, { pad, edgeOnly: true }))
  }
  /** Shift-dragging drawings: their box snaps to what is around them, as cards and notes do. */
  const snapMarks = (
    s0: CanvasState,
    ids: string[],
    dx: number,
    dy: number,
    k: number
  ): Snap | null => {
    const mine = new Set(ids)
    const b = boundsOf(
      marksOf(s0)
        .filter((m) => mine.has(m.id))
        .map(markBox)
    )
    if (!b) return null
    const box = { ...b, x: b.x + dx, y: b.y + dy }
    const reach = { x: box.x - 1600, y: box.y - 1600, w: box.w + 3200, h: box.h + 3200 }
    const others = [
      ...s0.frames,
      ...s0.notes,
      ...s0.cards.map(cardBox),
      ...marksOf(s0)
        .filter((m) => !mine.has(m.id))
        .map(markBox)
    ].filter((o) => hit(reach, o))
    return snapBox(box, others, { threshold: 8 / k })
  }
  /** The snap of a drag in progress: the moving things' box against what is around them. */
  const snapMove = (
    s0: CanvasState,
    g: Extract<Gesture, { kind: 'item' }>,
    dx: number,
    dy: number,
    k: number
  ): Snap | null => {
    const moving: Box[] = []
    const skipCards = new Set<number>(g.cards)
    if (g.what === 'card')
      for (const c of s0.cards) if (skipCards.has(c.id)) moving.push(cardBox(c))
    if (g.what === 'frame') {
      const f = s0.frames.find((x) => x.id === g.id)
      if (f) moving.push(f)
      for (const c of s0.cards) if (c.frame === g.id) skipCards.add(c.id)
    }
    if (g.what === 'note') {
      const n = s0.notes.find((x) => x.id === g.id)
      if (n) moving.push(n)
    }
    const b = boundsOf(moving)
    if (!b) return null
    const box = { ...b, x: b.x + dx, y: b.y + dy }
    const reach = { x: box.x - 1600, y: box.y - 1600, w: box.w + 3200, h: box.h + 3200 }
    const others: Box[] = []
    for (const f of s0.frames) if (f.id !== g.id && hit(reach, f)) others.push(f)
    for (const n of s0.notes) if (n.id !== g.id && hit(reach, n)) others.push(n)
    for (const m of marksOf(s0)) if (hit(reach, markBox(m))) others.push(markBox(m))
    for (const c of s0.cards) {
      if (skipCards.has(c.id)) continue
      const cb = cardBox(c)
      if (hit(reach, cb)) others.push(cb)
    }
    return snapBox(box, others, { threshold: 8 / k })
  }
  const drawGuides = (sn: Snap | null): void => {
    const el = guides.current
    if (!el) return
    if (!sn || (sn.guides.length === 0 && sn.gaps.length === 0)) {
      if (el.childElementCount) el.replaceChildren()
      return
    }
    const ns = 'http://www.w3.org/2000/svg'
    const parts: Element[] = []
    for (const gd of sn.guides) {
      const l = document.createElementNS(ns, 'line')
      const [x1, y1, x2, y2] =
        gd.axis === 'x' ? [gd.at, gd.from, gd.at, gd.to] : [gd.from, gd.at, gd.to, gd.at]
      l.setAttribute('x1', String(x1))
      l.setAttribute('y1', String(y1))
      l.setAttribute('x2', String(x2))
      l.setAttribute('y2', String(y2))
      parts.push(l)
    }
    for (const gp of sn.gaps) {
      const g0 = document.createElementNS(ns, 'g')
      g0.setAttribute('class', gp.even ? 'gap even' : 'gap')
      const l = document.createElementNS(ns, 'line')
      const [x1, y1, x2, y2] =
        gp.axis === 'y' ? [gp.at, gp.from, gp.at, gp.to] : [gp.from, gp.at, gp.to, gp.at]
      l.setAttribute('x1', String(x1))
      l.setAttribute('y1', String(y1))
      l.setAttribute('x2', String(x2))
      l.setAttribute('y2', String(y2))
      const tx = document.createElementNS(ns, 'text')
      tx.setAttribute('x', String((x1 + x2) / 2 + (gp.axis === 'y' ? 8 : 0)))
      tx.setAttribute('y', String((y1 + y2) / 2 + (gp.axis === 'x' ? -8 : 4)))
      tx.textContent = String(Math.round(gp.to - gp.from))
      g0.append(l, tx)
      parts.push(g0)
    }
    el.replaceChildren(...parts)
  }
  const linkRef = useRef<(href: string) => void>(() => undefined)
  useLayoutEffect(() => {
    linkRef.current = finder.openLink
  })
  const onCardLink = useCallback((href: string): void => linkRef.current(href), [])
  const onCardView = useCallback(
    (id: number): void => {
      const m = modelForRef.current({ id })
      const s0 = stRef.current
      const url = isVirtual(id) ? s0?.items[String(id)]?.url : byId.get(id)?.url
      if (!m || !url) return
      edit((cur) => setCardView(cur, url, m.reader ? 'snapshot' : 'reader'))
    },
    [byId, edit]
  )
  const onFrameColor = useCallback(
    (id: string, c: number | null): void =>
      void edit((s0) => setFrameColor(s0, id, c), { undo: 'Recoloured a section' }),
    [edit]
  )
  // a section goes with what is in it: its tabs close (the toast's Undo opens them again)
  const onFrameDelete = useCallback(
    (id: string): void => {
      const inside = (stRef.current?.cards ?? []).filter((c) => c.frame === id).map((c) => c.id)
      edit((s0) => deleteFrame(s0, id), { undo: 'Deleted a section' })
      if (inside.length) closeCards(inside)
      else setSel(new Set())
    },
    [edit, setSel, closeCards]
  )
  const openNew = (text: string, again = false): void => {
    const at = newAt
    if (!again) {
      const dup = alreadyOpen(findItems(modelForRef.current), text)
      const card = dup !== null ? stRef.current?.cards.find((c) => c.id === dup) : undefined
      if (card) {
        setNewAt(null)
        reveal(cardBox(card))
        setSel(new Set([`c:${card.id}`]))
        window.setTimeout(() => pulse(root.current?.querySelector(`[data-cid="${card.id}"]`) ?? null), 380)
        toastNow(
          'Already on your board',
          () => {
            setNewAt(at)
            openNewRef.current(text, true)
          },
          'Open a new one'
        )
        return
      }
    }
    setNewAt(null)
    if (!at) return
    // a blank tab's card that was clicked, when it is not the tab on screen: a new tab takes its place
    if (at.fill !== undefined && at.fill !== activeId && byId.has(at.fill)) {
      placeNext.current = { x: at.wx, y: at.wy, t: Date.now() }
      window.api.createTab(text)
      window.api.closeTab(at.fill)
      return
    }
    // the blank tab just made (the sidebar's New tab) takes the address rather than leaving an empty card
    const blank = activeId !== null ? byId.get(activeId) : undefined
    if (blank && !blank.url && !blank.private && !blank.tor && stRef.current) {
      const id = blank.id
      edit((s0) => placeCard(s0, id, { x: at.wx, y: at.wy }))
      setSel(new Set([`c:${id}`]))
      window.api.navigate(text)
      return
    }
    placeNext.current = { x: at.wx, y: at.wy, t: Date.now() }
    window.api.createTab(text)
  }
  // asking what to open: the address bar's own search popover, where the new card will go
  const openNewRef = useRef(openNew)
  useLayoutEffect(() => {
    openNewRef.current = openNew
  })
  useEffect(() => {
    if (!newAt) return
    const r = root.current?.getBoundingClientRect()
    let current = true
    void askSearch(anchorAt((r?.left ?? 0) + newAt.sx, (r?.top ?? 0) + newAt.sy)).then((text) => {
      if (!current) return
      if (text) openNewRef.current(text)
      else setNewAt(null)
    })
    return () => {
      current = false
    }
  }, [newAt, root])
  // ---- the preview: its neighbours in the same section, and opening it beside the page on screen ----
  const neighbours = (
    s0: CanvasState | null,
    id: number,
    model: (c: { id: number }) => CardModel | null
  ): number[] => {
    const c = s0?.cards.find((x) => x.id === id)
    if (!s0 || !c) return []
    return s0.cards
      .filter((x) => x.frame === c.frame && (c.frame !== null || Math.abs(x.y - c.y) < CARD_H))
      .filter((x) => {
        const m = model(x)
        return !!m && m.kind !== 'pending'
      })
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((x) => x.id)
  }
  const placeOf = (id: number): { at: number; of: number } | undefined => {
    const list = neighbours(st, id, modelFor)
    const at = list.indexOf(id)
    return at < 0 ? undefined : { at: at + 1, of: list.length }
  }
  const stepExpanded = (dir: -1 | 1): void => {
    const cur = expandedRef.current ? expandedNow.current : null
    if (cur === null) return
    const list = neighbours(stRef.current, cur, modelForRef.current)
    const at = list.indexOf(cur)
    const next = list[at + dir]
    if (next === undefined) return
    const s0 = stRef.current
    const card = s0?.cards.find((x) => x.id === next)
    if (!card) return
    reveal(cardBox(card))
    const v = vp.get()
    setSel(new Set([`c:${next}`]))
    setExpanded({
      id: next,
      from: {
        x: card.x * v.k + v.x,
        y: card.y * v.k + v.y,
        w: (card.w ?? CARD_W) * v.k,
        h: (card.h ?? CARD_H) * v.k
      }
    })
  }

  // ---- split view: the tabs side by side are one joined card on the board ----
  const splitIds = useMemo(
    () => (st && layout ? splitMembers(leaves(layout), st) : []),
    [st, layout]
  )
  const splitKey = splitIds.join(',')
  const splitTries = useRef(0)
  // the board as the split's own layout last left it: any other change (a card resized, moved) earns fresh tries
  const splitLaid = useRef<CanvasState | null>(null)
  useLayoutEffect(() => {
    splitRef.current = splitIds
  }, [splitIds])
  useEffect(() => {
    if (phaseRef.current === 'loading') return
    if (splitKey === '') {
      // no split any more (or a board saved with one from an earlier run): its cards are single cards again
      if (stRef.current?.split) edit((s0) => ({ ...s0, split: undefined }))
      return
    }
    // Checked on every change to the board, not only when the split changes: whatever laid its section out last
    // (a card added or taken out, a board from an older layout), the split keeps its room. Settles at once: an
    // arranged split comes back as the same state.
    const ids = splitKey.split(',').map(Number)
    const s0 = stRef.current
    if (s0 !== splitLaid.current) splitTries.current = 0
    if (!s0 || arrangeSplit(s0, ids) === s0) {
      splitTries.current = 0
      return
    }
    // never a loop: if arranging does not settle in a few goes, leave the board as it is (until it changes again)
    if (++splitTries.current > 3) return
    edit((s1) => arrangeSplit(s1, ids), { flip: true })
    splitLaid.current = stRef.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitKey, phase === 'loading', st])
  /** Real tab ids for cards (a found page or answer is opened as a tab first), in the same order. */
  const asTabs = async (ids: number[]): Promise<number[] | null> => {
    const out: number[] = []
    for (const id of ids) {
      if (!isVirtual(id)) {
        out.push(id)
        continue
      }
      const it = stRef.current?.items[String(id)]
      if (it?.tab !== undefined && tabsRef.current.some((t) => t.id === it.tab)) {
        out.push(it.tab)
        continue
      }
      if (!it?.url || !/^https?:/i.test(it.url)) return null
      const before = new Set(tabsRef.current.map((t) => t.id))
      window.api.createTab(it.url)
      let made: number | undefined
      for (let i = 0; i < 60 && made === undefined; i++) {
        await new Promise((r) => setTimeout(r, 100))
        made = tabsRef.current.find((t) => !before.has(t.id))?.id
      }
      if (made === undefined) return null
      const tabId = made
      edit((s0) => setItem(s0, id, { ...it, tab: tabId }))
      out.push(tabId)
    }
    return out
  }
  /** A card that is, or can become, a tab: an open tab or a page found on the web (not a note or an answer). */
  const canTab = (id: number): boolean => {
    if (!isVirtual(id)) return true
    const it = stRef.current?.items[String(id)]
    return !!it?.url && /^(https?|file):/i.test(it.url)
  }
  /**
   * Drop one page on another: they become a split view in the tabs and one joined card on the board, and the
   * canvas stays. Making the split activates the dragged tab, which would otherwise leave the canvas for it.
   */
  const joinOnBoard = async (id: number, onto: { id: number; edge: 'left' }): Promise<void> => {
    const real = await asTabs([id, onto.id])
    if (!real || real.length < 2) {
      toastNow('Those cannot be opened side by side')
      return
    }
    window.dispatchEvent(new CustomEvent('panes:canvas-expect', { detail: { id: real[0] } }))
    splitWanted.current = { ids: real, at: Date.now() }
    window.api.dropTab(real[0], real[1], onto.edge)
    setSel(new Set())
  }
  // a split just made on the board opens in the preview, side by side, once main has made it
  const splitWanted = useRef<{ ids: number[]; at: number } | null>(null)
  useEffect(() => {
    const want = splitWanted.current
    if (!want || Date.now() - want.at > 10_000) return
    if (!want.ids.every((id) => splitIds.includes(id))) return
    splitWanted.current = null
    expandRef.current(want.ids[0], true)
  }, [splitIds])
  const splitFrame = useMemo(
    () => (st && splitIds.length >= 2 ? splitBox(st, splitIds) : null),
    [st, splitIds]
  )
  const selLinks = useMemo(() => [...sel].filter((x) => x[0] === 'k').map((x) => x.slice(2)), [sel])

  // ---- exporting: a picture or PDF of the whole board, or a Markdown digest ----
  const exportBoard = async (kind: 'png' | 'pdf' | 'md'): Promise<void> => {
    const s0 = stRef.current
    const el = root.current
    if (!s0 || !el || phaseRef.current !== 'open') return
    if (privateNow()) return toastNow('Nothing is exported from a private window')
    const name = 'Canvas board'
    if (kind === 'md') {
      const text = boardDigest(
        s0,
        tabsRef.current.map((t) => ({
          id: t.id,
          url: t.url,
          title: t.aiTitle ?? t.title,
          private: t.private || t.tor
        })),
        name
      )
      if (await window.api.canvas.saveFile({ kind, name, text })) toastNow('Saved the digest')
      return
    }
    // the whole board, fitted, with nothing of the canvas's own controls over it
    const before = vp.get()
    const was = selRef.current
    flushSync(() => setSel(new Set()))
    el.classList.add('exporting')
    const { w, h } = size()
    vp.set(fitView(boundsOf(contentBoxes(s0)), w, h, 32, 2))
    await new Promise((r) => setTimeout(r, 450)) // cards that came into view draw their pictures
    const r = el.getBoundingClientRect()
    const data = await window.api.canvas.capture({
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height
    })
    el.classList.remove('exporting')
    vp.set(before)
    setSel(was)
    if (!data) return toastNow('Could not take a picture of the board')
    if (await window.api.canvas.saveFile({ kind, name, data }))
      toastNow(kind === 'pdf' ? 'Saved the PDF' : 'Saved the picture')
  }
  const applyPreset = (id: PresetId, topic: string): void => {
    const s0 = stRef.current
    if (!s0) return
    const v = vp.get()
    const near = { x: (size().w * 0.2 - v.x) / v.k, y: (size().h * 0.3 - v.y) / v.k }
    const made = addPreset(s0, id, near)
    edit(() => made.state, { flip: true, undo: `Added the ${PRESETS[id].label} board` })
    const b = presetBox(made.state, made.ids)
    if (b) vp.animateTo(fitView(b, size().w, size().h, 80, 1), 460)
    if (!topic.trim())
      return toastNow(`Type a topic after "${PRESETS[id].label}" to have it filled`)
    if (!chatReadyRef.current || privateNow())
      return toastNow('Turn on AI to have the sections filled')
    const frames = made.state.frames.filter((f) => made.ids.includes(f.id))
    asker.ask(presetAsk(id, topic, frames))
  }
  // ---- the right-click menu: what can be done with what is under the pointer ----
  const openContextRef = useRef<(t: HTMLElement, cx: number, cy: number) => void>(() => undefined)
  const openContext = (t: HTMLElement, cx: number, cy: number): void => {
    const s0 = stRef.current
    const r = root.current?.getBoundingClientRect()
    if (!s0 || !r) return
    const w = world(cx, cy)
    const at = { x: cx - r.left, y: cy - r.top }
    const show = (items: MenuEntry[], onPick: (id: string) => void, title?: string): void => {
      setCtx({ ...at, title, items, onPick })
    }
    const ask = (): void => askInDock()
    const sections = s0.frames
      .filter((f) => f.kind !== 'private')
      .map((f) => ({ id: f.id, name: f.name }))
    const moveCards = (ids: number[], to: string): void => {
      if (to === 'new') {
        const g = groupInto(stRef.current ?? s0, 'Section', ids)
        if (!g) return
        flushSync(() => edit(() => g.state, { flip: true, undo: 'Made a section' }))
        setSel(new Set([`f:${g.frameId}`]))
        setEditing(g.frameId)
        return
      }
      edit((cur) => ids.reduce((s, cid) => moveToFrame(s, cid, to, true), cur), {
        flip: true,
        undo: ids.length === 1 ? 'Moved a card' : `Moved ${ids.length} cards`
      })
    }

    const cardEl = t.closest<HTMLElement>('[data-cid]')
    if (cardEl) {
      const id = Number(cardEl.dataset.cid)
      const selCards = [...selRef.current]
        .filter((k) => k[0] === 'c')
        .map((k) => Number(k.slice(2)))
      // a card of a bigger selection: what is done to them all
      if (selCards.length > 1 && selCards.includes(id)) {
        const n = selCards.length
        const isPriv = (cid: number): boolean => {
          const it = isVirtual(cid) ? s0.items[String(cid)] : undefined
          const tb = isVirtual(cid)
            ? it?.tab !== undefined
              ? byId.get(it.tab)
              : undefined
            : byId.get(cid)
          return !!(tb && (tb.private || tb.tor))
        }
        const privCount = selCards.filter(isPriv).length
        const framesOf = [
          ...new Set(
            selCards
              .map((cid) => s0.cards.find((c) => c.id === cid)?.frame)
              .filter((fid): fid is string => !!fid)
          )
        ]
        return show(
          selectionMenu({
            n,
            private: privCount,
            canSplit: n === 2 && privCount === 0 && selCards.every(canTab),
            inSection: framesOf.length > 0,
            allTabs: selCards.every((cid) => !isVirtual(cid)),
            sections
          }),
          (act) => {
            if (act === 'ask') ask()
            else if (act === 'note') {
              for (const cid of selCards) if (!isPriv(cid)) void placeAs(cid, 'note')
            } else if (act === 'split')
              void joinOnBoard(selCards[0], { id: selCards[1], edge: 'left' })
            else if (act === 'group') moveCards(selCards, 'new')
            else if (act.startsWith('move:')) moveCards(selCards, act.slice(5))
            else if (act === 'tidy') {
              edit(
                (cur) =>
                  framesOf.reduce(
                    (s, fid) => regridFrame(s, fid, !!s.frames.find((x) => x.id === fid)?.sized),
                    cur
                  ),
                { flip: true, undo: 'Arranged sections' }
              )
            } else if (act === 'fit') fitSelection()
            else if (act === 'close') closeCards(selCards)
          },
          `${n} cards`
        )
      }
      const m = modelForRef.current({ id })
      if (!m || m.kind === 'pending') return
      setSel(new Set([`c:${id}`]))
      const card = s0.cards.find((c) => c.id === id)
      const item = isVirtual(id) ? s0.items[String(id)] : undefined
      const tab = isVirtual(id)
        ? item?.tab !== undefined
          ? byId.get(item.tab)
          : undefined
        : byId.get(id)
      const url = item?.url ?? tab?.url ?? ''
      const priv = !!(tab && (tab.private || tab.tor))
      const web = /^https?:/i.test(url)
      const canLive =
        (m.kind === 'page' || m.kind === 'video' || m.kind === 'pdf') && (!!tab || web)
      const media = m.isTab && (m.audible || m.muted || m.kind === 'video')
      return show(
        cardMenu({
          isTab: m.isTab,
          private: priv,
          canLive,
          canPop: m.isTab || !!tab || web,
          media,
          audible: m.audible,
          playing: m.playing,
          muted: m.muted,
          toggle: m.toggle,
          reader: m.reader,
          answer: m.kind === 'answer',
          note: m.kind === 'answer' && m.placement === 'note',
          canDocument: !!item && (item.kind === 'page' || (item.kind === 'answer' && !!item.url)),
          link: web,
          section: card?.frame ?? null,
          sections,
          split: splitRef.current.includes(id)
        }),
        (act) => {
          if (act === 'open') expandRef.current(id, false)
          else if (act === 'live') expandRef.current(id, true)
          else if (act === 'pop') leaveRef.current(id)
          else if (act === 'unsplit') window.api.unsplit()
          else if (act === 'play')
            void window.api.mediaPlay?.(m.id, m.playing ? 'pause' : 'play').catch(() => undefined)
          else if (act === 'mute') window.api.toggleMute(m.id)
          else if (act === 'view') onCardView(id)
          else if (act === 'ask') ask()
          else if (act === 'note') void placeAs(id, 'note')
          else if (act === 'document') void placeAs(id, 'document')
          else if (act === 'copy') void navigator.clipboard.writeText(url)
          else if (act === 'duplicate') boardClip.duplicate()
          else if (act.startsWith('move:')) moveCards([id], act.slice(5))
          else if (act === 'close') closeCards([id])
        },
        priv ? 'Private tab' : m.title || m.site
      )
    }

    const noteEl = t.closest<HTMLElement>('[data-nid]')
    if (noteEl) {
      const nid = noteEl.dataset.nid!
      const note = s0.notes.find((n) => n.id === nid)
      setSel(new Set([`n:${nid}`]))
      return show(
        noteMenu({ color: note?.color ?? 0 }),
        (act) => {
          if (act === 'edit') setEditing(nid)
          else if (act.startsWith('color:')) {
            const c = Number(act.slice(6)) % NOTE_COLORS
            edit((s1) => patchNote(s1, nid, { color: c }), { undo: 'Recoloured a note' })
          } else if (act === 'delete') {
            edit((s1) => deleteNote(s1, nid), { undo: 'Deleted 1 item' })
            setSel(new Set())
          }
        },
        'Note'
      )
    }

    const markEl = t.closest<HTMLElement>('[data-mid]')
    if (markEl) {
      const mid = markEl.dataset.mid!
      const curSel = [...selRef.current].filter((k) => k[0] === 'm').map((k) => k.slice(2))
      const ids = withGroups(s0, curSel.includes(mid) ? curSel : [mid])
      setSel(new Set(ids.map((i) => `m:${i}`)))
      const all = marksOf(s0).filter((m) => ids.includes(m.id))
      if (all.length === 0) return
      const one = all.length === 1 ? all[0] : null
      const locked = all.some((m) => m.locked)
      const shapes = all.some((m) => isShape(m.kind))
      const colors = new Set(all.map((m) => (isShape(m.kind) && m.fill === -1 ? -1 : m.color)))
      return show(
        markMenu({
          n: all.length,
          editable: !!one && !locked && (one.kind === 'text' || isShape(one.kind)),
          shapes,
          locked,
          grouped: all.some((m) => !!m.group),
          color: colors.size === 1 ? [...colors][0] : null
        }),
        (act) => {
          if (act === 'edit' && one) setEditing(one.id)
          else if (act === 'color:none')
            edit((s1) => ids.reduce((n, i) => patchMark(n, i, { fill: -1 }), s1), {
              undo: 'Restyled'
            })
          else if (act.startsWith('color:')) {
            const c = Number(act.slice(6))
            edit(
              (s1) =>
                ids.reduce((n, i) => {
                  const cur = marksOf(n).find((x) => x.id === i)
                  const p: MarkPatch =
                    cur && isShape(cur.kind) && cur.fill === -1
                      ? { color: c, fill: c }
                      : { color: c }
                  return patchMark(n, i, p)
                }, s1),
              { undo: 'Restyled' }
            )
          } else if (act === 'front' || act === 'back')
            edit((s1) => reorderMarks(s1, ids, act), {
              undo: act === 'front' ? 'Brought to front' : 'Sent to back'
            })
          else if (act === 'duplicate') duplicateSel()
          else if (act === 'group') groupSel(true)
          else if (act === 'ungroup') groupSel(false)
          else if (act === 'lock')
            edit((s1) => ids.reduce((n, i) => patchMark(n, i, { locked: !locked }), s1), {
              undo: locked ? 'Unlocked' : 'Locked'
            })
          else if (act === 'delete') deleteSelected()
        },
        all.length > 1 ? `${all.length} drawings` : 'Drawing'
      )
    }

    const headEl = t.closest<HTMLElement>('[data-fhead]')
    const f = headEl ? s0.frames.find((x) => x.id === headEl.dataset.fhead) : frameAt(s0, w.x, w.y)
    if (f) {
      setSel(new Set([`f:${f.id}`]))
      const inside = s0.cards.filter((c) => c.frame === f.id).length
      return show(
        sectionMenu({ inside, sized: !!f.sized, color: f.color ?? null }),
        (act) => {
          if (act === 'rename') startRename(f.id)
          else if (act === 'fit') {
            const { w: sw, h: sh } = size()
            vp.animateTo(fitView(f, sw, sh, 120, 1.2))
          } else if (act.startsWith('color:')) {
            const v = act.slice(6)
            onFrameColor(f.id, v === 'none' ? null : Number(v))
          } else if (act === 'tidy')
            edit((s1) => regridFrame(s1, f.id, !!f.sized), { flip: true, undo: 'Arranged a section' })
          else if (act === 'shrink')
            edit((s1) => unsizeFrame(s1, f.id), { flip: true, undo: 'Fitted a section' })
          else if (act === 'ungroup')
            edit((s1) => deleteFrame(s1, f.id), { undo: 'Ungrouped a section' })
          else if (act === 'delete') onFrameDelete(f.id)
        },
        f.name
      )
    }

    // the board itself: what is made goes where it was clicked
    setSel(new Set())
    const topUndo = undoStack.current[undoStack.current.length - 1]?.label ?? null
    show(
      boardMenu({
        empty: contentBoxes(s0).length === 0,
        paste: true,
        canPaste: boardClip.canPaste,
        undo: topUndo
      }),
      (act) => {
        if (act === 'page') askNew(at.x, at.y)
        else if (act === 'note') {
          const made = addNote(stRef.current!, { x: w.x - 92, y: w.y - 66 }, stRef.current!.notes.length)
          edit(() => made.state, { undo: 'Added a note' })
          setSel(new Set([`n:${made.id}`]))
          setEditing(made.id)
        } else if (act === 'text') addBlockAt('body', { x: w.x, y: w.y })
        else if (act === 'section') {
          const made = addFrame(
            stRef.current!,
            { x: w.x - 280, y: w.y - 40, w: 560, h: 400 },
            'Section'
          )
          flushSync(() => edit(() => made.state, { flip: true, undo: 'Made a section' }))
          setSel(new Set([`f:${made.id}`]))
          setEditing(made.id)
        } else if (act === 'paste') void boardClip.pasteAt(w)
        else if (act === 'tidy') void runTidy(false)
        else if (act === 'settings') window.api.openInternal('settings')
        else if (act === 'fit') fitAll()
        else if (act === 'all') {
          const cur = stRef.current
          if (cur)
            setSel(
              new Set([
                ...cur.cards.map((c) => `c:${c.id}`),
                ...cur.notes.map((n) => `n:${n.id}`),
                ...marksOf(cur).map((m) => `m:${m.id}`)
              ])
            )
        } else if (act === 'undo') {
          const said = undo()
          toastNow(said ? `Undid: ${said}` : 'Nothing to undo')
        } else if (act === 'ask') ask()
        else if (act === 'export:png') void exportBoard('png')
        else if (act === 'export:pdf') void exportBoard('pdf')
        else if (act === 'export:md') void exportBoard('md')
      }
    )
  }
  useLayoutEffect(() => {
    openContextRef.current = openContext
  })
  // a card's own menu button (and a right-click on it) open the same menu
  const onPlace = useCallback((id: number, x: number, y: number): void => {
    const el = root.current?.querySelector<HTMLElement>(`[data-cid="${id}"]`)
    if (el) openContextRef.current(el, x, y)
    // root is a ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  /** What the command menu offers; built when it opens, so it sees the board as it is. */
  const commands = (): Command[] => {
    const v = vp.get()
    const mid = { x: (size().w / 2 - v.x) / v.k, y: (size().h * 0.42 - v.y) / v.k }
    const shape = (k: ShapeKind, label: string, keys?: string): Command => ({
      id: `shape:${k}`,
      label: `Shape: ${label}`,
      also: 'draw',
      keys,
      run: () => {
        const made = addShape(stRef.current!, k, mid, { x: mid.x + 180, y: mid.y + 110 })
        if (made && edit(() => made.state, { undo: 'Drew a shape' }))
          setSel(new Set([`m:${made.id}`]))
      }
    })
    return [
      {
        id: 'note',
        label: 'New note',
        also: 'sticky',
        keys: 'S',
        run: () => {
          const r = addNote(stRef.current!, { x: mid.x - 92, y: mid.y - 66 }, stRef.current!.notes.length)
          edit(() => r.state, { undo: 'Added a note' })
          setSel(new Set([`n:${r.id}`]))
          setEditing(r.id)
        }
      },
      {
        id: 'frame',
        label: 'New section',
        also: 'frame',
        keys: 'F',
        run: () => {
          const r = addFrame(
            stRef.current!,
            { x: mid.x - 280, y: mid.y - 200, w: 560, h: 400 },
            'Section'
          )
          flushSync(() => edit(() => r.state, { flip: true, undo: 'Made a section' }))
          setSel(new Set([`f:${r.id}`]))
          setEditing(r.id)
        }
      },
      {
        id: 'page',
        label: 'New page',
        also: 'tab open address',
        keys: 'Ctrl+T',
        run: () => askNew()
      },
      { id: 'heading', label: 'Heading', also: 'title text', run: () => addBlockAt('heading') },
      { id: 'body', label: 'Text', also: 'body label', keys: 'T', run: () => addBlockAt('body') },
      { id: 'table', label: 'Table', also: 'grid', run: () => addBlockAt('table') },
      {
        id: 'checklist',
        label: 'Checklist',
        also: 'todo tasks',
        run: () => addBlockAt('checklist')
      },
      { id: 'code', label: 'Code block', also: 'snippet', run: () => addBlockAt('code') },
      shape('rounded', 'Rounded rectangle', 'R'),
      shape('rect', 'Rectangle'),
      shape('ellipse', 'Ellipse', 'O'),
      shape('diamond', 'Diamond'),
      shape('arrow', 'Arrow'),
      shape('star', 'Star'),
      shape('bubble', 'Speech bubble'),
      {
        id: 'tidy',
        label: 'Arrange by topic',
        also: 'tidy rearrange sort group reset',
        keys: 'Shift+T',
        run: () => void runTidy(false)
      },
      { id: 'ask', label: 'Ask', also: 'question chat ai', keys: '', run: () => askInDock() },
      {
        id: 'settings',
        label: 'Settings',
        also: 'preferences options',
        keys: '',
        run: () => window.api.openInternal('settings')
      },
      {
        id: 'find',
        label: 'Find a card',
        also: 'search tab look for',
        keys: 'Ctrl+F',
        run: () => setQuick((q) => q ?? '')
      },
      { id: 'fit', label: 'Fit everything', also: 'zoom', keys: 'Shift+1', run: fitAll },
      {
        id: 'history',
        label: 'Undo history',
        also: 'steps back',
        run: () => undoDepth > 0 && openHistory()
      },
      ...PRESET_IDS.map((p): Command => ({
        id: `preset:${p}`,
        label: `${PRESETS[p].label} board`,
        also: `preset template ${PRESETS[p].frames.join(' ')}`,
        run: (topic) => applyPreset(p, topic)
      })),
      {
        id: 'png',
        label: 'Export as image',
        also: 'png picture save',
        run: () => void exportBoard('png')
      },
      { id: 'pdf', label: 'Export as PDF', also: 'save print', run: () => void exportBoard('pdf') },
      {
        id: 'md',
        label: 'Export a Markdown digest',
        also: 'notes links summary save',
        run: () => void exportBoard('md')
      }
    ]
  }

  // ---- render ----
  const s = st
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of st?.cards ?? []) if (c.frame) m.set(c.frame, (m.get(c.frame) ?? 0) + 1)
    return m
  }, [st])
  const onClose = useCallback((id: number) => closeCards([id]), [closeCards])
  const onPdf = useCallback(
    (id: number, f: { pages: number }): void => {
      const cur = stRef.current?.items[String(id)]
      if (cur && cur.pages !== f.pages) edit((s) => setItem(s, id, { ...cur, pages: f.pages }))
    },
    [edit]
  )
  /** Only drawings are selected and none is being typed in: their bar shows above them. */
  const selMarkBar = useMemo(() => {
    const keys = [...sel]
    if (!st || keys.length === 0 || keys.some((k) => k[0] !== 'm')) return null
    const ids = new Set(keys.map((k) => k.slice(2)))
    const marks = marksOf(st).filter((m) => ids.has(m.id))
    const box = boundsOf(marks.map(markBox))
    if (!box || marks.some((m) => m.id === markEdit)) return null
    const units = new Set(marks.map((m) => m.group ?? `#${m.id}`)).size
    return { marks, box, units }
  }, [sel, st, markEdit])
  const selFrame = useMemo(() => {
    const keys = [...sel]
    if (keys.length !== 1 || keys[0][0] !== 'f') return null
    return st?.frames.find((f) => f.id === keys[0].slice(2)) ?? null
  }, [sel, st])
  const flying = ghostId !== null ? byId.get(ghostId) : undefined
  const ghostSrc =
    ghostId !== null && flying && !flying.private && !flying.tor
      ? (thumbs[ghostId] ?? benchThumbs[ghostId])
      : undefined

  return (
    <div
      ref={root}
      className={
        'cv ' +
        phase +
        (swap ? ' swap' : '') +
        (reduced ? ' reduced' : '') +
        (lod ? ' lod' : '') +
        (tool === 'hand' ? ' hand' : '') +
        (tool !== 'select' && tool !== 'hand' ? ' draw' : '') +
        (dim ? ' dim' : '') +
        (expanded ? ' reading' : '') +
        (asker.open ? ' docked' : '')
      }
      style={{ '--dock-w': `${dockW}px` } as React.CSSProperties}
      role="application"
      aria-label="Tab canvas"
      onDragOver={(e) => {
        const types = e.dataTransfer.types
        if (phase !== 'open' || !(types.includes('Files') || types.includes('text/uri-list')))
          return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        if (phase !== 'open') return
        e.preventDefault()
        const w0 = world(e.clientX, e.clientY)
        const files = [...e.dataTransfer.files]
        const uri = e.dataTransfer
          .getData('text/uri-list')
          .split('\n')
          .find((l) => /^https?:/i.test(l.trim()))
        const text = files.length ? '' : (uri ?? e.dataTransfer.getData('text/plain'))
        void putAt({ x: w0.x, y: w0.y }, files.map(incoming), text)
      }}
      onPointerDown={onDown}
      onPointerMove={onHover}
      onPointerLeave={() => conn.current?.hover(null)}
      onDoubleClick={(e) => {
        const t = e.target as HTMLElement
        const crz = t.closest<HTMLElement>('[data-crz]')
        if (crz?.dataset.crzc) {
          const cid = Number(crz.dataset.crzc)
          fitCardSize(cid)
          return
        }
        const rz = t.closest<HTMLElement>('[data-rz]')
        if (rz?.dataset.rzf) {
          const fid = rz.dataset.rzf
          edit((s0) => unsizeFrame(s0, fid), { flip: true, undo: 'Fitted a section' })
          return
        }
        // a drawing: type in it (a pen line has no text)
        const s0 = stRef.current
        if (
          s0 &&
          toolRef.current === 'select' &&
          !t.closest('.cv-fbar,.cv-bar,button,input,textarea')
        ) {
          const w0 = world(e.clientX, e.clientY)
          const mk = markAt(s0, w0.x, w0.y, 6 / vp.get().k)
          if (mk && !mk.pts && !mk.locked) {
            setSel(new Set([`m:${mk.id}`]))
            setMarkEdit(mk.id)
            return
          }
        }
        const link = (t as Element).closest?.('[data-kid]') as HTMLElement | null
        if (link?.dataset.kid && !t.closest('[data-cid],[data-nid],input')) {
          setSel(new Set([`k:${link.dataset.kid}`]))
          setEditing(link.dataset.kid)
          return
        }
        const el = t.closest<HTMLElement>('[data-cid]')
        if (el && !t.closest('.cv-expand,button')) expand(Number(el.dataset.cid))
        else if (
          !el &&
          toolRef.current === 'select' &&
          !t.closest(
            '[data-nid],[data-fhead],.cv-bar,.cv-toast,.cv-expand,.cv-kbar,.cv-fbar,.cv-top,.cv-new,.cv-dock,.cv-dock-handle,.cv-playing,.cv-ctx,button,input,textarea,a'
          )
        ) {
          const r = root.current!.getBoundingClientRect()
          askNew(e.clientX - r.left, e.clientY - r.top)
        }
      }}
      onContextMenu={(e) => {
        // text fields (the Ask box, a note, a frame's name) keep the usual cut / copy / paste menu
        if (isEditable(e.target)) return
        // the conversation, the preview and the board's own bars are not the board: no board menu there
        if ((e.target as HTMLElement).closest('.cv-dock,.cv-expand,.cv-bar,.cv-ctx')) return
        e.preventDefault()
        if (phaseRef.current === 'open') openContext(e.target as HTMLElement, e.clientX, e.clientY)
      }}
    >
      <div ref={grid} className="cv-grid" aria-hidden="true" />
      <div ref={layer} className="cv-board">
        {s?.frames.map((f) => (
          <FrameView
            key={f.id}
            frame={f}
            count={counts.get(f.id) ?? 0}
            selected={sel.has(`f:${f.id}`)}
            editing={editing === f.id}
            onRename={onRename}
            onEdit={startRename}
            onFan={fanOut}
          />
        ))}
        {s?.notes.map((n) => (
          <NoteView
            key={n.id}
            note={n}
            selected={sel.has(`n:${n.id}`)}
            editing={editing === n.id}
            onText={onNoteText}
            onEdit={setEditing}
            onColor={onNoteColor}
            onSize={onNoteSize}
            first={editing === n.id ? firstKey : null}
          />
        ))}
        {(() => {
          const b = splitFrame
          return b ? (
            <div
              className={'cv-splitbox' + (b.inFrame ? ' framed' : '')}
              data-splitbox=""
              style={{
                transform: `translate3d(${b.x}px, ${b.y}px, 0)`,
                width: b.w,
                height: b.h
              }}
            >
              <div className="cv-splithead">
                <span data-splithead="" title="Drag to move the split view">
                  Split view
                </span>
                <button
                  type="button"
                  title="Open the split view: its pages side by side"
                  aria-label="Open the split view"
                  onClick={() => expandRef.current(splitIds[0], true)}
                >
                  <ExpandIcon />
                </button>
                <button
                  type="button"
                  className="cv-unsplit"
                  title="Unsplit: the tabs stay open, each on its own"
                  aria-label="Unsplit"
                  onClick={() => window.api.unsplit()}
                >
                  <UnsplitIcon />
                </button>
              </div>
            </div>
          ) : null
        })()}
        {shownCards(s ?? emptyState()).map((c) => {
          if (!vis.has(c.id)) return null
          const m = modelFor(c)
          if (!m) return null
          const cw = c.w ?? CARD_W
          const ch = c.h ?? CARD_H
          return (
            <CardView
              key={c.id}
              m={m}
              x={c.x}
              y={c.y}
              w={cw}
              h={ch}
              selected={sel.has(`c:${c.id}`)}
              fresh={fresh.has(c.id)}
              lod={lod}
              hidden={expanded?.id === c.id && expandedCovers}
              rank={ranks.get(c.id) ?? 0}
              onClose={onClose}
              onExpand={onExpand}
              onPdf={onPdf}
              onView={onCardView}
              onLink={onCardLink}
              onPlace={onPlace}
              onVideoAspect={onVideoAspect}
              onStill={onStill}
              live={
                streams.has(c.id) ? Math.max(40, Math.round((cw * zoomPct) / 100 / 40) * 40) : 0
              }
              call={calls.has(c.id)}
            />
          )
        })}
        {s && marksOf(s).length > 0 && (
          <Marks
            marks={marksOf(s)}
            selected={sel}
            editing={markEdit}
            onText={onMarkText}
            onToggle={onMarkToggle}
            first={firstKey}
            onFit={onMarkFit}
          />
        )}
        <svg className="cv-marks" aria-hidden="true">
          <path ref={draft} className="cv-draft" d="" />
        </svg>
        {s && (
          <Connectors
            ref={conn}
            state={s}
            selected={selLinks}
            editing={editing}
            fresh={freshLink}
            handles={tool === 'select' || tool === 'connector'}
            style={linkStyle}
            reduced={reduced}
            onLabel={onLinkLabel}
            onPatch={onLinkPatch}
            onEditLabel={setEditing}
            onDelete={deleteLinks}
          />
        )}
        <svg ref={guides} className="cv-guides" width="1" height="1" overflow="visible" />
        {selMarkBar && phase === 'open' && (
          <MarkBar
            marks={selMarkBar.marks}
            box={selMarkBar.box}
            below={selMarkBar.box.y * vp.get().k + vp.get().y < 72}
            units={selMarkBar.units}
            onPatch={(p) =>
              patchSel(p, p.locked !== undefined ? (p.locked ? 'Locked' : 'Unlocked') : 'Restyled')
            }
            onAlign={(how) => {
              const ids = selMarkIds()
              edit((s0) => alignMarks(s0, ids, how), { undo: 'Aligned' })
            }}
            onDistribute={(axis) => {
              const ids = selMarkIds()
              edit((s0) => distributeMarks(s0, ids, axis), { undo: 'Spaced evenly' })
            }}
            onGroup={groupSel}
            onOrder={(to) => {
              const ids = selMarkIds()
              edit((s0) => reorderMarks(s0, ids, to), {
                undo: to === 'front' ? 'Brought to front' : 'Sent to back'
              })
            }}
            onDuplicate={duplicateSel}
            onDelete={deleteSelected}
          />
        )}
      </div>
      {selFrame &&
        editing !== selFrame.id &&
        phase === 'open' &&
        barShut !== sel &&
        (() => {
          const v = vp.get()
          const top = selFrame.y * v.k + v.y
          const below = top < 64
          return (
            <FrameBar
              frame={selFrame}
              at={{
                x: (selFrame.x + selFrame.w / 2) * v.k + v.x,
                y: below ? Math.max(top, 0) + FRAME_HEAD_PX : top,
                below
              }}
              onColor={onFrameColor}
              onRename={startRename}
              onDelete={onFrameDelete}
            />
          )
        })()}
      {phase !== 'loading' && (
        <div
          className={'cv-top' + (expanded ? ' under' : '')}
          role="toolbar"
          aria-label="Canvas"
          inert={!!expanded}
        >
          {/* the board is the whole window (no top bar under it): the window's own buttons live here */}
          {window.api.platform !== 'darwin' && <WindowControls />}
          <button
            type="button"
            className="cv-back"
            title="Back to tabs"
            onClick={() => leaveRef.current(null)}
          >
            <span>Back to tabs</span>
          </button>
          {/* always there, even with one space: it is the only way to switch or make a space on the board */}
          {spaces.length > 0 && (
            <div className="cv-spaces">
              <SpaceSwitcher
                spaces={spaces}
                activeSpaceId={spaceId}
                placement="down"
                dir={spaceDir}
                size={18}
              />
            </div>
          )}
          {undoDepth > 0 && (
            <div className="cv-hist-host">
              <button
                type="button"
                className="cv-newbtn cv-iconbtn"
                title="History"
                aria-label="History"
                aria-haspopup="menu"
                aria-expanded={history !== null}
                onClick={() => (history ? setHistory(null) : openHistory())}
              >
                <HistoryIcon />
              </button>
              {history && (
                <HistoryList
                  steps={history}
                  onPick={(i) => {
                    setHistory(null)
                    const said = undo(i + 1)
                    if (said) toastNow(i === 0 ? `Undid: ${said}` : `Went back ${i + 1} steps`)
                  }}
                  onClose={() => setHistory(null)}
                />
              )}
            </div>
          )}
        </div>
      )}
      {cmdOpen && (
        <CommandMenu
          commands={commands}
          canAsk={aiAvailable}
          onAsk={(q) => asker.ask(q)}
          onFind={(q) => {
            asker.close()
            finder.run(q)
          }}
          onClose={() => setCmdOpen(false)}
        />
      )}
      <div ref={marquee} className="cv-marquee" />
      <div ref={drawBox} className="cv-draw" />
      {phase !== 'loading' && (
        <div ref={ghost} className="cv-ghost" aria-hidden="true">
          {ghostSrc && <img src={ghostSrc} alt="" draggable={false} />}
        </div>
      )}
      {s && s.cards.length === 0 && phase === 'open' && (
        <p className="cv-empty">Nothing here yet. Open a page, or find or ask something below.</p>
      )}
      {quick !== null && (
        <div className="cv-quick" role="search">
          <SearchGlyph />
          <input
            autoFocus
            value={quick}
            placeholder="Find a card: title, site or words on the page"
            aria-label="Find a card on the board"
            spellCheck={false}
            onChange={(e) => {
              setQuick(e.target.value)
              setQuickAt(0)
            }}
            onKeyDown={(e) => {
              e.stopPropagation() // the board's own keys (tools, delete) stay out of it
              const n = quickHits.length
              if (e.key === 'Escape') setQuick(null)
              else if (e.key === 'Enter' && quickPick !== null) {
                const id = quickPick
                setQuick(null)
                expandRef.current(id)
              } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') && n) {
                e.preventDefault()
                const back = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)
                setQuickAt((i) => (Math.min(i, n - 1) + (back ? n - 1 : 1)) % n)
              }
            }}
            onBlur={() => {
              if (!quick) setQuick(null)
            }}
          />
          <span className="cv-quick-n" aria-live="polite">
            {quick
              ? quickHits.length
                ? `${Math.min(quickAt, quickHits.length - 1) + 1} of ${quickHits.length}`
                : 'No card has that'
              : 'Enter opens, arrows move'}
          </span>
        </div>
      )}
      {toast && (
        <div className="cv-toast" role="status" key={toast.key}>
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                toast.undo?.()
                setToast(null)
              }}
            >
              {toast.label ?? 'Undo'}
            </button>
          )}
        </div>
      )}
      {aiOff && !finder.confirm && (
        <div className="cv-aioff" role="status">
          <span>AI is off. Tabs still group by site, and the prompt finds by words.</span>
          <button
            type="button"
            className="primary"
            onClick={() => window.api.chatAction('enable-ai')}
          >
            Turn on AI
          </button>
        </div>
      )}
      {finder.confirm && (
        <div className="cv-confirm" role="alertdialog" aria-label="Confirm">
          <span>{finder.confirm.detail}</span>
          <button type="button" onClick={() => finder.answerConfirm(false)}>
            Not now
          </button>
          <button type="button" className="primary" onClick={() => finder.answerConfirm(true)}>
            Allow
          </button>
        </div>
      )}
      {expanded && (
        <Expanded
          key={expanded.id}
          startLive={expanded.live}
          onLive={onPreviewLive}
          onAsk={askInDock}
          m={modelFor({ id: expanded.id }) ?? EMPTY_MODEL}
          from={expanded.from}
          stage={asker.open ? { w: Math.max(320, stage.w - dockShown), h: stage.h } : stage}
          tab={isVirtual(expanded.id) ? st?.items[String(expanded.id)]?.tab : expanded.id}
          page={byId.get(
            (isVirtual(expanded.id) ? st?.items[String(expanded.id)]?.tab : expanded.id) ?? -1
          )}
          url={st?.items[String(expanded.id)]?.url ?? byId.get(expanded.id)?.url}
          file={st?.items[String(expanded.id)]?.file}
          reduced={reduced}
          answerLinks={(href) => finder.openLink(href)}
          cardBox={() => {
            const c = stRef.current?.cards.find((x) => x.id === expanded.id)
            if (!c) return null
            const v = vp.get()
            const b = cardBox(c)
            return { x: b.x * v.k + v.x, y: b.y * v.k + v.y, w: b.w * v.k, h: b.h * v.k }
          }}
          split={
            splitIds.includes(expanded.id)
              ? splitIds.map((id) => ({ tab: id, snap: thumbs[id] }))
              : undefined
          }
          onCover={setExpandedCovers}
          onClose={() => {
            setExpandedCovers(false)
            setExpanded(null)
          }}
          onGoToTab={() => goToTab(expanded.id)}
          onTab={(tabId) => {
            const it = st?.items[String(expanded.id)]
            if (it) edit((s0) => setItem(s0, expanded.id, { ...it, tab: tabId }))
          }}
          onText={(text) => {
            const it = st?.items[String(expanded.id)]
            if (it) edit((s0) => setItem(s0, expanded.id, { ...it, text }))
          }}
          onStep={(dir) => stepExpanded(dir)}
          place={placeOf(expanded.id)}
        />
      )}
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          title={ctx.title}
          items={ctx.items}
          avoid={
            asker.open
              ? [{ x: Math.max(0, stage.w - dockShown), y: 0, w: dockShown, h: stage.h }]
              : []
          }
          onPick={ctx.onPick}
          onClose={closeContext}
        />
      )}
      <AskDock
        ask={asker}
        enabled={aiAvailable}
        busy={asker.streaming || finder.busy || busy}
        onShow={askInDock}
        onSubmit={onPrompt}
        mentionable={allTabs
          .filter((t) => !t.private && !t.tor && /^(https?|file):/i.test(t.url))
          .map((t) => ({ tab: t.id, title: t.aiTitle ?? t.title ?? t.url }))}
        titles={allTabs
          .filter((t) => !t.private && !t.tor && t.url)
          .map((t) => t.aiTitle ?? t.title)}
        onOpen={openSource}
        onAdd={addToCanvas}
        onExample={(q) => asker.ask(q)}
        onResize={resizeDock}
        inputRef={dockInput}
        confirm={toolConfirm}
        canUndo={undoDepth > 0}
        onUndo={() => {
          const said = undo()
          toastNow(said ? `Undid: ${said}` : 'Nothing to undo')
        }}
      />
      {waiting.length > 0 && phase === 'open' && !expanded && quick === null && (
        <div className="cv-inbox" role="group" aria-label="New messages in your tabs">
          {waiting.slice(0, 5).map((t) => (
            <button
              key={t.id}
              type="button"
              title={`${t.aiTitle || t.title || 'A tab'}: ${attentionLabel(t.attention)}. Open it`}
              aria-label={`${t.aiTitle || t.title || 'A tab'}, ${attentionLabel(t.attention)}`}
              onClick={() => {
                const c = stRef.current?.cards.find((x) => x.id === t.id)
                if (!c) return
                reveal(cardBox(c))
                expandRef.current(t.id, true)
              }}
            >
              <TabFavicon tab={t} noSpinner />
            </button>
          ))}
          {waiting.length > 5 && <span className="cv-inbox-more">+{waiting.length - 5}</span>}
        </div>
      )}
      {playing.length > 0 && phase === 'open' && !expanded && (
        <div
          className={'cv-playing' + (playList ? ' open' : '')}
          role="group"
          aria-label="Playing on the board"
          ref={playBox}
        >
          <div className="cv-playing-row">
            <PlayingItem t={playing[0]} onGo={goToPlaying} onForget={forgetPlaying} />
            {playing.length > 1 && (
              <button
                type="button"
                className="cv-playing-more"
                aria-expanded={playList}
                aria-label={`${playing.length - 1} more playing`}
                title="Everything playing on the board"
                onClick={() => setPlayList((o) => !o)}
              >
                +{playing.length - 1}
              </button>
            )}
          </div>
          {playList &&
            playing
              .slice(1)
              .map((t) => (
                <PlayingItem key={t.id} t={t} onGo={goToPlaying} onForget={forgetPlaying} />
              ))}
        </div>
      )}
      <Toolbar
        tool={tool}
        zoom={zoomPct}
        busy={busy}
        finding={finder.busy || asker.streaming}
        asking={asker.open}
        showPrompt={!aiAvailable}
        promptRef={promptRef}
        shapeKind={shapeKind}
        onShapeKind={setShapeKind}
        onBlock={addBlockAt}
        mentionable={allTabs
          .filter((t) => !t.private && !t.tor && /^(https?|file):/i.test(t.url))
          .map((t) => ({ tab: t.id, title: t.aiTitle ?? t.title ?? t.url }))}
        onMention={asker.mention}
        onPrompt={onPrompt}
        onTool={setToolBoth}
        onTidy={() => void runTidy(false)}
        onSettings={() => window.api.openInternal('settings')}
        onFit={fitAll}
        onZoom={stepZoom}
      />
    </div>
  )
}

const benchThumbs: Record<number, string> = {}

const EMPTY_MODEL: CardModel = {
  id: 0,
  kind: 'page',
  title: '',
  site: '',
  reader: false,
  toggle: false,
  tor: false,
  audible: false,
  muted: false,
  ringing: false,
  current: false,
  isTab: false,
  streaming: false
}

const centerOf = (b: Box): { x: number; y: number } => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/**
 * Whether a page card shows its words or its picture: what the person picked for it, else words for a document and
 * the picture for an app-like page. It can be switched when it has both.
 */
function readerOf(
  page: boolean,
  documentLike: boolean,
  hasText: boolean,
  hasSnap: boolean,
  picked: 'reader' | 'snapshot' | undefined
): { reader: boolean; toggle: boolean } {
  if (!page) return { reader: false, toggle: false }
  const reader =
    picked === 'snapshot' && hasSnap ? false : picked === 'reader' && hasText ? true : documentLike
  return { reader, toggle: hasText && hasSnap }
}

const hit = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const px = (r: { left: number; top: number; width: number; height: number }): Keyframe => ({
  left: `${r.left}px`,
  top: `${r.top}px`,
  width: `${r.width}px`,
  height: `${r.height}px`
})
