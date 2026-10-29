import {
  clipboard,
  Menu,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents
} from 'electron'

interface Actions {
  openTab: (url: string) => void
  openPrivate: (url: string) => void
  openSplit: (url: string) => void
  pip: () => void
  searchUrl: (text: string) => string
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
      { label: 'Open link in new tab', click: () => a.openTab(p.linkURL) },
      { label: 'Open link in private tab', click: () => a.openPrivate(p.linkURL) },
      { label: 'Open link in split view', click: () => a.openSplit(p.linkURL) },
      { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) },
      sep
    )
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push(
      { label: 'Open image in new tab', click: () => a.openTab(p.srcURL) },
      { label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) },
      { label: 'Save image as...', click: () => wc.downloadURL(p.srcURL) },
      sep
    )
  }
  if (p.mediaType === 'video') {
    items.push({ label: 'Picture in Picture', click: a.pip }, sep)
  }
  if (p.isEditable) {
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
      { role: 'selectAll' },
      sep
    )
  } else if (p.selectionText) {
    const text = p.selectionText.trim()
    const short = text.length > 28 ? text.slice(0, 28) + '...' : text
    items.push(
      { role: 'copy' },
      { label: `Search for "${short}"`, click: () => a.openTab(a.searchUrl(text)) },
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
      sep
    )
  }
  items.push({ label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) })
  Menu.buildFromTemplate(items).popup({ window: win })
}
