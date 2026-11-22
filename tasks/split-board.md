# Split view on the board: rework (user 2026-11-22, asked four times)

What is wrong now (seen in a composite of the real views, scratch, google + wikipedia):
- One header for two pages: it shows only one pane's address; nothing says which pane has the keyboard or what
  Back / Reload act on.
- The panes butt against each other: no gap, no divider, no rounded inner corners.
- The recent tabs strip shows the other pane as just another tab; the split is invisible there.
- The only split action is an "Unsplit" icon in the header. No per-pane actions.
- Opening a link side by side: wording, motion and feel are poor ("not fun").
- The page view shows too big, then resizes, when the preview switches tab (live-open shows the page at the rect
  asked for when the request began; live-prepare paints it at a default size first).

## Direction (user 2026-11-22)

The tab view's split is "perfect": the board's split takes its flow and look (Panes.tsx: pane heads, the active
pane, its buttons, the divider) instead of a design of its own. Reuse its components where they can run in the
preview; where not, match them exactly. The notes below are refined against it.

## Design

- Panes: a 6 px gap with a draggable divider (the tab view's split ratio), each pane its own rounded rect.
  The focused pane has a quiet accent ring (1.5 px, inside); clicking or typing in a pane focuses it.
- Header: in a split, the address area becomes one chip per pane (icon + site), the focused one raised. Back,
  Reload and the address act on the focused pane; clicking a chip focuses that pane.
- Pane actions: no extra toolbar. Hovering near a pane's right edge slides out a slim vertical rail (as the
  downloads bin does): Swap sides, Open on its own (leaves the split, stays open), Mute, Close. It slides back
  when the pointer leaves.
- Strip: a split shows as one joined pill (both icons, one outline), not two loose tabs.
- Open link side by side: menu wording "Open beside this page"; the current page eases to half width while the
  new one slides in from the right edge on the same spring (no blank frame, no jump). Closing a pane: the other
  eases back to full width.
- View placement: the page is placed at the slot's rect as measured when it is shown, never at the request's.

## Steps

- [ ] Measure: frame-by-frame bounds of the live view while switching tabs in the preview (confirm the jump).
- [ ] Fix placement (main shows at the latest slot rect: the renderer sends it with the show, or main asks).
- [ ] Panes: gap, divider drag, rounded, focus ring, focus follows click.
- [ ] Header chips per pane; actions act on the focused pane.
- [ ] Slide-out pane rail.
- [ ] Strip: joined split pill.
- [ ] Open beside: wording + motion; close pane motion.
- [ ] Verify each with composite screenshots (E:/tmp/composite.js), both themes; release.
