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

# Digital wellbeing (planned, waiting on answers)

Principles: everything stays on this computer; only host names and time are stored (never full URLs or page
content); every nudge can be snoozed, and the user is never locked out unless they chose that.

## 1. Usage tracking
- [ ] `src/shared/wellbeing.ts` (pure, tested): fold focus ticks into per-day totals per host, per space, per category; idle and unfocused time never counts; sessions (gap > 5 min starts a new one); tab-switch rate.
- [ ] `src/main/wellbeing.ts`: a 5 s tick while the window is focused and the user was active (input in the last 60 s); stores `wellbeing.json` daily buckets, keeps 90 days.
- [ ] Categories: a small built-in host list (social, video, news, shopping, games, work, other) the user can override per site.

## 2. Insights page (panes://wellbeing)
- [ ] Today and week: total time, top sites, by category, by space, longest session, late-night minutes, tab switches per hour; a calm chart, no streak guilt.

## 3. Limits and friction
- [ ] Daily limit per site or category. At 80%: a quiet note in the address bar. At 100%: a full-page pause (breathing space, "I still want to" after 10 s, 5 more minutes, or stop). Optional hard block.
- [ ] Focus mode per space: a list of sites blocked while it is on, a timer or schedule, a calm banner instead of the page.

## 4. Habits
- [ ] Break reminder after a long continuous session (default 50 min), 20-20-20 eye rest option.
- [ ] Doomscroll nudge: long unbroken scrolling on a feed site, once, gently.
- [ ] Tab hoarding nudge: many open tabs, offers to save them as a session.

## 5. Sleep
- [ ] Bedtime and wake time. From 30 min before bed: pages warm and dim (a boost-style filter on every page, off by a click), a one-line wind-down note. During bedtime: late-night minutes counted and shown, optional lock on chosen sites, snooze 15 min.
- [ ] Morning summary: when the first browser use after wake time was.
