// READ-path calibration against a LIVE node, over real HTTP — the production
// path, not a reconstructed eunit dispatch.
//
// Compares the three candidate state shapes (D31) on the read side:
//   base    -- state on the message. Point-addressable at now/state/<k>.
//   globals -- state in a Lua global. Views only.
//   trie    -- node-side trie, global holds only the id.
//
// Measures, per shape:
//   view-one   point-lookup view  ->  as/one     (the dashboard case)
//   view-dump  whole-state view   ->  as/dump    (seed-diff case)
//   point      base-addressed     ->  now/state/verified/<fp>
//
// Every read asserts on the RESPONSE, not just that it did not throw: a fast
// 404 timed as a fast success is exactly how the eunit version of this probe
// produced three different operations all costing 0.49 ms.
//
// Run: HB_URL=http://localhost:8734 bun run scripts/probe/read-path-calibration.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from '../util/hb-client'

/** Like hb-client's readState but asks for JSON: without an Accept header the
 *  node renders via hyperbuddy and you measure HTML generation, not the read. */
async function read (url: string, pid: string, key: string): Promise<string> {
  const path = key.startsWith('AS:') ? key.slice(3) : `now/${key}`
  const res = await fetch(`${url}/${pid}~process@1.0/${path}`, {
    headers: { accept: 'application/json' },
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`${res.status}: ${body.replace(/\s+/g, ' ').slice(0, 160)}`)
  return body
}

const HB_URL = process.env.HB_URL || 'http://localhost:8734'
const KEY = process.env.DEPLOYER_PRIVATE_KEY
  || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37'
const VERIFIED = Number(process.env.VERIFIED || 7932)
const CLAIMABLE = Number(process.env.CLAIMABLE || 2940)
const SLOTS = Number(process.env.SLOTS || 20)
const REPS = Number(process.env.REPS || 7)

const PAD = `
local function pad(i)
  local s = tostring(i)
  return string.rep('0', 40 - #s) .. s
end
`

const BASE = `${PAD}
function compute(base, req, opts)
  if base.state == nil then
    local st = { verified = {}, claimable = {}, n = 0 }
    for i = 1, ${VERIFIED} do st.verified[pad(i)] = '0x' .. pad(i) end
    for i = 1, ${CLAIMABLE} do st.claimable[pad(100000 + i)] = '0x' .. pad(i) end
    base.state = st
  end
  base.state.n = base.state.n + 1
  base.state.verified[pad(300000 + base.state.n)] = '0x' .. pad(base.state.n)
  base.results = { output = { body = tostring(base.state.n) } }
  return base
end
function one(base, req, opts) return { v = base.state.verified[pad(4000)] } end
function dump(base, req, opts) return base.state end
`

const GLOBALS = `${PAD}
function compute(base, req, opts)
  if OperatorRegistry == nil then
    OperatorRegistry = { verified = {}, claimable = {}, n = 0 }
    for i = 1, ${VERIFIED} do OperatorRegistry.verified[pad(i)] = '0x' .. pad(i) end
    for i = 1, ${CLAIMABLE} do OperatorRegistry.claimable[pad(100000 + i)] = '0x' .. pad(i) end
  end
  OperatorRegistry.n = OperatorRegistry.n + 1
  OperatorRegistry.verified[pad(300000 + OperatorRegistry.n)] = '0x' .. pad(OperatorRegistry.n)
  base.results = { output = { body = tostring(OperatorRegistry.n) } }
  return base
end
function one(base, req, opts)
  if OperatorRegistry == nil then return { v = 'NIL-GLOBAL' } end
  return { v = OperatorRegistry.verified[pad(4000)] or 'MISS' }
end
function dump(base, req, opts) return { v = (OperatorRegistry and 'HAVE') or 'NIL-GLOBAL' } end
`

const TRIE = `${PAD}
local function idOf(res)
  if type(res) ~= 'table' then return nil end
  if type(res.commitments) ~= 'table' then return nil end
  for k, _ in pairs(res.commitments) do return k end
  return nil
end
function compute(base, req, opts)
  if base.verifiedId == nil then
    local vb = { path = 'set' }
    for i = 1, ${VERIFIED} do vb[pad(i)] = '0x' .. pad(i) end
    local _, vres = ao.resolve({ device = 'trie@1.0' }, vb)
    base.verifiedId = idOf(vres)
    base.n = 0
  end
  base.n = base.n + 1
  local _, r = ao.resolve(
    { 'as', 'trie@1.0', base.verifiedId },
    { path = 'set', [pad(300000 + base.n)] = '0x' })
  base.verifiedId = idOf(r) or base.verifiedId
  base.results = { output = { body = tostring(base.n) } }
  return base
end
function one(base, req, opts)
  local _, v = ao.resolve(
    { 'as', 'trie@1.0', base.verifiedId },
    { path = 'get', key = pad(4000) })
  return { v = tostring(v) }
end
function dump(base, req, opts) return { v = base.verifiedId } end
`

const pad40 = (n: number) => String(n).padStart(40, '0')

type Timing = { ms: number | null, note: string }

/** Median of REPS reads. Records WHAT came back, so a 404 cannot look like a win. */
async function timeRead (
  config: any, pid: string, key: string
): Promise<Timing> {
  const samples: number[] = []
  let note = ''
  for (let i = 0; i < REPS; i++) {
    const t0 = performance.now()
    try {
      const body = await read(config.url, pid, key)
      const dt = performance.now() - t0
      samples.push(dt)
      if (!note) {
        const g = body.match(/"v":"([^"]{0,24})"/)
        note = g ? `ok v=${g[1]}` : `ok ${body.length}B`
      }
    } catch (e: any) {
      if (!note) note = `ERR ${String(e.message).slice(0, 150)}`
    }
  }
  if (!samples.length) return { ms: null, note }
  samples.sort((a, b) => a - b)
  return { ms: samples[Math.floor(samples.length / 2)], note }
}

const fmt = (t: Timing) =>
  (t.ms === null ? 'n/a' : t.ms.toFixed(2).padStart(8)) + `  ${t.note}`

;(async () => {
  const config = { url: HB_URL, signer: new EthereumSigner(KEY.replace(/^0x/, '')) }
  console.log(`node: ${HB_URL} (${await fetchNodeAddress(HB_URL)})`)
  console.log(`seed: ${VERIFIED} verified + ${CLAIMABLE} claimable, ${SLOTS} slots, median of ${REPS}\n`)

  const arms: Array<[string, string]> = [
    ['base', BASE], ['globals', GLOBALS], ['trie', TRIE],
  ]
  const rows: string[] = []

  for (const [arm, src] of arms) {
    process.stdout.write(`${arm}: spawning... `)
    const { pid } = await spawnLuaProcess(config, {
      luaSource: src,
      tags: [{ name: 'name', value: `readcal-${arm}-${Date.now()}` }],
    })
    process.stdout.write(`pid=${pid.slice(0, 8)} sending ${SLOTS}... `)
    for (let i = 0; i < SLOTS; i++) {
      await sendMessage(config, { pid, tags: [{ name: 'action', value: 'Tick' }], data: '' })
    }
    // Force a snapshot: idle past process_snapshot_time (60s), then one more
    // message. Under globals the read path can ONLY see state via a restored
    // snapshot, so without this the views observe an empty VM.
    if (process.env.FORCE_SNAPSHOT === '1') {
      process.stdout.write('idle 65s for snapshot... ')
      await new Promise(r => setTimeout(r, 65000))
      await sendMessage(config, { pid, tags: [{ name: 'action', value: 'Tick' }], data: '' })
    }
    // Confirm the chain actually computed before timing anything.
    let n = 'ERR'
    try { n = await read(config.url, pid, 'results/output/body') } catch (e: any) { n = `ERR ${e.message?.slice(0, 40)}` }
    process.stdout.write(`n=${n.trim()}\n`)

    const one = await timeRead(config, pid, 'AS:as/one')
    const dump = await timeRead(config, pid, 'AS:as/dump')
    const point = arm === 'trie'
      ? await timeRead(config, pid, `verifiedId/~trie@1.0/${pad40(4000)}`)
      : await timeRead(config, pid, `state/verified/${pad40(4000)}`)

    rows.push(`${arm.padEnd(8)} | ${fmt(one)} | ${fmt(dump)} | ${fmt(point)}`)
    console.log(`  view-one  ${fmt(one)}`)
    console.log(`  view-dump ${fmt(dump)}`)
    console.log(`  point     ${fmt(point)}\n`)
  }

  console.log('arm      | view-one ms          | view-dump ms         | point ms')
  console.log(rows.join('\n'))
})()
