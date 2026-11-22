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
- [ ] Recent tabs: switching sometimes drops that tab from the bar; a newly opened tab does not show at the left.
      Rule: left = most recent, stable, never disorienting; tabs appear and move with clear motion. UI is never a surprise.
- [ ] Preview open: a rim of something peeks from behind at the left / top corners. Hide it (and unload if not needed).
- [ ] Shared spaces (FigJam-like), decided 2026-11-20 (polish-2.md:132): Yjs, own websocket relay on the user's Render
      account, invite link with a secret key (no accounts), images shrunk + uploaded to the relay (~5 MB cap). Both edit
      notes, images, arrows, sections, cards. Later: shared tabs. Plan it in tasks/shared-spaces.md first; deploying to
      Render is outward-facing: confirm with the user before the first deploy.
- [ ] Usage analytics (user decided 2026-11-22): self-hosted endpoint, asked on first run (welcome), domains included.
      Actions, screens, durations, version/OS/RAM tier, perf timings, site domains. Never contents, typed text, passwords.
- [ ] Tidy freezes the whole PC for a second, even without AI: make it efficient (measure; worker/WASM if needed).
- [ ] Notes and text on the board: Ctrl+B / Ctrl+I and the like (Figma-like), font size.
- [x] Certificate interstitial "Proceed (unsafe)": verified on self-signed.badssl.com (c249b32).
- [ ] Preview: tooltips (esp. near the bottom) go under the web contents (native view over the page).
- [ ] Frosted glass option: whole chrome (board strip, now playing, bottom toolbar, popovers) blurred/translucent
      when on; off automatically in Efficient/Performance mode. No such setting exists today. Measure GPU on pan/zoom.
- [ ] Scroll fade gradients on every scrolling list, search popover included.
- [ ] Notifications sometimes do not open from the strip. User likes the bell after all: reposition it, make it reliable.
      The bell shows always, even with nothing new (beta.113 feedback). Unread styling is "gross": redo it.
- [ ] open.spotify.com opens in its mobile layout (user agent? viewport?).
- [ ] Card host pill (top of a card) shows sometimes, not others: make it reliable.
- [ ] Cards redesign: sizes, rounding, overall look (user, again). Measure GPU on pan/zoom.
- [ ] Site settings popup: full retheme, clean; it is oddly see-through (fix). Then every other popup the same way
      (permission card, save-password, downloads bin, tab hover card...): one clean look, wider/horizontal if it reads better.
- [ ] Then: first-party screen time / digital health (time per site, daily/weekly, limits, focus), better than
      Apple's Screen Time. Local only.

## C. Web platform parity (plan, then build)

- [x] window.open(url) returns a live window; the new page is a tab still linked to its opener (6d8e669).
- [ ] beforeunload: no will-prevent-unload handler (closing a tab with unsaved work).
- [ ] Device pickers: WebUSB/HID/Serial/Bluetooth have no select-* handlers (requests fail).
- [ ] Certificate errors: no interstitial with proceed.
- [ ] navigator.registerProtocolHandler: unsupported.

- [ ] Audit what Chrome supports that Panes breaks or lacks; write the list here with a test page per item.
      BroadcastChannel / tab-to-tab (window.opener, postMessage, SharedWorker, storage events), native app
      protocols, download-then-redirect pages, popups (OAuth), beforeunload, file pickers, Web Share, clipboard,
      notifications, WebAuthn/passkeys, Payment Request, protocol handlers, PWA install, print, drag and drop
      files, fullscreen, pointer lock, gamepad, WebUSB/HID/Serial/Bluetooth device pickers, screen share picker.

## D. Speed

- [ ] Off the main thread wherever it is a transparent gain (user 2026-11-22): workers for Tidy/clustering, image decode,
      JSON parse of big state, search ranking; measure each with a long-task trace before and after.

- [ ] First open / load time: measure packaged cold and warm start (startup-trace), find the next big cost.

## Log

- beta.109: spaces row, corner fix, window.open. beta.110: tab strip, card perf.
- beta.106: swipe, preview Enter. beta.107: deck, toast click. beta.108: calls, cards.
