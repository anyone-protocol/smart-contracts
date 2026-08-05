// Tier-3 SUSTAINED vertical — many rounds, realistic width, every remaining action, and a
// node restart in the middle.
//
// WHY. The existing Tier-3 verticals are parity tests: one round, compared byte-for-byte against a
// luerl oracle. That is the right test for the reward math, and it is structurally blind to
// everything that has actually cost this migration time — write cost that grows with accumulated
// slots, the luerl snapshot leak, snapshot/restore fidelity. Those only appear on a live node
// across many slots. A one-round E2E cannot see them, and neither can Tier-1/Tier-2 (which do
// cover multi-round math: 10 Complete-Rounds for relay, 7 for staking, in busted).
//
// So this vertical deliberately trades parity for DURATION and BREADTH:
//   A  spawn from the real seed
//   B  ROUNDS x (batched Add-Scores -> Complete-Round) at realistic width, timed, disk measured
//   C  cross-round accumulation: tracked keys must STRICTLY increase every round
//   D  Claim-Rewards for real — claim, keep earning, assert the claim stays frozen, re-claim
//   E  the actions no live test has ever executed: Cancel-Round, Update-Configuration,
//      Set-Delegate / Toggle-Feature-Shares + Update-Shares-Configuration + Set-Share
//   F  ACL negative: an unprivileged signer's write is rejected AND changes nothing
//   G  restart the node mid-life: full dump must survive byte-identical, then keep running
//
// It doubles as the standing regression test for the dev_lua snapshot GC fix: run it against a
// patched and an unpatched node and compare the per-round timing column and the disk column.
// (Before that fix a run this long was impractical — per-write latency climbed with every slot.)
//
// Run:
//   HB_URL=… MODULE_ID=… CONTAINER=hb-gc bun run scripts/tier3-sustained.ts relay
//   HB_URL=… MODULE_ID=… CONTAINER=hb-gc bun run scripts/tier3-sustained.ts staking
// CONTAINER is optional: without it the restart section (G) and the disk column are skipped.
import { EthereumSigner } from '@dha-team/arbundles'
import { Wallet, getAddress } from 'ethers'
import { execFileSync } from 'node:child_process'
import fs from 'fs'
import path from 'path'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from './util/hb-client'
import { seedEnvelopeFor } from './util/native-bundle'
import { buildRelayRound } from './util/relay-round'
import { buildRound as buildStakingRound } from './util/staking-round'

const CONTRACT = (process.argv[2] || '').toLowerCase()
if (CONTRACT !== 'relay' && CONTRACT !== 'staking') {
  console.error('usage: bun run scripts/tier3-sustained.ts <relay|staking>'); process.exit(2)
}
const RELAY = CONTRACT === 'relay'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID
if (!MODULE_ID) { console.error('MODULE_ID env required'); process.exit(2) }
const CONTAINER = process.env.CONTAINER || ''
const ENGINE = process.env.CONTAINER_ENGINE || 'podman'
const ROUNDS = Number(process.env.ROUNDS || 10)
const WIDTH = Number(process.env.WIDTH || (RELAY ? 300 : 250))
const BATCH = Number(process.env.BATCH || 100)
const RESTART_AFTER = Number(process.env.RESTART_AFTER || Math.ceil(ROUNDS / 2))

const OWNER_KEY = (process.env.DEPLOYER_PRIVATE_KEY
  || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
// Second wallet with NO role on this process. D29 established that an unprivileged write is
// admitted, rejected, and still consumes a slot — so "rejected" is not enough on its own, the
// state has to be provably untouched afterwards.
const STRANGER_KEY = '59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const owner = new EthereumSigner(OWNER_KEY)
const stranger = new EthereumSigner(STRANGER_KEY)
const OWNER = new Wallet('0x' + OWNER_KEY).address
const STRANGER = new Wallet('0x' + STRANGER_KEY).address

const AO = path.resolve(import.meta.dir, '..')
const seedFile = RELAY ? 'dist/relay-rewards-seed.expected.json' : 'dist/staking-rewards-seed.expected.json'
const expected = JSON.parse(fs.readFileSync(path.join(AO, seedFile), 'utf8'))
const STORE = '/app/_build/default/rel/hb/cache-mainnet'

// ---- assertions -------------------------------------------------------------
let pass = 0, fail = 0
const failures: string[] = []
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}${detail ? '  — ' + detail : ''}`) }
  else { fail++; failures.push(label); console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) }
}
const section = (s: string) => console.log(`\n=== ${s} ===`)

// ---- node I/O ---------------------------------------------------------------
let pid: string
const P = () => `${HB}/${pid}~process@1.0`
const raw = async (key: string) => (await fetch(`${P()}/now/${key}`)).text()
const view = async (v: string) => {
  const r = await fetch(`${P()}/now/~lua@5.3a/${v}`)
  const b = await r.text()
  if (!r.ok) throw new Error(`view ${v} -> ${r.status}: ${b.replace(/\s+/g, ' ').slice(0, 160)}`)
  return JSON.parse(b)
}
/** Send and return the handler's output string ('OK', a JSON payload, or an error message). */
async function send (signer: EthereumSigner, action: string, tags: Record<string, string> = {}, data = '') {
  const taglist = [{ name: 'action', value: action },
    ...Object.entries(tags).map(([name, value]) => ({ name, value: String(value) }))]
  const t0 = performance.now()
  await sendMessage({ url: HB, signer }, { pid, tags: taglist, data })
  const ms = Math.round(performance.now() - t0)
  return { out: (await raw('results/output/data')).trim(), ms }
}
const diskBytes = () => {
  if (!CONTAINER) return 0
  try {
    return Number(execFileSync(ENGINE, ['exec', CONTAINER, 'du', '-sb', STORE],
      { encoding: 'utf8', timeout: 120_000 }).trim().split(/\s+/)[0])
  } catch { return 0 }
}
const mib = (b: number) => (b / 1024 / 1024).toFixed(0)
// A base-addressed point read of an absent key answers with an HTML error page, not a number.
// Coerce anything that is not a plain decimal integer to 0 so a missing balance reads as "no
// reward yet" instead of throwing and killing the run.
const amount = (s: string) => /^\d+$/.test(s.trim()) ? BigInt(s.trim()) : 0n
const sleep = (s: number) => new Promise(r => setTimeout(r, s * 1000))
async function waitUp () {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${HB}/~meta@1.0/info`, { signal: AbortSignal.timeout(5000) })).ok) return }
    catch { /* booting */ }
    await sleep(2)
  }
  throw new Error('node did not come back after restart')
}
const chunk = <T>(entries: [string, T][], size: number) => {
  const out: [string, T][][] = []
  for (let i = 0; i < entries.length; i += size) out.push(entries.slice(i, i + size))
  return out
}

// ---- per-contract round shapes ----------------------------------------------
// Both contracts take Add-Scores{Round-Timestamp, data:{Scores}} then Complete-Round{Round-Timestamp}.
// What differs is the Scores payload and which keys accumulate.
type RoundPlan = {
  timestamp: number
  entries: [string, unknown][]      // top-level Scores entries, batched as-is
  trackedReads: string[]            // base-addressed point reads that must strictly increase
  claimAddress: string              // the address whose claim semantics section D exercises
}

// Built lazily: the staking builder reads seed fields that only exist in the staking seed, so
// constructing it eagerly blows up a relay run.
const stakingSeedRound = RELAY ? null : buildStakingRound(expected.state, WIDTH)

// The tracked pair must actually EARN every round or monotonicity is not assertable. buildRound
// deliberately puts some pairs below the Running gate (its first pair is 0.25), and a gated pair
// earns nothing — which reads as a broken test rather than as correct behaviour. So pick a pair
// that is already above the gate, and pin its Running to 1 in every round.
// It must also be a pair with a PRIOR in the seed. buildRound mixes in brand-new operators
// (Running 1, no prior) to exercise the no-prior branch; tracking one of those means the
// pre-round read is a 404, not a number.
function pickTrackedPair (): [string, string] {
  for (const [h, ops] of Object.entries(stakingSeedRound!.scores)) {
    for (const [o, s] of Object.entries(ops)) {
      if (s.Running === 1 && expected.state.Rewarded[h]?.[o] != null) return [h, o]
    }
  }
  throw new Error('no ungated pair with a seeded prior to track')
}
const [STAKING_TRACKED_HODLER, STAKING_TRACKED_OP] = stakingSeedRound ? pickTrackedPair() : ['', '']

function planRound (round: number): RoundPlan {
  if (RELAY) {
    const r = buildRelayRound(expected.state, WIDTH, round)
    return {
      timestamp: r.timestamp,
      entries: Object.entries(r.scores),
      trackedReads: [
        ...r.tracked.map(fp => `state/TotalFingerprintReward/${fp}`),
        `state/TotalAddressReward/${r.trackedAddress}`,
      ],
      claimAddress: r.trackedAddress,
    }
  }
  // Staking: reuse the shared round definition, re-timestamped per round and with Staked scaled so
  // successive rounds are distinct inputs. Parity against the oracle is NOT the job here — the
  // one-round vertical already owns that — so varying the amounts is safe.
  const scores: Record<string, Record<string, { Staked: string, Running: number }>> = {}
  for (const [h, ops] of Object.entries(stakingSeedRound!.scores)) {
    scores[h] = {}
    for (const [o, s] of Object.entries(ops)) {
      scores[h][o] = { Staked: String(BigInt(s.Staked) + BigInt(round) * 10n ** 18n), Running: s.Running }
    }
  }
  scores[STAKING_TRACKED_HODLER][STAKING_TRACKED_OP].Running = 1   // keep the tracked pair earning
  return {
    timestamp: expected.state.PreviousRound.Timestamp + round * 3600_000,
    entries: Object.entries(scores),
    trackedReads: [`state/Rewarded/${STAKING_TRACKED_HODLER}/${STAKING_TRACKED_OP}`],
    claimAddress: STAKING_TRACKED_HODLER,
  }
}

// ---- run --------------------------------------------------------------------
;(async () => {
  console.log(`\n════════ TIER-3 SUSTAINED — ${CONTRACT} ════════`)
  console.log(`node    ${await fetchNodeAddress(HB)}`)
  console.log(`module  ${MODULE_ID}`)
  console.log(`owner   ${OWNER}\nstranger ${STRANGER} (no role)`)
  console.log(`plan    ${ROUNDS} rounds x ${WIDTH} ${RELAY ? 'fingerprints' : 'pairs'}, batches of ${BATCH}`
    + `${CONTAINER ? `, restart after round ${RESTART_AFTER}` : ', no restart (no CONTAINER)'}`)

  section('A. spawn from the real seed')
  const spawned = await spawnLuaProcess({ url: HB, signer: owner },
    { moduleId: MODULE_ID, spawnData: seedEnvelopeFor(RELAY ? 'relay-rewards' : 'staking-rewards'),
      tags: [{ name: 'name', value: `sustained-${CONTRACT}-${Date.now()}` }] })
  pid = spawned.pid
  console.log(`  pid=${pid}`)
  let status: any
  for (let i = 0; i < 40; i++) {
    try { status = await view('status'); break } catch { await sleep(1.5) }
  }
  check('seed materialized', !!status, status ? JSON.stringify(status.counts) : 'status never answered')
  if (!status) process.exit(1)
  const diskStart = diskBytes()

  section(`B/C. ${ROUNDS} sustained rounds + cross-round accumulation`)
  const timings: { round: number, msgs: number, addMs: number, completeMs: number, disk: number }[] = []
  let prevTracked: string[] = await Promise.all(planRound(1).trackedReads.map(k => raw(k).then(s => s.trim())))
  let restarted = false

  for (let round = 1; round <= ROUNDS; round++) {
    const plan = planRound(round)
    const batches = chunk(plan.entries, BATCH)
    let addMs = 0
    let batchFail = ''
    for (const b of batches) {
      const { out, ms } = await send(owner, 'Add-Scores',
        { 'round-timestamp': String(plan.timestamp) },
        JSON.stringify({ Scores: Object.fromEntries(b) }))
      addMs += ms
      if (out !== 'OK' && !batchFail) batchFail = out.slice(0, 120)
    }
    const completed = await send(owner, 'Complete-Round', { 'round-timestamp': String(plan.timestamp) })
    const disk = diskBytes()
    timings.push({ round, msgs: batches.length + 1, addMs, completeMs: completed.ms, disk })

    const lastRound = await view('last_round')
    const okRound = !batchFail && lastRound.Timestamp === plan.timestamp && lastRound.Period === 3600
    check(`round ${round}: ${batches.length} Add-Scores + Complete-Round settled`, okRound,
      batchFail ? `Add-Scores -> ${batchFail}`
        : `t=${lastRound.Timestamp} period=${lastRound.Period} `
          + `add ${addMs}ms complete ${completed.ms}ms${disk ? ` disk ${mib(disk)}MiB` : ''}`)

    const now = await Promise.all(plan.trackedReads.map(k => raw(k).then(s => s.trim())))
    const grew = now.every((v, i) => amount(v) > amount(prevTracked[i] || '0'))
    check(`round ${round}: every tracked balance strictly increased`, grew,
      `${prevTracked[0]?.slice(0, 12)}… -> ${now[0]?.slice(0, 12)}…`)
    prevTracked = now

    // G. Restart mid-life — the snapshot/restore path the rest of the suite never touches.
    if (CONTAINER && !restarted && round === RESTART_AFTER) {
      section(`G. node restart after round ${round} (snapshot -> restore fidelity)`)
      const warm = JSON.stringify(await view('dump'))
      // process_snapshot_time is 60s, so idle past it and settle one more slot to guarantee the
      // snapshot being restored from is a LATE one rather than slot 0.
      await sleep(65)
      await send(owner, 'Cancel-Round', { 'round-timestamp': String(plan.timestamp + 1) })  // no-op; settles a slot
      execFileSync(ENGINE, ['restart', CONTAINER], { timeout: 300_000 })
      await waitUp()
      const t0 = performance.now()
      const cold = JSON.stringify(await view('dump'))
      const coldMs = Math.round(performance.now() - t0)
      check('full dump identical across restart', cold === warm,
        `${(warm.length / 1024).toFixed(0)}KB, cold read ${coldMs}ms`)
      restarted = true
    }
  }

  section('B/C summary — per-round cost')
  console.log('  round |  msgs |  Add-Scores |  Complete |  store')
  for (const t of timings) {
    console.log(`  ${String(t.round).padStart(5)} | ${String(t.msgs).padStart(5)} | `
      + `${String(t.addMs + 'ms').padStart(11)} | ${String(t.completeMs + 'ms').padStart(9)} | `
      + `${t.disk ? mib(t.disk) + ' MiB' : '—'}`)
  }
  if (diskStart && timings.length) {
    console.log(`  store grew ${mib(timings[timings.length - 1].disk - diskStart)} MiB over `
      + `${timings.reduce((a, t) => a + t.msgs, 0)} messages`)
  }
  const firstCost = timings[0].addMs + timings[0].completeMs
  const lastCost = timings[timings.length - 1].addMs + timings[timings.length - 1].completeMs
  console.log(`  per-round wall clock: round 1 ${firstCost}ms -> round ${ROUNDS} ${lastCost}ms `
    + `(${(lastCost / firstCost).toFixed(2)}x)`)

  section('D. Claim-Rewards — claim, keep earning, re-claim')
  const claimAddr = planRound(1).claimAddress
  const owedPath = RELAY
    ? `state/TotalAddressReward/${claimAddr}`
    : `state/Rewarded/${claimAddr}/${STAKING_TRACKED_OP}`
  const claimedPath = RELAY
    ? `state/Claimed/${claimAddr}`
    : `state/Claimed/${claimAddr}/${STAKING_TRACKED_OP}`

  const owedBefore = (await raw(owedPath)).trim()
  const claimOut = await send(owner, 'Claim-Rewards', { address: claimAddr })
  const claimedAfter = (await raw(claimedPath)).trim()
  check('Claim-Rewards succeeds on a live node', !/error|denied|No rewards/i.test(claimOut.out),
    claimOut.out.slice(0, 80))
  check('claimed == owed at claim time', claimedAfter === owedBefore, `${claimedAfter} vs ${owedBefore}`)

  // Earn more, then prove the claim did NOT drift with it.
  const extra = planRound(ROUNDS + 1)
  for (const b of chunk(extra.entries, BATCH)) {
    await send(owner, 'Add-Scores', { 'round-timestamp': String(extra.timestamp) },
      JSON.stringify({ Scores: Object.fromEntries(b) }))
  }
  await send(owner, 'Complete-Round', { 'round-timestamp': String(extra.timestamp) })
  const owedLater = (await raw(owedPath)).trim()
  const claimedLater = (await raw(claimedPath)).trim()
  check('owed grew after a further round', amount(owedLater) > amount(owedBefore),
    `${owedBefore} -> ${owedLater}`)
  check('claimed stayed FROZEN while owed grew', claimedLater === claimedAfter, claimedLater)

  await send(owner, 'Claim-Rewards', { address: claimAddr })
  check('re-claim catches up to the new owed', (await raw(claimedPath)).trim() === owedLater, owedLater)

  section('E. the actions no live test has executed')
  // Cancel-Round: stage a round, then discard it. The timestamp must stay ahead of the settled one.
  const cancelTs = extra.timestamp + 3600_000
  const staged = await send(owner, 'Add-Scores', { 'round-timestamp': String(cancelTs) },
    JSON.stringify({ Scores: Object.fromEntries(planRound(1).entries.slice(0, 5)) }))
  const pendingBefore = Object.keys((await view('dump')).PendingRounds || {})
  const cancelled = await send(owner, 'Cancel-Round', { 'round-timestamp': String(cancelTs) })
  const pendingAfter = Object.keys((await view('dump')).PendingRounds || {})
  check('Cancel-Round discards a staged round', staged.out === 'OK' && cancelled.out === 'OK'
    && pendingBefore.includes(String(cancelTs)) && !pendingAfter.includes(String(cancelTs)),
    `pending ${pendingBefore.length} -> ${pendingAfter.length}`)
  const reCancel = await send(owner, 'Cancel-Round', { 'round-timestamp': String(cancelTs) })
  check('Cancel-Round on nothing is rejected', reCancel.out !== 'OK', reCancel.out.slice(0, 60))

  // Update-Configuration: change TokensPerSecond, verify, restore.
  const tpsBefore = String(expected.state.Configuration.TokensPerSecond)
  const tpsProbe = String(BigInt(tpsBefore) + 1n)
  const upd = await send(owner, 'Update-Configuration', {}, JSON.stringify({ TokensPerSecond: tpsProbe }))
  const tpsSeen = String((await view('status')).tokensPerSecond)
  await send(owner, 'Update-Configuration', {}, JSON.stringify({ TokensPerSecond: tpsBefore }))
  check('Update-Configuration applies', upd.out === 'OK' && tpsSeen === tpsProbe, `${tpsBefore} -> ${tpsSeen}`)
  check('Update-Configuration restores', String((await view('status')).tokensPerSecond) === tpsBefore, tpsBefore)

  if (RELAY) {
    // Set-Delegate is permissionless (address = committer), so the STRANGER may call it.
    const delegateTo = getAddress(OWNER)
    const setD = await send(stranger, 'Set-Delegate', { address: delegateTo, share: '0.25' })
    const d = await view(`delegate?address=${STRANGER}`)
    check('Set-Delegate (permissionless, stranger)', setD.out === 'OK'
      && getAddress(d.Address) === delegateTo && Number(d.Share) === 0.25, JSON.stringify(d))
    const resetD = await send(stranger, 'Set-Delegate', {})
    const d2 = await view(`delegate?address=${STRANGER}`)
    check('Set-Delegate with no Address clears it', resetD.out === 'RESET' && !d2.Address, JSON.stringify(d2))
  } else {
    // Shares are Enabled but SetSharesEnabled is false in the seed, so Set-Share must refuse first.
    const refused = await send(stranger, 'Set-Share', {}, JSON.stringify({ Share: 0.1 }))
    check('Set-Share refused while SetSharesEnabled=false', /disabled/i.test(refused.out), refused.out.slice(0, 70))
    const enable = await send(owner, 'Update-Shares-Configuration', {}, JSON.stringify({ SetSharesEnabled: true }))
    const setS = await send(stranger, 'Set-Share', {}, JSON.stringify({ Share: 0.1 }))
    // ChangeDelaySeconds is 604800 in the seed, so the change QUEUES rather than applying.
    const queued = (await view('dump')).PendingShareChanges || {}
    check('Update-Shares-Configuration + Set-Share queues the change',
      enable.out === 'OK' && setS.out === 'OK' && Number(queued[STRANGER]?.Share) === 0.1,
      JSON.stringify(queued[STRANGER] || null))
    const off = await send(owner, 'Toggle-Feature-Shares', {}, JSON.stringify({ Enabled: false }))
    const refusedAgain = await send(stranger, 'Set-Share', {}, JSON.stringify({ Share: 0.2 }))
    await send(owner, 'Toggle-Feature-Shares', {}, JSON.stringify({ Enabled: true }))
    check('Toggle-Feature-Shares off disables Set-Share', off.out === 'OK' && /disabled/i.test(refusedAgain.out),
      refusedAgain.out.slice(0, 70))
  }

  section('F. ACL negative — unprivileged write rejected AND changes nothing')
  const beforeDump = JSON.stringify(await view('dump'))
  const denials: string[] = []
  for (const [action, tags, data] of [
    ['Add-Scores', { 'round-timestamp': String(extra.timestamp + 7200_000) },
      JSON.stringify({ Scores: Object.fromEntries(planRound(1).entries.slice(0, 2)) })],
    ['Complete-Round', { 'round-timestamp': String(extra.timestamp) }, ''],
    ['Claim-Rewards', { address: claimAddr }, ''],
    ['Update-Configuration', {}, JSON.stringify({ TokensPerSecond: '1' })],
  ] as [string, Record<string, string>, string][]) {
    const r = await send(stranger, action, tags, data)
    denials.push(`${action}:${r.out.slice(0, 40)}`)
    check(`  stranger ${action} denied`, /denied|permission|unauthor|role/i.test(r.out), r.out.slice(0, 70))
  }
  check('state unchanged after every denied write', JSON.stringify(await view('dump')) === beforeDump,
    'dump identical')

  // A rejected write still consumes a slot (D29) — prove the process is not wedged by them.
  const alive = await send(owner, 'Cancel-Round', { 'round-timestamp': '1' })
  check('process not wedged by rejected writes', alive.out !== '', alive.out.slice(0, 50))

  if (CONTAINER && !restarted) console.log('\n  (G skipped: RESTART_AFTER never reached)')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`${pass} passed, ${fail} failed   —  ${CONTRACT}, ${ROUNDS} rounds, pid=${pid}`)
  if (fail) console.log('failures:\n  - ' + failures.join('\n  - '))
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 700)); process.exit(2) })
