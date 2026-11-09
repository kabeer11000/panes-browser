# AI, Phase 3b: Canvas v2, browse without tabs

Reimagine canvas as a new way to browse, not a board of tab cards. Builds on Phase 3 (tasks/ai/phase-3.md).

## Immersive mode
Entering canvas closes the chat panel, collapses the sidebar and hides the top bar. Sidebar and top bar reveal on hover at the window edge (the app's existing auto-hide mechanics) and are restored exactly on exit. Window controls stay reachable.

## Cards are content, not tabs
No tab-chrome look. Each card renders what it is:
- PDF: first page rendered with pdf.js, page count; expands to read inline (all pages, smooth scroll) on the board. Web and local files.
- Image: the image at its natural aspect ratio, caption on hover; expands to view large with zoom.
- Web page: document-style card from reader extraction (title, site, hero image, first lines); app-like pages fall back to the snapshot in a soft frame.
- Video: poster with a play affordance.
- Notes and AI answers: text cards.
Double-click or Enter expands a card in place. PDFs, images, text and reader view stay DOM. "Open live" places the one real WebContentsView exactly at the expanded card's rect (scale 1, never transformed), with a handoff from the snapshot; hidden again on collapse. Never more than one live view.

## The prompt
Input in the floating toolbar ("Find or ask anything"). Intent is classified first (local model, with a heuristic fallback): find or question.
- Find: open tabs, then the embedding index of history, then downloaded files, then the web (hidden sandboxed webContents, fixed extraction script, filetype hints). Results fly out of the prompt into a new labelled frame, staggered, with a shimmer placeholder per pending result.
- Question: the existing chat backend (same model resolution, private/Tor policy, confirmations); the answer is an AI card next to the cards it used.
- Private/Tor spaces: local open-tab matching only; no AI, no history, no web.
- Ranking blends visit frequency and recency from history and the index; no new tracking store.

## Transitions
motion package, transform and opacity only. Enter: the page shrinks into its card while chrome fades; results spring in staggered; expand and collapse morph through shared layout; reduced motion respected.

## Performance
Virtualised cards, pdf.js renders only visible pages (low-res while zooming), async image decode, one live view at most, hidden webContents destroyed after use. Measure memory closed and open, fps, time to first result.

## Tests
Pure logic in src/shared/ai/canvas*.ts: intent fallbacks, ranking, source merging and dedupe, card kind detection, result frame layout without overlap.

## Add to board: placement (done)
Results and answers are placed as a Note (text, Markdown, editable, with a source link), a Document (PDF, picture, reader card, no tab) or a Live page (a real tab only when opened live). `suggestPlacement` (shared/ai/canvasPlace.ts) decides by rules first; a model (policy-checked, never in private or Tor windows) only settles unsure pages. A quiet chip "Added as ... Change" and a right-click menu switch the kind in place; "Turn into note" on a page asks for key points (model, else its first sentences) and keeps a link back. Nothing creates a tab until a card is opened live.

## Round 2 (person's feedback): status
Another agent is working in the same canvas files (AskPopover, useAsk, Connectors, connectors.ts exist). Recorded here so the work is not lost; items marked open were not built by this pass.
1. Threaded conversation per space on the chat backend (chatConv, chat.ts): open.
2. Mentions and selected cards as context, citations that pan to a card: open (useAsk takes selected tabs as chips already).
3. Right-hand conversation dock, "Add to canvas" from any part of a response with a connector to its sources, find frames collapsing to stacks: open. Add-to-canvas placement and kind suggestion are done (above).
4. Anti-clutter: free-space placement is done (freeSpot, result frames never overlap); stacks and fit-only-if-off-screen: open.
5. Connectors, pen, shapes, FigJam shortcuts: connectors exist (other agent); pen and shapes open.
6. Blur and dim of the board behind a revealed sidebar or top bar: open.
7. Deselect the active tab on entering canvas and exit on any tab switch: open (exit on card click and Go to tab is done).
8. First-run hint row and one-line status of what the AI is doing: open.

### Round 2 addendum: the canvas assistant acts (open)
Tools for the canvas conversation (args validated in src/shared/ai/canvasTools.ts, run in the renderer by IPC round-trip so the board state stays the truth): get_board, tidy_up, arrange, create_frame, rename_frame, move_cards, stack and unstack, delete_items (confirm), add_note, add_card, connect, set_kind, focus, select; browser tools reused from chatActions.ts. Each board change is one undoable step with a one-line "what I did" and Undo row; weak local models get a reduced set; no tools at all in private and Tor spaces; system prompt follows VOICE in chatTools.ts. Not built in this pass.
