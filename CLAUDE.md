# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Panes is an Electron + React + TypeScript browser (electron-vite, Bun). The README is the unmodified electron-vite template; use Bun, not npm.

## Commands

```bash
bun install                  # postinstall fetches the Electron binary
bun run dev                  # electron-vite dev
bun run typecheck            # node + web projects (tsconfig.node.json, tsconfig.web.json)
bun run lint                 # eslint --cache .
bun run format               # prettier --write .
bun test                     # unit tests (bun:test), colocated as src/shared/*.test.ts
bun test src/shared/anchor.test.ts   # single file
bun run build                # typecheck + electron-vite build (needs user approval to run)
bun run build:win | build:unpack | release:win   # electron-builder (release:win publishes)
```

Perf tooling (needs a running Panes started with `--remote-debugging-port`, see headers in each file): `bun scripts/perf-report.ts`, `perf-load.ts`, `perf-close.ts`.

Env vars: `PANES_USERDATA=<dir>` redirects the data folder (tests, side-by-side copies; also scopes the single-instance lock). `PANES_TRACE_STARTUP=1` appends startup timings to `startup-trace.log` in the data folder.

## Architecture

Three Electron layers, each built separately in `electron.vite.config.ts`:

- `src/main/` — main process. `index.ts` wires everything: one module per concern (`tabs.ts`, `spaces.ts`, `downloads.ts`, `tor.ts`, `adblock.ts`, `permissions.ts`, `updater.ts`, `youtube.ts`, ...), each a class or `register*` function that `index.ts` constructs and connects.
- `src/preload/` — one preload per window kind, exposing a typed `PanesApi` over `contextBridge`/IPC. Adding a window means adding an entry in the vite config's preload *and* renderer inputs, an `.html` in `src/renderer/`, and a `src/renderer/src/<name>/main.tsx`.
- `src/renderer/` — React 19 UI. Multiple HTML entry points, not one SPA: `index` (main chrome), `internal` (the `panes://` pages: settings, history, downloads, passwords...), `pip`, `popover`, `error`, `welcome`, `panel`, `permission`, `tabcard`, `dock`. `@renderer/*` aliases `src/renderer/src/*`.
- `src/shared/` — pure, Electron-free logic and types shared by all three layers (colour math, tab groups, memory-unload policy, attention/notification state, capture state, dithering, identity, settings schema, IPC types in `types.ts`). This is where the tests live; put new testable logic here rather than inside main-process classes.

Key mechanics that span files:

- **Web content** runs in `WebContentsView`s managed by `TabManager` (`main/tabs.ts`); the React UI in the window's own view renders chrome around them and is told their geometry via `Rect`s (`Panes.tsx`, `tabs:*` IPC). Tab state flows main → renderer as `tabs:state` pushes; the renderer sends commands back (`tabs:create`, `tabs:navigate`, ...).
- **Spaces** (`spaces.ts`) are the browsing-profile unit; sessions, identity, theme and tab groups hang off them.
- **`panes://` scheme** is registered before app ready (`registerInternalScheme`) and served by `main/internal.ts`, which also owns the IPC for the internal pages.
- **Persistence**: `JsonStore<T>` (`main/store.ts`) — debounced atomic JSON files in userData; fallbacks are shallow-merged over disk contents. Flushed on quit via `flushAllStores`.
- **Startup order matters**: `singleInstance.ts` must stay the first import of `main/index.ts` (second launches hand off their args and exit before anything loads). `applyPerformance()` must run before app ready. `boot.js` in `renderer/public` and the minified renderer bundle exist to avoid theme flash / slow first paint.
- **Do not minify main or preload builds**: the YouTube defences inject code built from their own functions' source text, which renaming would break. Only the renderer is minified.
- Shared types import across layers via relative `../shared/...` paths.

## Driving the app (UI testing)

- **Use `agent-desktop` first** to launch, see and operate Panes (it is a native desktop app; run `agent-desktop skills get desktop` for the snapshot/ref loop).
- Use `agent-browser` only where `agent-desktop` is a poor fit: reading or scripting web content over the DevTools port, or the `panes://` / renderer pages as plain web pages.
- Resource numbers still come from `scripts/perf-*.ts` over `--remote-debugging-port`.

## Conventions

- Prettier + ESLint (`@electron-toolkit` configs, react-hooks and react-refresh plugins); `.editorconfig` and `.prettierrc.yaml` apply.
- Release commits are `chore(release): <version>`; version lives in `package.json`.
