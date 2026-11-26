import { tidyMenu, type MenuAction, type MenuEntry } from '../menu'
import { FRAME_COLORS, NOTE_COLOR_NAMES, NOTE_COLORS } from './canvas'
import { MARK_COLORS } from './canvasMarks'

/**
 * What the board's right-click menu holds for what is under the pointer: a card, a selection of cards, a section, a
 * note, drawings, or the board itself. Most used first, grouped by separators; what does not apply now is shown
 * disabled, what never applies to this kind of thing is left out. Ids are what Canvas runs; a parameter follows a
 * colon (`color:3`, `move:f12`). Shortcut hints are the board's real keys.
 */

export interface SectionRef {
  id: string
  name: string
}

/** Sections a card can be moved to (not the one it is in), and a new one. */
function moveTo(sections: readonly SectionRef[], current: string | null, n = 1): MenuAction {
  const others = sections.filter((f) => f.id !== current)
  return {
    id: 'move',
    label: 'Move to section',
    items: [
      ...others.map((f) => ({ id: `move:${f.id}`, label: f.name || 'Section' })),
      ...(others.length ? (['sep'] as const) : []),
      { id: 'move:new', label: n > 1 ? 'New section with these' : 'New section' }
    ]
  }
}

export interface CardFacts {
  /** A real tab (else a card that only lives on the board: a found page, an answer, a file). */
  isTab: boolean
  private: boolean
  /** It can open as the live page. */
  canLive: boolean
  /** It is, or can become, a tab. */
  canPop: boolean
  /** Its page plays or can play (a video, something audible or muted). */
  media: boolean
  audible: boolean
  /** Its media plays, sound or not; when missing, `audible` stands in. */
  playing?: boolean
  muted: boolean
  /** It can switch between the reader text and the page picture; `reader` is which it shows. */
  toggle: boolean
  reader: boolean
  /** It is text already (an answer or a note). */
  answer: boolean
  /** It is already shown as a note. */
  note: boolean
  /** A found page: it can show as a document. */
  canDocument: boolean
  /** An http(s) address it can copy. */
  link: boolean
  section: string | null
  sections: readonly SectionRef[]
  /** Its tab is in the split view: it can be taken apart. */
  split?: boolean
  /** AI is on and ready (else what needs it is left out of the menu). */
  ai?: boolean
  /** In a shared space: it can be shown live to everyone ('start'), or it is ('stop'); missing: not offered. */
  live?: 'start' | 'stop'
  /**
   * In a shared space: the tab can be shared with everyone ('start'), or it is ('stop'), or it is but went on to
   * another site, so the others keep its last page ('paused': share this page, or stop); missing: not offered.
   */
  share?: 'start' | 'stop' | 'paused'
}

/**
 * A tab's place in a shared space, for every menu that offers it (a card's, the preview's More, a tab's in the
 * board's strip): presented live, and shared with everyone. Missing: not offered there.
 */
export interface ShareFacts {
  live?: 'start' | 'stop'
  share?: 'start' | 'stop' | 'paused'
}
export type ShareAct = 'share-tab' | 'share-here' | 'share-live'
export const isShareAct = (v: unknown): v is ShareAct =>
  v === 'share-tab' || v === 'share-here' || v === 'share-live'

/** Sharing facts from the other side of IPC, checked; null for none. */
export function parseShareFacts(v: unknown): ShareFacts | null {
  const o = v as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const live = o.live === 'start' || o.live === 'stop' ? o.live : undefined
  const share =
    o.share === 'start' || o.share === 'stop' || o.share === 'paused' ? o.share : undefined
  return live || share ? { ...(live ? { live } : {}), ...(share ? { share } : {}) } : null
}

/** The sharing items, worded and ordered the same in every menu. */
export function shareItems(f: ShareFacts): MenuAction[] {
  return [
    ...(f.share === 'paused' ? [{ id: 'share-here', label: 'Share this page' }] : []),
    ...(f.share
      ? [{ id: 'share-tab', label: f.share === 'start' ? 'Share with everyone' : 'Stop sharing' }]
      : []),
    ...(f.live
      ? [{ id: 'share-live', label: f.live === 'stop' ? 'Stop presenting' : 'Present live' }]
      : [])
  ]
}

/**
 * Someone else's tab on a shared board: what this person can do with it. It is theirs, so nothing that would change
 * it (moving, closing, sharing); opening it here makes a tab of this person's own. Hiding takes it off this board only.
 */
export function othersMenu(f: { owner: string; live: boolean; link: boolean }): MenuEntry[] {
  const first = f.owner.split(' ')[0] || f.owner
  return tidyMenu([
    { id: 'open', label: f.live ? `Watch ${first}'s tab live` : 'Open', keys: 'Enter' },
    { id: 'pop', label: 'Open as my own tab', disabled: !f.link },
    { id: 'copy', label: 'Copy link', disabled: !f.link },
    'sep',
    { id: 'hide', label: `Hide ${first}'s tab from my board` }
  ])
}

export function cardMenu(f: CardFacts): MenuEntry[] {
  const ai = !f.private
  const aiOn = f.ai !== false
  return tidyMenu([
    { id: 'open', label: 'Open', keys: 'Enter' },
    { id: 'live', label: 'Open live', disabled: !f.canLive },
    { id: 'pop', label: 'Pop out as a tab', disabled: !f.canPop },
    ...(f.split ? [{ id: 'unsplit', label: 'Unsplit' }] : []),
    ...(f.share || f.live ? ['sep' as const] : []),
    ...shareItems(f),
    'sep',
    ...(f.media
      ? [
          { id: 'play', label: (f.playing ?? f.audible) ? 'Pause' : 'Play' },
          {
            id: 'mute',
            label: f.muted ? 'Unmute' : 'Mute',
            disabled: !f.audible && !f.muted
          }
        ]
      : []),
    ...(f.toggle ? [{ id: 'view', label: f.reader ? 'Show the page' : 'Show as reader' }] : []),
    'sep',
    ...(aiOn
      ? [
          { id: 'ask', label: 'Ask about this', disabled: !ai },
          { id: 'note', label: 'Make a note of it', disabled: !ai || f.note },
          ...(f.canDocument ? [{ id: 'document', label: 'Show as document', disabled: !ai }] : [])
        ]
      : []),
    'sep',
    { id: 'copy', label: 'Copy link', disabled: !f.link || f.private },
    { id: 'duplicate', label: 'Duplicate', disabled: f.private || (!f.link && !f.answer) },
    { ...moveTo(f.sections, f.section), disabled: f.private },
    'sep',
    {
      id: 'close',
      label: f.isTab ? 'Close tab' : 'Remove from the board',
      keys: 'Del',
      danger: true
    }
  ])
}

export interface SelectionFacts {
  n: number
  /** How many of them are private (nothing about them goes to a model). */
  private: number
  /** Exactly two that can become tabs: they can be opened side by side. */
  canSplit: boolean
  /** Some of them sit in a section (it can be tidied). */
  inSection: boolean
  /** All of them are real tabs (the close label says so). */
  allTabs: boolean
  sections: readonly SectionRef[]
  /** AI is on and ready (else what needs it is left out of the menu). */
  ai?: boolean
}

export function selectionMenu(f: SelectionFacts): MenuEntry[] {
  const open = f.n - f.private
  return tidyMenu([
    ...(f.ai !== false
      ? [
          { id: 'ask', label: `Ask about these ${f.n}`, disabled: open === 0 },
          { id: 'note', label: `Make notes of these ${f.n}`, disabled: open === 0 }
        ]
      : []),
    { id: 'split', label: 'Open side by side', disabled: !f.canSplit },
    'sep',
    { id: 'group', label: 'Group into a section', disabled: f.private > 0 },
    { ...moveTo(f.sections, null, f.n), disabled: f.private > 0 },
    { id: 'tidy', label: 'Arrange their sections', disabled: !f.inSection },
    { id: 'fit', label: 'Zoom to fit', keys: 'Shift+2' },
    'sep',
    {
      id: 'close',
      label: f.allTabs ? `Close ${f.n} tabs` : `Remove ${f.n} cards`,
      keys: 'Del',
      danger: true
    }
  ])
}

export interface SectionFacts {
  /** Cards inside it. */
  inside: number
  /** Its size was set by hand (it can shrink back to fit what is in it). */
  sized: boolean
  color: number | null
}

export function sectionMenu(f: SectionFacts): MenuEntry[] {
  return tidyMenu([
    { id: 'rename', label: 'Rename', keys: 'F2' },
    { id: 'fit', label: 'Zoom to fit', keys: 'Shift+2' },
    {
      id: 'color',
      label: 'Colour',
      items: [null, ...Array.from({ length: FRAME_COLORS }, (_, i) => i)].map((c) => ({
        id: `color:${c ?? 'none'}`,
        label: c === null ? 'Space colour' : `Colour ${c + 1}`,
        checked: f.color === c,
        swatch: c === null ? { color: 'var(--space)' } : { cls: `fc${c}` }
      }))
    },
    'sep',
    { id: 'tidy', label: 'Arrange', disabled: f.inside < 2 },
    { id: 'shrink', label: 'Shrink to fit its cards', disabled: !f.sized },
    { id: 'ungroup', label: 'Ungroup', disabled: f.inside === 0 },
    'sep',
    {
      id: 'delete',
      label: f.inside
        ? `Delete section and close ${f.inside} tab${f.inside === 1 ? '' : 's'}`
        : 'Delete section',
      keys: 'Del',
      danger: true
    }
  ])
}

/** The colours notes come in, as the notes draw them (canvas.css `.cv-note.cN`). */
const NOTE_SWATCH = ['var(--space)', 'var(--space2)', 'var(--accent)', 'var(--fg-dim)']

export function noteMenu(f: { color: number }): MenuEntry[] {
  return tidyMenu([
    { id: 'edit', label: 'Edit', keys: 'Enter' },
    {
      id: 'color',
      label: 'Colour',
      items: Array.from({ length: NOTE_COLORS }, (_, c) => ({
        id: `color:${c}`,
        label: NOTE_COLOR_NAMES[c],
        checked: f.color % NOTE_COLORS === c,
        swatch: { color: NOTE_SWATCH[c] }
      }))
    },
    'sep',
    { id: 'delete', label: 'Delete note', keys: 'Del', danger: true }
  ])
}

export interface MarkFacts {
  n: number
  /** The one selected can take typing (a shape or a text, not a line, a block or a locked one). */
  editable: boolean
  /** Some are shapes (they take a fill, and can have none). */
  shapes: boolean
  locked: boolean
  grouped: boolean
  /** The colour they share, or null. */
  color: number | null
}

export function markMenu(f: MarkFacts): MenuEntry[] {
  return tidyMenu([
    { id: 'edit', label: 'Edit text', keys: 'Enter', disabled: !f.editable },
    {
      id: 'color',
      label: 'Colour',
      disabled: f.locked,
      items: [
        ...Array.from({ length: MARK_COLORS }, (_, c) => ({
          id: `color:${c}`,
          label: `Colour ${c + 1}`,
          checked: f.color === c,
          swatch: { color: `var(--m${c})` }
        })),
        ...(f.shapes
          ? ['sep' as const, { id: 'color:none', label: 'No fill', checked: f.color === -1 }]
          : [])
      ]
    },
    {
      id: 'arrange',
      label: 'Order',
      items: [
        { id: 'front', label: 'Bring to front' },
        { id: 'back', label: 'Send to back' }
      ]
    },
    'sep',
    { id: 'duplicate', label: 'Duplicate', keys: 'Ctrl+D' },
    ...(f.n > 1 && !f.grouped ? [{ id: 'group', label: 'Group', keys: 'Ctrl+G' }] : []),
    ...(f.grouped ? [{ id: 'ungroup', label: 'Ungroup', keys: 'Ctrl+Shift+G' }] : []),
    { id: 'lock', label: f.locked ? 'Unlock' : 'Lock' },
    'sep',
    {
      id: 'delete',
      label: f.n > 1 ? `Delete ${f.n}` : 'Delete',
      keys: 'Del',
      disabled: f.locked,
      danger: true
    }
  ])
}

export interface BoardFacts {
  /** Anything on the board (fit, tidy and export need something). */
  empty: boolean
  /** A paste handler is there (cut/copy/paste of tabs); `canPaste`: it has something. */
  paste: boolean
  canPaste: boolean
  /** What the last step was, when there is one to undo. */
  undo: string | null
  /** AI is on and ready: Arrange goes by topic and the board can be asked about; else by site, and no asking. */
  ai?: boolean
  /** Other people's tabs this person hid from their board (a shared space): they can come back. */
  hidden?: number
}

/** What Arrange does: by topic with AI, else by site (the grouping that needs no model). */
export function arrangeLabel(ai: boolean): string {
  return ai ? 'Arrange by topic' : 'Arrange by site'
}

export function boardMenu(f: BoardFacts): MenuEntry[] {
  return tidyMenu([
    { id: 'page', label: 'New page here', keys: 'Ctrl+T' },
    { id: 'note', label: 'Note here', keys: 'S' },
    { id: 'text', label: 'Text here', keys: 'T' },
    { id: 'section', label: 'Section here', keys: 'F' },
    {
      id: 'widget',
      label: 'Widget here',
      items: [
        { id: 'widget:stopwatch', label: 'Stopwatch' },
        { id: 'widget:timer', label: 'Timer' },
        { id: 'widget:reminder', label: 'Reminder' }
      ]
    },
    ...(f.paste
      ? [{ id: 'paste', label: 'Paste here', keys: 'Ctrl+V', disabled: !f.canPaste }]
      : []),
    'sep',
    { id: 'tidy', label: arrangeLabel(f.ai !== false), keys: 'Shift+T', disabled: f.empty },
    { id: 'fit', label: 'Fit everything', keys: 'Shift+1', disabled: f.empty },
    { id: 'all', label: 'Select all', keys: 'Ctrl+A', disabled: f.empty },
    {
      id: 'undo',
      label: f.undo ? `Undo ${f.undo.toLowerCase()}` : 'Undo',
      keys: 'Ctrl+Z',
      disabled: !f.undo
    },
    ...(f.hidden
      ? [
          'sep' as const,
          {
            id: 'unhide',
            label: f.hidden === 1 ? 'Show the tab you hid' : `Show the ${f.hidden} tabs you hid`
          }
        ]
      : []),
    'sep',
    // the tabs open now, kept to bring back later (panes://sessions)
    { id: 'save-session', label: 'Save tabs as a session', keys: 'Ctrl+Shift+D' },
    ...(f.ai !== false ? [{ id: 'ask', label: 'Ask about the board' }] : []),
    {
      id: 'export',
      label: 'Export',
      disabled: f.empty,
      items: [
        { id: 'export:png', label: 'Picture' },
        { id: 'export:pdf', label: 'PDF' },
        { id: 'export:md', label: 'Markdown digest' }
      ]
    },
    'sep',
    { id: 'settings', label: 'Settings' }
  ])
}
