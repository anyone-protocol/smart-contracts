// Phase 1 end-to-end — the write gate answering from LIVE contract state.
//
// Phase 0 proved the mechanism with a hardcoded address and refused in 4 ms. That number does
// NOT carry over: a gate that reads contracts pays those reads on every decision, and the
// refusal path is the attacker's path. This measures the real thing.
//
// The question it answers: is a contract-reading gate still meaningfully cheaper than letting
// the write land and be rejected in-contract (445 ms + a full slot + a state write)? The slot
// and the storage are saved either way — that is the DoS fix and it is not in doubt. What is in
// doubt is latency, and it feeds directly into the open decision between a stored index and a
// node-side cached pull.
//
// Covers BOTH gated shapes:
//   · operator-registry — its own allowlist carries owner, admins AND operators (one read)
//   · relay-rewards     — its allowlist carries owner + admins only, so an OPERATOR reaches it
//                         through the fallthrough to operator-registry (two reads)
// The fallthrough is the half that cannot be inferred from the opreg case, because it is the
// only place the gate consults a contract other than the one being written to.
//
// Sequencing note: the gate has to name the processes it protects, which do not exist until they
// are spawned. So the node starts WITHOUT p4, seeds the contracts, then the config is rewritten
// IN PLACE (same inode — replacing the file would break the bind mount) and the container is
// restarted onto the same store.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'node:child_process'
import { EthereumSigner, createData } from '@dha-team/arbundles'
import { computeAddress, hexlify } from 'ethers'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from '../util/hb-client'
import { seedEnvelopeFor } from '../util/native-bundle'
import { requireDeployerKey } from '../util/helpers'

const IMAGE = process.env.IMAGE || 'hyperbeam-luaenc:local'
const NAME = 'hb-gate-e2e'
const HB = 'http://localhost:8734'
const RELDIR = '/app/_build/default/rel/hb'
const HERE = path.resolve(import.meta.dir)
const AO = path.resolve(HERE, '../..')
const WORK = fs.mkdtempSync('/tmp/gate-e2e-')
const CFG = path.join(WORK, 'config.json')

const sleep = (n: number) => new Promise(r => setTimeout(r, n))
const podman = (a: string[], t = 120_000) => execFileSync('podman', a, { encoding: 'utf8', timeout: t })

let fails = 0, checks = 0
const check = (ok: boolean, label: string, detail = '') => {
  checks++; if (!ok) fails++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  — ' + detail : ''}`)
}

const deployer = new EthereumSigner(requireDeployerKey())
const deployerAddr = computeAddress(hexlify(deployer.publicKey))
const stranger = new EthereumSigner(crypto.randomBytes(32).toString('hex'))
const strangerAddr = computeAddress(hexlify(stranger.publicKey))

const writeConfig = (gatedPids: string[], opreg = '', gateModuleId = '', deployWallets: string[] = []) => {
  // The gate is referenced BY MODULE ID, exactly as the contracts are — not inlined. 9.8KB of
  // escaped Lua in a jobspec is something Nomad will reject, and a copy of the source in a second
  // repo can drift from the runtime whose allowlist format it parses. A content-addressed id
  // cannot drift: different source is a different id, so there is nothing to keep in step.
  const p4 = gatedPids.length
    ? [{
        device: 'p4@1.0', 'pricing-device': 'lua@5.3a', 'ledger-device': 'faff@1.0',
        'gated-processes': gatedPids,
        'operator-registry': opreg,
        'deploy-wallets': deployWallets,
        module: gateModuleId,
      }]
    : []
  const cfg = {
    // The PRODUCTION hook chain, in order — not a minimal one. verify-access-policy.ts asserts
    // "exactly 6 hooks" and reads the p4 entry at index 5, so a shorter chain here would let the
    // local run pass while the deployed shape differs.
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
    // LOCKDOWN, not preservation. Free reads are granted to OUR processes ONLY, per-PID — a
    // generic `^/<43-char>~process@1.0/now` template would hand every process on the node free
    // public reads, including ones we have nothing to do with. Everything not listed here goes
    // through the gate, which refuses anything unsigned or not aimed at a gated PID.
    // Six entries, matching the jobspec: three PID read carve-outs + the three node devices.
    'p4-non-chargable-routes': [
      ...gatedPids.map(p => ({ template: `^/${p}~process@1.0/(now|compute|slot)` })),
      { template: '^/~meta@1.0' },
      { template: '^/~hyperbuddy@1.0' },
      { template: '^/~query@1.0' },
    ],
    'rate-limit-requests': 100000, 'rate-limit-max': 100000, 'rate-limit-period': 60,
    // faff is still the LEDGER device; its list governs everything the gate does not.
    'faff-allow-list': deployWallets,
  }
  // Truncate-in-place so the bind mount keeps pointing at the same inode.
  const fd = fs.openSync(CFG, 'w'); fs.writeSync(fd, JSON.stringify(cfg, null, 2)); fs.closeSync(fd)
}

const waitUp = async (n = 90) => {
  for (let i = 0; i < n; i++) {
    if ((await fetch(`${HB}/~meta@1.0/info/address`).catch(() => null))?.ok) return true
    await sleep(2000)
  }
  return false
}

const push = async (signer: EthereumSigner, pid: string, action: string) => {
  const item = createData(new Uint8Array(0) as never, signer, {
    tags: [
      { name: 'type', value: 'Message' }, { name: 'data-protocol', value: 'ao' },
      { name: 'variant', value: 'ao.N.1' }, { name: 'action', value: action },
    ],
    target: pid,
  })
  await item.sign(signer)
  const t0 = Date.now()
  const res = await fetch(`${HB}/${pid}~process@1.0/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/ans104', 'codec-device': 'ans104@1.0' },
    body: item.getRaw() as unknown as BodyInit,
    signal: AbortSignal.timeout(120_000),
  })
  const body = (await res.text()).replace(/\s+/g, ' ')
  return { ms: Date.now() - t0, status: res.status, body }
}

const slotOf = async (pid: string) => {
  const t = (await (await fetch(`${HB}/${pid}~process@1.0/slot/current`)).text()).trim()
  return /^\d+$/.test(t) ? parseInt(t, 10) : NaN
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]

;(async () => {
  console.log(`\n=== Phase 1 — gate reading live contract state ===`)
  console.log(`  deployer ${deployerAddr}  (spawns the registry, so its Owner)`)
  console.log(`  stranger ${strangerAddr}`)

  podman(['rm', '-f', NAME], 60_000)
  writeConfig([])
  podman(['run', '-d', '--name', NAME, '--network', 'host',
    '-v', `${CFG}:${RELDIR}/config.json:ro,Z`,
    '-e', 'HB_CONFIG=config.json', '-e', 'HB_ALLOW_EPHEMERAL_WALLET=true',
    // dev_p4 swallows the pricing device's error; HB_PRINT=lua_error,lua is the only way to
    // see why an estimate failed.
    ...(process.env.HB_PRINT ? ['-e', `HB_PRINT=${process.env.HB_PRINT}`] : []),
    IMAGE])
  if (!await waitUp()) { console.log(podman(['logs', '--tail', '30', NAME])); process.exit(2) }

  // --- seed a real registry, ungated -------------------------------------------------
  const abs = path.join(AO, 'dist/operator-registry-native.lua')
  if (!fs.existsSync(abs)) throw new Error('missing dist/ — run scripts/run-e2e.ts first')
  podman(['cp', abs, `${NAME}:/tmp/g.lua`], 300_000)
  podman(['exec', NAME, './bin/hb', 'eval',
    `{ok,S}=file:read_file("/tmp/g.lua"), M=hb_message:commit(#{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>, <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>, <<"name">> => <<"gate-opreg">>, <<"body">> => S }, #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), {ok,_}=hb_cache:write(M,#{}), ok=file:write_file("/tmp/g.id", hb_util:id(M)).`],
    600_000)
  const modId = podman(['exec', NAME, 'cat', '/tmp/g.id'], 60_000).trim()

  const relayAbs = path.join(AO, 'dist/relay-rewards-native.lua')
  podman(['cp', relayAbs, `${NAME}:/tmp/r.lua`], 300_000)
  podman(['exec', NAME, './bin/hb', 'eval',
    `{ok,S}=file:read_file("/tmp/r.lua"), M=hb_message:commit(#{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>, <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>, <<"name">> => <<"gate-relay">>, <<"body">> => S }, #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), {ok,_}=hb_cache:write(M,#{}), ok=file:write_file("/tmp/r.id", hb_util:id(M)).`],
    600_000)
  const relayModId = podman(['exec', NAME, 'cat', '/tmp/r.id'], 60_000).trim()

  podman(['cp', path.join(AO, 'dist/staking-rewards-native.lua'), `${NAME}:/tmp/s.lua`], 300_000)
  podman(['exec', NAME, './bin/hb', 'eval',
    `{ok,S}=file:read_file("/tmp/s.lua"), M=hb_message:commit(#{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>, <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>, <<"name">> => <<"gate-staking">>, <<"body">> => S }, #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), {ok,_}=hb_cache:write(M,#{}), ok=file:write_file("/tmp/s.id", hb_util:id(M)).`],
    600_000)
  const stakingModId = podman(['exec', NAME, 'cat', '/tmp/s.id'], 60_000).trim()

  // Publish the gate the same way — one artefact, one id, in the node's cache.
  podman(['cp', path.join(AO, 'runtime/write-gate.lua'), `${NAME}:/tmp/wg.lua`], 300_000)
  podman(['exec', NAME, './bin/hb', 'eval',
    `{ok,S}=file:read_file("/tmp/wg.lua"), M=hb_message:commit(#{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>, <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>, <<"name">> => <<"write-gate">>, <<"body">> => S }, #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), {ok,_}=hb_cache:write(M,#{}), ok=file:write_file("/tmp/wg.id", hb_util:id(M)).`],
    600_000)
  const gateModId = podman(['exec', NAME, 'cat', '/tmp/wg.id'], 60_000).trim()
  console.log(`  gate mod ${gateModId}`)

  const { pid } = await spawnLuaProcess({ url: HB, signer: deployer }, {
    moduleId: modId, schedulerLocation: await fetchNodeAddress(HB),
    spawnData: seedEnvelopeFor('operator-registry'),
    tags: [{ name: 'name', value: 'gate-e2e-registry' }] })
  console.log(`  registry ${pid}`)

  let counts: any = null
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${HB}/${pid}~process@1.0/now/~lua@5.3a/status`)
    if (r.ok) { counts = JSON.parse(await r.text()).counts; break }
    await sleep(2000)
  }
  if (!counts) { console.log('  registry never seeded'); process.exit(2) }
  console.log(`  seeded   ${JSON.stringify(counts)}`)

  // The allowlist seeds at SLOT 0 — the spawn message itself — alongside the state seed, so no
  // message is needed to build it. What IS needed is for slot 0 to have been COMPUTED once: on a
  // never-computed process every `compute/…` read 508s with "Request creates infinite recursion",
  // including the Owner's committer read, so the gate has nothing to consult. The `now/status`
  // poll above already forced that compute (~6 s, the state seed). Measured with
  // scripts/probe/seed-on-spawn.ts: this message leaves `allowlistId` byte-identical, i.e. it
  // contributes nothing — it stays only because the checks below need a known slot boundary.
  // There is no deploy deadlock: `now` sits in p4-non-chargable-routes, so the compute that
  // arms the gate is a free read that never reaches the gate.
  await sendMessage({ url: HB, signer: deployer }, { pid, tags: [{ name: 'action', value: 'Seed-Nudge' }] })
  await sleep(1500)
  const seededId = (await (await fetch(`${HB}/${pid}~process@1.0/compute/allowlistId`)).text()).trim()
  check(/^[A-Za-z0-9_-]{43}$/.test(seededId), 'allowlist seeded before the gate is enabled',
    seededId.slice(0, 46))

  const roles = JSON.parse(await (await fetch(`${HB}/${pid}~process@1.0/compute/~lua@5.3a/roles`)).text())
  const roleName = Object.keys(roles).find(k => Object.keys(roles[k] ?? {}).some(a => a.startsWith('0x')))!
  const roleAddr = Object.keys(roles[roleName]).find(a => a.startsWith('0x'))!
  console.log(`  role     ${roleName} -> ${roleAddr}\n`)

  // relay-rewards: owner + admins only. An operator has NO entry here, so admitting one proves
  // the fallthrough rather than a local hit.
  const { pid: relayPid } = await spawnLuaProcess({ url: HB, signer: deployer }, {
    moduleId: relayModId, schedulerLocation: await fetchNodeAddress(HB),
    spawnData: seedEnvelopeFor('relay-rewards'),
    tags: [{ name: 'name', value: 'gate-e2e-relay' }] })
  console.log(`  relay    ${relayPid}`)
  await sendMessage({ url: HB, signer: deployer }, { pid: relayPid, tags: [{ name: 'action', value: 'Seed-Nudge' }] })
  await sleep(2000)

  // An operator we can actually SIGN as. The seeded operators are real addresses whose keys we
  // do not have, so mint one the way the protocol does: an admin assigns it a claimable
  // fingerprint, which is exactly the bootstrap path and puts it on opreg's allowlist only.
  const operatorSigner = new EthereumSigner(crypto.randomBytes(32).toString('hex'))
  const operator = computeAddress(hexlify(operatorSigner.publicKey))
  await sendMessage({ url: HB, signer: deployer }, { pid,
    tags: [{ name: 'action', value: 'Admin-Submit-Operator-Certificates' }],
    data: JSON.stringify([{ f: 'FADE' + '0'.repeat(36), a: operator }]) })
  await sleep(2000)
  const onOpreg = await (await fetch(
    `${HB}/${pid}~process@1.0/compute/allowlistId/~trie@1.0/${operator}`)).text()
  console.log(`  operator ${operator}  (opreg allowlist: ${JSON.stringify(onOpreg.trim())})`)

  const { pid: stakingPid } = await spawnLuaProcess({ url: HB, signer: deployer }, {
    moduleId: stakingModId, schedulerLocation: await fetchNodeAddress(HB),
    spawnData: seedEnvelopeFor('staking-rewards'),
    tags: [{ name: 'name', value: 'gate-e2e-staking' }] })
  await sendMessage({ url: HB, signer: deployer }, { pid: stakingPid, tags: [{ name: 'action', value: 'Seed-Nudge' }] })
  await sleep(2000)
  console.log(`  staking  ${stakingPid}`)

  // An ungated process, spawned BEFORE the gate goes on — afterwards spawns are refused for
  // anyone but a deploy wallet, which is the point.
  const { pid: foreign } = await spawnLuaProcess({ url: HB, signer: deployer }, {
    luaSource: `function compute(p,m,o) p.results={output={data='x'}}; return p end`,
    schedulerLocation: await fetchNodeAddress(HB),
    tags: [{ name: 'name', value: 'ungated-process' }] })
  console.log(`  ungated  ${foreign}`)

  // --- now install the gate and restart onto the same store ---------------------------
  writeConfig([pid, relayPid, stakingPid], pid, gateModId, [deployerAddr])
  podman(['restart', NAME], 180_000)
  if (!await waitUp()) { console.log(podman(['logs', '--tail', '30', NAME])); process.exit(2) }

  // List-valued opts serialize their MESSAGE entries as `<n>+link` refs, so the p4 hook is not
  // visible in the container — it has to be fetched per index. (Same trap as verify-access-policy.)
  // The hook's own `device` key is shadowed by the serializer's in the JSON rendering, so assert
  // on the p4-specific keys instead — they only exist on a p4 hook.
  // 1-BASED over HTTP, and p4 is last in the 6-hook production chain -> index 6. (Index 2 was
  // right only while this probe rendered a minimal 2-hook chain.)
  const hook = await (await fetch(`${HB}/~meta@1.0/info/on/request/6/serialize~json@1.0`)).text()
  check(/"pricing-device":"lua@5\.3a"/.test(hook) && /"ledger-device":"faff@1\.0"/.test(hook),
    'gate is installed on on/request after restart', hook.slice(0, 90))
  check(!Number.isNaN(await slotOf(pid)), 'registry survived the restart', `slot ${await slotOf(pid)}`)

  // --- the decisions ------------------------------------------------------------------
  const before = await slotOf(pid)

  const owner = await push(deployer, pid, 'Noop-Owner')
  check(owner.status < 400, 'OWNER admitted (spawn committer, read from the commitment)',
    `HTTP ${owner.status} in ${owner.ms} ms`)

  const strangerRes = await push(stranger, pid, 'Noop-Stranger')
  check(strangerRes.status === 400 && /will not service/i.test(strangerRes.body),
    'STRANGER refused', `HTTP ${strangerRes.status} in ${strangerRes.ms} ms`)

  await sleep(1500)
  const after = await slotOf(pid)
  check(after === before + 1,
    'exactly ONE slot consumed — the owner write landed, the stranger cost nothing',
    `slot ${before} -> ${after}`)

  // --- the fallthrough: operator-registry consulted for a write to relay-rewards --------
  console.log(`\n  --- relay-rewards (operator set lives in operator-registry) ---`)
  const relayBefore = await slotOf(relayPid)

  // A trie MISS is HTTP 404 with an HTML body — not an empty 200. Asserting on the body would
  // pass for the wrong reason (or, as it did here, fail while the underlying fact was correct).
  const notOnRelay = await fetch(
    `${HB}/${relayPid}~process@1.0/compute/allowlistId/~trie@1.0/${operator}`)
  const notOnRelayBody = (await notOnRelay.text()).trim()
  check(!notOnRelay.ok || notOnRelayBody === '',
    'the operator has NO entry on relay-rewards (so admission can only come from the fallthrough)',
    `HTTP ${notOnRelay.status}`)

  const opRelay = await push(operatorSigner, relayPid, 'Set-Delegate')
  check(opRelay.status < 400,
    'OPERATOR admitted to relay-rewards via the operator-registry fallthrough',
    `HTTP ${opRelay.status} in ${opRelay.ms} ms`)

  const strangerRelay = await push(stranger, relayPid, 'Set-Delegate')
  check(strangerRelay.status === 400 && /will not service/i.test(strangerRelay.body),
    'a stranger is still refused on relay-rewards', `HTTP ${strangerRelay.status} in ${strangerRelay.ms} ms`)

  await sleep(1500)
  const relayAfter = await slotOf(relayPid)
  check(relayAfter === relayBefore + 1,
    'exactly ONE slot on relay-rewards — the operator write landed, the stranger cost nothing',
    `slot ${relayBefore} -> ${relayAfter}`)
  console.log(`  fallthrough admission ${opRelay.ms} ms, refusal ${strangerRelay.ms} ms (two reads)`)

  // --- lockdown: the node is not a free read service for processes we do not run ---------
  console.log(`\n  --- lockdown ---`)
  const readOk = await fetch(`${HB}/${pid}~process@1.0/now/~lua@5.3a/status`)
  check(readOk.ok, 'unsigned READ of a gated contract is free (D3 public reads)',
    `HTTP ${readOk.status}`)

  const slotOk = await fetch(`${HB}/${pid}~process@1.0/slot/current`)
  check(slotOk.ok, 'unsigned /slot read of a gated contract is free', `HTTP ${slotOk.status}`)

  const foreignRead = await fetch(`${HB}/${foreign}~process@1.0/now`)
  check(foreignRead.status === 400,
    'unsigned read of an UNGATED process is REFUSED (no free reads for processes we do not run)',
    `HTTP ${foreignRead.status}`)

  const foreignWrite = await push(stranger, foreign, 'Noop')
  check(foreignWrite.status === 400 && /will not service/i.test(foreignWrite.body),
    'a stranger cannot write to an ungated process either', `HTTP ${foreignWrite.status}`)

  // --- cost, which is the point of this probe ------------------------------------------
  const denies: number[] = [], admits: number[] = []
  for (let i = 0; i < 5; i++) {
    denies.push((await push(stranger, pid, `deny-${i}`)).ms)
    admits.push((await push(deployer, pid, `admit-${i}`)).ms)
  }
  console.log(`\n  REFUSAL   ${String(med(denies)).padStart(5)} ms  (the attacker's path)`)
  console.log(`  admission ${String(med(admits)).padStart(5)} ms  (owner: short-circuits on the first check)`)
  console.log(`  vs 445 ms + a full slot + a state write for an in-contract ACL rejection`)
  console.log(`  vs 4 ms for the Phase 0 gate, which read no contracts at all`)

  console.log(`\n${fails === 0 ? 'PASS' : 'FAILED'} — ${checks - fails}/${checks} checks`)
  // Hand the verifier a real gated node to check BEFORE any of this reaches dev. Its gated
  // branch is otherwise only ever exercised by PERTURB, i.e. only ever seen failing.
  if (process.env.VERIFY === '1') {
    console.log(`\n=== verify-access-policy.ts against the local gated node ===`)
    try {
      const out = execFileSync('bun', ['run', path.join(AO, 'scripts/verify-access-policy.ts'), 'local'], {
        encoding: 'utf8', timeout: 600_000,
        env: { ...process.env, LOCAL_HOST: 'localhost:8734', LOCAL_GATED: 'true',
               LOCAL_ALLOW_LIST: deployerAddr },
      })
      console.log(out)
    } catch (e: any) {
      console.log(e.stdout ?? String(e))
      fails++
    }
  }

  if (process.env.KEEP === '1') console.log(`  KEEP=1 — ${NAME} left up, config ${CFG}`)
  else { podman(['rm', '-f', NAME], 60_000); fs.rmSync(WORK, { recursive: true, force: true }) }
  process.exit(fails === 0 ? 0 : 1)
})().catch(e => {
  console.error(e)
  try { console.log(podman(['logs', '--tail', '30', NAME])) } catch {}
  if (process.env.KEEP !== '1') podman(['rm', '-f', NAME], 60_000)
  process.exit(2)
})
