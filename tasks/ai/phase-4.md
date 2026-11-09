# AI, Phase 4: a chat that reads documents, researches and drives the browser

Builds on Phases 2 and 3b. Status: done (2026-11-09), verified with a scripted model server (see Testing).

## What changed
- Documents: PDFs are read with pdf.js in main (main/ai/docText.ts, no worker, text only). A PDF tab (web or file://) is read as a <document> with page markers; files can be attached (paperclip, file dialog, or drop on the panel; preload turns dropped Files into paths with webUtils). Attachments stay in the composer for the whole conversation; their text stays in main (ChatService.files), the panel holds id and name.
- Tools (shared/ai/chatTools.ts): list_downloads, read_download, search_web (hidden page reads the search engine), read_web_page (hidden page, or pdf.js for PDFs), and browser automation: look_at_page (numbered controls + visible text), click, type_text, press_key, scroll_page, select_option, navigate, go_back. Automation uses real input events (main/ai/automation.ts) aimed by fixed scripts (shared/ai/automation.ts); only numbers and JSON go into them. Each action returns the page after it settles.
- Safety: clicks on buy/send/delete/publish-like controls, unnamed submit buttons and anything in a password/card form wait for Confirm; passwords and card fields are never typed. At most 3 new tabs per answer (the old "opens 50 tabs" problem); the prompt says research with search_web/read_web_page instead.
- Modes: 'panel' (all tools, 30 steps) and 'popover' (read-only, 10 steps, short answers). The small local model keeps the local read-only set.
- Canvas prompt: questions answer in AskPopover (canvas/useAsk.ts, AskPopover.tsx, ask.css): springs out of the prompt, glowing edge and aura while working, sources as chips, follow-ups from the same box, Add to board / Copy. The board is changed only by Add to board. Addresses, private windows and no-model fall back to the old finder.
- Chat panel: Working indicator (orb + shimmer label of the current step), glowing composer edge while answering, file chips, drop overlay.

## Testing without a real model
A scripted OpenAI-compatible server (Bun) set as "Your server" (localProvider openai-compatible) can return `CALL {"name":...,"args":...}` lines from the user message as tool calls, and echo what it was given. That checks the whole path (IPC, tools, automation, popover) deterministically. Drive turns with window.api.chatSend over CDP.
