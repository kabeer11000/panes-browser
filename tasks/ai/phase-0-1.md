# AI, Phase 0 + 1: local AI core and quiet background features

Status: spec, approved 2026-11-09. Implementer: read this whole file, then the files it names, before writing code.

## Goals
- AI that stays out of the way: it suggests, the person accepts with one click, nothing blocks browsing.
- Local first. Every Phase 1 feature must work fully offline on a mid-range Windows laptop with no API key.
- BYOK cloud providers exist from day one but are only used where the person allows it.
- Phase 2 (chat panel), 3 (canvas mode in the main window) and 4 (automation agent) build on this core. Do not build them now, but the provider layer must support streaming and tool calling.

## Non-goals (this phase)
Chat UI, canvas, page automation, habit learning beyond the embedding index, mac/linux GPU tuning (they must work on CPU, that is all), fine-tuning, telemetry.

## Hard rules
1. Private and Tor tabs/spaces never touch AI. No embedding, title rewrite, filename suggestion, or cloud call. Enforce it once, in the router (main/ai/router.ts via shared/ai/policy.ts), not per feature. A test proves it.
2. The renderer never sees an API key. Keys encrypted with safeStorage in main. Renderer gets only { provider, hasKey }.
3. The local server is not reachable by web pages: llama-server binds 127.0.0.1 on a random free port with --api-key <random 32 bytes hex> per launch.
4. Model output is untrusted. Titles trimmed, single line, capped at 60 chars. Filenames go through the sanitizer (F2). Never executeJavaScript/eval model output.
5. Nothing new beside app.asar. Runtime and models download into userData on demand (same pattern as main/tor.ts), never bundled. Do not touch electron-builder asar settings.
6. Never block. Every AI call async, with timeout (local 20 s, cloud 30 s); failure = no suggestion, logged once, never a dialog.
7. Do NOT run any git command that mutates state (no commit, push, stash, checkout, reset). Do not run `bun run build`. Leave changes in the working tree.
8. No emojis, no AI attribution anywhere.

## Architecture
src/shared/ai/ (pure, Electron-free, tested): types.ts, models.ts (pinned runtime+model table: url, sha256, size, purpose), policy.ts (route(task, ctx, settings) -> 'local'|'cloud'|'deny'), titles.ts, filenames.ts, cluster.ts (cosine, topK, agglomerative), vectors.ts (in-memory index: add, remove, topK, cap/evict, serialize), *.test.ts each.
src/main/ai/: runtime.ts (LocalRuntime: download, verify, unpack, spawn/stop two llama-servers), providers.ts (AI SDK model factory per ProviderId, key storage), router.ts (only entry point: generate / embed), index.ts (EmbeddingIndex: tabs+history, persisted), features.ts (F1-F4 wiring to TabManager, downloads, Suggester, spaces), ipc.ts (ai:* IPC).
Wire in main/index.ts like other modules. Use @shared/* and @renderer/* aliases.

### New dependencies
ai, @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google, @ai-sdk/openai-compatible (main process only, `bun add`). Nothing else: no transformers.js, no node-llama-cpp, no vector DB.

### Local runtime
- Official llama.cpp release builds (ggml-org/llama.cpp GitHub releases), llama-server binary. Windows x64: Vulkan build; fall back to CPU build if Vulkan fails health check within 15 s or exits on start. macOS arm64: macos-arm64 build. Linux x64: ubuntu vulkan, CPU fallback.
- Models (GGUF, Hugging Face, pinned by URL + SHA-256 in shared/ai/models.ts): embed = small multilingual embedding model llama.cpp supports, <=350 MB (e.g. embeddinggemma-300m Q8 or multilingual-e5-small); chat = 1-4B instruct, Q4_K_M, <=2.5 GB, good at short JSON (e.g. Qwen3 1.7B/4B, Gemma 3). Comment why.
- Look up REAL URLs and real SHA-256 (HF shows sha256 for LFS files; GitHub release API gives digests, or download and hash). Never invent a hash.
- Lift download() from main/tor.ts into a shared helper (e.g. main/fetchVerified.ts: stream, progress, SHA-256, discard on mismatch) and make Tor use it. Unzip with the same tarCommand() approach.
- Layout: <userData>/ai/runtime/<build-id>/, <userData>/ai/models/. Delete old runtime builds after a new one passes health.
- Embed server: --embeddings, starts when first needed, stays up while AI is on. Chat server: starts on first generate, stops after 5 min idle. ctx 4096, -ngl 99 on GPU builds.
- Poll GET /health until ready. Kill both on before-quit. Crash -> restart on next request; 3 crashes in 10 min -> status error until settings toggled.
- AiStatus pushed to settings page: off | needs-download | downloading(progress) | starting | ready | error(message) per server, plus model names/sizes.

### Providers and router
- ProviderId: local | openai-compatible (user URL e.g. Ollama/LM Studio, optional key) | anthropic | openai | google.
- Settings: localProvider 'local'|'openai-compatible'; cloudProvider + model id per provider (default to provider's current small/fast model; look it up).
- AiTask: 'title'|'filename'|'group-name'|'embed' now; room for 'chat'|'agent'.
- policy: private or tor -> deny first; AI off -> deny; feature toggle off -> deny; background tasks -> local; cloud only if cloudForBackground and local unavailable.
- router: generate(task, ctx, prompt, schema?) and embed(texts, ctx) via AI SDK generateText/structured output and embedMany. Timeouts; local concurrency 1, queue max 20, drop oldest.

### Settings (shared/types.ts Settings + defaults in shared/settings.ts), all off by default
ai: { enabled, localProvider, compatibleUrl, cloudProvider, cloudModels, cloudForBackground, titles, filenames, grouping, semanticHistory }
Keys in their own JsonStore ai-keys.json, base64 safeStorage output, never in settings.
Settings page: "AI" section in panes://settings, using existing components (renderer/src/internal/ui.tsx). Master switch; local model card (status, size, download/remove, progress); feature toggles; cloud provider select + write-only key field ("Key saved" + Remove) + model field; cloud-for-background toggle; privacy note "Private and Tor tabs are never sent to AI." "Remove AI data" wipes <userData>/ai.

## Embedding index
- One entry per normalized URL; text = title + meta description + first ~1000 chars visible text, via a fixed extraction script string run with executeJavaScript 1.5 s after did-finish-load; skip private/tor, panes://, non-http(s).
- Index history by title+url on first enable, batches of 32, low priority. Content hash to skip unchanged.
- <userData>/ai/index.bin (Float32) + index.json. Lazy load. Cap 20000, evict least recently visited. Add `// ponytail: brute-force cosine over <=20k vectors; move to int8 or an ANN index if search exceeds ~20 ms`.
- Remove entries when history entries are deleted/cleared (hook existing path). Wipe on AI off/remove.

## Phase 1 features
F1 Clean tab titles: shared/ai/titles.ts cleanTitle(title,url) heuristic (strip trailing site-name segment matching host for -, |, em dash; collapse whitespace; leading "(3) " counters stripped for display only — attention system must still read the raw title). needsModel only if still >48 chars, then local model, <=40 chars, same language, JSON {title}. Cache by url+original title (JsonStore, LRU 5000). Add aiTitle: string|null to TabInfo; render aiTitle ?? title everywhere titles render (renderer/src/tabTitle.ts, dock, tabcard, etc.); tooltip shows original. Auto-applied, display-only; toggle off reverts instantly.
F2 Download names: shared/ai/filenames.ts isGeneric (download, file, document, image, untitled, UUIDs, hex/base64 blobs, IMG_1234, "(n)" suffix, <=3 chars) and sanitize(suggested, originalExt) (strip separators/control chars/.., trailing dots/spaces, Windows reserved names, <>:"/\|?*; cap 80; keep original extension exactly; null if empty). Never change/delay the download. On completion with generic name, ask model with page title, url, name -> JSON {name}; attach suggestedName. Downloads UI shows subtle "Rename to <name>"; accept renames on disk (collision -> " (2)"), dismiss hides.
F3 Grouping suggestions: read shared/tabgroups.ts and main/spaces.ts. If tab groups are disabled in the UI currently, implement logic + tests but don't show the suggestion; report. cluster.ts agglomerative, cosine threshold 0.75 const, min size 3, only ungrouped unpinned non-private tabs of one space. At most once per 2 min per space, only with >=6 ungrouped tabs; remember dismissed sets per session. Name with local model (2-3 words, JSON {name}), fallback most common host. UI: one quiet row at bottom of sidebar tab list "Group 4 tabs as 'Tokyo trip'" Accept/Dismiss; hover highlights those tabs; accept uses existing group creation path.
F4 Semantic history in omnibox (main/suggest.ts Suggester): queries >=3 chars, up to 3 history matches cosine >=0.5 not already listed, after exact/prefix matches. If embed+search >120 ms, drop for that keystroke (or deliver as second update if the flow supports it). Warm embed server on omnibox focus.

## Tests (bun:test in src/shared/ai/)
policy (private/tor always deny regardless), titles (separators, counters, non-English, short untouched), filenames (generic true/false; traversal ../../x, reserved names, extension preserved not doubled, unicode kept, empty -> null, length cap), cluster (identical cluster, orthogonal not, min size, deterministic order), vectors (topK order, remove, eviction, serialize round trip), models (https url, 64-hex sha256, positive size), server-args builder pure fn (127.0.0.1, --api-key, GPU flags only for GPU builds). Run bun test, bun run typecheck, bun run lint until clean.

## Manual verification
Use PANES_USERDATA=<scratch dir> bun run dev (never the person's profile). Follow CLAUDE.md "Driving the app" (agent-desktop, check focus before input). Verify: enable AI + download progress + both servers ready + /health without key rejected; 8 tabs across 2 topics -> titles cleaned, grouping suggestion, accept works; generic download -> rename works on disk; omnibox semantic hit; private + Tor tabs untouched and absent from index.json; AI off reverts titles and kills chat server; Remove AI data deletes folder; record RAM of both servers idle/generating. Stop the dev server when done.

## Additional UI/UX bar (from the person)
- Study existing chrome and internal-page styling first (styles.css, internal.css, ui.tsx, sidebar components) and match it exactly: spacing, radii, typography, colours/theme variables, dark/light, space accent colours, incognito/tor theming. New UI must look native to Panes, not bolted on.
- Motion: use the already-installed `motion` package the way the codebase already does. Suggestions enter/leave with short, soft transitions (opacity + small translate/height, ~150-220 ms, ease-out); AI title swaps crossfade rather than jump; no layout shift in the tab list when a suggestion appears (animate height). Respect prefers-reduced-motion.
- Quiet by design: no spinners in the chrome for background work; suggestions are subtle, dismissible, keyboard accessible (focusable buttons, Esc dismisses where sensible, aria labels). Never steal focus.
- Settings AI section: clear model card with download size, a smooth progress bar, human status text ("Downloading local model, 640 MB of 1.4 GB"), and graceful error states with a retry action.
- Verify visually with screenshots in light and dark, and in a private window, and fix anything that looks off.
