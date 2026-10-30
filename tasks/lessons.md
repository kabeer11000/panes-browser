
# Lessons

- Temporary debug harnesses go into src/main/index.ts: back the file up right before inserting one and restore from that fresh copy, never from an older backup (an old restore wiped real edits once). Check `grep -c TEMP- src/main/index.ts` is 0 and `git diff` is only what was meant.
- Releases: create the GitHub release first with `gh release create vX --latest` (not as a pre-release, or it is not "latest" and the website and updater links break), then `bun run release:win`. Run the build once; a second build for a repair changes the installer bytes and leaves latest.yml and the asset disagreeing while it uploads.
- Large literals with quotes in shell heredocs get mangled by the tool wrapper: write such files with the Write tool and run a script from disk.
- Update visibility: a silent installer shows nothing; Panes shows its own "installing" state and a small progress window until the new version is running.
- Prettier: run it on the files you changed, never on a directory (src/renderer/src, src/main...). Doing that reformatted ~50 untouched files (line endings) and two with real diffs, which had to be restored with `git show HEAD:path > path`.
- Dev app testing: `electron-vite dev` restarts the Electron main process when main/preload files rebuild, and if its npm process dies the orphan Electron is left showing chrome-error://chromewebdata/. Before trusting a DOM check, confirm the page is the real UI (title "Panes", `#root` present). Use a restart script that kills only `electron.exe` processes whose command line has node_modules and no `--type=`.
- CDP harness scripts (bun) must call process.exit(0) at the end, or the open WebSocket keeps bun alive and blocks a chained command. `TaskStop` does not kill the bun children it spawned: `taskkill //IM bun.exe //F` after a stuck run.
- A CSS rule that caps or centers an element (`.strip .address`) needs checking against every layout variant (`.strip.full`, `.strip.hstrip`) before it ships.
- Native overlay views (WebContentsView): never resize them to fit content. A resized view shows its old frame at its new top-left until the page repaints (flash/clip). Give it a fixed size and let the content move inside, or use two views and only move/show/hide them.
