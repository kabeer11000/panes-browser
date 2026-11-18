# Feeling like Park: speed and smoothness ideas

What Park (parkweb.co) does that makes it feel instant, and what Panes does or will do about it. Measured over the
DevTools port (scratch scripts: zoom-check, zoom-fps, trace-zoom, layers). Done items say what they measured.

## Done

- [x] Strain governor: live cards give up sharpness, then count, then frame rate as the computer struggles (long
      frames, dropped video frames, system pressure, battery, the board's own slow frames).
- [x] Memory: pages at rest are purged at 1 min and frozen at 3 min; idle helpers (tab card, password popover, site
      panel) released after 10 min; no idle unloads while memory is roomy.
- [x] The page you are flying to is prepared before you land (camera's resting view, `tabIntent`).
- [x] V8 compile cache for faster starts.
- [x] Off-screen pages (setting, off by default): the live page moves and zooms with the board. Costs about 3x for
      video, so native views stay the default.
- [x] Live video cards (native): cost the same as watching the video in its tab (~60% either way): at the floor.
- [x] Preview open/close: no dropped frames at 1x (worst gap 20 ms).
- [x] Zoom: pictures never go blank (decoded before shown, kept ready, small copies zoomed out; a card keeps the
      picture it shows). 0 flashes in a zoom out/in test, was every picture at each crossing.
- [x] Zoom: cards placed in 2D and card-button blur only on hover: 632 GPU layers to 139; frames over 20 ms 95 to 35.
- [x] Zoom: the zoomed-out restyle runs at low priority (startTransition) so the next input is not held up.
- [x] Sharp pictures zoomed in: a card shown much wider than its picture gets a new one at its width once the board
      settles (loaded tabs); pictures kept on disk up to 960 px (was 480). beta.87.
- [x] Crossing the far zoom renders no card (a store read by pictures and answers, not a prop): 70 ms of React gone
      at each settle. Cards keep their shadows zoomed out (no board-wide pop). beta.88.
- [x] Hover intent: already there (120 ms resting on a card starts its page).

## Next

- [ ] Thumbnails as files, not data URLs: a `panes-thumb://` URL per picture instead of base64 strings through IPC
      and React props (a third bigger, copied around, parsed on every decode).
- [ ] The rest of the overlap layers (75 to 130 cards still get a layer of their own while zooming). Ruled out: the
      card transform (left/top made no reliable difference, reverted), animations, button and media blur, frame
      heads, resize handles, the board's and grid's will-change. Card shadows matter (none: 23 layers).
- [ ] The re-raster after a zoom in (about 240 ms on the GPU once it settles): hold the board's layer a moment longer
      only when another movement is likely, or raster at the coming scale ahead.
- [ ] The `.lod` class restyle at settle (about 55 ms of style recalc): scope its selectors (a `:has()` rule may
      widen the invalidation).
- [ ] Keep the last few opened pages warm (not discarded) so going back is instant, within the memory budget.
- [ ] Prerender the likely next page from the search or command menu (Speculation Rules in the tab's session).
- [ ] Measure the built app, not only dev (React dev mode doubles render costs in the profiles).
