// Probe: can a HANDLER declare the content-type of its own output, the way a VIEW can?
//
// Context: `as/last_snapshot?redirect=true` 302s to `compute&slot=N/results/output/data`,
// and that target is served `text/plain; charset=utf-8` because native.lua returns a bare
// `{ data = <json string> }` with nothing to derive a type from (native.lua:880).
//
// `?accept=application/json` is NOT the answer — the node re-encodes into an AO envelope
// ({ao-result, body, commitments, status}) with the payload as an escaped string inside
// `body`: 14% larger and two parses to read.
//
// The open question this settles: `/results/output/data` selects a LEAF BINARY, so it is not
// obvious that a content-type set on the surrounding output MESSAGE reaches the response at
// all. Answering it decides whether the runtime change is worth putting in the next batch.
//
// Run: HB_URL=https://hb-dev.anyone.tech bun run scripts/probe/output-content-type.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from '../util/hb-client'

const HB_URL = process.env.HB_URL || 'https://hb-dev.anyone.tech'
const KEY = process.env.DEPLOYER_PRIVATE_KEY
if (!KEY) throw new Error('DEPLOYER_PRIVATE_KEY is required (use ao/.env — the hardcoded dev key in lua-smoke.ts is NOT allow-listed on hb-dev)')

// Each action returns a different output shape. `case` selects it; everything else is fixed
// so the ONLY variable between reads is the shape of `process.results.output`.
const LUA = `
local PAYLOAD = '{"probe":"value","n":1}'

-- Mirrors the SHAPE of a real round: a Details map keyed by 40-char hex fingerprints, with
-- the float multipliers and the bint-as-string rewards that the reward math actually emits.
local FP1 = '01DFBD67E3B3F1F04D674B0F78D5F67F6FE49D70'
local FP2 = 'AB12CD34EF56AB78CD90EF12AB34CD56EF7890AB'

local function relay(n)
  return {
    Address = '0x5f57d2664E9AC6c724623ABA4BAcf3cD43a4c31B',
    Rating = { Network = 1199, Uptime = 0.0, ExitBonus = 0, IsHardware = true },
    Reward = { Network = '6367189298323377', Total = '17111471074662800' },
    Variables = { FamilyMultiplier = 1.0, LocationMultiplier = 0.99999750000000 },
    Score = { Network = 1200, LocationSize = n, UptimeStreak = 1 },
  }
end

function compute(process, message, opts)
  -- Tags arrive under the body table, NOT at the top level of the message. The top level
  -- carries only the assignment envelope (base-hashpath, block-*, epoch, path, process, slot,
  -- timestamp, type, variant, commitments). native.lua reads body.data for the same reason.
  -- MUST type-check: the node also runs compute during PRICE ESTIMATION, where body is not
  -- necessarily a table. Indexing it unguarded throws, and the failure surfaces as a 400 on
  -- POST /push ("could not estimate price"), nowhere near the real cause.
  local b = type(message['body']) == 'table' and message['body'] or {}
  local case = b['case'] or b['Case'] or message['case']

  -- NO silent fallback: if the tag did not arrive, SAY SO and dump what the handler can see.
  -- (A default of 'bare' made every case look identical and hid the plumbing failure.)
  if case == nil then
    local ks = {}
    for k, v in pairs(message) do ks[#ks + 1] = tostring(k) .. '=' .. type(v) end
    table.sort(ks)
    process.results = { output = { data = 'NO-CASE-TAG KEYS: ' .. table.concat(ks, ',') } }
    return process
  end

  if case == 'bare' then
    -- what native.lua does today
    process.results = { output = { data = PAYLOAD } }
  elseif case == 'data-ct' then
    process.results = { output = { data = PAYLOAD, ['content-type'] = 'application/json' } }
  elseif case == 'body-ct' then
    process.results = { output = { body = PAYLOAD, ['content-type'] = 'application/json' } }
  elseif case == 'body-bare' then
    process.results = { output = { body = PAYLOAD } }
  elseif case == 'table' then
    -- THE HYPOTHESIS: hand the node a real Lua table instead of an encoded string, so it
    -- serializes natively and (maybe) base-addresses + types itself.
    process.results = { output = { data = {
      Timestamp = 1786597701240,
      Slot = 120,
      Period = 900,
      Details = { [FP1] = relay(1), [FP2] = relay(2) },
    } } }
  elseif case == 'table-top' then
    -- same, but the round IS the output message (no data wrapper)
    process.results = { output = {
      Timestamp = 1786597701240,
      Slot = 120,
      Period = 900,
      Details = { [FP1] = relay(1), [FP2] = relay(2) },
    } }
  else
    -- CATCH-ALL. Leaving process.results unset makes POST /push 400 rather than failing at
    -- compute, because the node evaluates the process to price the message.
    process.results = { output = { data = 'unhandled case: ' .. tostring(case) } }
  end

  return process
end
`

type Probe = { label: string; slot: number; path: string }

async function head(pid: string, slot: number, leaf: string) {
  const url = `${HB_URL}/${pid}~process@1.0/compute&slot=${slot}/results/output${leaf}`
  const res = await fetch(url)
  const body = await res.text()
  return {
    status: res.status,
    ct: res.headers.get('content-type') || '(none)',
    bytes: body.length,
    head: body.replace(/\s+/g, ' ').slice(0, 260),
  }
}

;(async () => {
  const config = { url: HB_URL, signer: new EthereumSigner(KEY.replace(/^0x/, '')) }
  console.log(`node: ${HB_URL} (${await fetchNodeAddress(HB_URL)})\n`)

  const { pid } = await spawnLuaProcess(config, {
    luaSource: LUA,
    tags: [{ name: 'name', value: `output-ct-${Date.now()}` }],
  })
  console.log(`pid = ${pid}\n`)

  const cases = ['keys', 'bare', 'data-ct', 'body-ct', 'body-bare', 'table', 'table-top']
  const probes: Probe[] = []

  for (const c of cases) {
    const msg = await sendMessage(config, { pid, tags: [{ name: 'case', value: c }], data: '' })
    probes.push({ label: c, slot: msg.slot, path: c.startsWith('body') ? '/body' : '/data' })
    console.log(`sent case=${c} -> slot ${msg.slot}`)
  }

  console.log('\n=== content-type on the LEAF (results/output/{data,body}) ===')
  for (const p of probes) {
    const r = await head(pid, p.slot, p.path)
    console.log(`  ${p.label.padEnd(10)} ${p.path.padEnd(6)} ${String(r.status).padEnd(4)} ${r.ct.padEnd(32)} ${r.bytes}B  ${r.head}`)
  }

  console.log('\n=== content-type on the PARENT (results/output) ===')
  for (const p of probes) {
    const r = await head(pid, p.slot, '')
    console.log(`  ${p.label.padEnd(10)} ${''.padEnd(6)} ${String(r.status).padEnd(4)} ${r.ct.padEnd(32)} ${r.bytes}B  ${r.head}`)
  }

  // ---- the two questions that actually decide whether a table output is usable ----
  const tbl = probes.find(p => p.label === 'table')!
  const top = probes.find(p => p.label === 'table-top')!
  const FP = '01DFBD67E3B3F1F04D674B0F78D5F67F6FE49D70'

  console.log('\n=== 1. does ?accept=application/json flatten a TABLE output? ===')
  for (const [label, p] of [['table', tbl], ['table-top', top]] as const) {
    for (const leaf of ['/data', '']) {
      if (label === 'table-top' && leaf === '/data') continue
      const url = `${HB_URL}/${pid}~process@1.0/compute&slot=${p.slot}/results/output${leaf}?accept=application/json`
      const res = await fetch(url)
      const body = await res.text()
      console.log(`  ${label}${leaf || ' (parent)'} -> ${res.status} ${res.headers.get('content-type')} ${body.length}B`)
      console.log(`     ${body.replace(/\s+/g, ' ').slice(0, 240)}`)
    }
  }

  console.log('\n=== 2. is a TABLE output BASE-ADDRESSABLE? (D29 §2b said no, for a string) ===')
  const paths = [
    `/data/Slot`,
    `/data/Details/${FP}/Address`,
    `/data/Details/${FP}/Variables/LocationMultiplier`,
    `/data/Details/${FP}`,
  ]
  for (const path of paths) {
    const url = `${HB_URL}/${pid}~process@1.0/compute&slot=${tbl.slot}/results/output${path}`
    const res = await fetch(url)
    const body = await res.text()
    console.log(`  ${path.padEnd(58)} ${res.status} ${(res.headers.get('content-type') || '').padEnd(26)} ${body.replace(/\s+/g, ' ').slice(0, 60)}`)
  }

  console.log('\n  float fidelity check — LocationMultiplier was written as 0.99999750000000')
})()
