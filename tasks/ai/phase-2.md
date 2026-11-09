# AI Phase 2: sign-in providers + chat panel with browser tools

Hard rules (plus all of Phase 0+1's):
- No Anthropic/Claude provider. No impersonating other vendors' clients (no Codex CLI / Gemini CLI / Antigravity client ids or headers). Only official, documented flows.
- Tokens and keys stay in main (KeyStore, safeStorage). Renderer sees only provider, signed-in/hasKey, account name/email if returned, plan-usage state.
- Private and Tor tabs: chat may be opened there, but it never reads their content or includes them in tool results; enforce in policy (add 'chat' and 'agent' tasks; tests).
- No mutating git commands, no `bun run build`. No emojis, no AI attribution.

## A. Providers and sign-in
1. Sign in with ChatGPT (official, developers.openai.com/siwc): OAuth 2.0 auth code + PKCE + OIDC with plan-usage scopes per docs (offline_access resource.invoke chatgpt.tokens.use.direct, resource=https://api.openai.com/v1; client_id=dynamic_agent_client, agent_name_hint="Panes", persistent per-install ext_agent_host_id). Loopback 127.0.0.1 redirect, system browser. Store tokens via KeyStore.setOAuth('chatgpt'). Auto-refresh before expiry (rotated refresh token stored). Handle cancel, state mismatch, refresh failure ("Sign in again"), usage cap reached (quiet notice; no silent fallback to paid providers). Chat-only: background features stay local. Button label "Continue with ChatGPT" (OpenAI UI guidelines).
2. OpenRouter: official OAuth PKCE flow returning a user key, stored as apiKey 'openrouter'. Manual key entry stays.
3. Gemini: "Get a free key" opens https://aistudio.google.com/apikey externally; paste field validates with one cheap request and shows the result inline.
4. OpenAI key and OpenAI-compatible URL unchanged.
5. Settings AI section: "Cloud AI" card with provider rows, one primary action each, signed-in state with account + Sign out, and one "Chat uses" picker. Default: signed-in cloud provider if any, else local.

## B. Chat panel
- Docked on the right of the main window inside the chrome; page views resize in step. Toggle Ctrl+Shift+L and a chrome button. Resizable width, remembered.
- Streaming (AI SDK streamText) over IPC; safe markdown (no raw HTML; links open in a new tab). Stop, New chat. Last 20 conversations kept in a JsonStore (never private/tor content).
- Context: "Current page" chip (default on for normal tabs, ~12k chars cap), @-mention other tabs as chips.
- Tools: list_tabs, read_tab, search_history, open_tab, switch_to_tab, close_tabs, find_in_page. All through policy; private/tor tabs invisible. close_tabs asks for inline Confirm/Cancel. Steps render as compact collapsible rows.
- Local model: read-only tools and tight prompts; `--jinja` in shared/ai/server.ts.
- Page text is untrusted: delimited, cannot give instructions, never auto-runs a destructive tool.

## C. UI/UX bar
Match Panes' visual language; 200 ms ease-out slide with motion, reduced-motion respected; auto-growing composer (Enter sends, Shift+Enter newline, Esc closes); auto-scroll only at bottom; empty state with 3 suggestions; inline errors with Retry; keyboard accessible, aria-live.

## Tests (bun:test, src/shared/ai/)
PKCE, OAuth state and refresh decision, policy chat/agent with private/tor, tool-argument validation, conversation store trimming.

## Manual verification
Scratch profile PANES_USERDATA=E:/tmp/panes-ai-chat, REMOTE_DEBUGGING_PORT=9334. Screenshots light + dark.
