// Cross-process reads at REALISTIC registry size — the p4 gate's hot path.
//
// The gate design has a `p4@1.0` ledger device answer "may this address write?" by reading the
// contracts' own state, rather than maintaining a synced union allow-list that can drift. Two
// things had to be measured before relying on it:
//
//   1. COST at real size. The first spike used toy processes (~19 ms/read). The live registry
//      carries ~1 MB of state (7,932 verified / 2,940 claimable), and this read sits on the hot
//      path of every write, so the number that matters is the one against a real seed.
//
//   2. BACKLOG COUPLING. `now/...` means COMPUTE-TO-LATEST, so a gate read against a busy contract
//      can block behind that contract's own queued messages — the gate inheriting a backlog it has
//      nothing to do with. `dev_process:compute/3` reads `slot` (or `compute`) off the request and
//      serves `dev_process_cache:read(ProcID, Slot)`; with NO slot it falls back to `now` with
//      `process-now-from-cache => true`, i.e. latest KNOWN state without computing forward.
//      This probe checks whether that actually decouples it.
//
// Method: a gate process does exactly ONE cross-process read per message, so the push round-trip
// minus a no-op baseline is the read cost. Several path forms are tried because the working
// `ao.resolve` syntax is not documented — the toy spike found three that work and one that
// silently returns the process message instead of the value.
//
// Env: HB_URL, CONTAINER (to publish the registry module), SLOT (optional, pin target)
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'node:child_process'
import { EthereumSigner } from '@dha-team/arbundles'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from '../util/hb-client'
import { seedEnvelopeFor } from '../util/native-bundle'
import { requireDeployerKey } from '../util/helpers'

const HB_URL = process.env.HB_URL || 'http://localhost:8734'
const CONTAINER = process.env.CONTAINER || 'hb-spike'
const AO = path.resolve(import.meta.dir, '../..')
const signer = new EthereumSigner(requireDeployerKey())
const cfg = { url: HB_URL, signer }
const sleep = (n: number) => new Promise(r => setTimeout(r, n))

function publish (rel: string, label: string): string {
  const abs = path.join(AO, rel)
  if (!fs.existsSync(abs)) throw new Error(`missing ${rel} — run scripts/run-e2e.ts to build dist/`)
  execFileSync('podman', ['cp', abs, `${CONTAINER}:/tmp/${label}.lua`], { timeout: 300_000 })
  const erl = `{ok,S}=file:read_file("/tmp/${label}.lua"), M=hb_message:commit(#{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>, <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>, <<"name">> => <<"${label}">>, <<"body">> => S }, #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), {ok,_}=hb_cache:write(M,#{}), ok=file:write_file("/tmp/${label}.id", hb_util:id(M)).`
  execFileSync('podman', ['exec', CONTAINER, './bin/hb', 'eval', erl], { encoding: 'utf8', timeout: 600_000 })
  const id = execFileSync('podman', ['exec', CONTAINER, 'cat', `/tmp/${label}.id`], { encoding: 'utf8', timeout: 60_000 }).trim()
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error(`bad module id: ${id.slice(0, 60)}`)
  return id
}

// The gate. One resolve per action so the round-trip IS the read cost.
const GATE = (target: string, fp: string, pin: string) => `
local TARGET = '${target}'
local FP = '${fp}'
local PIN = '${pin}'   -- validated integer, baked in: see the warning below

local function one(p)
  local ok, status, value = pcall(function() return ao.resolve(p) end)
  if not ok then return 'pcall-ERR ' .. string.sub(tostring(status), 1, 60) end
  return 'status=' .. tostring(status) .. ' type=' .. type(value)
    .. ' v=' .. string.sub(tostring(value), 1, 44)
end

function compute(process, message, opts)
  local body = message and message.body or {}
  local a = body.action
  if a == 'Noop' then
    process.last = 'noop'
  elseif a == 'ReadNow' then
    process.last = one(TARGET .. '~process@1.0/now/state/verified/' .. FP)
  elseif a == 'ReadCompute' then
    process.last = one(TARGET .. '~process@1.0/compute/state/verified/' .. FP)
  elseif a == 'ReadSlot' then
    process.last = one(TARGET .. '~process@1.0/compute&slot=' .. tostring(body.slot)
      .. '/state/verified/' .. FP)
  elseif a == 'ReadMiss' then
    process.last = one(TARGET .. '~process@1.0/now/state/verified/'
      .. '0000000000000000000000000000000000000000')
  end
  process.results = { output = { data = tostring(process.last) } }
  return process
end`

const timed = async (pid: string, action: string, extra: Record<string, string> = {}) => {
  const t0 = Date.now()
  await sendMessage(cfg, { pid, tags: [
    { name: 'action', value: action },
    ...Object.entries(extra).map(([name, value]) => ({ name, value })) ] })
  const ms = Date.now() - t0
  const v = await (await fetch(`${HB_URL}/${pid}~process@1.0/now/last`)).text()
  return { ms, v: v.trim().slice(0, 60) }
}

;(async () => {
  console.log(`\n=== cross-process gate read, REAL registry ===`)
  const schedulerLocation = await fetchNodeAddress(HB_URL)

  const modId = publish('dist/operator-registry-native.lua', 'xproc-opreg')
  const { pid: reg } = await spawnLuaProcess(cfg, {
    moduleId: modId, schedulerLocation, spawnData: seedEnvelopeFor('operator-registry'),
    tags: [{ name: 'name', value: 'xproc-registry' }] })
  console.log(`  registry ${reg}`)

  let counts = null
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${HB_URL}/${reg}~process@1.0/as/status`)
    if (r.ok) { counts = JSON.parse(await r.text()).counts; break }
    await sleep(2000)
  }
  if (!counts) { console.log('  registry never seeded'); process.exit(2) }
  console.log(`  seeded  ${JSON.stringify(counts)}`)

  // a real verified fingerprint to look up
  const scoring = await (await fetch(`${HB_URL}/${reg}~process@1.0/as/scoring`)).text()
  const fp = (scoring.match(/"([A-F0-9]{40})"/) || [])[1]
  if (!fp) { console.log('  no verified fingerprint found'); process.exit(2) }
  console.log(`  lookup  verified/${fp}`)

  // /slot returns the hyperbuddy HTML explorer; the number lives at /slot/current. Scraping
  // /slot with a digit regex silently yields a stray digit from the HTML.
  const slot = (await (await fetch(`${HB_URL}/${reg}~process@1.0/slot/current`)).text()).trim()
  if (!/^\d+$/.test(slot)) { console.log(`  bad slot: ${JSON.stringify(slot)}`); process.exit(2) }
  console.log(`  registry slot ${slot}`)

  const { pid: gate } = await spawnLuaProcess(cfg, {
    luaSource: GATE(reg, fp, slot), tags: [{ name: 'name', value: 'xproc-gate' }] })
  console.log(`  gate     ${gate}\n`)
  await sleep(3000)

  const base = await timed(gate, 'Noop')
  console.log(`  ${'noop (baseline)'.padEnd(22)} ${String(base.ms).padStart(6)} ms`)
  for (const [label, action, extra] of [
    ['now  (compute-to-latest)', 'ReadNow', {}],
    ['compute (from cache)', 'ReadCompute', {}],
    [`compute&slot=${slot}`, 'ReadSlot', {}],
    ['now, MISSING key', 'ReadMiss', {}],
  ] as const) {
    const r = await timed(gate, action, extra as Record<string, string>)
    console.log(`  ${label.padEnd(22)} ${String(r.ms).padStart(6)} ms  (net ${String(r.ms - base.ms).padStart(5)})  ${r.v}`)
  }
  // --- the coupling test -----------------------------------------------------------------
  // Queue writes on the REGISTRY without waiting for them, then immediately read from the gate.
  // `now` means compute-to-latest, so it should have to chew through the backlog first;
  // `compute` serves the latest CACHED state and should not.
  console.log(`\n  --- with a backlog queued on the registry ---`)
  const admin = (async () => {
    for (let i = 0; i < 6; i++) {
      sendMessage(cfg, { pid: reg, tags: [
        { name: 'action', value: 'Admin-Submit-Operator-Certificates' } ],
        data: JSON.stringify([{ f: 'FADE' + i.toString(16).toUpperCase().padStart(36, '0'),
                                a: '0x' + 'a'.repeat(40) }]) }).catch(() => {})
    }
  })()
  await admin
  await sleep(250)   // let them land in the schedule, not finish computing

  for (const [label, action] of [
    ['now  (compute-to-latest)', 'ReadNow'],
    ['compute (from cache)', 'ReadCompute'],
  ] as const) {
    const r = await timed(gate, action)
    console.log(`  ${label.padEnd(22)} ${String(r.ms).padStart(6)} ms  (net ${String(r.ms - base.ms).padStart(5)})`)
  }

  console.log(`\n  net = minus the no-op baseline, i.e. the cross-process read itself.`)
})()
