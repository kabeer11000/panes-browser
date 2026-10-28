# Panes todo

Stack: Electron + electron-vite + React + TS, bun. One WebContentsView per tab, UI is plain CSS tokens + motion.

## Done (not yet verified by eye unless noted)

- [x] Scaffold, bun runtime, frameless window, Mica, slim top, mac-style window dots
- [x] Vertical tab sidebar, address bar, nav buttons, collapsed top strip
- [x] Tab stack (Ctrl+wheel) with timeline rail, task view grid
- [x] Built-in adblock (ghostery), toggle in settings
- [x] Split view: Ctrl+\, sidebar button, pane headers, draggable divider, swap, close pane
- [x] Drag and drop: reorder tabs in sidebar, drop on left/right of page area to split
- [x] History, bookmarks (Ctrl+D, star), downloads, settings as panes:// pages
- [x] Find in page (sidebar), zoom, print, devtools, context menu, fullscreen video
- [x] Session restore (setting), permissions allow-list, mailto/tel handoff

## Next

- [ ] Address bar suggestions from history/bookmarks (needs an overlay view above pages)
- [ ] Swipe gestures over page content (use webContents input-event)
- [ ] Canvas task view (free-form, pan/zoom)
- [ ] Permission prompts (camera/mic/location), per-site zoom, pinned tabs
- [ ] Tab suspending, spaces/profiles
- [ ] AI command bar + skills (reads tabs)
- [ ] Extension loading (session.loadExtension)
- [ ] Tests for stores (history dedupe, sanitize) and dropTab/moveTab logic
