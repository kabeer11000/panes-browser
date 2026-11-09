# Canvas: round 2 and round 3 status

Resumable checklist for the AI canvas (src/renderer/src/canvas, src/shared/ai/canvas*.ts, connectors.ts, snap.ts, split.ts).
`[x]` done, `[-]` dropped, `[~]` partly done (what is missing is written next to it), `[ ]` missing. Audit 2026-11-09.

## Round 2

### Canvas and tabs
- [x] Opening canvas deselects the active tab (App passes `activeId=null` to sidebar and horizontal tabs).
- [x] Switching tabs closes canvas (App watches activeId; a click on the tab canvas opened over now leaves canvas too, App.tsx onTabClick).
- [x] Board blurs and dims while the sidebar or top bar is revealed (`dim` prop, `.cv.dim`).
- [x] After restart, zoom to fit when the saved view shows nothing (fit and the in-sight check use contentBoxes, drawings included; tested).

### Conversation dock (AskDock, useAsk)
- [x] Follow-ups with the thread as context (history sent each turn, kept per space, not in private windows).
- [x] @mentions in the prompt and selected cards as context (chips; non-tab cards go as text).
- [x] Citations: source chips under the latest answer, click pans to the card or opens the link.
- [x] "Add to canvas" for a whole answer or any part of it, with arrows from the cards it used.

### AI that acts (canvasTools.ts, main/ai/canvasAssistant.ts)
- [x] Board tools (get_board, tidy_up, arrange, frames, move, stack, delete with confirm, notes, cards, connect, set_kind, focus, select, add_shape, style), checked in shared, run in the renderer, one undo step each, "what I did" row with Undo.
- [x] Browser actions: the chat backend's own tools are given in canvas mode.
- [x] Flowchart: `flowchart` board tool (layFlow: one shape per step, diamonds for questions, elbow arrows, free space, one undo step). Connectors attach to shapes and blocks. Not tried with a real cloud model (no key in the scratch profile); run through the tool path in tests and in the app.

### Prompt
- [x] Quiet focus: no ring on the field inside the pill (the pill keeps its own thin inset line), same for the queue editor and drawing editors.
- [x] Queue: Enter while busy queues; rows editable, removable, drag to reorder; run in order with full context; Stop cancels the current answer only; Clear queue.

### Shapes and blocks
- [x] Shapes: rect, rounded, ellipse, diamond, triangle, arrow, star, bubble.
- [x] Colour (8, theme vars --m0..7), no fill, outline on/off, text size, z-order, lock: the drawing bar (MarkBar.tsx).
- [x] Blocks: stickies (notes, 4 colours), heading and body text, sections (frames), tables (cell editor), checklists (tick on the board), code blocks, straight lines (L). Toolbar block menu.
- [x] Paste and drop: links become cards without a tab and unfurl (title, lines, picture kept), images and PDFs are copied to <userData>/canvas-files and shown, CSV/TSV and spreadsheet rows become tables, task lists checklists, code code blocks, text notes.
- [x] Connectors attach to shapes and blocks too (End kind mark).
- [x] Multi-select bar for drawings: colour, outline, text size, align (6), distribute (2), front/back, duplicate, group/ungroup, lock, delete. Scope: drawings (shapes, text, blocks, lines); cards, notes and frames keep their own bars.
- [x] Keys: R, O, S, T, X, L line, C connector, Ctrl+D duplicate, Alt+drag duplicate, Ctrl+G / Ctrl+Shift+G, arrows nudge drawings (Shift 10, one undo step per run). Arrows still walk between cards when no drawing is selected.
- [x] Undoable: edit(fn, { undo }) records every person step (notes, frames, card and note moves, connectors, drawings, paste, drop, AI). Undo re-syncs with open tabs.
- [x] 60 fps with 300 objects: 313 drawings, pan 61 fps (p95 16.8 ms), zoom 60 fps (p95 17.2 ms) over CDP in the scratch profile. A drag moves the DOM, not React; one selection change re-renders the board in about 27 ms. Shapes without text have no foreignObject.

### Stacks
- [x] Older find results fold into stacks (`collapseOld`, latest two stay open), fan out on click.

## Round 3
1. [x] Command menu on / or Ctrl+K (CommandMenu.tsx, matchCommands tested): new note, section, page, blocks, shapes, tidy, rearrange, ask, find, fit, undo history, presets, exports; free text runs as Ask or Find.
2. [x] Smart paste and drop of files from Explorer as the right card type (canvasPaste.ts, tested; drop tested with a synthetic DragEvent).
3. [x] Undo history: "History" beside New (only when there is something to undo), newest first with times; a row takes back it and everything after. Per open board (not kept across closing canvas).
4. [-] Minimap: dropped by owner (2026-11-09). It had been built and was removed entirely (component, CSS, state, command); zoom to fit and the rest of navigation stay.
5. [x] Presets Research, Trip, Shopping (canvasPresets.ts, tested): a row of sized sections in free space; "Trip Lisbon in May" in the menu asks the assistant to fill them (add_note/add_card near a section now go into it). Fill run through the mock server only for the flowchart path, not for a preset.
6. [~] Export: image and one-page PDF of the fitted board with its controls hidden (canvas:capture + canvas:save-file in main/ai/canvasExport.ts), Markdown digest (canvasDigest.ts, tested). Capture checked (1752x1010 PNG decodes); the save dialog and the PDF step were not driven (native dialog). Picture is the window resolution of the fitted board, so big boards come out small.
7. [x] Snapping: guides, gap lengths and even-spacing (equal gaps to both neighbours, drawn in the accent) while Shift-dragging cards, notes, frames and drawings (snap.ts, tested).
8. [~] Offline reading: expanded documents fall back to the text kept with the card ("Saved copy"); links unfurl into kept text; dropped files are local copies. Web PDFs are not cached.

## Handoff from the browser-polish agent
- [x] Keep `addCardToBoard` in src/main/ai/canvasAssistant.ts (reader mode "Add to canvas") when editing that file. Kept; it and the new addFileToBoard share untilBoard().
- [x] Downloads "Show in canvas": shelf button (Dock.tsx) -> downloads:act "canvas" -> dock.ts finds the finished download -> addFileToBoard (main-only "add_file", never a model tool) -> the board puts it as its card kind (PDF, picture, CSV table, code, text note; anything else a link card to the file). Tested with a CSV download in the scratch profile.
- [x] Saved boards get usedAt (stamped by CanvasService.save; old files load without it); pickBoards sorts the active space first, then by usedAt (tested).

## Owner requests
- [x] Horizontal tabs layout: in canvas the tab strip and the toolbar tuck away as one (App.tsx .topbars.tucked, barAutoHidden now covers top tabs in canvas, barPx counts both rows), slide out together the auto-hidden way, the board dims and blurs; closing canvas restores both rows. Screenshots: vertical and top-tabs canvas full screen, top tabs restored after closing. The slide-out was checked by putting the app in its out state by hand (classes and --slide-y), not with the real pointer: main reads the real cursor and the user's mouse was not driven.
- [ ] Shape and sticky text like FigJam (owner bug, before the queue): centred WYSIWYG text in shapes with per-kind inset box, invisible in-place editor, enter by double-click, Enter or typing; Esc keeps it selected; auto-contrast text; shapes grow to fit; stickies top-left with shrinking font; text blocks auto-width; one undo per editing session. Screenshots at 50, 100, 200 %.
- [ ] Popovers never clipped (owner bug, with the text fix): shared fitPopover(anchor, size, viewport, prefer, gap, margin) -> {x, y, side} that flips then shifts and clamps (tests for every edge, corner, oversize); every canvas popover, tooltip, menu and toolbar through it, measured in a layout effect, re-run on resize, zoom, pan and chrome reveal, rendered in a top-level layer (portal to the canvas root, z above 10). Screenshots: section menu at each edge and corner, a right-edge toolbar tooltip, the selection bar touching the top edge.
- [ ] Live pages open as a popup inside canvas, never as a tab (owner, high priority). Coordinator notes: the popup header uses "Pop out" (not "Open as tab"), opening the CURRENT url and moving the live view into the tab without a reload; URL/title field min-width 0 and ellipsized (full URL in title), header buttons never shrink or wrap, test with a 300+ character URL; the popup sits above the .cv::after dim layer (z > 10) and no container that holds popovers gets opacity or filter. Plan (not started in code): main/ai/canvasLive.ts owns one WebContentsView made by a new TabManager.makeCanvasView() (session of the window canvas was opened from; makeView keeps adblock and YouTube defences, which are per session) and loaded with the tab identity; create() gains an optional view to adopt for "Open as tab" (no reload). Window open: sign-in popups stay real windows (same rule as tabs.ts), other new windows become cards. before-input-event: Esc closes, F5/Ctrl+R reload, Alt+arrows. State (url, title, favicon, back/forward, loading) pushed to the renderer. Renderer: a panel (top 64, bottom 92, side margins, leaves room for the dock) whose placeholder rect is sent on ResizeObserver; the native view is hidden with a captured still in its place while the board is dimmed (sidebar/top bar out) or any canvas HTML overlay is open. Replace: Expanded Open live for non-tab cards, goToTab for non-tab cards, openNew (New page) and the canvas createTab calls (Canvas.tsx ~2416, ~3114, ~3208) with the popup plus a card.
- [ ] Video and media live cards: background play, mini player, now playing in the toolbar (owner, after the popup).
- [ ] Card failure and empty states (favicon, title, domain, a plain reason, one action; skeleton while loading; saved text instead of an error) for PDF, web, image, video, document; light and dark (owner, after media).
- [ ] Cards refresh themselves: cookie change on a domain (debounced) retries its failed or sign-in cards, back online retries failed, a failed card retries on coming into view with backoff 1 s, 5 s, 30 s, stale cards refresh lazily when visible (2 at a time, aborted when they leave); never while editing, never across private sessions. Manual Reload in the card menu and Ctrl+R on a selected card; Ctrl+R/F5 in the popup. Pure logic in shared with tests. Verify with a local server that 401s a PDF without a cookie (owner, after media).

## Log
- 2026-11-09: round 2 shapes/blocks/bar/keys/undo/paste/drop/flowchart built; CSP of index.html now allows blob: images (dropped and downloaded pictures were blank before).
- 2026-11-09: round 3 menu/history/map/presets/export/even spacing; handoff items done. End-to-end with a scripted OpenAI-compatible mock (flowchart via the dock with its Undo row; queue of 3 with Stop on the first: the other two ran in order).
