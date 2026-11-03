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

Prior art: Electron's own `default_app` (`app.setVersion`, `app.setAppPath`, then imports the entry, so loading an app from another path is first-party), Chrome's component updater (parts updated on their own while browsing) and its binary deltas, Discord's host and modules split (closed source, behaviour only).
Copy from Chrome: download while browsing, small deltas, swap is a pointer flip, a restart brings every tab back, a waiting update applies on the next normal start.
Skip: always-on update services or scheduled tasks (Panes checks only while running), red buttons and nags, forced restart deadlines, full re-downloads, dropping private or Tor tabs without asking, and Discord's "Checking for updates" splash: startup never waits on the network, it boots whatever is already staged.

## Steps

- [ ] 1. Loader in the shipped `app.asar`, small and synchronous: apply the `PANES_USERDATA` override, read the layer pointer, and if a staged layer matches this shell, `app.setVersion`, `app.setAppPath`, and `require` its `out/main/index.js`; else run the built-in app. One file format: a layer is exactly the `app.asar` the build already makes, which also notices when it was loaded as a layer. A fresh install's `resources/app.asar` is the first delta base, byte for byte. Update the startup-order note in CLAUDE.md (loader, then `singleInstance.ts`).
- [ ] 2. Shell identity: `process.versions.electron` plus a whole-number loader version. A layer runs only on the exact shell it was built for.
- [ ] 3. Signed manifest per release: build number (whole number, goes up every release, so no `beta.10` vs `beta.9` string compare and an old manifest can't be replayed), shell, sha256 and size of the full layer, and deltas keyed by the sha256 of their base. Ed25519 via Node `crypto`; the loader holds a list of public keys so the key can be rotated. Private key outside the repo; losing it means updates fall back to the installer only.
- [ ] 4. Apply, in `UpdateManager`: fetch the manifest (plain GET of `releases/latest/download/...`, no range requests), check the signature and build number, download the delta for our base (or the 3.3 MB full layer when there is none or anything fails), decode, check the sha256, write `.partial`, rename, then write the pointer atomically. All `.asar` file work through `original-fs`. Done while browsing; the Software page says "ready, used next time Panes starts".
- [ ] 5. Gate electron-updater: `autoDownload` off; download the installer only when the manifest's shell differs from ours (Electron upgrades). Every release still publishes `Panes-setup.exe` and `latest.yml` for new installs and the website link.
- [ ] 6. Crash loops: the loader counts boots per layer, the app resets the count after its first window paints; two failed boots fall back to the previous layer, then to the built-in app, and the Software page says so.
- [ ] 7. Clean-up: keep the running layer and the previous one, never delete the running one (its files stay open, `adblockWorker` starts from `__dirname`). Layers live under the local app data folder (not roaming), under the override when `PANES_USERDATA` is set.
- [ ] 8. Release script (`scripts/release-layer.ts`, run by `release:win`): zstd deltas from the last few releases' layers (about 8 s each), sign the manifest, upload layer, deltas, then the manifest last (see the upload-race note in `tasks/lessons.md`).
- [ ] 9. What the user sees: a quiet "Restart to update" on the Software page, no deadline. Restart is a plain relaunch (measured 1.3 to 2.4 s) that brings back every window, space, split and tab even with session restore off. Private or Tor tabs open: one line first, "2 private tabs will close", Restart or Later. Quitting normally just means the next start is the new version.
- [ ] 10. Electron upgrades (rare) still use the installer. That path gets the earlier fixes: no progress window or promise when quitting, the progress window closes only once the new Panes is up, a launch guard before the single-instance lock, `customCheckAppRunning` without PowerShell probes and fixed sleeps.

## Check before calling it done

- Renderer storage across the layer path change: `boot.js` keeps the theme in `localStorage` under `file://`, which Chromium treats as one origin, so it should survive. Confirm on the first start of a new layer (no theme flash). If anything is lost, serve the windows through the existing `panes://` handler, which has stable URLs.
- End to end in scratch, without touching the installed Panes: run `win-unpacked` with `PANES_USERDATA` in scratch and a local manifest, apply a real delta, restart, and time quit to new window.
- Unit tests in `src/shared`: manifest checks (signature, build number, shell match), delta selection by base hash, crash-loop fallback.
- zstd in Node is still young; the full-layer fallback covers a decode failure.

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
