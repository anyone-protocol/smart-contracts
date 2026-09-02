// Phase 0 of the write-gate plan — prove a Lua script can serve as a `p4@1.0` PRICING device.
//
// Everything in Phases 1-4 of docs/hyperbeam-migration/write-gate-plan.md rests on this and it
// had never been demonstrated: upstream only ever wires Lua as a p4 LEDGER device. If it does
// not work, the fallback is a controller-maintained static `faff-allow-list`, which reintroduces
// the union-drift problem the whole design exists to avoid — so it is worth knowing first.
//
// Runs a throwaway local node (no cluster access needed) with:
//     pricing-device: lua@5.3a   <- the thing under test, scripts/probe/p4-pricing.lua
//     ledger-device:  faff@1.0   <- no-op charge; never consulted for 0 or infinity
// and probes it with two real ANS-104-signed requests: one from an allow-listed key and one
// from a fresh throwaway key that cannot be on any list by construction.
//
// The gate lives on the WRITE path, so cost is measured on `/push` (a scheduler write) rather
// than on a read: a refusal that costs more than the slot it prevents would be pointless.
//
// Run: bun run scripts/probe/p4-lua-pricing.ts
//      IMAGE=... to test a different build. KEEP=1 leaves the container up for poking.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'node:child_process'
import { EthereumSigner, createData } from '@dha-team/arbundles'
import { computeAddress, hexlify } from 'ethers'
import { fetchNodeAddress, spawnLuaProcess } from '../util/hb-client'

// Minimal target for the slot-accounting checks: every accepted message moves the slot, so
// "did this write land" and "did this write cost a slot" are both readable off /slot/current.
const COUNTER = `
function compute(process, message, opts)
  process.n = (process.n or 0) + 1
  process.results = { output = { data = tostring(process.n) } }
  return process
end`

const IMAGE = process.env.IMAGE || 'ghcr.io/memetic-block/hyperbeam-docker:v0.9-FINAL-patched'
const NAME = 'hb-p4spike'
const PORT = 8734
const HB = `http://localhost:${PORT}`
const RELDIR = '/app/_build/default/rel/hb'
const HERE = path.resolve(import.meta.dir)
const WORK = fs.mkdtempSync('/tmp/p4spike-')

const sleep = (n: number) => new Promise(r => setTimeout(r, n))
const podman = (args: string[], timeout = 120_000) =>
  execFileSync('podman', args, { encoding: 'utf8', timeout })

let fails = 0, checks = 0
const check = (ok: boolean, label: string, detail = '') => {
  checks++
  if (!ok) fails++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  — ' + detail : ''}`)
}

// --- the two identities ----------------------------------------------------------------
// Both are generated per run. The allowed one is baked into the Lua source below, so this
// probe never touches a real key and cannot be made to pass by an ambient allow-list.
const allowedKey = crypto.randomBytes(32).toString('hex')
const deniedKey = crypto.randomBytes(32).toString('hex')
const allowedSigner = new EthereumSigner(allowedKey)
const deniedSigner = new EthereumSigner(deniedKey)
// Derive via keccak of the uncompressed point. Slicing the last 20 bytes off the public key
// yields a plausible-looking but WRONG address, which would silently make the allowed case
// fail as if the mechanism were broken.
const allowedAddr = computeAddress(hexlify(allowedSigner.publicKey))
const deniedAddr = computeAddress(hexlify(deniedSigner.publicKey))

// --- build the node config -------------------------------------------------------------
const lua = fs.readFileSync(path.join(HERE, 'p4-pricing.lua'), 'utf8')
  .replace('--[[ALLOWED]]', `  ['${allowedAddr}'] = true,`)
if (!lua.includes(allowedAddr)) throw new Error('allow-list placeholder not substituted')

// The pricing and ledger devices are declared on the SAME hook message, and dev_lua reads its
// script from that message's `module` key — so a Lua pricing device and a Lua ledger device
// could not coexist here with different scripts. Irrelevant for the binary design (the ledger
// is faff's no-op) but it is a real constraint on any future metered variant.
const p4Hook = {
  device: 'p4@1.0',
  'pricing-device': 'lua@5.3a',
  'ledger-device': 'faff@1.0',
  module: {
    'content-type': 'text/x-lua',
    name: 'p4-pricing.lua',
    body: lua,
  },
}

const config = {
  on: {
    // The stock hook chain, with p4 last — same order as the deployed jobspecs, so the spike
    // is not accidentally testing a simpler pipeline than production runs.
    request: [
      { device: 'rate-limit@1.0' },
      { device: 'name@1.0' },
      { device: 'manifest@1.0' },
      { device: 'blacklist@1.0' },
      p4Hook,
    ],
    // p4 must be on BOTH hooks: `on/request` estimates, `on/response` charges. A binary gate
    // never charges, but leaving it off would silently break any metered successor.
    response: [p4Hook],
  },
  // The Phase 4 target shape, in miniature: READS on any process are free, WRITES are not.
  // The deployed config's blanket `^/<pid>` carve-out covers both, which is exactly the hole
  // being closed — so the spike must not reproduce it. Ids are matched by pattern here rather
  // than enumerated from Consul KV; production keeps the three explicit ids.
  'p4-non-chargable-routes': [
    { template: '^/~meta@1.0' },
    { template: '^/~hyperbuddy@1.0' },
    { template: '^/[A-Za-z0-9_-]{43}~process@1.0/now' },
    { template: '^/[A-Za-z0-9_-]{43}~process@1.0/compute' },
    { template: '^/[A-Za-z0-9_-]{43}~process@1.0/slot' },
  ],
  'rate-limit-requests': 100000,
  'rate-limit-max': 100000,
  'rate-limit-period': 60,
  // Present but empty: proves admissions come from the Lua device and not from faff, which is
  // still wired as the ledger.
  'faff-allow-list': [],
}
const cfgPath = path.join(WORK, 'config.json')
fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2))
JSON.parse(fs.readFileSync(cfgPath, 'utf8'))  // a heredoc/escaping slip here is invisible until the node ignores the file

// --- run ---------------------------------------------------------------------------------
const cleanup = () => { try { podman(['rm', '-f', NAME], 60_000) } catch {} }

;(async () => {
  console.log(`\n=== Phase 0 — Lua as a p4 PRICING device ===`)
  console.log(`  image    ${IMAGE}`)
  console.log(`  allowed  ${allowedAddr}`)
  console.log(`  denied   ${deniedAddr}`)

  cleanup()
  podman(['run', '-d', '--name', NAME, '--network', 'host',
    '-v', `${cfgPath}:${RELDIR}/config.json:ro,Z`,
    '-e', 'HB_CONFIG=config.json',
    '-e', 'HB_ALLOW_EPHEMERAL_WALLET=true',
    // dev_p4 swallows the pricing device's error and reports only "Could not estimate price of
    // request." — the Lua stack trace never reaches the client. HB_PRINT=lua_error,payment is
    // the only way to see why an estimate failed.
    ...(process.env.HB_PRINT ? ['-e', `HB_PRINT=${process.env.HB_PRINT}`] : []),
    IMAGE])

  let up = false
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${HB}/~meta@1.0/info/address`).catch(() => null)
    if (r?.ok) { up = true; break }
    await sleep(2000)
  }
  if (!up) {
    console.log('\n  node never came up. last 40 log lines:')
    console.log(podman(['logs', '--tail', '40', NAME]).split('\n').map(l => '    ' + l).join('\n'))
    cleanup()
    process.exit(2)
  }
  console.log(`  node     ${(await (await fetch(`${HB}/~meta@1.0/info/address`)).text()).trim()}\n`)

  // The config actually took effect. Without this a node that ignored config.json entirely
  // would have NO pricing device, dev_p4 would fall through its `{true, false}` clause and
  // admit everything — and the "allowed key is admitted" check below would pass for the
  // completely wrong reason.
  const infoRaw = await (await fetch(`${HB}/~meta@1.0/info/serialize~json@1.0`)).text()
  const info = JSON.parse(infoRaw)
  check(info['rate-limit-period'] === 60, 'config.json was loaded (hyphenated opt read back)',
    `rate-limit-period=${info['rate-limit-period']}`)

  // --- the actual question ---------------------------------------------------------------
  // With no pid this posts to the bare /push spawn path (no process tags, so nothing can be
  // created either way — safe as a pure gate probe). With a pid it is a real scheduler write,
  // and must carry the full ao Message envelope + target: a bare item is rejected as malformed
  // with the same 400 the gate uses, which reads as a gate refusal and is not one.
  const push = async (signer: EthereumSigner, label: string, pid?: string) => {
    const item = createData(new Uint8Array(0) as never, signer, {
      tags: pid
        ? [
            { name: 'type', value: 'Message' },
            { name: 'data-protocol', value: 'ao' },
            { name: 'variant', value: 'ao.N.1' },
            { name: 'require-codec', value: 'application/json' },
            { name: 'action', value: label },
          ]
        : [{ name: 'action', value: label }],
      ...(pid ? { target: pid } : {}),
    })
    await item.sign(signer)
    const t0 = Date.now()
    const res = await fetch(`${HB}${pid ? `/${pid}~process@1.0/push` : '/push'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/ans104', 'codec-device': 'ans104@1.0' },
      body: item.getRaw() as unknown as BodyInit,
      signal: AbortSignal.timeout(60_000),
    })
    const body = (await res.text()).replace(/\s+/g, ' ')
    return { ms: Date.now() - t0, status: res.status, body, process: res.headers.get('process') }
  }

  const denied = await push(deniedSigner, 'p4-lua-denial-probe')
  check(denied.status === 400 && /will not service/i.test(denied.body),
    'Lua pricing device REFUSES a non-allow-listed signer',
    `HTTP ${denied.status}: ${denied.body.slice(0, 90)}`)
  check(denied.process === null, 'refused request created no process')

  const allowed = await push(allowedSigner, 'p4-lua-admit-probe')
  // A 500 here specifically means the Lua returned a FLOAT zero: dev_p4's `{ok, 0}` clause
  // missed, it treated 0.0 as a price, and asked faff — which exports no balance/3 — for a
  // balance. Worth naming, because "admitted" and "priced then failed" look alike otherwise.
  check(allowed.status !== 500,
    'admitted path did not fall through to the ledger (integer 0 matched dev_p4)',
    `HTTP ${allowed.status}: ${allowed.body.slice(0, 90)}`)
  check(!/will not service/i.test(allowed.body),
    'Lua pricing device ADMITS an allow-listed signer',
    `HTTP ${allowed.status}: ${allowed.body.slice(0, 90)}`)

  // Unsigned. Stock faff admits these (`lists:all` over an empty signer list is vacuously
  // true); the Lua device denies by default. Asserting the difference so it is a decision on
  // record rather than an accident.
  const un = await fetch(`${HB}/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device: 'process@1.0', type: 'Process', variant: 'ao.N.1' }),
    signal: AbortSignal.timeout(30_000),
  })
  const unBody = (await un.text()).replace(/\s+/g, ' ')
  check(/will not service/i.test(unBody),
    'Lua pricing device denies UNSIGNED requests (stock faff admits them)',
    `HTTP ${un.status}: ${unBody.slice(0, 70)}`)

  // --- the claim that actually matters: a refused write consumes NO SLOT ------------------
  // Everything above only shows p4 answering. The DoS fix rests on the refusal landing at the
  // request hook, BEFORE the scheduler assigns a slot — otherwise the attacker still grows the
  // process and still makes every subsequent read more expensive, just with an error attached.
  const schedulerLocation = await fetchNodeAddress(HB)
  const { pid } = await spawnLuaProcess({ url: HB, signer: allowedSigner }, {
    luaSource: COUNTER,
    schedulerLocation,
    tags: [{ name: 'name', value: 'p4-gate-target' }],
  })
  console.log(`\n  target process ${pid}`)
  await sleep(3000)

  const slotOf = async () => {
    const t = (await (await fetch(`${HB}/${pid}~process@1.0/slot/current`)).text()).trim()
    return /^\d+$/.test(t) ? parseInt(t, 10) : NaN
  }
  check(!Number.isNaN(await slotOf()),
    'allow-listed signer could SPAWN through the gate (a real write, not just a non-refusal)',
    `slot ${await slotOf()}`)

  const before = await slotOf()
  const attack = await push(deniedSigner, 'Increment', pid)
  const after = await slotOf()
  check(attack.status === 400 && /will not service/i.test(attack.body),
    'non-allow-listed signer is REFUSED when writing to an existing process',
    `HTTP ${attack.status}`)
  check(after === before,
    'the refused write consumed NO SLOT (the DoS fix, stated directly)',
    `slot ${before} -> ${after}`)

  const good = await push(allowedSigner, 'Increment', pid)
  await sleep(1500)
  const afterGood = await slotOf()
  // Coverage: without this, a node refusing EVERY write would pass the slot check above while
  // being entirely broken.
  check(good.status < 400 && afterGood > after,
    'an allow-listed write still lands (the gate is a filter, not an outage)',
    `HTTP ${good.status}, slot ${after} -> ${afterGood}: ${good.body.slice(0, 120)}`)

  // --- cost --------------------------------------------------------------------------
  // Only meaningful warm: the first request through the device pays for luerl init.
  const warm = { denied: [] as number[], allowed: [] as number[] }
  for (let i = 0; i < 5; i++) {
    warm.denied.push((await push(deniedSigner, `cost-deny-${i}`)).ms)
    warm.allowed.push((await push(allowedSigner, `cost-admit-${i}`)).ms)
  }
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
  console.log(`\n  refusal  ${String(med(warm.denied)).padStart(5)} ms (median of 5, warm)`)
  console.log(`  admission${String(med(warm.allowed)).padStart(5)} ms`)
  console.log(`  cold     ${String(denied.ms).padStart(5)} ms refusal / ${allowed.ms} ms admission`)
  check(med(warm.denied) < 445,
    'refusal is cheaper than the 445 ms in-contract ACL rejection it replaces',
    `${med(warm.denied)} ms`)

  console.log(`\n${fails === 0 ? 'PASS' : 'FAILED'} — ${checks - fails}/${checks} checks`)
  if (process.env.KEEP === '1') {
    console.log(`  KEEP=1 — container ${NAME} left running, config at ${cfgPath}`)
  } else {
    cleanup()
    fs.rmSync(WORK, { recursive: true, force: true })
  }
  process.exit(fails === 0 ? 0 : 1)
})().catch(e => {
  console.error(e)
  try { console.log(podman(['logs', '--tail', '40', NAME])) } catch {}
  if (process.env.KEEP !== '1') cleanup()
  process.exit(2)
})
