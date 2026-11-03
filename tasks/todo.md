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

# Import from another browser (plan, awaiting go-ahead)

## Why

A Brave or Chrome user who tries Panes today arrives with nothing: no bookmarks, no history, so the address bar suggests nothing, and the wrong search engine. Only passwords can come over, and only if they find the CSV import in Passwords on their own. Things people move when they switch, as listed in Zen's profile-migration guide and Firefox's migrator resource types: bookmarks, history, passwords, signed-in sessions, open tabs, extensions, search engine.

Checked on this machine 2026-11-04: Brave's `Local State` has five profiles and only `os_crypt.encrypted_key`. Edge also has `app_bound_encrypted_key` (Chrome's app-bound encryption, which only the browser's own elevation service can open). `node:sqlite` works in Electron 44 (Node 24.22.1, SQLite 3.53.4, no warning), so the SQLite files need no new dependency. Spaces share one session (`persist:panes`) and bookmarks and history are global, so one source profile goes in per import.

## Design

One import flow, two ways in: a step on the Welcome screen (between `welcome` and `look`) and a section in Settings. Pick a browser (your current default browser is preselected), pick a profile, tick what to bring, Import, then a result line per item ("1,204 bookmarks, 18,400 visits, search engine set to Brave Search").

Sources are data, not per-browser branches: a registry `{ id, name, family: 'chromium' | 'firefox', roots per platform }` covering Chrome, Brave, Edge, Vivaldi, Opera (Chromium) and Firefox, Zen, LibreWolf (Firefox). One reader per family. Chromium profile names come from `Local State` `profile.info_cache`; Firefox ones from `profiles.ini`. The default browser comes from the `UrlAssociations\https\UserChoice` ProgId on Windows (BraveHTML, ChromeHTML, MSEdgeHTM, FirefoxURL-*).

What comes over:
- Bookmarks: Chromium `Bookmarks` (plain JSON tree), Firefox `places.sqlite` `moz_bookmarks`. A bookmarks HTML file (the Netscape format every browser exports, including Safari and Arc) is the fallback for anything not on the list. Duplicates by URL are skipped, so running it twice is safe.
- History: Chromium `History` `urls`, Firefox `places.sqlite` `moz_places`. Chromium times are microseconds since 1601, Firefox's since 1970; both converters live in `src/shared` with tests. Merged by time with what Panes has, the newest 20,000 kept (the store's cap), same URL and time skipped.
- Search engine: Chromium `Preferences` `default_search_provider_data`, Firefox `search.json.mozlz4` skipped for now. Matched by host onto `SEARCH_ENGINES`; anything else leaves the setting alone.
- Passwords: a guided CSV step, like Firefox does for Chrome on Windows (`showsManualPasswordImport`). The step shows the exact clicks for that browser (Brave: `brave://password-manager/settings`, Export passwords), then a file picker feeds the existing `PasswordStore.importCsv`. Afterwards Panes offers to delete the CSV, since it holds every password in plain text.
- Not imported, said plainly on the result screen: signed-in sessions (sign in again once per site), open tabs, extensions (Panes loads none yet; ad blockers are covered by the built-in blocker, and the result screen says so when it sees uBlock Origin or Brave Shields).

Reading safely: each file is copied to a temp folder first and opened read-only from there; if the copy fails because the browser is running, the step asks to close it and retry. Temp copies are deleted when the import ends, success or not. The readers run in a `worker_threads` worker (same pattern as `adblockWorker.ts`) so a large `History` file never freezes the window. Nothing leaves the computer.

Prior art: Firefox's migration wizard (browser migrators plus file migrators, per-item progress, the manual CSV flow for Chrome passwords), Chromium's first-run import from the default browser (`import_bookmarks`, `import_history`, `import_search_engine`), Zen's guide (copy profile files by hand, the experience to avoid).
Copy: preselect the default browser, per-item results, a file import for everything else, the CSV password flow.
Skip: importing on first run without asking, reading other browsers' encrypted cookies or passwords directly (app-bound encryption blocks Chrome and Edge anyway, and it is exactly what malware does), extension migration.

## Steps

Built 2026-11-04:
- [x] `src/shared/importers.ts` (pure, tested): source registry; Chromium bookmarks JSON and Netscape HTML to rows; Chromium time converter; search host to `SearchEngineId`; merge (newest first, cap, dedupe).
- [x] `src/main/importWorker.ts` (`node:sqlite` on temp copies, always closed and deleted) and `src/main/importer.ts` (sources, profiles, default browser via `app.getApplicationNameForProtocol`, password CSV and bookmarks HTML pickers, deletes only the CSV it just imported).
- [x] `HistoryStore.importMany`, `BookmarkStore.importMany`; IPC `int:import-*`; typed in `shared/types.ts`.
- [x] UI: `ImportSection` in Settings and as the Welcome step after the first page.
- [x] Tests in `importers.test.ts`; the worker checked under Electron's Node against synthetic Chromium and Firefox profiles (times past 2^53, hidden pages, limit, Firefox WAL, missing profile, temp folder gone).
- [ ] Verify in the running app: a scratch `PANES_USERDATA` importing from the real Brave profile with Brave closed and open; counts match `brave://bookmarks`; run it twice, nothing doubles; Welcome step and Settings both; an HTML export and a password CSV (and its delete).
- [ ] `bun run build` once: confirm electron-vite leaves `node:sqlite` out of the worker bundle.

Later: Firefox passwords read directly (`logins.json` plus `key4.db`, no app-bound lock there), open tabs from Chromium `Sessions/` and Firefox `sessionstore.jsonlz4`, extensions once Panes loads them.

## Decisions (owner, 2026-11-04)

- Bookmarks stay flat: folders are dropped on import.
- Offered on the Welcome step and any time in Settings; never automatic.
- One profile per import.

# Ad blocker on Brave's engine (plan, awaiting go-ahead)

## Why

Reported: sites break, ads and empty boxes still show, the blocker feels heavy. Causes found: Panes blocks everything everywhere, where Brave's default Standard mode spares a site's own requests and content; the scriptlet file Panes downloads (Ghostery's copy of uBlock Origin's) was last updated 14 Aug 2026; and the cosmetic glue is patched around the Ghostery package (the YouTube scriptlet path, the `withoutScripts` proxy). "Heavy" gets a measured baseline before anything changes.

## Decisions (owner, 2026-11-04)

- Engine: Brave's `adblock-rs` (Rust via Neon). Rust on dev and release machines is fine.
- Lists: Brave's default catalog entries `default`, `4D715457-307C-4383-8873-73A2FD263F71` (privacy), `E99CBD02-FFD1-4651-9BDD-6A9ED7B87819` (first party). Not cookie notices, mobile promos or iOS.
- Standard by default, Aggressive as a setting and per site. YouTube is always Aggressive (Brave does the same).
- Must keep working with no Panes releases: lists and scriptlets both come from upstream on a schedule, with copies bundled at release as the fallback.

## Design

Package: `adblock-rs` 0.13.x has no prebuilt binary; its postinstall runs cargo, so it goes in `trustedDependencies`. Built on Node-API, so one `.node` works across Electron versions with no rebuild. It stays inside app.asar (the layers rule); Electron copies it to a temp file when loading it. The postinstall calls `npm run`; if that fails under bun, call `cargo-cp-artifact` from a bun script instead.

Lists (worker, every 12 h as now): fetch Brave's `list_catalog.json`, take the three UUIDs above, run Brave's `!#if` preprocessing with Brave's `IF_CONDITIONS` (data in `src/shared`, tested), and pass each list's `permission_mask` so uBO's trusted scriptlets work. Lists with `first_party_protections` also build a second, small engine. A catalog snapshot ships in the app for when GitHub is unreachable.

Scriptlets and redirects: `.github/workflows/adblock-resources.yml` runs daily. It checks out uBlock Origin's latest release, then `scripts/adblock-resources.ts` does what Brave's `generateResources` does (uBO `builtinScriptlets` as `application/javascript` resources, `uBlockResources` for redirects, plus Brave's own `dist/resources.json`). It builds a test engine with the result and publishes `resources.json` to a fixed release tag, `adblock-resources`. Panes downloads it alongside the lists and falls back to the copy bundled at release. Free, since the repo is public. GitHub pauses scheduled jobs after 60 days without repo activity, so the job re-enables itself through the workflow-enable API. uBO's code only ever runs in CI; on users' machines it is JSON data.

Main process (`src/main/adblock.ts`, same surface: `set`, `setOffSites`, `attach`, `siteState`, `blockedOn`; `youtubeScriptlets` goes):
- Saved engine named by package version (`adblock-<ver>.dat`). The binding's `deserialize` swallows errors, so every load runs a canary (a few requests that must block and a few that must not, after Brave's `sampleUnblockedNetworkRequests`); a failure means rebuild.
- Network: Panes' own `onBeforeRequest` per session (`identity.ts` only uses `onBeforeSendHeaders`, so they don't clash). The decision is a pure function in `src/shared` with tests: Electron resource type to engine type, first party or not, Standard or Aggressive, `$important`, redirects as data URLs, `$removeparam` rewrites only for GET/HEAD/OPTIONS (as Brave does).
- Site exceptions, the YouTube ad-request rule and the blocked count carry over as plain code instead of wrapped handlers.
- One known gap: `$csp` rules. The JS binding has no call for them, and Ghostery did apply them.

Page side: one frame preload, `src/preload/adblock.ts`, for http(s) frames, registered the way `youtube.ts` is. A sync `adblock:start` returns the page's scriptlet, hide selectors, procedural rules, exceptions and switches. The scriptlet runs at document start in every frame, which is what the YouTube special path existed for, so that path and `withoutScripts` are deleted. Styles go in with `insertCSS` (removable, as the YouTube preload notes). Generic class/id hiding: a batched MutationObserver asks main for `hiddenClassIdSelectors`. In Standard mode generic hides skip elements holding the site's own content, ported from Brave's `content_cosmetic.ts`. Procedural rules: port Brave's `procedural_filters.ts` (MPL-2.0, header kept). Frames that aren't http(s) are skipped, to keep the per-frame sync call cheap.

Looked at: Ghostery's `adblocker-electron` (current), Brave's `brave-core` (Shields network helper, cosmetic content scripts) and `brave-core-crx-packager` (list and resource generation).

## Steps

- [ ] 1. Spike, nothing merged: install Rust and `adblock-rs` under bun; load it in main from a packed asar (`build:unpack`, needs ask) and inside a worker thread; serialize round trip; a data-URL redirect through `webRequest`; confirm Brave's Standard rule in `brave-core` source. Baseline on the current blocker with `scripts/perf-*.ts`: time to engine ready, main process memory, load of three heavy news sites.
- [ ] 2. Resources script, workflow with self re-enable, bundled `resources.json` and catalog snapshot.
- [ ] 3. `src/shared`: catalog picking, preprocessor, resource type map, request decision; tests.
- [ ] 4. Worker build and main engine swap, network blocking, canary.
- [ ] 5. Page preload (scriptlets, styles, generic hiding, procedural); delete the YouTube scriptlet path.
- [ ] 6. Aggressive setting: settings schema, Settings page, site panel.
- [ ] 7. Remove `@ghostery/*` and delete the old `adblock-engine.bin` on first run.
- [ ] 8. Verify against the baseline: YouTube (watch page, embed), news sites, the sites that break today, private window, site off and hiding off toggles, first start offline (bundled fallback), a corrupt `.dat` (canary rebuilds).

Open: which sites break today? They become the step 8 checklist.
