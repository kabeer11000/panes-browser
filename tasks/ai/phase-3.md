# AI, Phase 3: Canvas mode

Concept: a mode of the main window (not a separate window). Toggle via a chrome button and Ctrl+Shift+K. The active web view is parked, and the page area shows an infinite board of the current space's tabs as cards, arranged by AI into labelled frames (like FigJam sections). Click a card: exit canvas and switch to that tab with a zoom-into-card transition.

## Board
- Cards: thumbnail (existing snapshot pipeline in main/tabs.ts, refreshed for stale tabs when canvas opens, small on-disk cache in userData/ai/thumbs for unloaded tabs), favicon, cleaned title (aiTitle ?? title), host, audio/attention badges as in the sidebar. Close button on hover. Private and Tor tabs are never captured or cached: neutral placeholder card.
- Frames: clusters from the Phase 1 embedding index (cluster.ts, GROUP_THRESHOLD), named by the local model (2-3 words, fallback most common host). Ungrouped tabs in "Other". Private/Tor tabs never reach AI: own "Private" frame, sorted by host. Without AI, tabs on the same site are framed together.
- Pan (drag background, wheel/trackpad, space+drag, middle button), zoom (Ctrl/Cmd+wheel, pinch, + / -, Shift+1 fit, Shift+2 selection), inertia. Drag cards between frames and anywhere, drag frames, rename frames (double-click, F2), create frames (toolbar, F, Alt+drag), sticky notes, multi-select (shift-click, marquee), Delete closes selected tabs with an undo toast.
- Tidy up: re-cluster and animate cards to the new layout; frames the person named or moved and cards placed by hand stay, unless "Rearrange everything".
- Persisted per space (positions, frames, names, notes, viewport) in ai-canvas.json. New tabs go to the frame whose centroid they are nearest (above the threshold), else Other.
- Performance: only cards in the viewport (plus margin) are mounted; one transformed board layer.
- Layout logic is pure, in src/shared/ai/canvas.ts, with bun tests.

## UI
Matches Panes tokens (light/dark, space accent, private/Tor). Enter: the current page shrinks into its card and the rest fade in staggered; exit zooms the chosen card to the page. 250-350 ms, off for prefers-reduced-motion. Keyboard: arrows move selection, Enter opens, Esc exits, F2 renames a frame. Floating toolbar at the bottom centre: Select, Hand, Frame, Note, Tidy up, Zoom %.

## Rules
Private and Tor never touch AI. No new dependencies. No mutating git, no `bun run build`. No emojis, no attribution.
