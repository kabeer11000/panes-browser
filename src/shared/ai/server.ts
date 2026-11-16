import type { ModelRole } from './models'

/**
 * The chat model's context. Its KV cache stays 16-bit: an 8-bit one halves the CPU's reading speed once a page is in
 * (34 against 62 tokens a second at 2000 tokens in, Qwen3 1.7B on 4 cores), and llama.cpp cannot restore a saved
 * 8-bit prompt. 8192 tokens at 16-bit is ~940 MB, given back when the server idles out.
 */
export const CONTEXT_TOKENS = 8192
// an indexed page is at most ~1900 characters (~600 tokens); a smaller batch halves the embedder's compute buffers
export const EMBED_TOKENS = 1024

export interface ServerArgsInput {
  role: ModelRole
  modelPath: string
  port: number
  apiKey: string
  /** A GPU build: layers go to the GPU. */
  gpu: boolean
  /** Logical CPUs. The server's threads leave some of them free (see aiThreads). */
  cpus?: number
}

/**
 * The RAM llama-server may keep earlier prompts in (it saves the chat's prompt there while a title or file name job
 * uses the server, and restores it after). Its default is 8 GB, more than a whole 8 GB laptop has spare; one chat
 * prompt is ~100-500 MB for the 1.7B model.
 */
export const CACHE_RAM_MB = 768

/**
 * Threads for a server on `cpus` logical CPUs. On every one (what llama.cpp does by default) a background job, such as
 * naming a board's sections, held a 4-core laptop at 100% and froze it. Writing tokens is bound by memory, not
 * compute, so a few threads lose little; reading a prompt is compute, so it gets all but two logical CPUs. The
 * server also runs at below-normal priority (runtime.ts), so what the person is doing comes first.
 */
export function aiThreads(cpus: number): { generate: number; read: number } {
  return {
    generate: Math.max(1, Math.floor(cpus / 2) - 1),
    read: Math.max(1, cpus - 2)
  }
}

/**
 * The command line for one llama-server. It listens on the loopback address only and refuses any request that
 * does not carry this launch's key, so a web page (which can reach 127.0.0.1) cannot use it.
 */
export function serverArgs({
  role,
  modelPath,
  port,
  apiKey,
  gpu,
  cpus
}: ServerArgsInput): string[] {
  const args = [
    '-m',
    modelPath,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--api-key',
    apiKey,
    '-c',
    String(role === 'embed' ? EMBED_TOKENS : CONTEXT_TOKENS),
    '-np',
    '1', // one slot: a parallel slot splits the context and costs memory
    '--no-webui'
  ]
  if (cpus && cpus > 1) {
    const t = aiThreads(cpus)
    args.push('-t', String(t.generate), '-tb', String(t.read))
  }
  if (role === 'embed')
    args.push(
      '--embeddings',
      '-ub',
      String(EMBED_TOKENS),
      '-b',
      String(EMBED_TOKENS),
      '--cache-ram',
      '0'
    )
  // --jinja: the model's own chat template, which is what turns tool definitions and tool calls into text it knows
  else
    args.push(
      '--jinja',
      '--chat-template-kwargs',
      '{"enable_thinking":false}',
      '-fa',
      'on', // ~10% faster reading on a CPU
      '--cache-ram',
      String(CACHE_RAM_MB)
    )
  if (gpu) args.push('-ngl', '99')
  return args
}
