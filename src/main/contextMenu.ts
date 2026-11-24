import {
  clipboard,
  Menu,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents
} from 'electron'
import { highlightLink } from '@shared/textFragment'

interface Actions {
  openTab: (url: string) => void
  openPrivate: (url: string) => void
  openSplit: (url: string) => void
  pip: () => void
  print: () => void
  /** Null in a private or Tor tab: chat does not read those. */
  askAi: ((text: string | null) => void) | null
  /** The Explain / Translate / Summarise chip beside the selection; null where it is off (AI off, private, Tor). */
  explain: (() => void) | null
  /** Circle to search on this page. */
  circle: () => void
  searchUrl: (text: string) => string
  /** The page's source, in a new tab (Ctrl+U). */
  viewSource: () => void
  /** The page is on the canvas board (its preview): what opens becomes a card, so the words say so. */
  onBoard?: boolean
}

/** Cut, copy, paste and spelling fixes for a text field. */
function editItems(wc: WebContents, p: ContextMenuParams): MenuItemConstructorOptions[] {
  const sep: MenuItemConstructorOptions = { type: 'separator' }
  const items: MenuItemConstructorOptions[] = []
  if (p.misspelledWord) {
    // Corrections first, as in every browser; the menu pops up exactly where the squiggle was clicked.
    const fixes = p.dictionarySuggestions.slice(0, 5)
    items.push(
      ...(fixes.length > 0
        ? fixes.map((w) => ({ label: w, click: () => wc.replaceMisspelling(w) }))
        : [{ label: 'No suggestions', enabled: false }]),
      sep,
      {
        label: `Add "${p.misspelledWord}" to dictionary`,
        click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord)
      },
      sep
    )
  }
  items.push(
    { role: 'undo', enabled: p.editFlags.canUndo },
    { role: 'redo', enabled: p.editFlags.canRedo },
    sep,
    { role: 'cut', enabled: p.editFlags.canCut },
    { role: 'copy', enabled: p.editFlags.canCopy },
    { role: 'paste', enabled: p.editFlags.canPaste },
    { role: 'selectAll' }
  )
  return items
}

/** Right-click in a text field of Panes' own window (the search box, the find bar, ...). */
export function showEditMenu(win: BrowserWindow, wc: WebContents, p: ContextMenuParams): void {
  if (p.isEditable) Menu.buildFromTemplate(editItems(wc, p)).popup({ window: win })
}

export function showContextMenu(
  win: BrowserWindow,
  wc: WebContents,
  p: ContextMenuParams,
  a: Actions
): void {
  const sep: MenuItemConstructorOptions = { type: 'separator' }
  const items: MenuItemConstructorOptions[] = []

  if (p.linkURL) {
    items.push(
      {
        label: a.onBoard ? 'Open link as a new card' : 'Open link in new tab',
        click: () => a.openTab(p.linkURL)
      },
      { label: 'Open link in private tab', click: () => a.openPrivate(p.linkURL) },
      {
        label: a.onBoard ? 'Open link side by side' : 'Open link in split view',
        click: () => a.openSplit(p.linkURL)
      },
      ...(/^https?:/i.test(p.linkURL)
        ? [{ label: 'Save link as...', click: () => wc.downloadURL(p.linkURL) }]
        : []),
      { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) },
      sep
    )
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push(
      {
        label: a.onBoard ? 'Open image as a new card' : 'Open image in new tab',
        click: () => a.openTab(p.srcURL)
      },
      { label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) },
      { label: 'Save image as...', click: () => wc.downloadURL(p.srcURL) },
      { label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) },
      sep
    )
  }
  if (p.mediaType === 'video') {
    // A plain file address can be saved as it is. A stream (a blob: or data: address, as most big sites use) has no
    // file behind it to fetch, so the entry is shown but off rather than missing.
    const saveable = /^(https?|file):/i.test(p.srcURL)
    items.push(
      { label: 'Picture in Picture', click: a.pip },
      { label: 'Save video as...', enabled: saveable, click: () => wc.downloadURL(p.srcURL) },
      ...(saveable
        ? [{ label: 'Copy video address', click: () => clipboard.writeText(p.srcURL) }]
        : []),
      sep
    )
  }
  if (p.isEditable) {
    items.push(...editItems(wc, p), sep)
  } else if (p.selectionText) {
    const text = p.selectionText.trim()
    const short = text.length > 28 ? text.slice(0, 28) + '...' : text
    items.push(
      { role: 'copy' },
      ...(() => {
        const link = highlightLink(p.pageURL, text)
        return link
          ? [{ label: 'Copy link to highlight', click: () => clipboard.writeText(link) }]
          : []
      })(),
      { label: `Search for "${short}"`, click: () => a.openTab(a.searchUrl(text)) },
      ...(a.explain ? [{ label: 'Explain, translate or summarise', click: a.explain }] : []),
      ...(a.askAi
        ? [{ label: 'Ask AI about selection', click: () => a.askAi?.(text.slice(0, 2000)) }]
        : []),
      sep
    )
  } else if (!p.linkURL && p.mediaType !== 'image') {
    items.push(
      {
        label: 'Back',
        enabled: wc.navigationHistory.canGoBack(),
        click: () => wc.navigationHistory.goBack()
      },
      {
        label: 'Forward',
        enabled: wc.navigationHistory.canGoForward(),
        click: () => wc.navigationHistory.goForward()
      },
      { label: 'Reload', click: () => wc.reload() },
      sep,
      { label: 'Print...', accelerator: 'CmdOrCtrl+P', click: a.print },
      { label: 'View page source', accelerator: 'CmdOrCtrl+U', click: a.viewSource },
      { label: 'Circle to search', accelerator: 'CmdOrCtrl+Shift+S', click: a.circle },
      ...(a.askAi ? [{ label: 'Ask AI about this page', click: () => a.askAi?.(null) }] : []),
      sep
    )
  }
  items.push({ label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) })
  Menu.buildFromTemplate(items).popup({ window: win })
}
