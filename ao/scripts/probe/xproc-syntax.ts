// Which `ao.resolve` forms actually work for a CROSS-PROCESS read? (syntax reference)
//
// The working syntax is not documented anywhere we have, and the failure modes are nasty: one form
// silently returns the process message instead of the value, and a malformed path raises an ERLANG
// badarg that `pcall` cannot catch -- it escapes compute and WEDGES the process permanently.
// So: establish the syntax here on throwaway processes, never by trial-and-error on a real one.
//
// Companion: scripts/probe/xproc-gate.ts measures the COST at realistic registry size, and shows
// why the gate must read `compute` rather than `now`.
//
// SPIKE: can one lua@5.3a process READ another process's state during compute?
//
// Why it matters: the p4 gate needs an allow-set that is the UNION of every contract's ACL
// holders plus the operator set. If a process (or a lua ledger device) can resolve another
// process's state directly, there is no union to maintain and nothing to drift.
//
// Tries several `ao.resolve` shapes because the working form is not documented anywhere we have,
// and records what each returns. B holds a known marker; A tries to read it.
import { EthereumSigner } from '@dha-team/arbundles'
import { spawnLuaProcess, sendMessage } from '../util/hb-client'
import { requireDeployerKey } from '../util/helpers'

const HB = process.env.HB_URL || 'http://localhost:8734'
const signer = new EthereumSigner(requireDeployerKey())
const cfg = { url: HB, signer }
const sleep = (n: number) => new Promise(r => setTimeout(r, n))

// --- B: the "other contract". Holds a roles-shaped map we want to read from A. -------------
const B_SRC = `
function compute(process, message, opts)
  if not process.state then
    process.state = { marker = 'HELLO-FROM-B', roles = { ['0xAAA'] = 'admin' } }
  end
  process.results = { output = { data = 'b-ok' } }
  return process
end`

// --- A: tries to read B's state several ways. ----------------------------------------------
const A_SRC = (pidB: string) => `
local PID_B = '${pidB}'

local function try(label, fn)
  local ok, a, b = pcall(fn)
  local status = tostring(a)
  local val = b
  if not ok then return label .. ' | pcall-ERR: ' .. string.sub(tostring(a), 1, 70) end
  return label .. ' | status=' .. status .. ' type=' .. type(val)
    .. ' v=' .. string.sub(tostring(val), 1, 60)
end

function compute(process, message, opts)
  local body = message and message.body or {}
  if body.action == 'Probe' then
    local out = {}
    out['1-as-process-tbl'] = try('as process@1.0 + {path}', function()
      return ao.resolve({ 'as', 'process@1.0', PID_B }, { path = 'now/state/marker' })
    end)
    out['2-as-process-str'] = try('as process@1.0 + str', function()
      return ao.resolve({ 'as', 'process@1.0', PID_B }, 'now/state/marker')
    end)
    out['3-path-string'] = try('bare path string', function()
      return ao.resolve(PID_B .. '~process@1.0/now/state/marker')
    end)
    out['4-path-field'] = try('msg with path field', function()
      return ao.resolve({ path = '/' .. PID_B .. '~process@1.0/now/state/marker' })
    end)
    out['5-nested-map'] = try('read a nested map', function()
      return ao.resolve({ 'as', 'process@1.0', PID_B }, { path = 'now/state/roles/0xAAA' })
    end)
    process.probe = out
    process.results = { output = { data = 'probed' } }
    return process
  end
  process.results = { output = { data = 'noop' } }
  return process
end`

;(async () => {
  console.log('\n=== SPIKE: cross-process read from inside compute ===')

  const { pid: pidB } = await spawnLuaProcess(cfg, {
    luaSource: B_SRC, tags: [{ name: 'name', value: 'xproc-B' }] })
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${HB}/${pidB}~process@1.0/now/state/marker`)
    if (r.ok) { console.log(`  B ${pidB}  marker=${(await r.text()).trim()}`); break }
    await sleep(1500)
  }

  const { pid: pidA } = await spawnLuaProcess(cfg, {
    luaSource: A_SRC(pidB), tags: [{ name: 'name', value: 'xproc-A' }] })
  console.log(`  A ${pidA}`)
  await sleep(3000)

  const t0 = Date.now()
  await sendMessage(cfg, { pid: pidA, tags: [{ name: 'action', value: 'Probe' }] })
  console.log(`  probe compute took ${Date.now() - t0} ms\n`)

  const r = await fetch(`${HB}/${pidA}~process@1.0/now/probe/serialize~json@1.0`)
  const j = await r.json().catch(() => null)
  if (!j) { console.log('  could not read probe results:', (await r.text()).slice(0, 200)); return }
  for (const k of Object.keys(j).sort()) {
    if (k === 'device' || k === 'commitments') continue
    console.log(`  ${j[k]}`)
  }
})()
