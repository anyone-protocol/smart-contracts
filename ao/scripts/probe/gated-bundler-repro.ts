// Why self-hosted bundling works on dev and silently stops publishing on stage and live.
//
// Enabled by config alone (`bundler-ans104` -> loopback, node address added to `deploy-wallets`),
// stage and live stopped publishing assignments on 2026-08-27 and 8 slots were lost permanently.
// Dev, whose pricing device is `faff@1.0`, was unaffected. Reverted the same day.
//
// ROOT CAUSE (found with this probe, 2026-08-27) — `dev_lua` cannot encode a CACHE LINK.
//
//   The node posts every scheduled message and assignment to its own `~bundler@1.0/tx`. That
//   POST runs the `on/request` hooks like any other request, so p4 asks the pricing device to
//   price it. On stage and live the pricing device is `lua@5.3a`, and encoding the request into
//   Lua goes through `dev_lua:do_encode/2`, which recurses through maps and lists and passes
//   anything else to `luerl:encode/2` — whose final clause is `error({badarg, Term})`.
//   A link is such a term:
//
//       {link, <<"o3ue1CsSYb9Dm1eLcqqPRoHI1PpA-zZinZe-X3TkIng">>,
//              #{<<"lazy">> => false, <<"type">> => <<"link">>}}
//
//   So the request never encodes, `dev_p4` answers "Could not estimate price of request."
//   (HTTP 400), and `dev_scheduler_server` DISCARDS the upload result — the refusal is dropped
//   and never retried. Slots keep advancing and their assignments never reach Arweave.
//   Fixed by hyperbeam-docker patch `0004-dev-lua-encode-link.patch`.
//
// 🚨 IT IS NOT THE WRITE GATE, which was the obvious suspect and the wrong one. The theory was
// that the upload envelope is unsigned (`hb_http:post` never commits what it sends) and the
// gate's `n == 0 -> REFUSE` rejects it where `dev_faff`'s vacuous `lists:all` admits it. Both
// halves of that are true and it is still not the cause: a gate whose `estimate` returns ADMIT
// unconditionally fails identically, and the UNMODIFIED gate admits the upload once the encode
// patch is in. A correlation between "faff works, gate does not" is not a mechanism — this
// probe now asserts the mechanism instead of the correlation. That is the fifth wrong theory
// this bug family has produced; do not skip the substitution step.
//
// Two legs, so no single artefact carries the conclusion:
//   LEG 1  the gate's unsigned-vs-faff asymmetry, RECORDED for context. It is real, and it is
//          not the cause. Kept so a future reader does not rediscover it and stop there.
//   LEG 2  the assertion — a real write with `bundler-ans104` on loopback under each pricing
//          device, checking whether the node's own upload reaches the bundler.
//
// Runs entirely locally on the production image, and costs no slots on any real node. That
// matters: every attempt on stage or live burns assignments that can never be published.
//
// Expected: FAILS on an image without patch 0004, PASSES with it.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'node:child_process'
import { EthereumSigner } from '@dha-team/arbundles'
import { computeAddress, hexlify } from 'ethers'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from '../util/hb-client'
import { requireDeployerKey } from '../util/helpers'

// The digest stage and live actually run: edge @ 14e9f68a + patches 0002/0003.
const IMAGE = process.env.IMAGE ||
  'ghcr.io/memetic-block/hyperbeam-docker@sha256:bdb96b0b42ecf5ed97b93398e31960777c9d8c9d959ce8fa26dfbc5c4bec8d78'
const NAME = 'hb-bundler-repro'
const HB = 'http://localhost:8734'
const RELDIR = '/app/_build/default/rel/hb'
const HERE = path.resolve(import.meta.dir)
const AO = path.resolve(HERE, '../..')
const WORK = fs.mkdtempSync('/tmp/bundler-repro-')
const CFG = path.join(WORK, 'config.json')

const sleep = (n: number) => new Promise(r => setTimeout(r, n))
const podman = (a: string[], t = 180_000) => execFileSync('podman', a, { encoding: 'utf8', timeout: t })

let fails = 0, checks = 0
const check = (ok: boolean, label: string, detail = '') => {
  checks++; if (!ok) fails++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  — ' + detail : ''}`)
}

const deployer = new EthereumSigner(requireDeployerKey())
const deployerAddr = computeAddress(hexlify(deployer.publicKey))

// The stage/live config, verbatim in shape — same six hooks in the same order, same
// non-chargable routes. `mode` selects the ONE thing that differs between dev and stage/live.
const writeConfig = (opts: {
  mode: 'none' | 'faff' | 'gate'
  pids?: string[]
  gateModuleId?: string
  nodeAddr?: string
  bundler?: string
}) => {
  const { mode, pids = [], gateModuleId = '', nodeAddr = '', bundler } = opts
  const wallets = [deployerAddr, ...(nodeAddr ? [nodeAddr] : [])]
  const p4 =
    mode === 'gate'
      ? [{
          device: 'p4@1.0',
          'pricing-device': 'lua@5.3a',
          'ledger-device': 'faff@1.0',
          module: gateModuleId,
          'gated-processes': pids,
          'operator-registry': pids[0] ?? '',
          'deploy-wallets': wallets,
        }]
      : mode === 'faff'
        ? [{ device: 'p4@1.0', 'pricing-device': 'faff@1.0', 'ledger-device': 'faff@1.0' }]
        : []
  const cfg: Record<string, unknown> = {
    'scheduler-default-commitment-spec': 'ans104@1.0',
    on: {
      request: [
        { device: 'rate-limit@1.0' },
        {
          device: 'auth-hook@1.0',
          path: 'request',
          when: { keys: ['authorization', '!'] },
          'secret-provider': {
            device: 'http-auth@1.0',
            'access-control': { device: 'http-auth@1.0' },
          },
        },
        { device: 'name@1.0' },
        { device: 'manifest@1.0' },
        { device: 'blacklist@1.0' },
        ...p4,
      ],
    },
    // On dev BOTH the deployer and the node's own address are here; on stage/live the node goes
    // in `deploy-wallets` instead and faff is only the ledger. Kept populated in both modes so
    // the only variable between the two runs is the pricing device.
    'faff-allow-list': wallets,
    'p4-non-chargable-routes': [
      ...pids.map(p => ({ template: `^/${p}~process@1.0/(now|compute|slot|as)` })),
      { template: '^/$' },
      { template: '^/~meta@1.0' },
      { template: '^/~hyperbuddy@1.0' },
      { template: '^/~query@1.0' },
      // Mirrors stage and live: the bundler route is exempt from pricing, and the EDGE is what
      // keeps it off the internet. Legitimate only because those edges refuse `~bundler@1.0`;
      // dev, whose edge is open, keeps p4 in front of it instead.
      { template: '^/~bundler@1.0/(tx|item)$' },
    ],
    'rate-limit-requests': 100000,
    'rate-limit-max': 100000,
    'rate-limit-period': 60,
  }
  // `^/~bundler@1.0` is deliberately NOT in p4-non-chargable-routes — adding it would remove the
  // only gate in front of an endpoint that spends AR. The loopback POST therefore goes through
  // the pricing device like any other request, which is the whole subject of this probe.
  if (bundler) cfg['bundler-ans104'] = bundler
  const fd = fs.openSync(CFG, 'w'); fs.writeSync(fd, JSON.stringify(cfg, null, 2)); fs.closeSync(fd)
}

const waitUp = async (n = 90) => {
  for (let i = 0; i < n; i++) {
    if ((await fetch(`${HB}/~meta@1.0/info/address`).catch(() => null))?.ok) return true
    await sleep(2000)
  }
  return false
}

// Through a shell, because HB_PRINT writes to the container's STDERR and `execFileSync` returns
// only stdout — reading `podman logs` directly reports zero events while the node is emitting
// them, which reads as "the bundler never saw it" and is the exact wrong conclusion.
const logs = () => {
  try { return execFileSync('sh', ['-c', `podman logs ${NAME} 2>&1`], { encoding: 'utf8', timeout: 120_000, maxBuffer: 256 * 1024 * 1024 }) }
  catch { return '' }
}
// Everything the node has said since a marker, so each phase is read in isolation.
const logsSince = (mark: number) => logs().slice(mark)

const restartInto = async (label: string) => {
  podman(['restart', NAME], 240_000)
  if (!await waitUp()) { console.log(podman(['logs', '--tail', '40', NAME])); throw new Error(`node did not come up: ${label}`) }
}

// An unsigned request on a CHARGEABLE path — the shape of the node's own upload envelope, which
// carries its signature on the nested body and nothing on the envelope itself.
//
// Judged by the refusal phrase, not the status: `dev_p4` answers 400 for a refusal, but so do
// plenty of things upstream of it. A POST of `{}` to a push path, for instance, is 400
// "Message is not valid." under BOTH devices — rejected before p4 is ever consulted, which
// looks like agreement and is nothing of the kind.
const REFUSAL = 'will not service this request'
const unsignedGet = async (p: string) => {
  const res = await fetch(`${HB}${p}`, { signal: AbortSignal.timeout(60_000) })
  const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 140)
  return { status: res.status, body, refused: REFUSAL.split(' ').every(w => body.includes(w)) }
}

;(async () => {
  console.log(`\n=== gated self-bundling — local reproduction ===`)
  console.log(`  image    ${IMAGE}`)
  console.log(`  deployer ${deployerAddr}`)

  podman(['rm', '-f', NAME], 60_000)
  writeConfig({ mode: 'none' })
  podman(['run', '-d', '--name', NAME, '--network', 'host',
    '-v', `${CFG}:${RELDIR}/config.json:ro,Z`,
    '-e', 'HB_CONFIG=config.json', '-e', 'HB_ALLOW_EPHEMERAL_WALLET=true',
    // `bundler_short` carries queueing_item / verify_failed — the bundler's own answer.
    // `lua_error,lua` is the only way to see a gate decision at all: every gate failure mode
    // otherwise presents as HTTP 400 "Could not estimate price of request."
    // `bundler_short` is NOT optional — it carries queueing_item, which is the probe's entire
    // acceptance signal. An HB_PRINT override that drops it makes the faff control report zero
    // and the run announce NOT REPRODUCED with nothing actually wrong.
    '-e', `HB_PRINT=${['bundler_short', ...(process.env.HB_PRINT ?? 'lua_error').split(',')].filter(Boolean).join(',')}`,
    IMAGE])
  if (!await waitUp()) { console.log(podman(['logs', '--tail', '40', NAME])); process.exit(2) }

  const nodeAddr = await fetchNodeAddress(HB)
  console.log(`  node     ${nodeAddr}\n`)

  // Publish the REAL gate — the same artefact stage and live run, by the same route
  // (`hb_message:commit` + `hb_cache:write` inside the container), not a copy adapted for a test.
  // GATE_SRC swaps in an instrumented copy without touching the artefact stage and live run.
  const gateSrc = process.env.GATE_SRC || path.join(AO, 'runtime/write-gate.lua')
  if (gateSrc !== path.join(AO, 'runtime/write-gate.lua')) console.log(`  gate src ${gateSrc}`)
  podman(['cp', gateSrc, `${NAME}:/tmp/wg.lua`], 300_000)
  podman(['exec', NAME, './bin/hb', 'eval',
    `{ok,S}=file:read_file("/tmp/wg.lua"), M=hb_message:commit(#{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>, <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>, <<"name">> => <<"write-gate">>, <<"body">> => S }, #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), {ok,_}=hb_cache:write(M,#{}), ok=file:write_file("/tmp/wg.id", hb_util:id(M)).`],
    600_000)
  const gateModuleId = podman(['exec', NAME, 'cat', '/tmp/wg.id'], 60_000).trim()
  console.log(`  gate mod ${gateModuleId}`)

  // A trivial process, spawned ungated. What it computes is irrelevant — the subject is the
  // ASSIGNMENT the scheduler uploads, which is the same shape whatever the process does.
  const { pid } = await spawnLuaProcess({ url: HB, signer: deployer }, {
    luaSource: `function compute(p,m,o) p.results={output={data='ok'}}; return p end`,
    schedulerLocation: nodeAddr,
    tags: [{ name: 'name', value: 'bundler-repro' }] })
  console.log(`  process  ${pid}\n`)

  const results: Record<string, { unsigned: number, queued: number, assigned: number }> = {}

  for (const mode of ['faff', 'gate'] as const) {
    console.log(`  --- pricing-device: ${mode === 'faff' ? 'faff@1.0  (dev)' : 'lua@5.3a  (stage + live)'} ---`)
    writeConfig({ mode, pids: [pid], gateModuleId, nodeAddr, bundler: 'http://127.0.0.1:8734' })
    await restartInto(mode)

    // The ephemeral wallet is generated once and kept on disk, but assert rather than assume:
    // a regenerated identity would silently invalidate both wallet lists and fake a refusal.
    const addrNow = await fetchNodeAddress(HB)
    check(addrNow === nodeAddr, `[${mode}] node identity survived the restart`, addrNow)

    // LEG 1 — the mechanism, in one request.
    const un = await unsignedGet('/~router@1.0/routes')
    console.log(`       unsigned request -> HTTP ${un.status} ${un.refused ? 'REFUSED' : 'admitted'}  ${un.body.slice(0, 60)}`)

    // The subject rule must not be usable off the bundler route. That is NOT tested here: a
    // hand-rolled forgery never decodes and is refused identically by the vulnerable build, so it
    // passes for the wrong reason. It needs a captured real envelope replayed at a push path —
    // scripts/probe/gate-subject-replay.ts does exactly that, and fails on the unconfined gate.

    // LEG 2 — a real write. The scheduler uploads message + assignment to the loopback bundler
    // INLINE (`scheduling_mode` defaults to `sync`), so by the time this resolves the upload has
    // already been attempted and its result thrown away.
    const mark = logs().length
    let sent = ''
    try {
      const r = await sendMessage({ url: HB, signer: deployer }, {
        pid, tags: [{ name: 'action', value: `Repro-${mode}` }] })
      sent = `slot ${r.slot}`
    } catch (e: unknown) { sent = `push failed: ${String(e).slice(0, 80)}` }
    await sleep(4000)

    const tail = logsSince(mark)
    const queued = (tail.match(/queueing_item/g) ?? []).length
    const verifyFailed = (tail.match(/verify_failed/g) ?? []).length
    console.log(`       write ${sent}`)
    console.log(`       bundler: queueing_item x${queued}, verify_failed x${verifyFailed}`)
    results[mode] = { unsigned: un.refused ? 1 : 0, queued, assigned: sent.startsWith('slot') ? 1 : 0 }

    if (process.env.VERBOSE === '1') {
      const lines = tail.split('\n').filter(l => /bundler|queueing|verify_failed|estimate|price|lua/i.test(l))
      for (const l of lines.slice(0, 40)) console.log(`       | ${l.slice(0, 200)}`)
    }
    console.log('')
  }

  // --- the assertion --------------------------------------------------------------
  //
  // This is a REGRESSION TEST, not only a reproduction: the passing condition is the behaviour
  // we want, so it fails on the unfixed gate and keeps failing if the fix is ever lost. The
  // diagnosis is printed on failure so a red run explains itself.
  check(results.faff.assigned === 1 && results.gate.assigned === 1,
    'the WRITE itself is admitted under both pricing devices (the deployer is signed and listed)',
    `faff ${results.faff.assigned}, gate ${results.gate.assigned}`)
  check(results.faff.queued > 0,
    'CONTROL — under faff the node\'s own upload reaches the bundler',
    `queueing_item x${results.faff.queued}`)
  check(results.gate.queued > 0,
    'under the GATE the node\'s own upload reaches the bundler too',
    `queueing_item x${results.gate.queued}`)


  if (results.faff.queued > 0 && results.gate.queued === 0) {
    console.log(`\n  DIAGNOSIS — the node's upload is refused before the bundler sees it.`)
    console.log(`  Expected if this image lacks patch 0004: \`dev_lua:do_encode/2\` cannot encode a`)
    console.log(`  cache link, so p4 cannot price the request and answers HTTP 400. Confirm it with`)
    console.log(`    HB_PRINT=lua,lua_error  and look for luerl:encode/2 at luerl.erl:439`)
    console.log(`  immediately after the request dump containing \`bundler-subject => body\`.`)
    console.log(`  Do NOT read this as the gate refusing: substitute a gate that returns ADMIT`)
    console.log(`  unconditionally and check again before concluding anything about the gate.`)
    console.log(`  (For context, LEG 1 this run: unsigned request ${results.faff.unsigned ? 'refused' : 'admitted'} under faff,`)
    console.log(`  ${results.gate.unsigned ? 'refused' : 'admitted'} under the gate. Real, and not the cause.)`)
  }

  console.log(`\n${fails === 0 ? 'PASS' : 'FAILED'} — ${checks - fails}/${checks} checks`)
  if (process.env.KEEP === '1') console.log(`  KEEP=1 — ${NAME} left up, config ${CFG}`)
  else { podman(['rm', '-f', NAME], 60_000); fs.rmSync(WORK, { recursive: true, force: true }) }
  process.exit(fails === 0 ? 0 : 1)
})().catch(e => {
  console.error(e)
  try { console.log(podman(['logs', '--tail', '40', NAME])) } catch {}
  if (process.env.KEEP !== '1') podman(['rm', '-f', NAME], 60_000)
  process.exit(2)
})
