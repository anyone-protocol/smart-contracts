// Reproduce, locally, the compute wedge that stopped operator-registry on stage (slot 39) and
// live (slot 9) on 2026-08-28.
//
// The node answers `Erlang error while running Lua: undef` and WEDGES: every later compute
// re-attempts the failing slot and fails, so state freezes while the scheduler keeps accepting
// messages. `HB_PRINT=lua_error` prints NOTHING for it (verified on stage 2026-08-31) — dev_lua
// swallows the Erlang stacktrace — so the only way to learn more is to reproduce it somewhere we
// can instrument.
//
// Neither offline tier can see this:
//   - Tier-1 (Lua 5.3) and Tier-2 (real luerl) both PASS the failing payload, because
//   - `native.allowlist.store` falls back to an in-memory table whenever `ao.resolve` is absent,
//     which is always true offline. The real `~trie@1.0` write that
//     `Admin-Submit-Operator-Certificates` performs on EVERY new cert is exercised by NO tier.
//
// Runs entirely on the production image and costs no slots on any real node.
//
// Usage:
//   bun run scripts/probe/opreg-wedge-repro.ts                 # empty seed (fast)
//   bun run scripts/probe/opreg-wedge-repro.ts --seed <file>   # seed from a real dump
//   KEEP=1 bun run scripts/probe/opreg-wedge-repro.ts          # leave the container up
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Wallet } from 'ethers'
import { EthereumSigner } from '@dha-team/arbundles'
import { spawnLuaProcess, sendMessage } from '../util/hb-client'

const AO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ENGINE = process.env.CONTAINER_ENGINE || 'podman'
const IMAGE = process.env.IMAGE ||
  'ghcr.io/memetic-block/hyperbeam-docker@sha256:ace515580b495c56ccdc61daa716a21614439897c0dcf2ff84563c04277d0826'
const NAME = process.env.NAME || 'hb-wedge'
const HB = 'http://localhost:8734'
const RELDIR = '/app/_build/default/rel/hb'
const KEY = process.env.PROBE_KEY || '0x' + '11'.repeat(32)
const deployerAddr = new Wallet(KEY).address

// The exact payload that wedged BOTH environments, and the last one that computed cleanly
// before it (live slot 8) as a control. Same shape, same size, different address/fingerprint —
// so any difference between them is about the DATA, not the request.
const WEDGE   = [{ a: '0x461500aa19D9747Bd45aCeCBe1964dBb2Bda9f66', f: '0AE767A60CB3C22C8554584408458473EAF92946' }]
const CONTROL = [{ a: '0x22EFb37d768043c52430014389144ecD645ba54A', f: '404E908342616B2410F79F67114F0D5728D97C49' }]

const sh = (args: string[], ms = 120_000) =>
  execFileSync(ENGINE, args, { encoding: 'utf8', timeout: ms, stdio: ['ignore', 'pipe', 'pipe'] })

const cfg = path.join(AO, 'dist', 'wedge-config.json')
const seedArg = process.argv.indexOf('--seed')
const seedFile = seedArg > -1 ? process.argv[seedArg + 1] : undefined
// `--gate` reconfigures the node to match stage/live EXACTLY: p4 with the real write-gate as its
// Lua pricing device. The gate is a SECOND luerl VM running on every chargeable request, and it
// is the last structural difference between this harness and the wedged nodes. Applying it also
// RESTARTS the node, which forces the process and its messages to be re-read from cache — where
// a message body is a `+link` (`name => body+link` in the stage arg dump) rather than inline.
const GATE = process.argv.includes('--gate')
// `--raw-seed <file>` takes an ALREADY-ENVELOPED spawn payload — e.g. the real one fetched from
// Arweave at the process id, which IS the spawn item. Faithful in a way a re-enveloped `as/dump`
// is not: the dump is state as of the LAST COMPUTED slot, not what the process was spawned with.
const rawArg = process.argv.indexOf('--raw-seed')
const rawSeedFile = rawArg > -1 ? process.argv[rawArg + 1] : undefined
// Slots of realistic history to build BEFORE the wedging cert. The wedged processes had 38
// (stage) and 8 (live) slots behind them; jumping straight to the end state tests nothing about
// accumulated history. Each batch uses FRESH fingerprints so every one drives `ctx.allow` into
// the real `~trie@1.0` — the write path no offline tier can reach.
const histArg = process.argv.indexOf('--history')
const HISTORY = histArg > -1 ? Number(process.argv[histArg + 1]) : 0
// 🚨 THE VERSION CROSSING. stage/live wedged at exactly the boundary the real deploys crossed:
// the last GOOD compute ran on v0.9-FINAL (2026-08-25), the first FAILING one on 14e9f68a
// (2026-08-28, after infra-arweave 6949ad4 bumped both nodes on 2026-08-27 17:06 UTC). A process
// spawned fresh on the new image computes fine — which is why every earlier attempt here passed.
// `--from-image` spawns and builds history on the OLD image, then restarts onto the new one over
// the SAME store, which is what the real nodes actually did.
// `--expect-healthy` inverts the exit code: this script is a REPRODUCTION tool (wedging is
// success) but qualify-node uses it as a GATE (wedging is failure). One mechanism, two callers.
const EXPECT_HEALTHY = process.argv.includes('--expect-healthy')
const fromArg = process.argv.indexOf('--from-image')
const FROM_IMAGE = fromArg > -1 ? process.argv[fromArg + 1] : undefined
const STORE_VOL = process.env.STORE_VOL || 'hb-wedge-store'
const STORE_PATH = '/app/_build/default/rel/hb/cache-mainnet'

async function waitUp (): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${HB}/~meta@1.0/info/address`)).ok) return true } catch {}
    await new Promise(r => setTimeout(r, 2000))
  }
  return false
}

/** Did the process wedge? `now/` is the liveness probe — `as/` serves last-computed state and
 *  keeps answering 200 long after compute has stopped, which is why this went unnoticed. */
async function wedged (pid: string): Promise<{ wedged: boolean, code: number, slot: string }> {
  const r = await fetch(`${HB}/${pid}~process@1.0/now/results/output/data`)
  const slot = await (await fetch(`${HB}/${pid}~process@1.0/slot/current`)).text()
  return { wedged: !r.ok, code: r.status, slot: slot.trim() }
}

;(async () => {
  console.log('\n=== operator-registry compute wedge — local reproduction ===')
  console.log(`  image  ${IMAGE.slice(0, 60)}…`)
  console.log(`  seed   ${seedFile ?? '(empty state)'}`)

  fs.mkdirSync(path.dirname(cfg), { recursive: true })
  // No p4: the gate is NOT implicated (proven on stage — a gate refusal returns a different
  // body), and leaving it out removes a variable.
  const writeCfg = (pid?: string, gateModuleId?: string) => fs.writeFileSync(cfg, JSON.stringify({
    'scheduler-default-commitment-spec': 'ans104@1.0',
    'faff-allow-list': [deployerAddr],
    ...(pid && gateModuleId ? {
      // p4 must sit BEHIND the same device chain stage and live run. The preceding hooks shape
      // the hook message the gate reads: with p4 alone, `req.request` is absent, the gate sees
      // ZERO signers and deny-by-default refuses even a deploy wallet.
      on: { request: [
        { device: 'rate-limit@1.0' },
        { device: 'auth-hook@1.0', path: 'request', when: { keys: ['authorization', '!'] },
          'secret-provider': { device: 'http-auth@1.0', 'access-control': { device: 'http-auth@1.0' } } },
        { device: 'name@1.0' },
        { device: 'manifest@1.0' },
        { device: 'blacklist@1.0' },
        {
          device: 'p4@1.0', 'pricing-device': 'lua@5.3a', 'ledger-device': 'faff@1.0',
          module: gateModuleId, 'gated-processes': [pid], 'operator-registry': pid,
          'deploy-wallets': [deployerAddr],
        },
      ] },
      'p4-non-chargable-routes': [
        { template: `^/${pid}~process@1.0/(now|compute|slot|as)` },
        { template: '^/$' }, { template: '^/~meta@1.0' }, { template: '^/~hyperbuddy@1.0' },
      ],
    } : {}),
  }, null, 2))
  writeCfg()

  // 🚨 A PERSISTENT node wallet is mandatory once `--gate` restarts the container.
  // HB_ALLOW_EPHEMERAL_WALLET regenerates the operator key on every start, so after a restart
  // the node has a NEW address, the process it scheduled points at the old one, and every write
  // fails in a way that looks like a gate decision and is not.
  const walletFile = path.join(AO, 'dist', 'wedge-wallet.json')
  if (!fs.existsSync(walletFile)) {
    execFileSync('bun', ['-e',
      `import Arweave from 'arweave'; const a=Arweave.init({}); ` +
      `await Bun.write(${JSON.stringify(walletFile)}, JSON.stringify(await a.wallets.generate()))`],
      { cwd: AO, timeout: 120_000 })
  }
  // The store is a VOLUME so it survives swapping the image underneath it — that persistence is
  // the whole point of the crossing test.
  let expectAddr: string | null = null
  const assertIdentity = async (where: string) => {
    const a = (await (await fetch(`${HB}/~meta@1.0/info/address`)).text()).trim()
    if (expectAddr === null) { expectAddr = a; console.log(`  node identity ${a.slice(0, 12)}… (${where})`) }
    else if (a !== expectAddr) {
      console.log(`\n  *** HARNESS BUG: node identity CHANGED at ${where}: ${expectAddr.slice(0, 12)}… -> ${a.slice(0, 12)}…`)
      console.log('  Any failure after this is the identity change, NOT the wedge. Aborting.')
      process.exit(3)
    } else console.log(`  node identity PRESERVED at ${where} (${a.slice(0, 12)}…)`)
    return a
  }
  const start = (image: string) => sh(['run', '-d', '--name', NAME, '--network', 'host',
    '-v', `${cfg}:${RELDIR}/config.json:ro,Z`,
    '-v', `${walletFile}:/app/wallet.json:ro,Z`,
    '-v', `${STORE_VOL}:${STORE_PATH}:Z`,
    // 🚨 `config.flat,config.json` — BOTH. config.flat is baked into the image and is the only
    // thing that sets `priv_key_location: /app/wallet.json` (UNDERSCORES; the hyphenated spelling
    // is silently ignored). Passing config.json alone drops it, the node mints a FRESH identity
    // on every boot, and any restart or image swap then fails with
    // `No location found for address` — which reads exactly like a compute wedge and is not one.
    '-e', 'HB_CONFIG=config.flat,config.json', '-e', 'HB_WALLET_PATH=/app/wallet.json',
    '-e', 'HB_PRINT=lua_error,error,debug', image])

  sh(['rm', '-f', NAME], 60_000)
  if (!FROM_IMAGE) sh(['volume', 'rm', '-f', STORE_VOL], 60_000)
  const bootImage = FROM_IMAGE ?? IMAGE
  if (FROM_IMAGE) {
    sh(['volume', 'rm', '-f', STORE_VOL], 60_000)
    console.log(`  starting on OLD image ${FROM_IMAGE.slice(0, 60)}…`)
  }
  start(bootImage)
  if (!await waitUp()) { console.log(sh(['logs', '--tail', '40', NAME]).slice(-2000)); process.exit(2) }
  await assertIdentity('first boot')

  // Modules are pure source; the seed rides the spawn message.
  const src = path.join(AO, 'dist', 'operator-registry-native.lua')
  if (!fs.existsSync(src)) {
    console.log('  building operator-registry module…')
    execFileSync('bun', ['run', 'scripts/build-native-bundle.ts', 'operator-registry'],
      { cwd: AO, encoding: 'utf8', timeout: 300_000 })
  }
  sh(['cp', src, `${NAME}:/tmp/opreg.lua`], 300_000)
  sh(['exec', NAME, './bin/hb', 'eval',
    `{ok,S}=file:read_file("/tmp/opreg.lua"), M=hb_message:commit(#{ <<"data-protocol">> => <<"ao">>, ` +
    `<<"variant">> => <<"ao.N.1">>, <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>, ` +
    `<<"name">> => <<"opreg">>, <<"body">> => S }, #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), ` +
    `{ok,_}=hb_cache:write(M,#{}), ok=file:write_file("/tmp/opreg.id", hb_util:id(M)).`], 600_000)
  const moduleId = sh(['exec', NAME, 'cat', '/tmp/opreg.id'], 60_000).trim()
  console.log(`  module ${moduleId}`)

  let spawnData: string
  if (rawSeedFile) {
    spawnData = fs.readFileSync(rawSeedFile, 'utf8')
  } else {
    const state = seedFile
      ? JSON.parse(fs.readFileSync(seedFile, 'utf8'))
      : { claimable: {}, verified: {}, blocked: {}, verifiedHardware: {},
          registrationCredits: {}, registrationCreditsRequired: false }
    spawnData = JSON.stringify({ 'ao-migration-seed': 1, state, acl: { roles: {} } })
  }
  console.log(`  seed envelope ${(spawnData.length / 1048576).toFixed(2)} MiB`)

  const config = { url: HB, signer: new EthereumSigner(KEY.replace(/^0x/, '')) } as any
  const { pid } = await spawnLuaProcess(config, {
    moduleId, spawnData, tags: [{ name: 'name', value: `wedge-${Date.now()}` }],
  })
  console.log(`  pid    ${pid}`)

  // SELF-CHECK. A seed that silently failed to land would make every case below "not
  // reproduced" for the wrong reason — the exact shape of a check that passes because it never
  // ran. Assert the real state is present before drawing any conclusion from a negative.
  const status = await (await fetch(`${HB}/${pid}~process@1.0/as/status`)).text()
  console.log(`  seeded status: ${status.replace(/\s+/g, ' ').slice(0, 160)}`)
  const alSeeded = await fetch(`${HB}/${pid}~process@1.0/compute/allowlistId/~trie@1.0/${deployerAddr}`)
  console.log(`  owner in allowlist trie: HTTP ${alSeeded.status}`)

  if (GATE) {
    // Publish the REAL gate artefact stage and live run, then restart onto a stage-shaped config.
    sh(['cp', path.join(AO, 'runtime/write-gate.lua'), `${NAME}:/tmp/wg.lua`], 300_000)
    sh(['exec', NAME, './bin/hb', 'eval',
      `{ok,S}=file:read_file("/tmp/wg.lua"), M=hb_message:commit(#{ <<"data-protocol">> => <<"ao">>, ` +
      `<<"variant">> => <<"ao.N.1">>, <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>, ` +
      `<<"name">> => <<"write-gate">>, <<"body">> => S }, #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), ` +
      `{ok,_}=hb_cache:write(M,#{}), ok=file:write_file("/tmp/wg.id", hb_util:id(M)).`], 600_000)
    const gateId = sh(['exec', NAME, 'cat', '/tmp/wg.id'], 60_000).trim()
    writeCfg(pid, gateId)
    const addrBefore = await (await fetch(`${HB}/~meta@1.0/info/address`)).text()
    console.log(`\n  restarting onto stage-shaped config (p4 + write-gate ${gateId.slice(0, 12)}…)`)
    sh(['restart', NAME], 120_000)
    if (!await waitUp()) { console.log(sh(['logs', '--tail', '40', NAME])); process.exit(2) }
    const addrAfter = await (await fetch(`${HB}/~meta@1.0/info/address`)).text()
    console.log(`  node identity ${addrBefore.trim() === addrAfter.trim() ? 'PRESERVED' : '*** CHANGED — harness bug ***'} (${addrAfter.trim().slice(0, 12)}…)`)
  }

  const before = await wedged(pid)
  console.log(`\n  after spawn: now/ HTTP ${before.code}, slot ${before.slot}` +
    (before.wedged ? '   *** ALREADY WEDGED ***' : '   healthy'))
  if (before.wedged) { console.log('\n  spawn itself wedged — the SEED is implicated, not the cert.'); process.exit(1) }

  // Build realistic slot history first. Fresh fingerprints each time, so every batch grows the
  // allowlist trie exactly the way the controller's real traffic does.
  if (HISTORY > 0) {
    console.log(`\n  building ${HISTORY} slots of history (fresh fingerprints -> real trie writes)…`)
    for (let i = 0; i < HISTORY; i++) {
      const batch = Array.from({ length: 8 }, (_, j) => ({
        a: new Wallet('0x' + (i * 8 + j + 3).toString(16).padStart(64, '0')).address,
        f: (i * 8 + j + 1).toString(16).toUpperCase().padStart(40, 'C'),
      }))
      await sendMessage(config, {
        pid, data: JSON.stringify(batch),
        tags: [{ name: 'action', value: 'Admin-Submit-Operator-Certificates' }],
      }).catch(e => console.log(`    history ${i} send error: ${String(e.message).slice(0, 120)}`))
      if (i % 10 === 9 || i === HISTORY - 1) {
        const h = await wedged(pid)
        console.log(`    after ${i + 1} batches: now/ HTTP ${h.code}, slot ${h.slot}` +
          (h.wedged ? '   *** WEDGED DURING HISTORY BUILD ***' : ''))
        if (h.wedged) {
          console.log('\n  --- node stderr ---')
          console.log(sh(['logs', '--tail', '80', NAME], 60_000).split('\n').slice(-40).join('\n'))
          if (!process.env.KEEP) sh(['rm', '-f', NAME], 60_000)
          process.exit(EXPECT_HEALTHY ? 1 : 0)
        }
      }
    }
  }

  if (FROM_IMAGE) {
    const v = await (await fetch(`${HB}/~meta@1.0/info/address`)).text()
    console.log(`\n  *** CROSSING VERSIONS: stopping old image (node ${v.trim().slice(0, 12)}…) ***`)
    sh(['rm', '-f', NAME], 120_000)
    start(IMAGE)
    if (!await waitUp()) { console.log(sh(['logs', '--tail', '40', NAME]).slice(-2000)); process.exit(2) }
    await assertIdentity('after crossing to the new image')
    const crossed = await wedged(pid)
    console.log(`  immediately after crossing: now/ HTTP ${crossed.code}, slot ${crossed.slot}` +
      (crossed.wedged ? '   *** WEDGED BY THE CROSSING ITSELF ***' : '   still healthy'))
    if (crossed.wedged) {
      console.log('\n  --- node stderr ---')
      console.log(sh(['logs', '--tail', '80', NAME], 60_000).split('\n').slice(-40).join('\n'))
      if (!process.env.KEEP) sh(['rm', '-f', NAME], 60_000)
      process.exit(EXPECT_HEALTHY ? 1 : 0)
    }
  }

  const NOOP = [{ a: '0x58bd1A7Db94Ee1a00D4dC6Cb0333828f27e61662', f: '33ED9E79B1089D52865A126EE63A93FB1D2F0DB2' }]
  for (const [label, certs] of [
    ['NO-OP   (already claimable, no trie write)', NOOP],
    ['CONTROL (live slot 8)', CONTROL],
    ['WEDGE   (live slot 9)', WEDGE]] as const) {
    await sendMessage(config, {
      pid, data: JSON.stringify(certs),
      tags: [{ name: 'action', value: 'Admin-Submit-Operator-Certificates' }],
    }).catch(e => console.log(`    send error: ${String(e.message).slice(0, 160)}`))
    const s = await wedged(pid)
    console.log(`  ${label}: now/ HTTP ${s.code}, slot ${s.slot}` +
      (s.wedged ? '   *** WEDGED — REPRODUCED ***' : '   still healthy'))
    if (s.wedged) {
      console.log('\n  --- node stderr around the failure ---')
      console.log(sh(['logs', '--tail', '60', NAME], 60_000).split('\n').slice(-40).join('\n'))
      if (!process.env.KEEP) sh(['rm', '-f', NAME], 60_000)
      process.exit(EXPECT_HEALTHY ? 1 : 0)
    }
  }

  console.log('\n  NOT REPRODUCED with this seed — the trigger needs more of the real state.')
  if (!process.env.KEEP) sh(['rm', '-f', NAME], 60_000)
})()
