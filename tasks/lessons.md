
# Lessons

- Temporary debug harnesses go into src/main/index.ts: back the file up right before inserting one and restore from that fresh copy, never from an older backup (an old restore wiped real edits once). Check `grep -c TEMP- src/main/index.ts` is 0 and `git diff` is only what was meant.
- Releases: `bun run release:win prerelease` (or patch/minor/major/exact version; no bump repeats the package.json version after a failed run). Notes are generated from commits that touch src/ since the last tag: a `Notes: <plain user line>` trailer in the commit message wins, else a feat/fix/perf subject is used as it is. Write the trailer on every user-visible commit; preview with `bun scripts/release-notes.ts`, override with `--notes`. The script does not pause before publishing. Needs a clean tree and HEAD pushed; it bumps package.json, commits `chore(release)`, pushes, and the tag is made by GitHub at publish. `--dry-run` builds without touching git or GitHub, and `bun pm version --dry-run` still writes package.json, so never use it. It makes a draft release, uploads installer, latest.yml and the app layer from one build, checks the asset list, then publishes as latest (a pre-release is not "latest" and breaks the website and updater links). A failed run leaves a draft that the rerun reuses; never hand-edit assets of a published release, a second build changes the installer bytes and leaves latest.yml disagreeing. A release without `app-layer.json` gives existing users no update at all.
- Updates: a release on the same Electron reaches users as an app layer (a delta of a few hundred KB, started on the next launch); only a new Electron goes through the installer. Try one locally before releasing: `bun scripts/release-layer.ts --asar <new app.asar> --out <dir> --base <old app.asar>`, serve `<dir>`, run the old build with `PANES_LAYER_FEED=http://127.0.0.1:<port>` and `PANES_USERDATA=<scratch>`. A local `electron-builder --dir` build has no app-update.yml, so copy one into its resources folder or updates are off.
- Large literals with quotes in shell heredocs get mangled by the tool wrapper: write such files with the Write tool and run a script from disk.
- Update visibility: a silent installer shows nothing; on Restart to update Panes shows its own "installing" state and a small progress window until the new version is running. Never show that window when Panes is simply quit: the installer does not reopen Panes then, and the window waited out its 2 minutes saying it would.
- Prettier: run it on the files you changed, never on a directory (src/renderer/src, src/main...). Doing that reformatted ~50 untouched files (line endings) and two with real diffs, which had to be restored with `git show HEAD:path > path`.
- Dev app testing: `electron-vite dev` restarts the Electron main process when main/preload files rebuild, and if its npm process dies the orphan Electron is left showing chrome-error://chromewebdata/. Before trusting a DOM check, confirm the page is the real UI (title "Panes", `#root` present). Use a restart script that kills only `electron.exe` processes whose command line has node_modules and no `--type=`.
- CDP harness scripts (bun) must call process.exit(0) at the end, or the open WebSocket keeps bun alive and blocks a chained command. `TaskStop` does not kill the bun children it spawned: kill that one by PID (find it by its command line). Never `taskkill //IM bun.exe`: with other agents or the user running Panes it kills their `bun run dev` wrappers and scripts too (it did on 2026-11-09).
- A CSS rule that caps or centers an element (`.strip .address`) needs checking against every layout variant (`.strip.full`, `.strip.hstrip`) before it ships.
- Native overlay views (WebContentsView): never resize them to fit content. A resized view shows its old frame at its new top-left until the page repaints (flash/clip). Give it a fixed size and let the content move inside, or use two views and only move/show/hide them.
- Own the product, not just the diff. After a change, use it as an end user would and check the states next to it: every way in (shortcut, click, hover) and out (Esc, click outside, another panel or the sidebar opening, resize), in the running app with screenshots. Fix breakage found next to the change in the same pass. (Search popover: floated detached with the bar hidden, no right-click menu, stayed open when the sidebar opened. All three were found by the user, not by me.)
- A component that lives in more than one place is tested in every one of them. The space editor opens from the pinned sidebar, the hover sidebar, the auto-hidden top bar (sidebar collapsed) and the horizontal tab bar; I fixed and tested the hover sidebar and called it done, and the user found it still shut from the top bar. Before testing, grep where the component is rendered (`<SpaceSwitcher` has three hosts) and list each route.
- Testing in the user's dev profile changes their data (a wheel click recoloured their Home space). Test in a `PANES_USERDATA` scratch profile; if the real one is needed, note every value before touching it and put it back.
- Auto mode may block the Write and Edit tools (no classifier verdict): write files from Bash. A heredoc over about 150 lines fails with "unexpected EOF while looking for matching" (split it into several `cat >>` calls), and a double backslash in it collapses to one (write `\x5c` in a regex, or build the character with String.fromCharCode(92)). Many files in src/ are CRLF: edit them with a script that keeps the line endings (replace on LF text, write back with the original ending), and run prettier with `--end-of-line auto`.
- Electron-vite dev does not restart the main process when main files change here: kill only the dev tree you started (by its --remote-debugging-port) and start it again. A restart during a model download throws the download away (it is not resumable yet), so let it finish first.
- bsdtar on Windows exits non-zero for "Can't restore time" while unpacking a zip: pass -m.
- Testing chat tools needs no real model: point "Your server" at a tiny scripted OpenAI-compatible server that returns tool calls named in the user message (tasks/ai/phase-4.md). Both E: and C: were nearly full (exFAT E: has no hard links), so a fresh profile cannot copy the 1.1 GB local model; use the mock instead.
- When several dev instances run (the user's on 9333, a subagent's), find yours by its --remote-debugging-port and stop only that one; `bun run dev` in a PowerShell background task can exit and orphan its Electron, so start it from Bash.
- A mode that holds the page overlay for its whole life (canvas) must not count as "something is over the page" for the hover sidebar and top bar, or they open on hover and never close. Since 2026-11-10 the board mounts no tabs chrome and switches both edge watchers off, so the overlay it holds pins nothing (ui:overlay-pins is gone). Test hover with the real cursor (SetCursorPos on a focused test window), since main reads the real cursor, not DOM events.
- Dev instances side by side share `out/`: one instance rebuilding main or preload can leave another's freshly loaded page without its preload (`window.panesInternal` undefined, blank page). Reload the page before calling it a bug.
- A CSS file split out of a shared one (controls.css out of internal.css) must be imported by every entry that used those classes: welcome/main.tsx lost its toggles and segmented controls until it imported controls.css too. Grep the class users per entry after a split.

## A packaged build must start where nothing else is installed (2026-11-10)

beta.9 would not start on another computer: `zod`, which the AI SDK needs, was in node_modules here but not in
package.json `dependencies`, so electron-builder left it out of app.asar. It worked on the dev machine only because
the repo's own node_modules sits above `dist/win-unpacked`, and Node found it there.

- Every package the built main process or a preload imports, and every peer dependency of one of them, goes in
  `dependencies` (bun does not install or pack peers for you).
- Before a release, start the packaged app from a copy outside the repo: copy `dist/win-unpacked` to a temp folder, use
  `PANES_USERDATA=<fresh folder>`, and check a window opens. To test the layer path too, put `app.asar` in
  `<userData>/app-layers/` with a `state.json` naming it, on an installed copy whose `panesBuild` is lower.

## Local AI work (2026-11-10)

- Edit scripts go through the Write tool, never a heredoc: `\n` and `\s` in a heredoc were mangled three times in one
  session (a literal newline inside a string, a regex that matched nothing). The rule above already said so; follow it.
  Again 2026-11-10: `\b` in a Python heredoc string became a backspace byte in sites.ts. Use the Edit tool for
  small changes; a script only via Write, with raw strings.
- Never put `bun run dev &` (or any app launch) on the end of an unrelated command. One slipped in and started a dev
  Panes; kill such a stray by PID after listing processes created in the last minutes, nothing broader.
- Killing processes by command-line match (`CommandLine -match 'ai-bench.ts'`) also matches the shell running the
  kill: it killed itself. Match by PID or exclude the current process tree.
- Measure the local model before tuning it: `bun scripts/ai-bench.ts --dir E:/ai-bench --affinity FF` (4 cores + HT,
  an i5 stand-in). Guesses were wrong twice: Q4_0 was slower than Q4_K_M on AVX2, and the 8-bit KV cache that was
  meant to save memory halved prompt reading at depth.
- Small models copy the surface form of prompt examples: prose like "scroll_to with target X" came back as that text,
  and `<tool_call>` examples got the request lines echoed. Worked turns as real messages (LOCAL_EXAMPLES) are the
  form that holds.

## Native view state: ask main, not the page (2026-11-10)

- `document.visibilityState` of a tab page is no proof it is on screen: a page with background throttling off reports
  "visible" while hidden or parked. Read the truth from main: start dev with `-- --inspect <port>` and list
  `BrowserWindow.getAllWindows()[0].contentView.children` (getVisible, getBounds, webContents URL; last child is on
  top). That showed the canvas preview parked at x=-20000 in one call, after reading code had found nothing.
- Keyed React remounts (a board per space) can deliver the new instance's "open" before the old one's "close" (exit
  animations). A main-side on/off flag driven by such pairs must count, not toggle, or the late close wins.
