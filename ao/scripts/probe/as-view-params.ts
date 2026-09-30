// What survives the `as/<view>` read path — the one D32 depends on and nothing had tested.
//
// Under globals a view function is the ONLY way to reach state (a data global 500s), so every
// property of `as/` is load-bearing. Findings, all measured on v0.9-FINAL-patched 2026-08-09:
//
//   1. QUERY PARAMS WORK.        `as/one?address=X` reaches the view as `req.address`.
//                                `&` works too — but NOT with a device suffix appended
//                                (`as/one/serialize~json@1.0&address=X` silently loses it,
//                                the view sees no param and answers a MISS with HTTP 200).
//                                Always use `?`.
//   2. PATH SEGMENTS ONLY INDEX A RAW RETURN. `as/raw/verified/AAA` returns the leaf, but a
//                                WRAPPED view answers `not_found` — its result is a `body`
//                                string, not a map, so there is nothing to index. Since we
//                                wrap every view, path addressing into a view is simply not
//                                available, which also removes the D31 §5a trap (addressing
//                                into a whole-state view cost 674 ms to return 1,957 bytes).
//                                Add a parameter to the view instead.
//   3. THE VIEW WRAPPER WORKS.   `{ body = <json string>, ['content-type'] = 'application/json' }`
//                                — what native.installViews generates — comes back as clean
//                                inlined JSON with no envelope keys, ~23 ms.
//   4. `require` IS NOT FREE.    A module the DEVICE provides is unreachable from a view under
//                                `as/`: the restored VM has only what the module source
//                                preloaded. `require('json')` in a view of a module that did
//                                not preload json is an HTTP 500. Our bundles preload json +
//                                the common libs (scripts/util/native-bundle.ts), so they are
//                                fine — an inline `luaSource` spawn in a probe is not.
//                                This is the trap that made an earlier run of this probe
//                                report "as/ cannot serve views at all".
//   5. RAW TABLES LINK-IFY.      A view returning a nested Lua table comes back with each
//                                child content-addressed: `{"verified+link":"CMqwo…"}`, one
//                                extra GET per map. `serialize~json@1.0` does NOT inline them.
//                                That is why the wrapper pre-encodes, and why it must stay.
//
// Run: HB_URL=http://localhost:8734 bun run scripts/probe/as-view-params.ts
import fs from 'node:fs'
import path from 'node:path'
import { EthereumSigner } from '@dha-team/arbundles'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from '../util/hb-client'

const HB_URL = process.env.HB_URL || 'http://localhost:8734'
const KEY = process.env.DEPLOYER_PRIVATE_KEY
  || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37'
const AO = path.resolve(import.meta.dir, '../..')

// Preloaded exactly as native-bundle.ts does — finding 4 is why this is not optional.
const JSON_LUA = fs.readFileSync(path.join(AO, 'runtime/vendor/json.lua'), 'utf8')

const SRC = `
package.loaded['json'] = (function()
${JSON_LUA}
end)()
function compute(base, req, opts)
  Reg = Reg or { verified = { AAA = '0xaa', BBB = '0xbb' }, hardware = { AAA = true } }
  Hits = (Hits or 0) + 1
  base.results = { output = { body = tostring(Hits) } }
  return base
end
-- The shape native.installViews generates.
local function wrap(t)
  return { body = require('json').encode(t or {}), ['content-type'] = 'application/json' }
end
function one(base, req)
  local a = (type(req) == 'table') and req.address or nil
  return wrap({ address = a or 'NO-PARAM', value = (a and Reg.verified[a]) or 'MISS' })
end
function dump(base, req) return wrap(Reg) end
-- Deliberately unwrapped, to show the +link shape the wrapper exists to avoid.
function raw(base, req) return { verified = Reg.verified, hardware = Reg.hardware } end
-- Deliberately un-preloaded module, to show finding 4 as a 500 rather than folklore.
function badrequire(base, req) return wrap({ x = require('.common.utils') ~= nil }) end
`

async function get (pid: string, p: string) {
  const t0 = performance.now()
  const res = await fetch(`${HB_URL}/${pid}~process@1.0/${p}`,
    { headers: { accept: 'application/json' } })
  const ms = performance.now() - t0
  let body = await res.text()
  try { const j = JSON.parse(body); delete j.commitments; body = JSON.stringify(j) } catch { /* raw */ }
  return { status: res.status, ms, body: body.replace(/\s+/g, ' ').slice(0, 220) }
}

;(async () => {
  const config = { url: HB_URL, signer: new EthereumSigner(KEY.replace(/^0x/, '')) }
  console.log(`node ${HB_URL} (${await fetchNodeAddress(HB_URL)})\n`)
  const { pid } = await spawnLuaProcess(config, {
    luaSource: SRC, tags: [{ name: 'name', value: `as-view-params-${Date.now()}` }],
  })
  await sendMessage(config, { pid, tags: [{ name: 'action', value: 'Tick' }], data: '' })

  const cases: Array<[string, string]> = [
    ['as/one?address=AAA', '1. query param via ? — expect value 0xaa'],
    ['as/one&address=AAA', '1. query param via & — works bare'],
    ['as/one/serialize~json@1.0&address=AAA', '1. & + device suffix — param LOST, still 200'],
    ['as/one', '1. no param — expect NO-PARAM, not an error'],
    ['as/dump', '3. wrapper on a nested table — expect inlined JSON'],
    ['as/dump/verified/AAA', '2. path segment into a WRAPPED view — expect 404 (body is a string)'],
    ['as/raw/verified/AAA', '2. path segment into a RAW view — works'],
    ['as/raw', '5. unwrapped nested table — expect +link children'],
    ['as/badrequire', '4. require of a non-preloaded module — expect 500'],
  ]
  for (const [p, why] of cases) {
    const r = await get(pid, p)
    console.log(`${String(r.status).padEnd(4)} ${r.ms.toFixed(0).padStart(5)}ms  ${p}`)
    console.log(`      ${why}`)
    console.log(`      ${r.body}\n`)
  }
})()
