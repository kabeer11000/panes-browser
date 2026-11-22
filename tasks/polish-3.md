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

- [ ] First open / load time: measure packaged cold and warm start (startup-trace), find the next big cost.

## Log

- beta.109: spaces row, corner fix, window.open. beta.110: tab strip, card perf.
- beta.106: swipe, preview Enter. beta.107: deck, toast click. beta.108: calls, cards.
