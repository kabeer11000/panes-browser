/**
 * Builds the ad blocker's scriptlets and redirect files (resources.json) from a uBlock Origin checkout, the
 * way Brave builds its own (brave-core-crx-packager, lib/adBlockRustUtils.js `generateResources`).
 *
 *   bun scripts/adblock-resources.ts <uBlock checkout> <out file>
 *
 * Run daily by .github/workflows/adblock-resources.yml, which publishes the result for Panes to download. The
 * copy Panes falls back to when that download fails is resources/adblock-resources.json, made by running this
 * by hand. uBO's code only ever runs here: Panes itself only receives the JSON.
 */
import { promises as fs } from 'fs'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
import { Engine, FilterSet, uBlockResources } from 'adblock-rs'

interface Resource {
  name: string
  aliases: string[]
  kind: { mime: string } | string
  content: string
  dependencies?: string[]
}

const BRAVE_RESOURCES =
  'https://raw.githubusercontent.com/brave/adblock-resources/master/dist/resources.json'

const [uboDir, out] = process.argv.slice(2)
if (!uboDir || !out) {
  console.error('usage: bun scripts/adblock-resources.ts <uBlock checkout> <out file>')
  process.exit(1)
}
const ubo = resolve(uboDir)

const { builtinScriptlets } = (await import(
  pathToFileURL(join(ubo, 'src/js/resources/scriptlets.js')).href
)) as {
  builtinScriptlets: Array<{
    name: string
    aliases?: string[]
    fn: () => void
    dependencies?: string[]
  }>
}

const names = new Set(builtinScriptlets.map((s) => s.name))
for (const s of builtinScriptlets) {
  for (const dep of s.dependencies ?? []) {
    if (!names.has(dep)) throw new Error(`uBO scriptlet ${s.name} needs ${dep}, which is missing`)
  }
}

const scriptlets: Resource[] = builtinScriptlets.map((s) => ({
  name: s.name,
  aliases: s.aliases ?? [],
  kind: { mime: 'application/javascript' },
  content: Buffer.from(s.fn.toString()).toString('base64'),
  dependencies: s.dependencies ?? []
}))

// Brave leaves this one out too: its own resources replace it.
const redirects = (
  uBlockResources(
    join(ubo, 'src/web_accessible_resources'),
    join(ubo, 'src/js/redirect-resources.js')
  ) as Resource[]
).filter((r) => r.name !== 'google-ima-dai.js')

const res = await fetch(BRAVE_RESOURCES)
if (!res.ok) throw new Error(`${res.status} ${BRAVE_RESOURCES}`)
const brave = (await res.json()) as Resource[]

const resources = [...redirects, ...brave, ...scriptlets]

// Proof it works before it is published: a scriptlet and a redirect must both come out of an engine.
const filters = new FilterSet(true)
filters.addFilters(
  [
    'example.com##+js(set-constant, panesCheck, true)',
    '||example.com/ads.js$script,redirect=noopjs'
  ].join('\n')
)
const engine = new Engine(filters)
engine.useResources(resources)
const cosmetic = engine.urlCosmeticResources('https://example.com/') as { injected_script: string }
if (!cosmetic.injected_script.includes('panesCheck'))
  throw new Error('set-constant scriptlet did not resolve')
const blocked = engine.check(
  'https://example.com/ads.js',
  'https://example.com/',
  'script',
  'GET',
  true
) as {
  redirect?: string
}
if (!blocked.redirect?.startsWith('data:')) throw new Error('noopjs redirect did not resolve')

await fs.writeFile(out, JSON.stringify(resources))
console.log(
  `${resources.length} resources (${scriptlets.length} scriptlets, ${redirects.length} redirects, ${brave.length} Brave) to ${out}`
)
