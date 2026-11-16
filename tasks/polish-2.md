# Polish, speed and stability pass (started 2026-11-16)

Goal: no new features except AI page edits. Make what exists stable, always reachable, fast to open, light on RAM.

## Goals (measurable; each item is done only when its number is met in the running app)
- G1 Stability: no blank window, ever (Recover boundary everywhere); 0 console errors across the scripted tour
  (open, tabs, split, canvas, settings, notifications) in the test copy.
- G2 Reachable: at 720x480, 1366x768 and 2560x1440, every control is on screen and clickable in every mode (pinned
  sidebar, hidden sidebar, horizontal tabs, canvas, preview, fullscreen video). Esc always backs out one level.
- G3 Visible state: every action over 150 ms shows progress within 100 ms; every mode shows it is on.
- G4 Motion: 60 fps (p95 frame < 17 ms) for sidebar, top bar, canvas open/close, preview, split resize on the
  2-core no-GPU stand-in; transitions 140-320 ms on the shared tokens, spring for direct manipulation, nothing
  animates layout (transform/opacity only), every animation interruptible, reduced-motion honoured.
- G5 Launch: cold start to first paint < 400 ms, to usable < 800 ms; link from another app while running < 150 ms
  to the page view; link that cold-starts Panes < 900 ms to the page view. Baseline first.
- G6 Search: first suggestion < 30 ms after a key; history + bookmarks + open tabs + actions ranked, keyboard only.
- G7 Memory: same 10 sites idle 10 min, total private bytes below Chrome and Brave on this machine.
- G8 AI: page edits work on YouTube, Jira, a news site; local answers start < 1.5 s on the i5 stand-in.

## 0. Test rig (first, everything else depends on it)
- [x] Scratch Panes driven only over CDP (`PANES_USERDATA` scratch profile, own `--remote-debugging-port`, own
      `--inspect`). Clicks and keys go in as `Input.dispatch*` events on the chrome and page targets, screenshots with
      `Page.captureScreenshot`. No OS focus needed, so the user's terminal and windows are never touched.
- [x] Window parked off-screen; occlusion and background throttling off for the test instance only, so it still paints.
- [ ] Limits: native menus, the real cursor (hover sidebar/top bar read it from main) and OS notifications cannot be
      seen this way; those few checks still use agent-desktop and are batched, with a warning first.

## 1. Stability
- [x] Canvas white screen when editing text (reported 2026-11-13): reproduce, fix root cause, test.
- [ ] Notifications: audit the attention/notification path end to end (badges, inbox, popups, grouping), list every
      failure found, fix, unit-test the state logic in shared/.
- [x] Renderer crash guard: any React tree that throws shows a recoverable state, never a blank window.

## 2. Always reachable UI
- [ ] Tour card says "1 / 7" but its text says "Six short stops".
- [ ] Inventory every surface (sidebar, top bar, canvas toolbar, preview bar, popovers, panels) x every way in/out
      (shortcut, click, hover, Esc, resize, fullscreen, split, small window). Fix any state where a control is lost.
- [ ] Canvas toolbar: never off-screen or hidden behind a card/preview at any window size.
- [ ] System visibility: every slow action shows progress; every mode shows it is on (loading, offline, Tor
      connecting, AI working, saved/unsaved, download state). Checked against platform UI guidelines.

## 3. Canvas split view
- [ ] More than two panes (grid layouts), drag to rearrange, resize every divider, keyboard focus moves, close/
      maximise one pane, layouts survive restart.

## 4. Speed
- [ ] Measure first: cold start (normal and opened by a link from another app), warm "open link while running",
      tab switch. Baseline numbers in this file before any change.
- [ ] Fix the largest costs found; re-measure.
- [ ] Search: address bar suggestion latency and ranking, measured, then improved.

## 5. Memory: beat Chrome and Brave on the same tab set
- [ ] Script: same 10 sites in Chrome, Brave and Panes, idle 10 min, total private bytes of all processes. Baseline.
- [ ] Close the gap with what exists (trim, unload, process limits) and anything the measurement points at.

## 6. AI
- [ ] Cactus: engine kernels are ARM only, no Windows x64, no Node binding (docs v1.9); Needle 3 is a tool-call model,
      too small to write page code. Not usable on this machine. Keep llama.cpp.
- [ ] Page edits ("make YouTube's home mine", "sort this", "nyan cat in the corner", "latest Jira cards"): the model
      writes CSS/JS that Panes injects into that page, saved per site and re-applied, with an undo and a list to remove.
- [ ] Outside AI (asked 2026-11-16): use the user's own Claude Code CLI / claude.ai / ChatGPT from Panes, sending page
      context in and taking the answer back. Chosen: A) "Ask in Claude/ChatGPT/Gemini" opens the site in a split with
      the page context prefilled; B) Panes MCP server so Claude Code/Codex can read tabs, edit pages, use the canvas.
      MCP for claude.ai / ChatGPT web needs a public HTTPS URL: later step, a Panes relay tunnel with OAuth and a
      per-action approval in Panes. Local MCP (Claude Code, Claude desktop, Codex, Cursor) first.
      Not doing: running the user's `claude -p` inside Panes (subscription policy risk).
- [ ] Model efficiency: measure the current local model on the bench; consider a smaller default.

## 7. Circle to search (asked 2026-11-16)
- [ ] Circle or drag over any part of a page: the region is cut out and a small bar offers Copy text (Windows OCR,
      Windows.Media.Ocr, local, no download), Search with Google Lens (upload in a split), Ask AI (image to an online
      vision model; local model gets the OCR text), Edit this (page-edit scoped to the elements under the circle).
- [ ] Cactus Mirage not usable: Cactus engine has no Windows x64 build.

## Decisions (2026-11-16)
- Page edits: online model when signed in, local model only for simple CSS edits.
- Order: stability first (as listed).
- Split view: free grid (split any pane edge, drag headers, every divider resizes).

## Log
- 720x480 pass: sidebar ~1/3 of width (auto-collapse below ~900?); canvas search placeholder clipped; AI-off banner sits over cards; bin sliver over canvas. Esc from CDP did not close canvas (CDP keys skip before-input-event; recheck with real keys).
- 2026-11-16: canvas white screen fixed (label width loop, flex-shrink), empty hint fixed, Recover error boundary; beta.61.
- Downloads bin sliver (12px, bottom right) also shows over the canvas: decide in the reachability pass.
- 2026-11-16: test rig done (f01bff8). PANES_OFFSCREEN + scripts/drive.ts (click/key/type/eval/shot/winshot). Verified: click landed, foreground stayed on the terminal.
