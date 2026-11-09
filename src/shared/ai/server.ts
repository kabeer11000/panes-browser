import type { ModelRole } from './models'

// 8192 tokens with an 8-bit KV cache costs the memory 4096 did at 16-bit, and fits a long page plus the question
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
}

/**
 * The command line for one llama-server. It listens on the loopback address only and refuses any request that
 * does not carry this launch's key, so a web page (which can reach 127.0.0.1) cannot use it.
 */
export function serverArgs({ role, modelPath, port, apiKey, gpu }: ServerArgsInput): string[] {
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
  if (role === 'embed')
    args.push('--embeddings', '-ub', String(EMBED_TOKENS), '-b', String(EMBED_TOKENS))
  // --jinja: the model's own chat template, which is what turns tool definitions and tool calls into text it knows
  else
    args.push(
      '--jinja',
      '--chat-template-kwargs',
      '{"enable_thinking":false}',
      '-fa',
      'on', // a quantised V cache needs flash attention
      '-ctk',
      'q8_0',
      '-ctv',
      'q8_0'
    )
  if (gpu) args.push('-ngl', '99')
  return args
}
