import {
  CLOUD_PROVIDERS,
  type AiContext,
  type AiSettings,
  type AiTask,
  type CloudProviderId
} from './types'

export type Route = 'local' | 'cloud' | 'deny'

/** Which feature switch has to be on for a task to run at all. */
const FEATURE: Record<AiTask, (s: AiSettings) => boolean> = {
  title: (s) => s.titles,
  filename: (s) => s.filenames,
  'group-name': (s) => s.grouping || s.canvas,
  embed: (s) => s.grouping || s.canvas || s.semanticHistory,
  // later phases: a person asks for these directly, so only the master switch applies
  chat: () => true,
  agent: () => true
}

const BACKGROUND: readonly AiTask[] = ['title', 'filename', 'group-name', 'embed']

/**
 * Where a call may go. This is the one place that decides, and the router asks it for every call:
 * a private or Tor tab is refused before anything else is looked at.
 * `localAvailable` is whether the local provider could answer right now.
 */
export function route(
  task: AiTask,
  ctx: AiContext,
  settings: AiSettings,
  localAvailable = true
): Route {
  if (ctx.private || ctx.tor) return 'deny'
  if (!settings.enabled) return 'deny'
  if (!FEATURE[task](settings)) return 'deny'
  if (localAvailable) return 'local'
  const cloudOk =
    settings.cloudProvider !== null && (!BACKGROUND.includes(task) || settings.cloudForBackground)
  return cloudOk ? 'cloud' : 'deny'
}

/** Where the chat panel is answered: this computer's model, or a signed-in online one. */
export type ChatTarget = 'local' | 'chatgpt' | CloudProviderId

export interface ChatAvailability {
  /** The local provider could answer now (the runtime is installed, or the person's own server is set). */
  local: boolean
  /** Online providers that have a key or a sign-in. */
  online: readonly ChatTarget[]
}

/**
 * Which provider chat uses. `auto` is the first signed-in online provider (ChatGPT, then the one chosen for
 * background work, then any other), else the local one. A named choice is used only if it is usable: chat never
 * quietly moves to another paid provider when the chosen one is not.
 */
export function resolveChatTarget(s: AiSettings, a: ChatAvailability): ChatTarget | null {
  const choice = s.chatProvider
  if (choice === 'local') return a.local ? 'local' : null
  if (choice !== 'auto') return a.online.includes(choice) ? choice : null
  if (a.online.includes('chatgpt')) return 'chatgpt'
  if (s.cloudProvider && a.online.includes(s.cloudProvider)) return s.cloudProvider
  const other = CLOUD_PROVIDERS.find((p) => a.online.includes(p))
  if (other) return other
  return a.local ? 'local' : null
}

/**
 * The route for a chat or agent turn. Private and Tor are refused first, as for every task. The tab the panel
 * is opened on does not matter here: what matters is each tab it is asked to read (see canShareTab).
 */
export function routeChat(
  task: 'chat' | 'agent',
  ctx: AiContext,
  s: AiSettings,
  a: ChatAvailability
): { route: Route; target: ChatTarget | null } {
  if (route(task, ctx, s, true) === 'deny') return { route: 'deny', target: null }
  const target = resolveChatTarget(s, a)
  if (!target) return { route: 'deny', target: null }
  return { route: target === 'local' ? 'local' : 'cloud', target }
}

/** Whether a tab's content may reach a model at all (a private or Tor tab never may). Used by every chat tool. */
export function canShareTab(task: 'chat' | 'agent', tab: AiContext, s: AiSettings): boolean {
  return route(task, tab, s, true) !== 'deny'
}
