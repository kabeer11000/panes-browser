/**
 * Whether a tab is silent: the person's own choice for that tab wins ('on' muted, 'off' heard even on a muted site),
 * and without one it follows its site (Mute site). Kept apart from the page itself, so it holds when the tab goes to
 * another site, is unloaded and brought back, or its site is unmuted while the tab was muted on its own.
 */
export type TabMute = 'on' | 'off' | undefined

export const isMuted = (tab: TabMute, siteMuted: boolean): boolean =>
  tab === 'on' || (tab !== 'off' && siteMuted)

/** Mute tab / Unmute tab: the opposite of what is heard now, as the tab's own choice. */
export const toggledTabMute = (tab: TabMute, siteMuted: boolean): TabMute =>
  isMuted(tab, siteMuted) ? 'off' : 'on'

/**
 * The tab's choice after it goes to another site: muting stays (as Chrome's tab mute), but "heard anyway" was an
 * exception for the site it was on, so it ends and the new site's own setting applies.
 */
export const muteAfterSiteChange = (tab: TabMute): TabMute => (tab === 'on' ? 'on' : undefined)
