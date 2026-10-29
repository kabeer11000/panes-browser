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

# Private windows, Tor and Snowflake (planned, not started)

Decisions taken: Snowflake sharing is OPT-IN (offered in onboarding and Settings, off until chosen), because
relaying strangers' traffic uses the user's bandwidth and IP.

Open questions for the owner (defaults in brackets):
- Ship the tor and snowflake binaries inside the installer, or download on first use? [download on first use, verified by hash: keeps the installer small and avoids bundling per-platform binaries]
- Private = separate in-memory session; Tor = a separate choice that routes that session through Tor. [yes]

## Part 1: Private browsing
- [ ] Session: `session.fromPartition('private-<n>')` (no `persist:` prefix = in memory), one per private window or tab group; destroyed on close.
- [ ] TabManager: tabs carry `private: boolean`; no history, bookmarks suggestions, session restore, password save or autofill, downloads list entry, thumbnails on disk.
- [ ] UI: private tabs marked (icon plus tinted sidebar), "New private tab" in the app menu and Ctrl+Shift+N.
- [ ] Tests: pure rules for what is recorded (shared/privacy.ts).

## Part 2: Tor
- [ ] `src/main/tor.ts`: start and stop the tor daemon (SocksPort on a random localhost port, own DataDirectory in userData), bootstrap progress parsing from stdout.
- [ ] Private-with-Tor session: `session.setProxy({ proxyRules: 'socks5://127.0.0.1:<port>' })`, DNS through the proxy, WebRTC IP handling policy, no ad blocker cosmetic calls leaking, user agent normalised.
- [ ] UI: bootstrap progress while connecting, circuit info optional, "New identity" button.
- [ ] Binary fetch with sha256 pin, stored under userData/tor.

## Part 3: Snowflake (opt-in)
- [ ] Snowflake client for censored users as a Tor pluggable transport (bridge line in torrc).
- [ ] Optional Snowflake proxy (helping others): off by default; onboarding card and a Settings section; start and stop; show clients served and bytes relayed if the proxy exposes them (it logs a summary every interval; parse it).
- [ ] Never run on battery or metered connections unless chosen.
