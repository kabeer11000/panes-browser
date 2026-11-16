# Polish, speed and stability pass (started 2026-11-16)

Goal: no new features except AI page edits. Make what exists stable, always reachable, fast to open, light on RAM.

## 0. Test rig (first, everything else depends on it)
- [ ] Scratch Panes driven only over CDP (`PANES_USERDATA` scratch profile, own `--remote-debugging-port`, own
      `--inspect`). Clicks and keys go in as `Input.dispatch*` events on the chrome and page targets, screenshots with
      `Page.captureScreenshot`. No OS focus needed, so the user's terminal and windows are never touched.
- [ ] Window parked off-screen; occlusion and background throttling off for the test instance only, so it still paints.
- [ ] Limits: native menus, the real cursor (hover sidebar/top bar read it from main) and OS notifications cannot be
      seen this way; those few checks still use agent-desktop and are batched, with a warning first.

## 1. Stability
- [ ] Canvas white screen when editing text (reported 2026-11-13): reproduce, fix root cause, test.
- [ ] Notifications: audit the attention/notification path end to end (badges, inbox, popups, grouping), list every
      failure found, fix, unit-test the state logic in shared/.
- [ ] Renderer crash guard: any React tree that throws shows a recoverable state, never a blank window.

## 2. Always reachable UI
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
      context in and taking the answer back. Options and recommendation pending.
- [ ] Model efficiency: measure the current local model on the bench; consider a smaller default.

## Decisions (2026-11-16)
- Page edits: online model when signed in, local model only for simple CSS edits.
- Order: stability first (as listed).
- Split view: free grid (split any pane edge, drag headers, every divider resizes).

## Log
