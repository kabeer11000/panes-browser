
# Lessons

- Temporary debug harnesses go into src/main/index.ts: back the file up right before inserting one and restore from that fresh copy, never from an older backup (an old restore wiped real edits once). Check `grep -c TEMP- src/main/index.ts` is 0 and `git diff` is only what was meant.
- Releases: create the GitHub release first with `gh release create vX --latest` (not as a pre-release, or it is not "latest" and the website and updater links break), then `bun run release:win`. Run the build once; a second build for a repair changes the installer bytes and leaves latest.yml and the asset disagreeing while it uploads.
- Large literals with quotes in shell heredocs get mangled by the tool wrapper: write such files with the Write tool and run a script from disk.
- Update visibility: a silent installer shows nothing; Panes shows its own "installing" state and a small progress window until the new version is running.
