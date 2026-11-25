# Polish 4 (board notes, 2026-11-25)

From the sticky-note board. Each item: what was found in the code, then the fix. Order = rough priority
(broken things first, features last). Release a prerelease after every finished item.

## A. Bugs

- [x] (1173aa6) **Going back from the error page does nothing.** Chromium commits its own entry for the failed URL, then
      `did-fail-load` (`main/tabs.ts:3813`) does `loadURL(panes://error/...)` on top of it. History is
      `[A, failedURL, panes://error]`, so Back (`ErrorPage.tsx:191` `history.back()`, and the toolbar's
      `goBack()` at `tabs.ts:2404/2423`) lands on the failed URL, which fails again and reloads the error page.
      Fix: in `did-navigate`, when the new URL is `panes://error`, remove the entry before it if it is
      `tab.failed.url` (same pattern as the `fellBack` removal at `tabs.ts:3846`). Check Retry/Forward still work.
- [x] (a8227b8) **Windows installer sidebar graphic not visible.** `build/installerSidebar.bmp`, `uninstallerSidebar.bmp`
      and `installerHeader.bmp` are each **2 bytes short** of the size their own header declares (sidebar:
      bfSize 154542, file 154540; Pillow: "image file is truncated"). They lost bytes in 1a10128 (likely a CRLF->LF
      pass). NSIS can refuse a truncated bitmap. Also: electron-builder's assisted installer has **no Welcome
      page** (only Finish shows the sidebar), so the `MUI_WELCOMEPAGE_*` text in `build/installer.nsh` is dead.
      Fix: regenerate the three BMPs (164x314 / 150x57, 24-bit), add `.gitattributes` `*.bmp binary`, and add a
      `customWelcomePage` macro (`!insertmacro MUI_PAGE_WELCOME`) so the art shows on the first page. Verify with
      `build:unpack` + an NSIS build run by the user.
- [x] (43fe87e) **Private/Tor tab in the board turns the whole space dark and it does not revert.** `App.tsx:727` picks the
      window theme from `kindOf(active)`, the active tab, not what is on screen. On the board the active tab sits
      behind it, so opening (or having last opened) a private tab darkens the whole board and stays dark after the
      preview closes. Canvas already knows the right answer (`privateWin`, `Canvas.tsx:4196`: private only while a
      private/Tor page is open in the preview). Fix: in canvas mode the theme kind comes from the preview (lift
      `privateWin` up or report it), `normal` otherwise. Check Tor the same way.
- [x] (7fa5547) **Private tabs in the preview's recent tabs have no logo.** `StripTab` (`canvas/TabStrip.tsx:85`) always
      draws `SiteIcon src={m.favicon}`; a private/Tor tab's favicon is not cached (`main/favicons.ts:15`) so it is
      blank. Fix: for `m.kind === 'private'` draw `IncognitoIcon` / `TorIcon` (as the card does, `Cards.tsx:155`).
- [x] (74046ba) **Adding a note near the screen edge scrolls the whole UI up** (again; same class as long notes). Editing a
      note does `el.focus()` without `preventScroll` (`canvas/Marks.tsx:274`, also `:392`, `Cards.tsx:702`,
      `Widgets.tsx:302`), and the caret near the edge makes Chromium scroll an `overflow: hidden` ancestor (it can
      still be scrolled by script/focus). Fix: `focus({ preventScroll: true })` everywhere on the board, plus a
      guard that snaps the board root's (and `html`'s) `scrollTop/Left` back to 0 on `scroll`, so typing past the
      edge can never move the chrome. Repro with a note at the bottom edge and a long note.
- [x] (abd769c) **White text on light theme colours (both white, invisible).** `shared/color.ts:220` already computes
      `--accent-fg` (white or near-black by contrast), but 18 rules hardcode `color: #fff` on `var(--accent)`:
      `styles.css` (.tour-acts .primary, .recover-btn.primary), `print.css` (.pr-btn.primary), `ask.css`
      (.cv-dock-send), `panel.css` (.pn-btn.accent, .pn-tabs i, .pn-primary, .pn-tile.on .pn-tile-icon),
      `welcome.css` (.wl-go, .wl-next, .wl-imp-go), `error.css` (.err-btn.primary), `permission.css`
      (.perm-btn.primary), `internal.css` (.int-btn.primary), `chat.css` (.chat-btn.primary, .chat-send x2).
      White knobs on accent tracks (`.toggle span`, `.pn-switch span`, range thumbs) vanish the same way.
      Fix: all to `var(--accent-fg)`; knobs get a hairline ring. Check every window with a white space colour.
- [ ] **Settings dialogs/menus animate in but do not close properly.** Needs a repro to pin down which ones:
      `ui.tsx` `Select` uses `<Presence>` (fine), but other in-page pieces animate in with CSS only and are
      unmounted on close with no exit (`.pw-detail` in Passwords, `.dl-suggest` in Downloads, the confirm states in
      SpacesSection/AiSection). Fix: route every conditional overlay/expander through `<Presence>` (or
      `motion` exit), then check each Settings section by clicking open/close on screen.

## B. Downloads

- [x] (a2a8762) **Downloads bin entries: Chrome's options and "Opening..." feedback.** In the fan (`dock/Dock.tsx:470`) the
      row's main button is `disabled` while downloading, so a click does nothing; a click on a finished one opens
      it with no feedback. Chrome: click while downloading = "Open when done", the row says "Opening in 5 s / Will
      open when done"; right-click gives Open when done, Always open files of this type, Show in folder, Copy link,
      Pause/Resume, Cancel, Remove. Fix: an `openWhenDone` flag in `main/downloads.ts` (opened on `done`),
      "Opening..." meta for ~2 s after Open, a native context menu on rows (fan and `panes://downloads`).
- [-] Bin artwork artifacting: skipped for now (user, 2026-11-25).
- [x] (a2a8762) **Progress bar and its states.** Fan row bar (`Dock.tsx:621`, `dock.css:297`): no track, so it reads as a
      stray line; `scaleX` squashes the rounded ends; unknown size shows a fake 5% (the page shows a fake 30%,
      `Downloads.tsx:115`); paused looks the same as running; it vanishes on completion; failed has no reason.
      Fix: a track + width-based fill, an indeterminate sweep when size is unknown, dimmed/striped when paused,
      a brief full/green settle on completion, red with the reason (`interrupted` cause) on failure. Same component
      for the fan and `panes://downloads`.

## D. Asked during the session (2026-11-25)

- [x] Frosted glass one setting across every window; never see-through without blur (49cc02b)
- [x] Settings bottom nav too wide: icons, current page named (b5b9d6d)
- [x] Card shadow under the title row (9b1ad90; lift shadow, split target, pulse)
- [x] (bdd1cfe) Ctrl+F find opens as a bar above the page (in the strip/sidebar) instead of floating on it. Native page views
      paint over the window's UI, so it needs its own small view over the page's top-right (like the popover).
- [x] Share popover on the board: too much text (38a4321; not checked on screen, the test instance would not open the board)
- [x] Mute tab / mute site reliable: own tab mute kept apart from the page (shared/mute.ts). Leaving a muted site is
      heard again, unmuting a site keeps tabs muted on their own, a tab's mute survives unload. Needs an on-screen check.
- [x] (670f78a) Split view: the panes' left and right border/outline is clipped.
- [x] (208d543) Preview's recent tabs: more than the limit (the row of 4 plus up to 2 waiting tabs appended), and picking a
      right-hand one moves the row (a tab outside the row joins at the left / takes a freed seat by recency).
      Fix (drafted, E:/tmp/draft/kept.ts): the row is frozen while the preview is open; a tab keeps its seat while
      open; closed ones leave and the next fills the end; a page from outside takes the rightmost seat that is not
      the way back; waiting tabs only fill free seats; one cap (5, the board's) for both rows.
- [x] (0f11120) Setting to turn off tooltips everywhere: `tooltips` setting, stamped as data-tips by main/uiFx.ts on every
      Panes page, tooltip.ts shows nothing while it is off (titles are still moved off, so no system tooltip).
- [x] Pop out (open as a tab, leave the board) removed from the preview header and its menu.
- [x] (88cf379) Every floating surface follows the frosted-glass setting (space menu, share, strip, menus, toasts, AI/chat
      panel...): converted to --glass-alpha / --glass-blur; check on screen with glass on and off.
- [x] (00b60fb) Bulk-closing a frame: cards leave in one frame (board hides them at once; main sends one state for the batch).
- [x] (670f78a) Split view outline clipped: native view snapped inside the pane box (shared/geometry.ts innerRect).
- [x] (88cf379) Selected card ring not rounded (user: since today). Find on screen.
- [x] (bfeb894) Scroll fade gradients everywhere, search dialog (command palette) included.
- [x] (9f55529) Settings page reorganised: easier to find things (fewer, clearer sections; a section index or search).
- [x] (df767e2) Top toolbar (strip with now playing and tabs) with the AI or chat panel open: drifts left with a gap.
- [x] (147b0d2, beta.173) adblock-rs 0.13.5 -> 0.13.6, then a full Windows and Mac release (installer + Mac shell build).
- [x] (9bb8d8b) Cards on top of each other after navigating (free sections): grown card pushes others aside.
- [x] (670f78a) Settings memory figure wrong (summed working sets).
- [x] (1078a6f) Onboarding password import: open the browser's own password page, with a per-browser steps popup.
- [x] (3d6a893) AI can change Panes' own settings (a tool: read/set a whitelisted set, says what it changed, undoable).
- [x] (845da6b) Space selector, Share and presenting pill not frosted: now on the board chrome.
- [x] (8a1f328) Settings segmented selectors (Balanced etc.) look broken, no background on the picked one.
- [x] Re-check every prompt of 2026-11-25 against what shipped (user asked twice).
- [x] (f06cc4a) Welcome screen redesign: calmer, typographic, less "vibe coded" (Dia/Arc-like restraint).

## C. Features

- [x] (39670c5) **Reorder spaces by dragging in the space selector.** Nothing exists: no `spaces:reorder` IPC, `Space[]`
      order in `main/spaces.ts` is the display order. Add `SpaceManager.move(id, toIndex)` + IPC + preload, then
      drag in `SpaceSwitcher.tsx`, `SpacePopover.tsx` and the board's `BoardSpaces.tsx` (one shared drag hook).
      Keyboard: Alt+Shift+Up/Down. Tests for the move in `src/shared`.
- [x] (92404c6) **Pinch to zoom like macOS (visual zoom, not page zoom).** Pinch arrives as Ctrl+wheel and is filtered from
      the tab stack (`tabs.ts:4016`), but no visual zoom is enabled. Fix: `wc.setVisualZoomLevelLimits(1, 4)` on
      every tab so a touchpad pinch magnifies the page in place (layout unchanged), keep Ctrl+wheel/Ctrl+= as page
      zoom. Check it does not trigger the stack, and that a double-tap/pinch-out returns to 1x.
- [x] (365c6ff, toolbar button) **Widgets more prominent.** Stopwatch/Timer/Reminder are only in the command menu (`Canvas.tsx:5627`) and
      the board's right-click (`:5526`); not in the toolbar. Faces are note-sized (`canvas.css:3910`). Fix: a
      widgets button in the board toolbar (fan of the three), bigger, bolder faces (large digits, accent ring that
      runs down), and a live one shows its time in the board's top bar while off screen.
- [x] (0b2d4bf) **DevTools support.** Today: `toggleDevTools` (`tabs.ts:1177`), Inspect in the page menu, F12/Ctrl+Shift+I/J/C
      all just toggle (`tabs.ts:4260/4274`). Missing: links DevTools opens (Sources "Open in new tab", network
      request URLs) go nowhere: handle `devtools-open-url` and the DevTools webContents' `setWindowOpenHandler`
      to open Panes tabs; a context menu on the DevTools webContents (copy/paste/inspect); Ctrl+Shift+C opens
      with the element picker, Ctrl+Shift+J on the Console panel; dock position remembered.
- [ ] Board section name chips: light section/space colour with white text (fhead-at missed the newer styles).
- [ ] Settings: the sticky search row sticks against the page header (no gap / overlaps it).
- [ ] Downloads bin: its shadow is clipped, and it flashes sometimes (user asked again, so the artifacting is in scope).
- [ ] **Chrome extensions (not urgent).** Nothing exists (`session.loadExtension` unused). Electron supports only a
      subset of the extension APIs (no full `chrome.tabs`/action UI). Needs a design pass first: load unpacked +
      CRX from the Web Store per space session, an extensions page in `panes://`, toolbar action buttons. Park until
      the rest is done.

## Review
