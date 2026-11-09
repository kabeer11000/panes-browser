# Polish batch (resumable)

Status from reading the code on 2026-11-09. Canvas files (src/renderer/src/canvas/**, src/shared/ai/canvas*.ts) belong to the canvas agent.

## 1. Consistency audit: tokens everywhere
- [x] Tokens in styles.css, documented in tasks/design-tokens.md.
- [x] ask.css: already on tokens (only multi-layer glass shadows and a looped pulse left, both allowed).
- [x] print.css migrated: radius 6/7/8/10 to --r-2/--r-3/--r-4 (toggle --r-pill), type 11-14 and 11.5/12.5 to --fs-*, 0.12/0.18/0.2s to --dur-fast/--dur, knob shadow to --shadow-1; its own 2px focus outline dropped for the global ring; reduced-motion rule for the sheets dropped (tokens collapse).
- [x] pip.css: left as is on purpose (video overlay, does not import styles.css, own focus ring; circles and a 4px bar).
- [x] Other surfaces (styles.css, internal.css, chat.css, panel, dock, welcome, error, share): remaining literals are 50% circles, 2-3px bars, hero type (18-76px), glows. Allowed by design-tokens.md rules.
- [x] Half-pixel type in print.css gone. Left: dock.css 8px/9.5px badge glyphs (geometry of the bin icon).

## 2. Command bar first
- [x] ACTIONS in src/shared/search.ts include reader (Ctrl+Shift+E), mute (Ctrl+M), duplicate, pin, close others, new private (Ctrl+Shift+N), new Tor tab; TabManager.runAction handles each.
- [x] Shortcut uniqueness tested in search.test.ts.
- [x] Reader action wired (item 4).

## 3. Ask about selected text
- [x] main/askSelection.ts, preload/selection.ts (skips text fields), renderer/src/ask (chip + card, "Continue in chat"), shared/ask.ts with tests.
- [x] Not offered for private/Tor (`TabManager.selectionHost`), nor when AI is off or the setting `ai.selectionAsk` is off.
- [x] Command bar action + Ctrl+Shift+Y.
- [ ] Not seen running in this pass (needs a model or the mock server from tasks/ai/phase-4.md).

## 4. Reader mode
- [x] shared/reader.ts (+ tests): reader address with source and random key, prefs sanitizer, reading time, screen CSS and document (CSP without script).
- [x] main/reader.ts: Ctrl+Shift+E, command bar, address bar button. Extracts with READER_SCRIPT, keeps the article in memory (30, never on disk), navigates the tab to panes://reader; toggling again goes back (history back when the previous entry is the page, else loads it).
- [x] internal/pages/Reader.tsx: sandboxed iframe (no allow-scripts), text size, serif/sans, width, theme (auto/light/sepia/dark) kept in the page's localStorage (private tabs keep nothing), reading time, Add to canvas (hidden in private and Tor).
- [x] Address bar shows the source address and a pressed reader button while reading; site panel and star hidden there.
- [x] Add to canvas: canvasAssistant.addCardToBoard opens the board and calls the board tool add_card, retrying until the board answers.
- [x] Verified on port 9342: Wikipedia article in dark auto and sepia/sans/narrow/20; Add to canvas made a document card; toggling back returned to the page; a private tab shows no canvas button and default prefs.

## 5. Smart new tab
- [x] shared/newtab.ts (+ tests): continue reading (article-like pages from the last 7 days, not open, not error pages), a usual site at this hour (3+ earlier days within an hour, not opened today), boards with things on them (active space first).
- [x] IPC newtab:smart (null while AI is off) and newtab:open-board (switch space, open canvas). Shown only for normal tabs with AI on.
- [x] Verified on port 9342 with AI on: continue reading rows and the Home board chip over the dithered photo.
- [ ] Boards are not ordered by last use: the canvas store keeps no time. Needs a savedAt in CanvasService (canvas agent's file).

## 6. Download shelf
- [x] Previews: main/downloads.ts makes image thumbnails and asks the shell for others (PDF on Windows); shown in the dock and on panes://downloads.
- [x] AI rename in the dock rows: meta line says "Rename to X?" in the accent colour, a pencil button accepts (dock.ts allows 'accept-name'). Dismiss stays on panes://downloads. Not seen running (needs a generic-named download and a model).
- [ ] "Show in canvas": blocked on the canvas side. The board tool add_card accepts only http(s); a downloaded file needs add_card (or a new board call) to take a file / download id (shared/ai/canvasTools.ts, canvas agent).

## 7. First-run AI screen
- [x] welcome/AiStep.tsx, a step between "Fast and private" and the finish: AI toggle (off by default), This computer (download size from aiStatus.installBytes, 1.4 GB here; download, progress, stop, error) or Online (Sign in with ChatGPT / OpenRouter, keys in Settings), and the private/Tor guarantee (policy.ts denies every AI task for them).
- [x] Fixed on the way: welcome/main.tsx did not import controls.css after the previous agent split it out of internal.css, so the speed step's toggles and segmented controls had no styles.
- [x] Verified on port 9342: step renders, toggle turns AI on, both options show. The download and the sign-ins were not started (1.4 GB; opens the system browser).

## 8. Performance pass
- [ ] No optimisation done in this run; baseline only (scratch profile, dev build, port 9342, 2026-11-09):
  - idle, 1 tab: 7 processes, 624 MB private, 0.4% CPU over 10 s (perf-report).
  - 6 real sites (perf-load --tabs 6): 16 processes, 1362 MB private, 19.7% CPU over 5 s while loading; interface frames p50 16.7 / p95 16.8 / max 17.4 ms.
  - closing 6 tabs 40 ms apart (perf-close): p50 2 ms, max 2 ms, 286 ms total.
  - a video_capture service (68 MB) was alive after loading the sites with no call open: worth a perf-leak run.
- [ ] AI servers idle CPU not measured: no local model in the scratch profile. By code, chat stops after 5 min idle and embed after 15 (main/ai/runtime.ts IDLE_MS), so idle CPU is 0 after that.
- [ ] Startup (PANES_TRACE_STARTUP=1) and tab switch not measured; there is no tab-switch script yet.

## Log
- 2026-11-09: audit; items 1, 4, 5, 6 (rename), 7 built; 8 baseline only. While cleaning up a stuck CDP script I ran `taskkill /IM bun.exe`, which also ended other bun processes (the `bun run dev` wrappers of the 9333 and 9341 instances; their electron-vite and Electron kept running). Lesson recorded.
