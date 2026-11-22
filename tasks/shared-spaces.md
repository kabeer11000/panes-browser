# Shared spaces

A space several people are in at once: the board (notes, sections, arrows, drawings, pictures, links) edited
together live, plus shared browsing (a host's tab streamed to everyone, Hyperbeam-style, with control handed around).
People without Panes join from any browser in a light web version that is also Panes' best advert.

## Decided

- 2026-11-20: Yjs; our own relay on the user's Render account; join by invite link with a secret key, no accounts;
  pictures shrunk and uploaded to the relay (~5 MB cap).
- 2026-11-22: people without Panes get a lightweight web board, Apple-style (iCloud Freeform on the web): works on
  its own, clearly the lesser version, "Get Panes" throughout.
- 2026-11-22: shared browsing like Hyperbeam, but the host's own Panes tab is the browser (WebRTC, no cloud browser).
- 2026-11-22: end-to-end encrypted (the invite's secret after `#` encrypts everything; the relay stores ciphertext).
- 2026-11-22: TURN from Cloudflare (used only when a direct peer connection fails; user creates the key at phase 7).

- 2026-11-22: Hyperbeam-level smoothness for shared browsing and remote control (the bar: low latency video,
  instant pointer, no visible lag in handing control). And chat in shared spaces.

## Open (ask before building the part that needs it)

1. (Decided: yes.) End-to-end encryption: the invite's secret (URL fragment, never sent to the server) encrypts every update, so the
   relay stores only ciphertext. Recommended (a browser should not upload boards in the clear); costs: the relay
   cannot compact the log itself, so clients upload encrypted snapshots now and then.
2. (Decided: Cloudflare.) TURN for shared browsing: Render cannot carry UDP. Recommended: Cloudflare Calls TURN (free 1 TB/month); needs a
   Cloudflare account and key from the user.
3. First deploy to Render (outward-facing): confirm the service name and plan with the user.

## Architecture

### Relay (`share/server`, Node, one Render web service)

- `GET /s/:id` serves the web board (static, built from `share/web`).
- `WS /sync/:id` relays Yjs sync + awareness messages between everyone in a room; appends updates to the room's log
  (SQLite on a Render disk, or Postgres), sends the log to joiners. Opaque bytes if E2E is on.
- `POST /blob/:id` takes a shrunk picture (<= 5 MB, rate limited), returns its address; `GET /blob/:id/:hash`.
- `WS /rtc/:id` (or messages over /sync): WebRTC signalling (offer/answer/ICE) for shared browsing; hands out
  short-lived TURN credentials.
- Room id: random 128 bits. Write access: knowing the room secret (an HMAC of it proves it; with E2E it also decrypts).
  Limits: room size, update rate, blob quota per room; idle rooms expire after N days unless a Panes owner renews.

### Board sync (Panes)

- The board stays one immutable `CanvasState`, changed through `edit()`. Sync sits at that seam, not inside the board:
  - `src/shared/share/doc.ts` (pure, tested): `stateToDoc` / `diffIntoDoc(prev, next, ydoc)` / `docToState(ydoc, local)`.
    Y.Maps by id for frames, notes, items, connectors, marks; each entity a plain JSON value (last writer wins per
    entity; notes' text a Y.Text later if concurrent typing in one note matters).
  - After every local change (the three `setStState` sites) `diffIntoDoc(lastSynced, next)` in one transaction.
  - A remote update rebuilds the state with `docToState` and applies it without an undo entry and without flips.
  - Undo: local undo restores the person's own earlier state, then diffs: it can undo another person's later change to
    the same thing. v1 accepts that; v2 uses Y.UndoManager scoped to the local origin.
- Tab cards are personal (a tab exists only on its owner's machine). Shared as page links: others see a link card
  (`items` kind 'page', with the owner's latest picture as its image, uploaded as a blob); opening it opens the page in
  their own tab. The owner sees their live tab card as now.
- Not shared: the viewport, which preview is open, live video streams, AI state.
- Presence (Yjs awareness): name + colour per person, pointer position in board coordinates, what they selected.
  Drawn as Figma-style cursors with name tags; a row of faces in the top bar; "follow" a person's view.
- Local persistence: the Y doc is saved with the space (works offline, merges on reconnect).
- UI: space settings > Share: "Invite people" makes the room and copies the link; people in the space, stop sharing.
  Opening an invite link in Panes joins as a new shared space.

### Shared browsing (Hyperbeam-like)

- Any tab card: "Browse together". The host's tab is captured (the board's existing tab-capture stream, at full size)
  and sent over WebRTC to everyone in the space, as a live card everyone sees on their board (and the web board).
- Control: one driver at a time. A guest asks, the host (or the driver) hands over; the guest's pointer, wheel and keys
  go over a data channel and the host's Panes injects them (`webContents.sendInputEvent`, as the test harness does).
  Typed text into password fields is blocked for guests; file pickers and downloads stay with the host.
- Audio: the tab's sound as a WebRTC audio track (watch-together).
- Topology: mesh up to ~4 viewers, past that an SFU (Cloudflare Calls) or lower resolution. TURN as in Open 2.

### Chat

- A Y.Array of messages in the room's doc (end-to-end encrypted like the rest): text, links, reactions, a reply to
  a board object ("about this card"). Typing indicators and read marks over awareness.
- Panes: a chat panel beside the board (the AI dock's place, or a tab of it); unread count on the space.
- Web board: the same panel. Notifications in Panes through the attention system.

### Smoothness targets (shared browsing)

- Glass-to-glass under ~150 ms on a good network; pointer echo of the driver drawn locally at once (no round trip).
- Video: hardware H.264/VP9 encode of the tab capture, 30-60 fps, adaptive bitrate (WebRTC congestion control),
  frame size following the viewer's card size; audio Opus. Input over an unordered, unreliable data channel for
  moves, reliable for clicks and keys; coalesce moves per frame.
- Measure: a test page that flashes a timestamp, read back on the viewer's side, two scratch instances.

### Web board (`share/web`, people without Panes)

- Small: Vite + React, shares only `src/shared` (state types, layout, colours), not `Canvas.tsx`.
- Can: see the live board and everyone's cursors, pan/zoom, add and edit notes, react/comment, watch shared browsing
  (and drive when handed control).
- Shows but defers to Panes: sections, arrows, drawing, Tidy, live pages, AI: "Open in Panes" moments.
- "Get Panes" bar (download for Windows / Mac), a page card explains it is a live page in Panes.
- Mobile-friendly reading.

## Phases (each shipped and released on its own)

- [ ] 1. `src/shared/share/doc.ts` + tests: state <-> Y doc round-trip, diffs, concurrent edits merge.
- [ ] 2. Relay MVP (`share/server`): sync + awareness + log, end-to-end encrypted from the start; local run; test
      with two headless clients.
- [ ] 3. Panes client: share a space, join by link, live board sync, cursors. Two scratch instances side by side.
- [ ] 4. Deploy relay to Render (confirm first). Invite links work across machines.
- [ ] 5. Pictures: shrink + upload blobs; tab cards as shared page links.
- [ ] 6. Web board MVP: view, cursors, notes, Get Panes.
- [ ] 7. Shared browsing: stream a tab over WebRTC to Panes peers, then the web board; then handing control.
- [ ] 8. Chat (Panes + web).
- [ ] 9. Room expiry, limits, abuse.
