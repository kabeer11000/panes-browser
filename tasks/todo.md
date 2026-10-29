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

## panes:// native redesign (plan, awaiting go-ahead)

Direction: blend of iOS inset-grouped lists + Windows 11 type/Mica colors. Floating bottom tab bar. Settings stays one scrolling page.

Files: Shell.tsx, internal.css, pages/{History,Bookmarks,Downloads,Settings,SpacesSection}.tsx. No new deps (motion is already installed).

- [ ] Shell: drop left sidebar; floating pill tab bar (4 icon+label tabs, sliding active highlight via motion layoutId), blurred fade under it, bottom padding on content
- [ ] Large title that collapses into a small centered title bar on scroll (sticky, blurred)
- [ ] Shared primitives in internal.css: .group (inset rounded list, hairline separators), .row (icon tile, label, sub, trailing control), section footers
- [ ] Controls: Fluent/iOS toggle (bigger thumb, spring), segmented control for 2-3 option settings, custom Select (replaces native <select> popup), styled checkbox, slider with filled track, accent swatches
- [ ] Settings: convert every .int-field to grouped rows; icons per section; destructive Clear data as its own group
- [ ] History: day groups as inset lists, sticky day headers, search field with cancel, swipe-free hover delete, empty state
- [ ] Bookmarks/Downloads: same row/card language
- [ ] Respect light/dark scheme tokens, prefers-reduced-motion, keyboard focus rings, aria roles (tablist, switch, listbox)
- [ ] Verify: typecheck, lint, run dev build, screenshot all 4 pages in dark + light and at narrow width

Skipped: sub-page drill-in routing, new theming tokens beyond what internal.css needs.
