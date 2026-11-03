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

# Updates: two layers, deltas, no install step (plan, awaiting go-ahead)

## Why

Measured 2026-11-04 on the real beta.1, beta.4 and beta.5 installers:
- Every update downloads 123 MB and rewrites the whole 388 MB install. Between releases, `Panes.exe` differs by 65 bytes (the version stamp) and `app.asar` changes in 48 of 1993 files (1 MB).
- zstd delta of `app.asar` against the previous one, using the old file as dictionary in Electron's own Node 24 zlib: 177 KB beta.4 to beta.5, 183 KB beta.1 to beta.5, decode 47 to 92 ms. Full `app.asar` zstd is 3.3 MB. No new dependency, no experimental warning.
- Today, Restart to new window is about 13 s (probes and sleeps 4.7 s, files 5 s, launch 2.4 s). Quitting with an update waiting never reopens Panes, while the progress window says it will and stays up to 120 s. A shortcut click mid-install can start a half-written copy or leave mixed old and new files.
- Releases go out several a day, so users pay the 123 MB repeatedly.

## Design

Split Panes into the shell (Electron: `Panes.exe`, Chromium files) and the app layer (`app.asar`, our code). The shell only changes when Electron does. The app layer is updated in the background as a delta, written beside the running one, and used from the next start. No installer runs for a normal release, so there is no install window to click into and nothing to wait for after Panes closes.

Prior art: Electron's own `default_app` (loads an app's entry from another path, the same idea), Chrome's component updater (parts updated on their own while browsing) and its binary deltas, Discord's host and modules split (closed source, behaviour only).
Copy from Chrome: download while browsing, small deltas, swap is a pointer flip, a restart brings every tab back, a waiting update applies on the next normal start.
Skip: always-on update services or scheduled tasks (Panes checks only while running), red buttons and nags, forced restart deadlines, full re-downloads, dropping private or Tor tabs without asking, and Discord's "Checking for updates" splash: startup never waits on the network, it boots whatever is already staged.

## Steps

Built 2026-11-04 (commits from `feat: rules for updating Panes' own code` on):
- [x] Loader (`src/main/loader.ts`, package.json `main`): applies the `PANES_USERDATA` override, reads `app-layers/state.json` and `require`s the chosen layer's `out/main/index.js` synchronously, else the installed app. No `app.setAppPath`/`app.setVersion` (internal, not in Electron's typings): the running code reads its own version from the package.json beside it (`appVersion()`), and knows it is a layer from where `__dirname` is.
- [x] Shell identity: Electron version plus `LOADER_VERSION`; a layer only runs on the shell it was built for.
- [x] Manifest checks (`parseManifest`): build number, shell, sha256 and size, plain file names only. No signature (owner's call 2026-11-04): anyone who can upload to the GitHub release can ship code that Panes runs.
- [x] Apply (`src/main/layers.ts`): zstd delta against a layer on hand (staged, running or installed, picked by sha256), else the whole layer gzipped (gzip because Node marks zstd experimental); sha256 and size checked, `.partial` then rename, state written atomically, all `.asar` work through `original-fs`.
- [x] electron-updater is asked only when the manifest's shell differs. A latest release with no `app-layer.json` means no update, not a 123 MB installer download.
- [x] Crash loops: a start is counted after the single-instance lock, cleared when the window's page loads; two failed starts, or a layer that throws while loading, mark the build bad and Panes runs the previous layer, else the installed app. Silent: the Software page does not say it happened.
- [x] Clean-up keeps the staged, previous and running layers. Layers live in the data folder (`%APPDATA%\Panes\app-layers`, roaming, like Electron's caches already are).
- [x] Release (`bun run release:win` = `scripts/release.ts`): preflights, stamps `panesBuild`, builds once, fills a draft release (installer, latest.yml, then `scripts/release-layer.ts --publish`: gzip layer, deltas from the last 3 published layers on this shell, manifest last), checks the assets, publishes as latest. `--dry-run` stops after the build. `asarUnpack` removed so the layer is one file.
- [x] Restart to update relaunches and always brings the tabs back (a one-shot flag, whatever the startup setting). Quitting with an update ready no longer shows the progress window.

Tested end to end on a scratch `electron-builder --dir` build (`PANES_USERDATA` and `PANES_LAYER_FEED` in scratch, installed Panes untouched): Panes fetched the 3 KB delta (not the 5.2 MB layer), Restart to update to the new window loaded in 1.04 s, the open tab came back, the Software page showed the new version, the start count cleared. A layer file that is not an archive, and a layer at 2 failed starts, were both marked bad and Panes came up on the previous layer. After the two fixes (relaunch keeps only switches; shell includes platform and processor): started from a link, the restart restored one copy of the tab (0.91 s); with no delta it fetched the 5.2 MB layer and updated; a damaged delta fell back to the whole layer and updated; the ad-block worker rebuilt its engine running from a layer. The test builds included another session's in-progress import refactor.

Still to do:
- [x] Private or Tor tabs open on Restart to update: asks first ("2 private tabs will close"), Restart or Later.
- [x] The Software page says when a new version failed to start and Panes went back.
- [ ] Left for later (owner, 2026-11-04; rare now that only Electron upgrades use it). Installer path (new Electron only): launch guard before the single-instance lock, progress window closes only once the new Panes is up, `customCheckAppRunning` without PowerShell probes and fixed sleeps.
- [ ] Signing the manifest (ed25519, key outside the repo) when wanted.
- [ ] First real release with layers: the release after it is the first one existing users get as a delta.

# Small cards

- [ ] `website/` is packed into the app (`website\index.html` is inside `app.asar`); exclude it in `electron-builder.yml` `files`.

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
