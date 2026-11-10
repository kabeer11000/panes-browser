# Phase 5: local AI speed and agency

Target: i5 10th gen (4 cores / 8 threads, Intel UHD iGPU), 8-16 GB RAM. Big pages answered fast, follow-ups near instant,
and the local model acts instead of offering to.

## Why it is slow / passive today

- A turn about a page reads ~4-4.5k tokens before the first word (system + tools ~1.3k, page ~3k): 30-70 s on a laptop CPU.
- The page sits in the newest user message, so every follow-up reads it again (no prefix cache hit).
- A big article is cut to its first ~10k characters: answers deep in it are wrong as well as slow.
- The local model gets 7 tools (no scroll, media, switch), is never told which tab is current, and nothing tells it
  to act rather than offer (sample chat: "Let me know if you'd like me to...", read_tab with a made-up id).

## Plan

- [ ] Benchmark harness `scripts/ai-bench.ts`: speed (prompt tok/s, first word, follow-up) and agency cases (tool
      picked, tab id right) per model x backend, using the app's own prompt builders. Run in E:\ai-bench.
- [ ] Agency: current tab + open tabs line in every local turn; tab tools default to the current tab; wrong id
      error lists the real ids; local tool set gains switch_to_tab, scroll_to, scroll_page, media_control,
      find_in_page; local prompt says act, never offer, with examples for them.
- [ ] Stable prompt prefix: system + tools + attached pages first, history next, tabs line + question last.
- [ ] Big pages: stable lead in the prefix, plus question-matched passages (BM25, no model) in the last message.
- [ ] Prime: when the panel opens / the current page changes / typing starts, the local server reads the prefix in
      the background, so only the question is left when it is sent.
- [ ] Server: keep the cached prompt across background jobs (titles, file names) - check `--cache-ram` / slots
      on b12211.
- [ ] GPU vs CPU: measure both once on first start, keep the faster (an Intel iGPU can lose to the CPU). Not done, see below.
- [x] Model: stays Qwen3 1.7B Q4_K_M (user decision; other candidates not run: LFM2.5 1.2B, Qwen3.5 2B,
      Qwen3 4B 2507, Qwen3.5 4B).

## Results (Qwen3 1.7B Q4_K_M, CPU, affinity FF = 4 cores + HT on a Ryzen 2700X, i5 stand-in)

Model stays Qwen3 1.7B (user's call). Q4_0 measured slower than Q4_K_M (49 vs 69 tok/s at 4 threads), so the file stays.

|                                    | before                         | after                                   |
| ---------------------------------- | ------------------------------ | --------------------------------------- |
| prompt reading                     | ~30 tok/s                      | 53 tok/s (f16 KV, -tb all logical CPUs) |
| fixed head (system + tools)        | ~2150 tok, read every new page | read once on panel open, then cached    |
| page asked at once: first word     | 129.5 s (3887 tok)             | 26.9 s (1431 tok)                       |
| page read ahead (prime) then asked | n/a                            | 9 s                                     |
| follow-up on the same page         | 38.8 s                         | 13.9 s                                  |
| agency cases                       | 8/15                           | 13/15 (plain commands need no model)    |

Findings:

- 8-bit KV cache: 34 vs 62 tok/s at 2000 tokens in, and llama.cpp cannot restore a saved q8 prompt. Back to f16.
- Hyperthreads: 80 vs 59 tok/s reading on 4c/8t; generation unchanged. `-tb <logical CPUs>`.
- `--cache-ram` defaults to 8 GB in b12211: capped at 768 MB.
- Tool definitions are 1487 tokens of the head; the prompt was 660.

- [x] Bench harness, agency, stable prefix, passages, prime (main + panel), server flags.
- [ ] GPU vs CPU auto-pick: not done. Vulkan on an Intel iGPU needs measuring on the laptop
      (`bun scripts/ai-bench.ts --backends cpu,vulkan` there) before choosing a rule.

Final run: page asked at once 26.1 s, primed 8.9 s, follow-up 13.4 s, head on panel open 31.3 s, agency 13/15.
Left failing: lookups the model answers without calling (an unreadable panes:// tab, "what did I download").

In the app (dev, scratch profile, CPU build, all 16 threads): "scroll down" 0.4 s, "find ... on this page" 15 ms,
primed page question first word 10 s (right), follow-up 8.6 s (right).

Prompt experiments that did not hold (all removed): `<tool_call>` examples in the system prompt (the model echoed the
request lines), worked example turns (it repeated the examples' results as facts, or copied the reply and skipped
the call).
