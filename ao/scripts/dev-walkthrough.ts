// FUNCTIONAL WALKTHROUGH against a real node — the operator-facing story, end to end.
//
// Different question from the rest of the suite. Tier-2/Tier-3 ask "is the math right" and
// "does the surface hold"; verify-deployment.ts asks "does a deployed process match the dump".
// This asks the thing a person asks before go-live: can we actually OPERATE these contracts —
// register an operator, take them off, run rewards rounds, pay a claim — on the node we intend
// to ship, through the edge, with real EVM signing?
//
// It spawns its own processes from the live dumps and never touches a deployed one, so it is
// safe to run against dev repeatedly.
//
// TWO MODES, and the difference matters enough that the report says which one ran:
//
//   SEEDED (pass MODULE_ID_*) — spawns by module id with the migration dump riding the spawn
//     message. This is the real question: can we operate the MIGRATED contracts. Requires the
//     modules to exist on the node, which is a publish, not something this script can do.
//   FRESH (no MODULE_ID_*)   — spawns from inline source with NO seed. Still exercises the whole
//     operational surface, but against empty contracts, so it says nothing about the migration.
//
// The two cannot be combined: an inline-source spawn encodes the module INTO the data field,
// which is the same field the seed envelope needs, so a seed passed alongside `luaSource` is
// silently discarded and the process comes up empty while every call reports success. That is
// now a hard error in `spawnLuaProcess` rather than a quiet wrong answer.
//
// Run:
//   HB_URL=https://hb-dev.anyone.tech bun run scripts/dev-walkthrough.ts
//   HB_URL=… MODULE_ID_OPREG=… MODULE_ID_RELAY=… MODULE_ID_STAKING=… bun run …  # seeded
//
// The report lands in docs/hyperbeam-migration/reports/ by default — set REPORTS_DIR to
// move them all, or REPORT for this one.
import { EthereumSigner } from '@dha-team/arbundles'
import { Wallet } from 'ethers'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from './util/hb-client'
import { seedEnvelopeFor } from './util/native-bundle'
import { buildRelayRound } from './util/relay-round'
import { buildRound as buildStakingRound } from './util/staking-round'
import { requireDeployerKey, reportPath } from './util/helpers'

const HB = (process.env.HB_URL || 'https://hb-dev.anyone.tech').replace(/\/+$/, '')
const AO = path.resolve(import.meta.dir, '..')
const REPORT = process.env.REPORT
  ? path.resolve(process.env.REPORT)
  : reportPath('dev-walkthrough-report.md')
const WIDTH = Number(process.env.WIDTH || 60)

const OWNER_KEY = requireDeployerKey()
const owner = new EthereumSigner(OWNER_KEY)
const OWNER = new Wallet('0x' + OWNER_KEY.replace(/^0x/, '')).address
// A wallet with no standing anywhere: not on the node's faff allow-list, not the process Owner,
// no ACL role. What refuses it, and at which layer, is section E.
const STRANGER_KEY = crypto.randomBytes(32).toString('hex')
const stranger = new EthereumSigner(STRANGER_KEY)
const STRANGER = new Wallet('0x' + STRANGER_KEY).address

// ---- results -----------------------------------------------------------------
type Row = { section: string, label: string, ok: boolean, detail: string, ms: number }
const rows: Row[] = []
let section = ''
const sec = (s: string) => { section = s; console.log(`\n=== ${s} ===`) }
const check = (label: string, ok: boolean, detail = '', ms = 0) => {
  rows.push({ section, label, ok, detail, ms })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  return ok
}

// ---- node I/O ----------------------------------------------------------------
const P = (pid: string) => `${HB}/${pid}~process@1.0`
async function view (pid: string, v: string): Promise<any> {
  const r = await fetch(`${P(pid)}/as/${v}`, { headers: { Accept: 'application/json' } })
  const b = await r.text()
  if (!r.ok) throw new Error(`as/${v} -> ${r.status}: ${b.replace(/\s+/g, ' ').slice(0, 160)}`)
  return JSON.parse(b)
}
/** Send an action as `signer`; returns the handler's output string and the wall time. */
async function act (
  signer: EthereumSigner, pid: string, action: string,
  tags: Record<string, string> = {}, data = ''
): Promise<{ out: string, ms: number, status: number }> {
  const taglist = [{ name: 'action', value: action },
    ...Object.entries(tags).map(([name, value]) => ({ name, value: String(value) }))]
  const t0 = performance.now()
  try {
    await sendMessage({ url: HB, signer }, { pid, tags: taglist, data })
    const ms = Math.round(performance.now() - t0)
    const out = (await (await fetch(`${P(pid)}/now/results/output/data`)).text()).trim()
    return { out, ms, status: 200 }
  } catch (e: any) {
    // A node-layer refusal (faff, or the write gate once it lands) never reaches the contract.
    const m = /-> (\d{3})/.exec(String(e?.message ?? ''))
    return { out: String(e?.message ?? e).slice(0, 200), ms: Math.round(performance.now() - t0),
      status: m ? Number(m[1]) : 0 }
  }
}
const slotOf = async (pid: string) =>
  Number((await (await fetch(`${P(pid)}/now/at-slot`)).text()).trim())

const hex40 = () => crypto.randomBytes(20).toString('hex').toUpperCase()
const expectedOf = (c: string) =>
  JSON.parse(fs.readFileSync(path.join(AO, `dist/${c}-seed.expected.json`), 'utf8'))

// ---- spawn -------------------------------------------------------------------
const MODULES: Record<string, string | undefined> = {
  'operator-registry': process.env.MODULE_ID_OPREG,
  'relay-rewards': process.env.MODULE_ID_RELAY,
  'staking-rewards': process.env.MODULE_ID_STAKING,
}
const SEEDED = Object.values(MODULES).every(Boolean)

async function spawn (contract: string, schedulerLocation: string): Promise<string> {
  // A spawn is deterministic (secp256k1), so identical content yields the same pid and re-running
  // lands on the SAME process with its previous state. Vary the tags so each run is its own.
  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
  const { pid } = await spawnLuaProcess({ url: HB, signer: owner }, {
    schedulerLocation,
    ...(SEEDED
      ? { moduleId: MODULES[contract]!, spawnData: seedEnvelopeFor(contract) }
      : { luaSource: fs.readFileSync(path.join(AO, `dist/${contract}-native.lua`), 'utf8') }),
    tags: [{ name: 'name', value: `walkthrough-${contract}-${stamp}` }],
  })
  // Compute is LAZY and `as/<view>` does NOT drive slot 0 — it resolves against a fresh VM whose
  // globals are still nil, so every view answers 200 with an EMPTY state and the seed looks lost.
  // `now` is what forces the first compute. Do that before reading anything.
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${P(pid)}/now/at-slot`)
    if (r.ok && /^\d+$/.test((await r.text()).trim())) break
    await new Promise(r => setTimeout(r, 2000))
  }
  for (let i = 0; i < 30; i++) {
    try {
      const st = await view(pid, 'status')
      // A FRESH process legitimately reports zeros; a SEEDED one reporting zeros means the
      // envelope never landed, which is the failure this loop exists to catch.
      if (!SEEDED || Object.values(st?.counts ?? {}).some(v => Number(v) > 0)) return pid
    } catch { /* still materialising */ }
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error(`${contract}: spawned ${pid} but its seed never materialised`)
}

;(async () => {
  console.log(`\n=== FUNCTIONAL WALKTHROUGH ===`)
  console.log(`  node    ${HB}`)
  console.log(`  owner   ${OWNER}`)
  console.log(`  stranger ${STRANGER}`)

  const schedulerLocation = await fetchNodeAddress(HB)
  const started = Date.now()

  // ---- A. deploy the three contracts from the live dumps ---------------------
  sec('A. deploy from the live legacynet dumps')
  const pids: Record<string, string> = {}
  for (const c of ['operator-registry', 'relay-rewards', 'staking-rewards']) {
    const t0 = performance.now()
    try {
      pids[c] = await spawn(c, schedulerLocation)
      const st = await view(pids[c], 'status')
      check(`${c} spawned${SEEDED ? ' and seeded from the dump' : ' (fresh, unseeded)'}`, true,
        `${pids[c].slice(0, 12)}… ${JSON.stringify(st.counts)}`, Math.round(performance.now() - t0))
    } catch (e: any) {
      check(`${c} spawned and seeded`, false, String(e?.message ?? e).slice(0, 180))
    }
  }
  if (Object.keys(pids).length < 3) {
    console.error('\nspawn failed — cannot continue')
    await emit(started); process.exit(1)
  }

  // Seeded totals must match the dump, or every number below is measured against fiction.
  const opregExp = expectedOf('operator-registry')
  const opregStatus = await view(pids['operator-registry'], 'status')
  if (SEEDED) {
    check('registry seed matches the dump',
      opregStatus.counts.verified === Object.keys(opregExp.state.verified).length &&
      opregStatus.counts.claimable === Object.keys(opregExp.state.claimable).length,
      `verified ${opregStatus.counts.verified}, claimable ${opregStatus.counts.claimable}`)
  } else {
    check('running FRESH — contracts are empty, migration state is NOT covered',
      Object.values(opregStatus.counts).every(v => Number(v) === 0),
      'pass MODULE_ID_OPREG/RELAY/STAKING to run against the migration dumps')
  }

  // ---- B. operator registry: the operator lifecycle --------------------------
  sec('B. operator registry — add, claim, renounce, remove')
  const reg = pids['operator-registry']
  const fp = hex40()

  let r = await act(owner, reg, 'Admin-Submit-Operator-Certificates', {},
    JSON.stringify([{ f: fp, a: OWNER, hw: false }]))
  check('admin assigns a certificate (operator becomes claimable)', r.out === 'OK', r.out, r.ms)
  let op = await view(reg, `operator?address=${OWNER}`)
  check('the new fingerprint shows as claimable for that address',
    op.claimable?.[fp] === true, `claimable ${Object.keys(op.claimable ?? {}).length}`)

  r = await act(owner, reg, 'Submit-Fingerprint-Certificate', { 'fingerprint-certificate': fp })
  check('operator claims it (claimable -> verified)', r.out === 'OK', r.out, r.ms)
  op = await view(reg, `operator?address=${OWNER}`)
  check('it is now verified and no longer claimable',
    op.verified?.[fp] === true && op.claimable?.[fp] === undefined,
    `verified ${Object.keys(op.verified ?? {}).length}`)

  r = await act(owner, reg, 'Renounce-Fingerprint-Certificate', { fingerprint: fp })
  check('operator renounces it', r.out === 'OK', r.out, r.ms)
  op = await view(reg, `operator?address=${OWNER}`)
  check('it is gone from verified', op.verified?.[fp] === undefined,
    `verified ${Object.keys(op.verified ?? {}).length}`)

  // Admin removal — the other way a relay leaves the set. Uses a certificate this run created
  // and claimed, so the count arithmetic holds whether or not the contract was seeded.
  const fp2 = hex40()
  await act(owner, reg, 'Admin-Submit-Operator-Certificates', {},
    JSON.stringify([{ f: fp2, a: OWNER, hw: false }]))
  await act(owner, reg, 'Submit-Fingerprint-Certificate', { 'fingerprint-certificate': fp2 })
  const beforeRemove = (await view(reg, 'status')).counts.verified
  r = await act(owner, reg, 'Remove-Fingerprint-Certificate', { fingerprint: fp2 })
  check('admin removes a verified certificate', r.out === 'OK', `${fp2.slice(0, 12)}…`, r.ms)
  const afterRemove = await view(reg, 'status')
  check('verified count dropped by exactly one',
    afterRemove.counts.verified === beforeRemove - 1,
    `${beforeRemove} -> ${afterRemove.counts.verified}`)

  sec('B2. operator registry — blocking, credits, hardware')
  const blockMe = new Wallet('0x' + crypto.randomBytes(32).toString('hex')).address
  r = await act(owner, reg, 'Block-Operator-Address', { address: blockMe })
  check('admin blocks an operator address', r.out === 'OK', `${blockMe.slice(0, 12)}…`, r.ms)
  check('the address reads as blocked',
    (await view(reg, 'status')).counts.blocked === opregStatus.counts.blocked + 1,
    `blocked ${(await view(reg, 'status')).counts.blocked}`)
  r = await act(owner, reg, 'Unblock-Operator-Address', { address: blockMe })
  check('admin unblocks it', r.out === 'OK', r.out, r.ms)

  const creditFp = hex40()
  r = await act(owner, reg, 'Add-Registration-Credit', { address: OWNER, fingerprint: creditFp })
  check('admin grants a registration credit', r.out === 'OK', r.out, r.ms)
  r = await act(owner, reg, 'Remove-Registration-Credit', { address: OWNER, fingerprint: creditFp })
  check('admin revokes it', r.out === 'OK', r.out, r.ms)

  const hwFp = hex40()
  r = await act(owner, reg, 'Add-Verified-Hardware', {}, hwFp)
  check('admin adds verified hardware', r.out === 'OK', r.out, r.ms)
  r = await act(owner, reg, 'Remove-Verified-Hardware', {}, hwFp)
  check('admin removes it', r.out === 'OK', r.out, r.ms)

  // ---- C. relay rewards: two rounds, then the claim flow ---------------------
  sec('C. relay rewards — two rounds, then claim')
  const relay = pids['relay-rewards']
  const relayExp = expectedOf('relay-rewards')
  const relayReward = async (addr: string) =>
    BigInt((await view(relay, `rewards?address=${addr}`))?.reward ?? 0)
  const relayClaimed = async (addr: string) =>
    BigInt((await view(relay, `claimed?address=${addr}`))?.claimed ?? 0)

  let trackedAddr = ''
  let prevReward = 0n
  for (const round of [1, 2]) {
    const plan = buildRelayRound(relayExp.state, WIDTH, round)
    trackedAddr = plan.trackedAddress
    if (round === 1) prevReward = await relayReward(trackedAddr)
    const t0 = performance.now()
    const add = await act(owner, relay, 'Add-Scores',
      { 'round-timestamp': String(plan.timestamp) }, JSON.stringify({ Scores: plan.scores }))
    const done = await act(owner, relay, 'Complete-Round',
      { 'round-timestamp': String(plan.timestamp) })
    const ms = Math.round(performance.now() - t0)
    const last = await view(relay, 'last_round')
    check(`round ${round} settles (${WIDTH} relays scored)`,
      add.out === 'OK' && last.Timestamp === plan.timestamp,
      `add=${add.out} t=${last.Timestamp} period=${last.Period}`, ms)
    const now = await relayReward(trackedAddr)
    // On a FRESH contract the first round has no previous timestamp, so its Period is 0 and it
    // pays nothing — it only establishes the baseline. That is correct, not a missed payout.
    if (SEEDED || round > 1) {
      check(`round ${round} paid the tracked operator`, now > prevReward, `${prevReward} -> ${now}`)
    } else {
      check('round 1 establishes the baseline timestamp (fresh contract, Period 0, no payout)',
        now === 0n, `period ${last.Period}`)
    }
    prevReward = now
  }

  const owed = await relayReward(trackedAddr)
  r = await act(owner, relay, 'Claim-Rewards', { address: trackedAddr })
  check('Claim-Rewards succeeds', !/error|denied|No rewards/i.test(r.out), r.out.slice(0, 80), r.ms)
  check('claimed equals what was owed at claim time', (await relayClaimed(trackedAddr)) === owed,
    `${owed}`)

  const plan3 = buildRelayRound(relayExp.state, WIDTH, 3)
  await act(owner, relay, 'Add-Scores', { 'round-timestamp': String(plan3.timestamp) },
    JSON.stringify({ Scores: plan3.scores }))
  await act(owner, relay, 'Complete-Round', { 'round-timestamp': String(plan3.timestamp) })
  const owedLater = await relayReward(trackedAddr)
  check('a further round increases what is owed', owedLater > owed, `${owed} -> ${owedLater}`)
  check('the earlier claim stays frozen', (await relayClaimed(trackedAddr)) === owed, `${owed}`)
  await act(owner, relay, 'Claim-Rewards', { address: trackedAddr })
  check('re-claiming catches up to the new total',
    (await relayClaimed(trackedAddr)) === owedLater, `${owedLater}`)

  // ---- D. staking rewards: a round, then the claim flow ----------------------
  sec('D. staking rewards — a round, then claim')
  const stk = pids['staking-rewards']
  const stkExp = expectedOf('staking-rewards')
  const plan = buildStakingRound(stkExp.state, WIDTH)
  let hodler = '', operator = ''
  outer: for (const [h, ops] of Object.entries(plan.scores)) {
    for (const [o, sc] of Object.entries(ops as Record<string, any>)) {
      if (sc.Running === 1) { hodler = h; operator = o; break outer }
    }
  }
  if (!hodler) throw new Error('no pair above the Running gate in this round')
  const stkRewarded = async () =>
    BigInt((await view(stk, `rewards?address=${hodler}`))?.Rewarded?.[operator] ?? 0)
  const stkClaimed = async () =>
    BigInt((await view(stk, `claimed?address=${hodler}`))?.claimed?.[operator] ?? 0)

  // Two rounds, for the same reason relay needs two: a round pays for the time ELAPSED since the
  // previous one, so on a fresh contract the first round has Period 0 and pays nothing. Scale
  // Staked per round so no two rounds are byte-identical inputs.
  let afterRound = 0n
  for (const round of [1, 2]) {
    const ts = plan.timestamp + (round - 1) * 3600_000
    const scores: Record<string, Record<string, any>> = {}
    for (const [h, ops] of Object.entries(plan.scores)) {
      scores[h] = {}
      for (const [o, sc] of Object.entries(ops as Record<string, any>)) {
        scores[h][o] = { Staked: String(BigInt(sc.Staked) + BigInt(round) * 10n ** 18n),
          Running: sc.Running }
      }
    }
    const before = await stkRewarded()
    const t0 = performance.now()
    const addS = await act(owner, stk, 'Add-Scores',
      { 'round-timestamp': String(ts) }, JSON.stringify({ Scores: scores }))
    await act(owner, stk, 'Complete-Round', { 'round-timestamp': String(ts) })
    const lastS = await view(stk, 'last_round')
    check(`staking round ${round} settles (${WIDTH} pairs)`,
      addS.out === 'OK' && lastS.Timestamp === ts,
      `add=${addS.out} t=${lastS.Timestamp}`, Math.round(performance.now() - t0))
    afterRound = await stkRewarded()
    if (SEEDED || round > 1) {
      check(`staking round ${round} paid the tracked hodler/operator pair`, afterRound > before,
        `${before} -> ${afterRound}`)
    } else {
      check('staking round 1 establishes the baseline (fresh contract, no elapsed time)',
        afterRound === 0n, `period ${lastS.Period}`)
    }
  }

  r = await act(owner, stk, 'Claim-Rewards', { address: hodler })
  check('Claim-Rewards succeeds', !/error|denied|No rewards/i.test(r.out), r.out.slice(0, 80), r.ms)
  check('claimed equals what was owed', (await stkClaimed()) === afterRound, `${afterRound}`)

  const lastSnap = await view(stk, 'last_snapshot')
  check('last_snapshot serves the per-pair breakdown consumers read',
    !!lastSnap?.Details && Object.keys(lastSnap.Details).length > 0,
    `${Object.keys(lastSnap?.Details ?? {}).length} hodlers`)

  // ---- E. permissions --------------------------------------------------------
  sec('E. permissions — an unauthorised wallet')
  for (const [name, pid] of Object.entries(pids)) {
    const slotBefore = await slotOf(pid)
    const denied = await act(stranger, pid, 'Update-Configuration', {}, '{}')
    const slotAfter = await slotOf(pid)
    check(`${name}: a stranger's write is refused`, denied.status >= 400,
      `HTTP ${denied.status || '?'} ${denied.out.slice(0, 60)}`, denied.ms)
    check(`${name}: and consumed no scheduler slot`, slotAfter === slotBefore,
      `slot ${slotBefore} -> ${slotAfter}`)
  }
  check('reads stay public and unsigned',
    (await fetch(`${P(pids['operator-registry'])}/as/status`)).ok, 'as/status without a signature')

  await emit(started)
  const failed = rows.filter(x => !x.ok).length
  console.log(`\n${rows.length - failed} passed, ${failed} failed  —  report: ${REPORT}`)
  process.exit(failed ? 1 : 0)

  // ---- report ---------------------------------------------------------------
  async function emit (t0: number) {
    const failed = rows.filter(x => !x.ok)
    const bySection = [...new Set(rows.map(x => x.section))]
    const L: string[] = []
    L.push(`# Functional walkthrough — ${failed.length ? '**ATTENTION**' : 'HEALTHY'}`)
    L.push('')
    L.push(SEEDED
      ? '**SEEDED run** — contracts were spawned by module id with the 2026-07-09 legacynet '
        + 'dumps riding the spawn message, so this covers the migrated state.'
      : '⚠️ **FRESH run** — contracts were spawned from inline source with NO seed, so they '
        + 'are EMPTY. Everything below exercises the operational surface, and NOTHING below '
        + 'says anything about the migration. Re-run with MODULE_ID_OPREG / MODULE_ID_RELAY / '
        + 'MODULE_ID_STAKING once the modules exist on this node.')
    L.push('')
    L.push('| | |')
    L.push('|---|---|')
    L.push(`| node | \`${HB}\` |`)
    L.push(`| ran | ${new Date(t0).toISOString()} |`)
    L.push(`| duration | ${Math.round((Date.now() - t0) / 1000)}s |`)
    L.push(`| checks | **${rows.length - failed.length} passed**, ${failed.length} failed |`)
    L.push('')
    for (const [c, pid] of Object.entries(pids)) L.push(`- ${c} — \`${pid}\``)
    L.push('')
    L.push('Spawned by this run and thrown away: nothing deployed was read or written.')
    L.push('')
    if (failed.length) {
      L.push('## What needs attention')
      L.push('')
      for (const f of failed) L.push(`- **${f.section}** — ${f.label}${f.detail ? `: ${f.detail}` : ''}`)
      L.push('')
    }
    L.push('## What was exercised')
    L.push('')
    for (const s of bySection) {
      L.push(`### ${s}`)
      L.push('')
      L.push('| | check | detail | ms |')
      L.push('|---|---|---|---:|')
      for (const x of rows.filter(y => y.section === s)) {
        L.push(`| ${x.ok ? 'ok' : '**FAIL**'} | ${x.label} | ${x.detail.replace(/\|/g, '\\|')} | ${x.ms || ''} |`)
      }
      L.push('')
    }
    L.push('## What this could NOT cover on this node, and why')
    L.push('')
    L.push('- **Contract-level ACL denial.** The stranger in section E is refused by the NODE')
    L.push('  (faff, because a freshly spawned pid is not one of the carve-out routes), so the')
    L.push('  contract never sees the message. That is a real permission result, but it is a')
    L.push('  different layer from the contract\'s own role check, and it will NOT hold on stage')
    L.push('  or live, where the deployed pids sit inside a blanket carve-out until the write')
    L.push('  gate lands. Contract-level ACL denial is covered by Tier-2 and by section F of')
    L.push('  `tier3-sustained.ts`.');
    L.push('- **Module-by-id resolution.** Modules ride the spawn as inline source here, because')
    L.push('  a node resolves an id through Arweave GraphQL and a freshly published module is')
    L.push('  unusable until it indexes. `verify-deployment.ts` covers the by-id path against a')
    L.push('  real deploy.')
    L.push('- **Durability across a node restart.** Node-level, out of scope here; covered by')
    L.push('  section G of `tier3-sustained.ts`.')
    fs.mkdirSync(path.dirname(REPORT), { recursive: true })
    fs.writeFileSync(REPORT, L.join('\n') + '\n')
  }
})().catch(e => { console.error('\nWALKTHROUGH ERROR:', e?.message ?? e); process.exit(1) })
