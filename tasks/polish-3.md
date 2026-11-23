# Polish 3 (goal set 2026-11-22)

Release a prerelease after every finished item. Be critical of UI/UX: every change is checked on screen.

## A. Bugs

- [x] Touchpad swipe back/forward never fired: 40 mm needed, no flick, page check too late. Now 30 mm or a flick,
      page asked as fingers land, muted badge with no history. (cb4ac6c; needs a real-touchpad check by the user)
- [x] Toast click (WhatsApp) did nothing: hook went in after the page grabbed Notification. Now preload, doc start;
      on the board opens the preview. (01911b8)
- [x] Call badge unreliable/stuck: tracker missed first call on allowed sites; removed iframes left "on".
      Preload shim + prune dead frames + 2 s recheck. (d3ecdd2)
- [x] Preview address: Enter stayed on the page (self tab as the strong "switch to" pick; synthetic mousemove
      moving the pick). (af31e25)

## B. Board (canvas) design

- [x] Cards: bigger, no bottom rim (the footer strip with the host), presented better. Picture fills the card, the
      title floats on it; site identity without a strip.
- [x] Notifications vs recent tabs: one new pattern (the deck, 8eb3bbe). Today both are the same chip at the same spot (preview closed:
      notifications; open: recent tabs), so they read as one thing. Design one surface for "what wants you"
      (notifications) and "where you were" (recent), clearly different.
      Design (2026-11-22): split by place, shape and content.
      * Recent tabs = navigation: tab pills, top centre of the preview only (the board shows every tab already).
      * Notifications = messages: never favicon-only. A "deck" in the top-right corner, board and preview alike:
        stacked message cards (icon, site, what it said, age), the top one readable, the rest as edges behind it
        with a count. New ones slide in on top and settle into the deck; click the deck to fan it out into a list;
        a card opens that tab; swipe/x clears. In the preview the deck lives in the header's right zone (the live
        page is a native view, nothing can float over it) and fans out downward with the page stepped aside.
      * The board's top-centre favicon row (.cv-inbox) and the preview bell are replaced by the deck.
- [ ] Space selector (top left): redesign.
- [ ] Space settings button: redesign, intuitive.

- [x] Notifications + recent + now playing: user picked "Top strip everywhere" (2026-11-22). One strip, board top
      centre and preview header: playing chip, recent tabs, waiting tabs; message words drop below (board) or float
      beside (preview). Deck, bell and playing pill removed. (ea6a2c7)
- [x] Perf: beta.108 card tag + shade cost 25-30% GPU in pan/zoom (A/B measured). Tag now hover-only, flat. (f4440d8)
      SpaceSwitcher memoised (its layout animation re-measured on board renders mid-pan).
- [ ] Cards "better looking", not just bigger/no rim: user not satisfied yet. Needs a design pass (measure GPU!).

## Queue from the user (2026-11-22 evening), in order

- [x] Ctrl+T then typing at once, from every screen: no key lost. 60/60 timed runs, tab view + board, 0-250 ms.
- [x] Board strip + bottom toolbar must trap the pointer (hover, right-click reach the board under them). (88c45d1)
- [x] Setting to turn off live video on cards (RAM/GPU). Settings, Memory. (f61fef7)
- [x] Recent tabs: switching sometimes drops that tab from the bar; a newly opened tab does not show at the left.
      Rule: left = most recent, stable, never disorienting; tabs appear and move with clear motion. UI is never a surprise.
      (b9de12b, verified live: background tab joins at the left in 1.5 s, board and preview.)
- [x] Preview open: a rim of something peeks from behind at the left / top corners. Board put away at rest. (0f61495)
- [x] Shared spaces (FigJam-like, plan: tasks/shared-spaces.md; + Hyperbeam-like co-browsing, chat, web guests), decided 2026-11-20 (polish-2.md:132): Yjs, own websocket relay on the user's Render
      2026-11-23: every phase in tasks/shared-spaces.md done but TURN, which waits on the user's Cloudflare key.
      account, invite link with a secret key (no accounts), images shrunk + uploaded to the relay (~5 MB cap). Both edit
      notes, images, arrows, sections, cards. Later: shared tabs. Plan it in tasks/shared-spaces.md first; deploying to
      Render is outward-facing: confirm with the user before the first deploy.
- [ ] Usage analytics (user decided 2026-11-22): self-hosted endpoint, asked on first run (welcome), domains included.
      Actions, screens, durations, version/OS/RAM tier, perf timings, site domains. Never contents, typed text, passwords.
- [x] Tidy freezes the whole PC for a second, even without AI: measured on 120 scattered cards (dev build): frames of
      267 ms, 469 ms of JPEG encoding (cards' small copies made as they flew into view) and 458 ms of GC on the main
      thread. Small copies are now encoded in a worker (pics.ts, shrinkWorker.ts) and cards out of sight at both ends
      of a move are not animated: worst frame 100 ms (one React render of the moved cards, dev mode), GC 96 ms.
- [~] Notes and text on the board: Ctrl+B / Ctrl+I and the like (Figma-like), font size. DONE for notes: Ctrl+B bold,
      Ctrl+I italic, Ctrl+Shift+X struck (markdown markers in the text, drawn on the board and the web board;
      shared/noteMarks.ts). Checked with real keys. OPEN: text labels and shapes; a font size control.
- [x] Certificate interstitial "Proceed (unsafe)": verified on self-signed.badssl.com (c249b32).
- [x] Tooltips go under the web contents: preview and tab view (sidebar). 25/25 clear in a sweep. (7dcff39)
- [x] Preview notifications list under the page (offscreen page canvas) + Escape closed the preview. (7dcff39)
- [x] Space switcher unread bubble clipped. (8926016)
- [ ] Frosted glass option: whole chrome (board strip, now playing, bottom toolbar, popovers) blurred/translucent
      when on; off automatically in Efficient/Performance mode. No such setting exists today. Measure GPU on pan/zoom.
- [x] Scroll fade gradients on every scrolling list, search popover included: one scroll-driven rule (styles.css) for
      the tab list, search, spaces popover, board command list and space menu, notifications, chats. Fades only an
      edge with more beyond it (checked on 63 tabs: top 0/28, middle 28/28, end 28/0); a short list gets none.
- [~] Notifications sometimes do not open from the strip. User likes the bell after all: reposition it, make it reliable.
      The bell shows always, even with nothing new (beta.113 feedback). Unread styling is "gross": redo it.
      2026-11-23: nothing new, the bell is faint (full when pointed at); something new, a soft accent tint and the count
      in the accent, no red blob. Not opening: not reproduced (open/close goes through one toggle).
- [x] open.spotify.com opens in its mobile layout (user agent? viewport?): the Electron user agent; spotify.com now
      gets the Chrome identity (shared/identity.ts). Checked: desktop player, Your Library sidebar, no "Open App".
- [x] Card host pill (top of a card) shows sometimes, not others: make it reliable. (e4d901c)
- [ ] Cards redesign: sizes, rounding, overall look (user, again). Measure GPU on pan/zoom.
- [~] Site settings popup: full retheme, clean; it is oddly see-through (fix). Redone in 2b77b45 (1.5 h after this
      note): one opaque card (--popover-bg, checked defined), hairline-parted. The other popups the same way: open. Then every other popup the same way
      (permission card, save-password, downloads bin, tab hover card...): one clean look, wider/horizontal if it reads better.
- [~] Then: first-party screen time / digital health (time per site, daily/weekly, limits, focus), better than
      Apple's Screen Time. Local only.
      DONE (MVP, 2026-11-23): panes://screen-time (menu and search): today, the week as bars, sites by time; daily
      limits per site; past one the tab shows "Time's up" with 15 more minutes. Counted every 5 s while Panes is in
      front and the person is there (or a video plays); private and Tor never; kept 60 days on this computer
      (shared/screenTime.ts, main/screenTime.ts). Page, limits and time's-up checked on a scratch profile; the counting
      itself only by tests (it needs the window in front). OPEN: focus sessions, weekly report, per-space view.

- [~] Zooming the board in and out is laggy again: measured 2026-11-23 with scripts/perf-canvas.ts on the built app
      (beta.139, 60 tabs): pan, zoom and drag p95 16.8 ms even at CPU x4, no frame over 33 ms zooming. Not
      reproduced on a scratch board: needs the user's own board (many live pages, videos) to find what is slow there.
- [~] Switching spaces (esp. with many tabs) is laggy and stutters: measured 2026-11-23 (dev, 2 spaces of 25 tabs):
      the state arrives in 2-10 ms; tab view worst frame 33 ms, board open worst 83 ms (React, dev mode). One switch
      once took a 3.8 s React render (right after 25 tabs were opened, still loading); not reproduced since, fresh
      or warm. Next: the same on the user's real profile (a trace of the slow switch).
- [x] Search popover offers "canvas mode" while the board is already open: the board's search hides it (typed or
      not; search.test.ts).
- [~] Now playing play/pause: one click sometimes leaves the wrong state (YouTube). Two causes found: Pause stopped the
      first playing element (a muted hover preview or an ad), the video playing on; and the strip's button showed main's
      flag, asked of the page a beat later, so a second click undid the first. Now Pause stops everything playing and
      Play brings it back (automation.test.ts), and the strip shows the page's answer at once. Not yet tried on YouTube.
- [x] Switching between tabs with different page zoom shifts the layout (zoom badge appears/goes): no shift, tab view and preview.
      Fixed in d3cbf02 (what comes and goes sits left of the tabs in the preview header); the tab view shows no badge.
- [ ] Board: "open link side by side" reworked: its animations are poor and it is not fun to use (user 2026-11-22).
      Split view in the preview: no extra toolbar per pane; each pane's tab actions slide out at its right edge on
      hover (like the downloads bin), and the whole flow is reworked: the context menu item, its wording, the motion.
      Split view + the recent tabs strip in the preview is broken (behaviour and look): rework both together.
      Seen 2026-11-22 (scratch, google+wikipedia split): the other pane is a dark blurry picture, not live; the
      header shows only one pane's address, no sign of which pane has focus; the strip does not show the split.
      Also: the page view shows too big, then resizes, when switching tabs in the preview (user).
- [x] Hyperbeam-smooth shared browsing with remote control, and chat: in tasks/shared-spaces.md.
      2026-11-23: sound, 60 fps, sized pictures, pointers, TURN-ready, web watching; ~40 ms glass to glass locally.

### User 2026-11-22 23:00+ (after beta.122)

- [x] PiP back-to-tab did nothing: now brings the tab up (6a9d64c, both buttons checked from another tab).
- [x] Joining a shared space: invite page opens Panes (panes://join), join field, copied-link suggestion, Share on the
      board's top bar, own name; space rename overwrite fixed (b641918, 2c1eca4; two-instance test on the relay).
- [x] Live indicator: capsule in the room's state colour, halo dot (d803622, beta.124).
- [x] Shared space reconnects after any outage (gave up after 16 s; relay redeploys left everyone offline) (d803622).
- [x] Space selector on the board: the name no longer jumps from under the pointer; quiet at rest (d803622).
- [x] Black flash closing the preview: board hidden one frame (data-closing removed before .covered) (ee11667).
- [x] Ctrl+W in the preview keeps it open on the tab used before (ee11667).
- [x] Shared boards show the others' tabs (mirrors) (b93f420); shared spaces badged in the selector (bd49dbc).
- [x] Recent tabs strip: picking a tab moves it to the front and shifts the rest (user 00:51). Nothing moves while
      the strip is used; the order catches up when it is not (preview closed, or a moment after). Shipped in
      beta.130 (4099888).
- [x] Back went to about:blank after the first page (the identity priming load). Shipped in beta.129 (05ada01).
- [x] Mirrored tabs: pictures (the owner's snapshot, shrunk, encrypted, through the relay's blobs); later live.
      Shared through the relay's blobs (main/share.ts); the web board shows them decrypted.
- [x] Mirrored tabs overlap the viewer's own tabs in the same section (both lay out from the same spots): readInto
      moves a mirror on one of the viewer's cards (or an earlier mirror) to the nearest free spot, the same each read.
- [x] Board opened on a space switch stayed blank (stuck in .swap) in the parked test window; reopening fixed it.
      Reproduced: StrictMode's mount-time effect cleanup on the new board handed its own layer to holdLeaving, which
      carried it off with the old board. A layer still in the page is now left alone (checked: 4 switches, each board
      kept its surface and cards). Development builds only (StrictMode), but now safe either way.
      Check on a visible window whether it ever happens for real.
- [x] Reopen closed tab (Ctrl+Shift+T) exactly where it was: Ctrl+W's close (beforeunload path) never recorded the
      tab at all (checked: example.com closed that way was not in closedUrls). Keep history (pageState: scroll,
      forms) via navigationHistory.restore, video time, space, in the preview on the board, card back at its spot
      (placeNext). All in place (closingSnap, captureClosed, placeWhenReady, canvas:reopen-at); now also its place
      among the tabs and its group (checked: closed at index 3 of 63, back at index 3).
- [ ] Ctrl+T after typing in a page: sometimes the search popover's field does not have the keyboard (click needed).
      Ruled out: a page calling window.focus() (cannot take focus back in Electron, tested), the new-tab page (no
      focus calls). CDP keys skip main's shortcut, and the parked window never has OS focus: needs real keys on a
      foreground window (E:/tmp/keys.ps1, target the right HWND: MainWindowHandle was not Panes' window).
      2026-11-23: real keys on a visible copy: 10/10 runs the popover opened with every key ("gmail", 0-200 ms
      after Ctrl+T) and held the keyboard. Not yet with the keyboard truly in a page first (the click to put it there
      missed: the user's window was over that spot; keys.ps1 now refuses such a click). Next: a page focused by a
      click verified with WindowFromPoint, then the same 10 runs; also the board with the preview open.
- [ ] Preview over a YouTube page, bell opened: the page turns into its picture (good), but on closing the bell the
      live page comes back and reflows (things move, update). Make the return seamless: show the live view only once
      it has painted at the same size (no resize on return), no blur or darkening.
- [x] Notifications sometimes not picked up; only the tab title changes. (Shipped in beta.129, eac05b1: preload/sw.ts.) Title counts already reach the bell
      (count > 0 is waiting). The gap: a notification shown from inside a service worker (a push while the tab is in
      the background; Gmail, Discord, WhatsApp at times) never passes the frame preload's shim (shared/notify.ts covers
      the page calling registration.showNotification only) and Electron drops it. Fix: a service-worker preload
      (session.registerPreloadScript type 'service-worker') wrapping self.registration.showNotification, reported to
      main and matched to the site's tabs by origin.
- [x] Preview: switching from one recent tab to another and closing it (Ctrl+W on the board) should keep the
      preview open and show the last tab, as navigation does; no reopen or glitch. (beta.125, ee11667: onBack.)
- [ ] Split view in the board: still not the tab view's (user 23:04). Parked by the user for now.

- [x] PiP is broken (user 21:13, YouTube): opening PiP glitches the whole page, a little video sticks at the left
      over the page. Must behave like Chrome/Brave: the video leaves for the PiP window, the page stays as it is. Fixed in beta.122
      (5e0f235: Chromium's own picture in picture) and beta.123 (6a9d64c: back to tab).
- [x] Search popover forgets what was typed when it blurs (click away) and starts from scratch. Chrome-like: the
      text stays until Escape or navigation, in the preview's, the tab view's and the toolbar's search alike. Kept
      per bar and tab (SearchPalette drafts); Escape, a pick or a page change clears it. Checked with real keys and
      clicks: typed, clicked away, reopened with it; Escape, reopened with the address.
- [x] Board: tab cards still sometimes land on top of each other (user 21:09, after makeRoom fix of beta.103). Trace
      where new/synced tab cards get placed (syncTabs, placeItem, reconcileSaved) and what skips makeRoom. Found by a
      seeded walk (canvas.overlap.test.ts): a section re-gridded after a tab closed (a column becoming two) covered the
      next one; dropIfEmpty now makes room. Clean over 3000 runs.

### Missed by the 21:04 session (said "logged", never written here; audit 2026-11-22 21:10)

- [x] Deleting a tab section / frame group sometimes flashes or stutters (user): the section went at once and its
      cards hung loose until their tabs closed in main, then popped off. They now leave in the same step (checked: a
      24-card section, nothing left 80 ms after Delete).
- [~] Board chrome is "too much, noisy": drag/resize handles, card buttons, general look should be refined and quiet
      (Figma / Apple level). Part of the cards redesign, but its own pass. 2026-11-23: card buttons and the hover corner
      appear after 150 ms of resting, not on passing (a pointer crossing the board no longer flashes them). Handles were
      already selection-only but for one corner. The rest waits for the cards redesign.
- [ ] Space settings popover (SpacePopover): full redesign, same language as the new site settings panel (user asked
      "did you not redesign the settings popover").
- [ ] Opening the preview is laggy (user, with pan/zoom/space-switch lag). Zoom renders fixed in 27938ed; preview
      open, pan and space switch not yet measured on a heavy board.
- [x] beta.121 left as a draft with only latest.yml (limit hit mid-release): finish it.
      Published since (checked 2026-11-23: not a draft).
- [ ] Split view rework (45b4ae7) not verified on screen; split-board.md steps unchecked; the "page shows too big then
      resizes" placement fix not done.
- Done in commits, unchecked above until now: site settings retheme + solid popovers (2b77b45, c4bc2b7, 09da048),
  unread chip/count (607057a, 712c51c), strip holds still (d3cbf02), tooltips never on their own control (2025a09).
- [ ] Off the main thread: see D.

### Audit of the earlier session's asks (2026-11-22, from the 17:27 transcript): unverified live

- [x] Delete key closes the selected tab cards on the board: checked live 2026-11-23 (a card selected, Delete: 63 tabs
      to 62, its card gone).
- [~] Clicking a Windows notification (WhatsApp-style page) opens that tab: wired (frame preload's click report and
      the worker toasts call showFromNotification); a click on a real toast not tested here (needs the screen).
- [x] Hover states on the strip's tabs, tab switchers, preview header buttons; header height 34 px. (In place: the
      header is 34 px; :hover on .cv-hbtn, .cv-recent buttons, the playing chip and the bell. Checked 2026-11-23.)
- [x] Zoom / pinch / pan on the board: re-measure with scripts/perf-canvas.ts after the recent UI changes.
      2026-11-23, built app: pan/zoom/drag p95 16.8 ms even at CPU x4.

## C. Web platform parity (plan, then build)

- [x] window.open(url) returns a live window; the new page is a tab still linked to its opener (6d8e669).
- [x] beforeunload: no will-prevent-unload handler (closing a tab with unsaved work): there is one (tabs.ts, Leave/Stay).
- [x] Device pickers: WebUSB/HID/Serial/Bluetooth have no select-* handlers (requests fail): main/devices.ts has them.
- [x] Certificate errors: no interstitial with proceed: main/certs.ts + the error page's Advanced. Checked 2026-11-23 on
      self-signed.badssl.com: the page, then the site loads once let through.
- [~] navigator.registerProtocolHandler: unsupported (a silent no-op, checked). mailto: links, its main use, already
      go where Settings says (Gmail, Outlook, Yahoo or the system's app). Other web+ schemes: needs a consent prompt
      and a list in Settings; deferred.

- [~] Audit what Chrome supports that Panes breaks or lacks; write the list here with a test page per item.
      2026-11-23, probed in a Panes tab (example.com) over CDP:
      - Present and working: WebGPU (adapter), WebUSB/HID/Serial/Bluetooth objects, File System Access, Payment
        Request, Translator, EyeDropper, Idle Detection, Wake Lock, Window Controls Overlay, install prompt event,
        document PiP, getDisplayMedia, ClearKey EME, H.264/AAC/HEVC/AV1 in MSE, speech voices (3, after a moment).
      - MISSING: Widevine DRM (NotSupportedError): Netflix, Disney+, Prime, Spotify/Apple Music playback fail. Needs
        castlabs' Electron (ECS) with Widevine and their VMP signing: a decision for the user (build change).
      - MISSING: platform passkeys (isUserVerifyingPlatformAuthenticatorAvailable false): Windows Hello passkeys.
      - FIXED: navigator.share (was undefined): now Panes' share menu (Copy link, Email); shared/webShare.ts.
      - UNCLEAR: speech recognition (no answer in 4 s; needs a microphone prompt to judge); web push subscribe
        (Electron has no push service: expected to fail; needs a site with a worker to confirm).
      BroadcastChannel / tab-to-tab (window.opener, postMessage, SharedWorker, storage events), native app
      protocols, download-then-redirect pages, popups (OAuth), beforeunload, file pickers, Web Share, clipboard,
      notifications, WebAuthn/passkeys, Payment Request, protocol handlers, PWA install, print, drag and drop
      files, fullscreen, pointer lock, gamepad, WebUSB/HID/Serial/Bluetooth device pickers, screen share picker.

## D. Speed

- [~] Off the main thread wherever it is a transparent gain (user 2026-11-22): workers for Tidy/clustering, image decode,
      JSON parse of big state, search ranking; measure each with a long-task trace before and after.
      2026-11-23: card pictures' small copies are encoded in a worker (Tidy: 470 ms encoding + 460 ms GC gone from the
      interface thread); clustering measured cheap in main (no worker needed); tab pictures no longer go through IPC
      as base64. Left: JSON of big state, search ranking (not measured as slow yet).

- [x] Releases are slow and Mac updates heavy: each Mac layer's deltas are ~17 MB (Windows ~180 KB, beta.122), so
      something in the Mac asar changes every build. Diff two consecutive dist/mac asars (file list + hashes), make
      the build deterministic, re-measure delta size and release time. Also why each Mac layer takes ~3 min.
      Found 2026-11-23: the build is deterministic enough (beta.143 to .144: 46 files, 3.3 MB changed); the delta was
      not. zstd at level 19 kept match tables too small to find a 130 MB dictionary again. hashLog 26 + chainLog 27:
      17.6 MB to 32 KB, same decoder. Live in beta.147's Mac layers (17-32 KB) and beta.148's Windows ones (19-34 KB).
- [~] First open / load time (user 21:15: "needs to be nearly instant"): measure packaged cold and warm start (startup-trace), find the next big cost.
      Measured 2026-11-23 (beta.142 build, fresh profile, PANES_TRACE_STARTUP): page loaded at 639 ms cold, 420-486 ms
      warm. Lock at ~132 ms (Electron's own start), main setup ~110 ms, the interface page 200-270 ms (900 KB of JS
      at boot: app 543 KB, motion 223 KB, React 136 KB). Next: load the board's code only when the window does not
      open on the board; first paint is not traced yet (add it).

## Log

- beta.109: spaces row, corner fix, window.open. beta.110: tab strip, card perf.
- beta.106: swipe, preview Enter. beta.107: deck, toast click. beta.108: calls, cards.
