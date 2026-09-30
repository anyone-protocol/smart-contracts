// Does a `~trie@1.0` point lookup stay cheap at OPERATOR-SET scale?
//
// The gate design (see docs / third-party write DoS work) puts an address-keyed operator index
// behind p4 as a whitelist: every chargeable write costs one trie read before it is admitted. That
// read is on the hot path of every write, so its cost at realistic key count is the number the
// whole design rests on.
//
// The earlier measurement used examples/trie-by-id.lua at 1,000 keys and gave 114 ms via the
// process and 38 ms direct-by-id, against 154 ms for a flat base-addressed read on the real ~1 MB
// registry. But 1,000 is not the operator set (the live seed carries 7,932 verified / 2,940
// claimable), and "radix lookup is O(key length), not O(n)" was reasoning rather than data. This
// probe turns it into data.
//
// Keys are shaped like the real thing: `0x` + 40 hex. The shared `0x` prefix matters — a radix
// trie path-compresses it, so using bare hex would flatter the result.
//
// Measures, per key count:
//   seed        build time for the whole trie (batched inserts)
//   hit / miss  point-lookup latency through the process, ONE request
//   by-id       point-lookup when the trie id is already known
//   update      cost of changing ONE key — the controller's onionoo-cadence path
//
// Usage:
//   HB_URL=http://localhost:8734 N=8000 bun run scripts/probe/trie-scale.ts
//   N=1000,8000,20000 bun run scripts/probe/trie-scale.ts     # sweep
import { EthereumSigner } from '@dha-team/arbundles'
import { spawnLuaProcess, sendMessage, fetchNodeAddress } from '../util/hb-client'
import { requireDeployerKey } from '../util/helpers'

const HB_URL = process.env.HB_URL || 'http://localhost:8734'
const COUNTS = (process.env.N || '1000,8000,20000').split(',').map(s => Number(s.trim()))
const BATCH = Number(process.env.BATCH || 500)

const KEY = requireDeployerKey()
const signer = new EthereumSigner(KEY)
const config = { url: HB_URL, signer }

// Deterministic, address-shaped keys. Mirrors examples/trie-by-id.lua's generator so results stay
// comparable, but prefixed `0x` and widened to a full 40 hex chars like a real EIP-55 address.
const addrOf = (i: number) =>
  '0x' + ((i % 256).toString(16).toUpperCase().padStart(2, '0')
    + ((i * 2654435761) % 0x100000000).toString(16).toUpperCase().padStart(38, '0')).slice(0, 40)

// NB: no backticks anywhere in this Lua — it is embedded in a JS template literal.
const contract = (n: number) => `
local INIT = ${n}
local BATCH = ${BATCH}

local function idOf(msg)
  if type(msg) ~= 'table' or type(msg.commitments) ~= 'table' then return nil end
  for id in pairs(msg.commitments) do return id end
  return nil
end

local function trieSet(id, kvs)
  local ok, status, result
  if id == nil then
    local base = { device = 'trie@1.0', path = 'set' }
    for k, v in pairs(kvs) do base[k] = v end
    ok, status, result = pcall(function() return ao.resolve(base) end)
  else
    local req = { path = 'set' }
    for k, v in pairs(kvs) do req[k] = v end
    ok, status, result = pcall(function()
      return ao.resolve({ 'as', 'trie@1.0', id }, req)
    end)
  end
  if not ok then return nil, 'pcall:' .. tostring(status) end
  local newId = idOf(result)
  if newId == nil then return nil, 'no id (status=' .. tostring(status) .. ')' end
  return newId, tostring(status)
end

local function addrOf(i)
  local hex = string.format('%02X', i % 256)
    .. string.sub(string.format('%038X', (i * 2654435761) % 0x100000000), 1, 38)
  return '0x' .. string.sub(hex, 1, 40)
end

local function seed()
  local id, i = nil, 1
  while i <= INIT do
    local kvs = {}
    local last = math.min(i + BATCH - 1, INIT)
    for j = i, last do kvs[addrOf(j)] = 'true' end
    local newId, err = trieSet(id, kvs)
    if newId == nil then return nil, 'batch ' .. i .. ': ' .. tostring(err) end
    id = newId
    i = last + 1
  end
  return id
end

function compute(process, message, opts)
  if not process.operatorsId then
    local id, err = seed()
    if id == nil then
      process.error = err
      process.results = { output = { body = 'SEED FAILED: ' .. tostring(err) } }
      return process
    end
    process.operatorsId = id
    process.count = INIT
  end

  local body = message and message.body or {}
  local action = body.action
  if action == 'Set-Operator-Composed' then
    -- Try to get the NEW trie id WITHOUT the trie ever crossing into Lua, by composing the path
    -- so AO-Core re-devices the set result as a message and resolves its id server-side.
    local ok, status, result = pcall(function()
      return ao.resolve({ 'as', 'trie@1.0', process.operatorsId },
        { path = 'set/id', [tostring(body.addr)] = 'true' })
    end)
    if not ok then
      process.results = { output = { body = 'COMPOSED pcall:' .. tostring(status) } }
      return process
    end
    if type(result) ~= 'string' or #result ~= 43 then
      process.results = { output = { body = 'COMPOSED non-id: status=' .. tostring(status)
        .. ' type=' .. type(result) .. ' val=' .. string.sub(tostring(result), 1, 60) } }
      return process
    end
    process.operatorsId = result
    process.results = { output = { body = 'ok:' .. result } }
    return process
  end

  if action == 'Set-Operator' then
    -- The controller's cadence path: add/flip exactly ONE key.
    local newId, err = trieSet(process.operatorsId, { [tostring(body.addr)] = 'true' })
    if newId == nil then
      process.results = { output = { body = 'SET FAILED: ' .. tostring(err) } }
      return process
    end
    process.operatorsId = newId
    process.results = { output = { body = 'ok' } }
    return process
  end

  process.results = { output = { body = 'noop' } }
  return process
end
`

const ms = async (url: string, n = 5) => {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t0 = Date.now()
    await fetch(url).then(r => r.text())
    out.push(Date.now() - t0)
  }
  return Math.round(out.sort((a, b) => a - b)[Math.floor(out.length / 2)])
}
const sleep = (x: number) => new Promise(r => setTimeout(r, x))

;(async () => {
  console.log(`\n=== trie point-lookup cost vs key count ===`)
  console.log(`node ${HB_URL}  batch ${BATCH}\n`)
  console.log(`  ${'keys'.padStart(7)}  ${'seed'.padStart(8)}  ${'hit'.padStart(7)}  ${'miss'.padStart(7)}  ${'by-id'.padStart(7)}  ${'update'.padStart(8)}  ${'composed'.padStart(8)}  result`)

  for (const n of COUNTS) {
    const t0 = Date.now()
    const { pid } = await spawnLuaProcess(config, {
      luaSource: contract(n), tags: [{ name: 'name', value: `trie-scale-${n}` }] })

    let tid = ''
    for (let i = 0; i < 300; i++) {
      const r = await fetch(`${HB_URL}/${pid}~process@1.0/now/operatorsId`)
      if (r.ok) { tid = (await r.text()).trim(); break }
      await sleep(2000)
    }
    const seedMs = Date.now() - t0
    if (!tid) { console.log(`  ${String(n).padStart(7)}  SEED FAILED / TIMED OUT`); continue }

    const hitKey = addrOf(Math.floor(n / 2))
    const missKey = '0x' + 'D'.repeat(40)
    const P = `${HB_URL}/${pid}~process@1.0/now/operatorsId/~trie@1.0`

    const hit = await ms(`${P}/${hitKey}`)
    const miss = await ms(`${P}/${missKey}`)
    const byId = await ms(`${HB_URL}/${tid}~trie@1.0/${hitKey}`)

    const u0 = Date.now()
    await sendMessage(config, { pid, tags: [
      { name: 'action', value: 'Set-Operator' }, { name: 'addr', value: missKey } ] })
    const update = Date.now() - u0

    const c0 = Date.now()
    const cres = await sendMessage(config, { pid, tags: [
      { name: 'action', value: 'Set-Operator-Composed' },
      { name: 'addr', value: '0x' + 'E'.repeat(40) } ] })
    const composed = Date.now() - c0
    const cbody = String(cres.body || '').match(/(COMPOSED[^"]{0,90}|ok:[A-Za-z0-9_-]{43})/)?.[0] || '?'

    console.log(`  ${String(n).padStart(7)}  ${String(seedMs).padStart(7)}ms  ${String(hit).padStart(6)}ms  ${String(miss).padStart(6)}ms  ${String(byId).padStart(6)}ms  ${String(update).padStart(7)}ms  ${String(composed).padStart(8)}ms  ${cbody.slice(0,50)}`)
  }
  console.log(`\n  hit/miss/by-id are medians of 5. Compare: flat base-addressed read on the real`)
  console.log(`  ~1 MB operator-registry measured 154 ms.`)
})()
