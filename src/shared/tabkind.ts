/** How private a tab is: an ordinary one, a private one (no trace kept), or a private one through Tor. */
export type TabKind = 'normal' | 'private' | 'tor'

export function kindOf(tab: { private: boolean; tor: boolean } | null | undefined): TabKind {
  return !tab || !tab.private ? 'normal' : tab.tor ? 'tor' : 'private'
}

/** What the window looks like while a private or Tor tab is on screen: always dark, Tor in its own purple. */
export const KIND_THEME = {
  private: { color: '#3a3a48', color2: null, tint: 0.55, grain: 0 },
  tor: { color: '#7d4698', color2: '#4a2a6a', tint: 0.6, grain: 0 }
} as const

/** Tor's purple, for its logo and highlights. */
export const TOR_PURPLE = '#7d4698'

/** The welcome tour is shown on its own: dark, with no sidebar or bars around it, so the whole window is the page. */
export const WELCOME_THEME = { color: '#08080c', color2: null, tint: 0, grain: 0 } as const

export const isWelcome = (url: string | undefined | null): boolean =>
  !!url && url.startsWith('panes://welcome')
