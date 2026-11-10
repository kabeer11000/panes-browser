# Canvas v3: canvas as a way to browse, fast on old hardware

Goal: the canvas is a full browsing mode, not an overlay you visit. Fast on an i5 10th gen / 8 GB, pages full-bleed,
media and AI at hand on every card, transitions that feel finished. Spaces stay available inside it.

Baseline facts (from reading the code, 2026-11-10):
- `Canvas.tsx` is 4231 lines, one component. Pan and zoom are already DOM-only (useViewport), good.
- Card memo is defeated: `modelFor` builds new objects every render (Canvas.tsx:2422), so every visible card
  re-renders on any board state change.
- Per pointer move: dragging a card sets state in Connectors (Connectors.tsx:97). Resizing or rotating a mark calls
  `edit()`, which re-renders the whole board (Canvas.tsx:2041). `getBoundingClientRect` runs on every move (:1661).
- Culling is an O(n) scan per frame (Canvas.tsx:495). It's fine for hundreds of cards; measure before changing it.
- A space switch remounts the whole board (`key={canvas-${spaceId}}`, App.tsx:980).
- Preview: capped at READ_W with margins, and 84 px kept clear for the toolbar (Expanded.tsx:625-628). The slim
  header leaves the page well short of the board's edges.
- AI dock: `position:absolute` over the board (ask.css:2-17). It covers cards.
- Media: a card shows an audio icon only (Cards.tsx:278). There is no mute or play control on the board, though tab
  mute and media_control both exist.
- Thumbnails: capturePage every 4 s while dirty (tabs.ts:359), at 800 px q72.

## Phase 0: measure (before any change)
- [ ] `scripts/perf-canvas.ts` (CDP): open a board with 60 and 200 cards. Record frame times during pan, zoom, card
      drag and preview open/close (Performance.getMetrics + rAF sampler). Record renderer CPU, main-process CPU
      and memory.
- [ ] Run it under `scripts/launch-lowend.ps1 -Cores 4 -RamMB 8192` and normally. The numbers go in this file.

Results so far (dev build, 60 tabs on the board, 22 cards in view, `bun scripts/perf-canvas.ts 9336 --throttle 1,4`):
- Pan at 4x CPU: script ~9.7 s -> 80 ms; frames p95 16.8 ms. Causes: `getBoundingClientRect` after each transform
  (forced layout), per-frame custom properties on the root (restyled every card), and the dot grid repainting via
  background-position (now its own layer, slid by transform).
- Drag at 4x: script 572 -> ~145 ms, slow frames 6 -> 1-2. Causes: Connectors routed every card per move with no
  connectors (routeAll now skips; Connectors skip drags that move no line end), and `.cv.dragging *` /
  `.cv.grabbing *` cursor rules restyling the whole board at drag start/end (now a ::before sheet).
- Idle: the AI ring (`.ai-edge`) spun invisibly forever, repainting a conic gradient and three blurred shadows every
  frame wherever the canvas prompt or chat composer was on screen. Paused unless `.on`; idle board now does 0 work.
- Card memo was NOT defeated: `sameModel` (canvas/model.ts) compares values. Baseline note above was wrong.
- Still open: mark resize/rotate re-render the board per frame (measure on a board with marks before rewriting).

## Phase 1: performance (no visible change)
- [x] Stable card models: already held by `sameModel`; nothing to do.
- [~] Drag paths DOM-only (card drag done; marks open): Connectors follows a dragged card through a ref and rAF (no setState per move); mark
      resize and rotate write the DOM and commit once on pointerup. Cache the board rect once per gesture.
- [ ] Keep boards of recently used spaces mounted but hidden (`content-visibility`) instead of remounting on a
      space switch. Cap at 2.
- [x] Thumbnails: capture only the cards in view (canvas:in-view; main re-captures stale pictures of on-screen
      cards one at a time, others when scrolled to). Already: 480 px, timer only while focused; 480 px on low-end (<= 4 cores or <= 8 GB); stop the timer while
      the window is hidden.
- [ ] motion/react only where a spring is wanted; CSS transitions for the rest. Check the bundle cost after.
- [ ] Re-run phase 0 and keep only changes that measurably help.

## Phase 2: canvas as a browsing mode
- [ ] Setting "Browse with": Tabs | Canvas. A global default, which each space can override (space editor). A canvas
      space opens straight into its board, and new tabs land on the board.
- [ ] In canvas mode, the tab stack and the panes/tab switcher are off; the sidebar becomes the space switcher plus
      the board's sections. The space switcher stays reachable (hover edge and Ctrl+1..9).
- [ ] Leaving canvas mode is "pop out to tabs" for one card, or switching the space to Tabs.

## Phase 3: full-bleed preview
- [x] (size, toolbar, mute in header) The live page fills the board area edge to edge. One slim floating bar (favicon, site, title, back/forward/
      reload, mute, reader/live, pop out, close) sits over the page top, auto-hides while scrolling, and comes back on
      hover. No padding around the page; the toolbar hides while a page is open.
- [ ] Left/right arrows and a swipe step to the neighbouring card without closing.
- [ ] Open/close stays the snapshot swap that exists now (native views cannot animate), tuned to 200-260 ms.

## Phase 4: media on the board
- [x] Live previews remembered per address (`previews` on the board): a page closed while live reopens live.
- [x] Every card playing sound: a mute toggle on the card face, plus play/pause on hover (tabs:media IPC).
- [x] A "now playing" pill (top right of the board, clear of the dock) when anything plays: title, play/pause, mute, jump to card.
- [x] Mute all on the board (Shift+M, uses muteSpace).

## Phase 5: AI on hover and selection
- [ ] Hover a card for ~500 ms (or hold Alt): a small action row grows from it. Summarise, Ask about this, Compare
      with selected, Find similar (embeddings), Group with similar. The results land as cards next to it, with an
      arrow.
- [ ] Hover a section: Summarise section, Tidy, Name it.
- [ ] Text selection menu: one row of actions (Explain, Summarise, Translate, Ask...) that answers inline under the
      selection, with Pin to board as a card. Fewer steps than the chip-then-card flow now; the same menu on the
      live preview.
- [x] AI dock: a column that the board makes room for (it slides over and the viewport shrinks, cards stay
      visible), not an overlay. It's resizable, remembers its width per space, and Esc closes it.
- [ ] Local model: these actions use the prime/cache path from phase 5 of the AI work. Hover primes the card's page.

## Context menu (user, 2026-11-10)
- [x] Right-click menu per target: card (open, open live, pop out, play/pause, mute, reader/page, ask, note,
      document, copy link, close), a selection (ask, close all), section (rename, fit, colours, delete), note
      (edit, delete), board (new page/note/text/section at the pointer, tidy, fit, ask, export). Replaces PlaceMenu.

## Phase 6: polish pass
- [ ] One motion spec (durations, springs, easing) in a shared file, used by every canvas transition.
- [ ] Consistency sweep: icon set and sizes, hit targets >= 28 px, focus rings, tooltips with shortcuts, empty states.
- [ ] Reduced motion honoured everywhere.
- [ ] Each phase is tested in the running app (scratch profile), every way in and out (lessons.md).

## Round 2026-11-10 afternoon (user asks, parallel agents)
- [x] AI dock has its own message box (toolbar prompt is hidden under a preview). Blank screen was the half-applied edit.
- [x] "play X on <media site>" plays the thing: YouTube results page / channel feed for "latest", else web search on
      that domain; opens it and presses play (shared/ai/play.ts, chatActions playQuick). Needs a dev restart.
- [ ] A. Canvas as its own browsing mode (Phase 2 above): in canvas mode the tab sidebar, top bar, tab stack and pane
      switcher are not mounted at all. "Browse with: Tabs | Canvas", global default + per-space override.
- [ ] B. Preview rework: no odd slide when the sidebar/dock opens, never blank, full site bar (site settings /
      permissions, bookmark, zoom, find, copy link, share, pop out), header menu redone.
- [ ] C. Canvas board context menu redone (cards, selection, sections, notes, board).
- [ ] D. Cut/copy/paste tabs: Ctrl+C/X/V on canvas (paste at pointer, across sections/spaces) and in the tab sidebar
      (after the active tab). Only when no text is selected and no field has focus; links go to the clipboard too.
- [ ] E. Playing tabs play live on their small card: tab stream (getMediaSourceId -> <video>), sound stays in the tab,
      playing tabs not throttled while hidden.

## Decisions (user, 2026-11-10)
1. Mode setting: global default + per-space override.
2. AI dock: a column the board makes room for.
3. Hover AI: dwell ~500 ms.
4. Order: perf first, then features, each phase tested in the app.
