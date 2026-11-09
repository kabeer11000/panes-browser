import {
  CHAT_CHOICES,
  CLOUD_PROVIDERS,
  DEFAULT_AI_SETTINGS,
  type AiSettings,
  type CloudProviderId
} from './types'

const MAX_MODEL = 100

const isHttpUrl = (v: string): boolean => {
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

const model = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length <= MAX_MODEL ? v.trim() : null

/**
 * An edit to the AI settings that came from a page: only known fields of the right type are applied, over the
 * current values.
 */
export function sanitizeAi(raw: unknown, current: AiSettings): AiSettings {
  const out: AiSettings = {
    ...DEFAULT_AI_SETTINGS,
    ...current,
    cloudModels: { ...DEFAULT_AI_SETTINGS.cloudModels, ...current.cloudModels }
  }
  if (!raw || typeof raw !== 'object') return out
  const p = raw as Record<string, unknown>
  for (const key of [
    'enabled',
    'cloudForBackground',
    'titles',
    'filenames',
    'grouping',
    'canvas',
    'semanticHistory',
    'selectionAsk'
  ] as const) {
    if (typeof p[key] === 'boolean') out[key] = p[key]
  }
  if (p.localProvider === 'local' || p.localProvider === 'openai-compatible')
    out.localProvider = p.localProvider
  if (typeof p.compatibleUrl === 'string') {
    const url = p.compatibleUrl.trim()
    if (url === '' || (url.length <= 300 && isHttpUrl(url))) out.compatibleUrl = url
  }
  const cm = model(p.compatibleModel)
  if (cm !== null) out.compatibleModel = cm
  if ((CHAT_CHOICES as readonly unknown[]).includes(p.chatProvider))
    out.chatProvider = p.chatProvider as AiSettings['chatProvider']
  const gm = model(p.chatgptModel)
  if (gm !== null) out.chatgptModel = gm
  if (p.cloudProvider === null) out.cloudProvider = null
  else if ((CLOUD_PROVIDERS as readonly unknown[]).includes(p.cloudProvider))
    out.cloudProvider = p.cloudProvider as CloudProviderId
  if (p.cloudModels && typeof p.cloudModels === 'object') {
    const models = p.cloudModels as Record<string, unknown>
    for (const id of CLOUD_PROVIDERS) {
      const m = model(models[id])
      if (m !== null) out.cloudModels[id] = m || DEFAULT_AI_SETTINGS.cloudModels[id]
    }
  }
  return out
}
