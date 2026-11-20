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
- [x] Tour card says "1 / 7" but its text says "Six short stops".
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
- [x] Cactus re-checked 2026-11-17 (v4.1.1): now ships windows-x86_64 cactus.exe, a win_amd64 Python wheel and a
      browser/Node WASM build (cactus.js + cactus.wasm, 1.2 MB, exports cactus_load/describe/complete/embed/transcribe).
      The CLI has no image input; vision is cactus_describe(rgb, w, h, ...). Measured on this machine (4 cores):
      Mirage (21.6 MB, Apache-2.0) loads in ~115 ms in WASM; describe takes ~3.7-5 s in WASM (single thread, 148 MB
      heap) and ~1.5 s native (Python wheel). Input is resized to 512 px, so a small crop is no faster. On page
      screenshots it finds mostly "text label" boxes with masks: useful for "select this object" (mask) in circle to
      search, weak for understanding web UI. Needle 3 is a tool-call model, too small to write page code: llama.cpp
      stays for chat. Whistle (speech, 16.9 MB, CPU) is a candidate for voice input.
- [x] Needle 3 (Cactus tool-call model, 35 MB) vs Qwen3-1.7B, 2026-11-17, bench `E:/tmp/toolbench/bench.ts`: 25 real
      requests on Panes's own local tool sets (18 browser, 7 board), 4 threads, same system prompt with the tab list
      / board ids. Qwen 17/25 (19/25 counting the two calls it wrote as text that `leakedCall` recovers), median
      2.4 s. Needle 8/25, median 0.58 s, 80 MB RAM. Needle picks the right tool often but cannot use context: it
      never maps "spotify tab" or "the react card" to an id from the list (gives 1, 7, "react"), suppresses most
      board calls as low confidence, and puts the tab list in the prompt makes it worse. Decision: keep Qwen. Needle
      only fits context-free intents (open a site, search a site, scroll), not worth a second runtime for that.
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
- [x] Circle to search v1 (2026-11-17): Ctrl+Shift+S, the command bar, or a fast mouse shake over the page. A frozen
      picture of the page with a glowing lasso; circle, scribble or tap (a tap picks the element, a picture whole).
      Text comes from the page's DOM (exact, local, isolated world). Bar: Search (default engine), Search image
      (Google Lens upload from the tab's own session), Copy (text, or the picture), Ask AI (normal tabs only).
      Draw again to re-pick, Esc closes. Not yet: text inside iframes/shadow roots, Windows OCR for text in pictures,
      "Edit this" (page edits scoped to the circle), a setting to turn the shake off.
- [ ] Mirage (WASM in a worker, no native binary to ship) for "pick the object under the lasso": its masks cut the
      object out. ~4 s in WASM: run it behind the shimmer, never block the gesture.

## 8. User-reported polish queue (2026-11-17)
- [ ] Preview dialog: top of the website has odd rounding / overflow.
- [x] Canvas cursors: right cursor for every surface (grab/grabbing, resize, text, pointer, crosshair for tools).
- [x] Drag handles: look and feel (size, hover, hit area, spring).
- [x] Tidy (arrange) takes arrows into account: connected cards placed near each other, fewer crossings.
- [x] Efficient mode / low-end: switch off transparency, blur, grain (a "Reduce transparency" setting, on by default in efficient).
- [ ] Search popover: serves many usage patterns (keyboard-first, mouse, power shortcuts, actions, tabs, history,
      bookmarks, calc/units, site search); measured latency.
- [ ] Context menus: one menu system, simple, consistent items, not many kinds.
- [x] Fully zoomed-out canvas: section headers scale smoothly with zoom (no sudden switch), overall polish of the board.

## Batch 2026-11-20
- [ ] Open native apps from links (zoommtg:, slack:, msteams:...): 'apps' permission card naming the app.
- [ ] Ctrl+W in the preview: page opened from another (arrow) goes back to that page; otherwise the board.
- [ ] Ctrl+W shrinks the recent-tabs count in the preview dialog: make consistent.
- [ ] Notifications (top centre) vs recent tabs in the preview: confusing, notifications used to switch tabs. Move notifications to the side in both UIs.
- [ ] Recent-tab favicons in the preview show the notification bubble. Redo notifications UI across the browser (esp. canvas), creatively.
- [ ] Missing favicon: a letter in some places, a globe in others. One fallback everywhere.
- [ ] Option: preview dialog toolbar at the bottom of the screen.
- [ ] Split view: fullscreen broken (esp. canvas preview); resizing panes unreliable.

## Decisions (2026-11-16)
- Page edits: online model when signed in, local model only for simple CSS edits.
- Order: stability first (as listed).
- Split view: free grid (split any pane edge, drag headers, every divider resizes).

## Log
- Startup: AI SDK + providers (~350 ms) and electron-updater (~110 ms) now load on first use; lock taken in loader.ts. Packaged, warm: first code 510 -> 360 ms, page loaded median 1200 -> 760 ms; link hand-off to a running Panes ~170 ms total (was >500 ms before the check).
- 720x480 pass: sidebar ~1/3 of width (auto-collapse below ~900?); canvas search placeholder clipped; AI-off banner sits over cards; bin sliver over canvas. Esc from CDP did not close canvas (CDP keys skip before-input-event; recheck with real keys).
- 2026-11-16: canvas white screen fixed (label width loop, flex-shrink), empty hint fixed, Recover error boundary; beta.61.
- Downloads bin sliver (12px, bottom right) also shows over the canvas: decide in the reachability pass.
- 2026-11-16: test rig done (f01bff8). PANES_OFFSCREEN + scripts/drive.ts (click/key/type/eval/shot/winshot). Verified: click landed, foreground stayed on the terminal.
