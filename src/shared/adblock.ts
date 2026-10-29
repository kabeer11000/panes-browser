/**
 * The filter lists the ad blocker is built from.
 *
 * They come straight from uBlock Origin's own publishing site, which carries its lists and fresh copies of
 * EasyList and EasyPrivacy. (Ghostery's prebuilt set, used before, is a copy that can lag upstream by months,
 * and its uBlock Origin lists stop at 2024: YouTube's countermeasures are answered in quick-fixes and the
 * newest yearly lists, usually within a day.)
 */
const UASSETS = 'https://ublockorigin.github.io/uAssets'

/** Scriptlets and redirect resources in the engine's own format (uBlock Origin's are not, so Ghostery's). */
export const RESOURCES_URL =
  'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json'

/**
 * uBlock Origin's `!#if` conditions, as a Chromium build of it sees them. Anything not named is false, so
 * rules meant for Firefox, phones, HTML filtering or uBO Lite are left out instead of all being loaded.
 */
export const ADBLOCK_ENV: Array<[string, boolean]> = [
  ['env_chromium', true],
  ['cap_user_stylesheet', true]
]

export interface FilterList {
  url: string
  /** Leave it out, rather than fail the whole update, if it cannot be fetched. */
  optional?: boolean
}

/** The last yearly list known to exist; later ones are tried, and skipped until uBlock Origin starts them. */
const LAST_KNOWN_YEAR = 2026

/** Every list to fetch, for the given calendar year (uBlock Origin starts a new list each year). */
export function filterLists(year: number): FilterList[] {
  const yearly: FilterList[] = []
  for (let y = 2020; y <= Math.max(year, LAST_KNOWN_YEAR); y++) {
    yearly.push({ url: `${UASSETS}/filters/filters-${y}.txt`, optional: y > LAST_KNOWN_YEAR })
  }
  return [
    { url: `${UASSETS}/thirdparties/easylist.txt` },
    { url: `${UASSETS}/thirdparties/easyprivacy.txt` },
    { url: `${UASSETS}/filters/filters.txt` },
    { url: `${UASSETS}/filters/filters-general.txt` },
    ...yearly,
    { url: `${UASSETS}/filters/badware.txt` },
    { url: `${UASSETS}/filters/privacy.txt` },
    { url: `${UASSETS}/filters/quick-fixes.txt` },
    { url: `${UASSETS}/filters/unbreak.txt` },
    { url: `${UASSETS}/filters/resource-abuse.txt` },
    {
      url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext',
      optional: true
    }
  ]
}
