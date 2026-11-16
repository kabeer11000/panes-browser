import type * as Ai from 'ai'
import type * as Google from '@ai-sdk/google'
import type * as OpenAi from '@ai-sdk/openai'
import type * as Compatible from '@ai-sdk/openai-compatible'

/**
 * The AI SDK and its providers, loaded on first use. Required at startup they cost about 350 ms before the window was
 * even asked for (and every link handed to a running Panes paid it again in the second process). Every async way
 * into AI work awaits `loadAi()` (router.model, chat.send, chat.modelFor); code after that uses `ai()`. A warm-up
 * shortly after the window is up (index.ts) means the first request does not wait either.
 */
export interface Sdk {
  generateText: typeof Ai.generateText
  streamText: typeof Ai.streamText
  embedMany: typeof Ai.embedMany
  stepCountIs: typeof Ai.stepCountIs
  jsonSchema: typeof Ai.jsonSchema
  tool: typeof Ai.tool
  Output: typeof Ai.Output
  createGoogleGenerativeAI: typeof Google.createGoogleGenerativeAI
  createOpenAI: typeof OpenAi.createOpenAI
  createOpenAICompatible: typeof Compatible.createOpenAICompatible
}

let loaded: Sdk | null = null
let loading: Promise<Sdk> | null = null

export function loadAi(): Promise<Sdk> {
  loading ??= Promise.all([
    import('ai'),
    import('@ai-sdk/google'),
    import('@ai-sdk/openai'),
    import('@ai-sdk/openai-compatible')
  ]).then(([ai, google, openai, compatible]) => {
    loaded = {
      generateText: ai.generateText,
      streamText: ai.streamText,
      embedMany: ai.embedMany,
      stepCountIs: ai.stepCountIs,
      jsonSchema: ai.jsonSchema,
      tool: ai.tool,
      Output: ai.Output,
      createGoogleGenerativeAI: google.createGoogleGenerativeAI,
      createOpenAI: openai.createOpenAI,
      createOpenAICompatible: compatible.createOpenAICompatible
    }
    return loaded
  })
  return loading
}

/** The SDK, for code that runs after `loadAi()` was awaited on its way in. */
export function ai(): Sdk {
  if (!loaded) throw new Error('The AI SDK is not loaded yet (await loadAi() first)')
  return loaded
}
