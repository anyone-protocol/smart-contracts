// Tier-3 staking-rewards vertical: spawn the seeded native staking-rewards (the real 322KB
// legacynet state, Details INCLUDED) by-id on a live node and prove:
//   1. materialization + counts (status view)
//   2. full seed-diff: Rewarded / Claimed / PreviousRound.Details — every pair of the two-level
//      maps vs dist/staking-rewards-seed.expected.json
//   3. roles seeded (Add-Scores / Complete-Round / Claim-Rewards)
//   4. the legacynet read surface still answers off migrated state (last_round, last_snapshot,
//      last_round_data, rewards, claimed) + base-addressed point reads
//   5. BYTE-IDENTICAL round: drive the SAME round the luerl oracle ran against the SAME full seed
//      (util/staking-round.ts is the single definition of it) and assert every per-pair Score /
//      Rating / Reward, the Summary, and the whole cumulative Rewarded map equal
//      dist/staking-oracle-probe.json. Round timestamps are realistic 13-digit ms, so this also
//      proves the A17 tostring() keying holds on the real device VM.
//
// Prereqs: bun run scripts/build-staking-seed.ts && bun run scripts/build-staking-oracle.ts,
// then publish dist/staking-rewards-seed.lua (scripts/publish-native-module.ts prints the eval).
// Run: HB_URL=http://localhost:8734 MODULE_ID=<seed id> bun run scripts/tier3-staking-validate.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { Wallet } from 'ethers'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from './util/hb-client'
import { seedEnvelopeFor } from './util/native-bundle'
import { buildRound } from './util/staking-round'
import fs from 'fs'
import path from 'path'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID
if (!MODULE_ID) { console.error('MODULE_ID env required'); process.exit(2) }
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const signer = new EthereumSigner(KEY)
const DEV = new Wallet('0x' + KEY).address

const AO = path.resolve(import.meta.dir, '..')
const expected = JSON.parse(fs.readFileSync(path.join(AO, 'dist/staking-rewards-seed.expected.json'), 'utf8'))
const oracle = JSON.parse(fs.readFileSync(path.join(AO, 'dist/staking-oracle-probe.json'), 'utf8'))
const round = buildRound(expected.state, Number(process.env.N || 250))
if (round.timestamp !== oracle.timestamp) {
  console.error(`round/oracle drift: round t=${round.timestamp}, oracle t=${oracle.timestamp} — rebuild the oracle`)
  process.exit(2)
}

// NEGATIVE CONTROL: shift ONE wei in ONE pair's reward and one unit in the Summary. A parity check
// that cannot fail proves nothing, and a whole-map comparison is exactly the kind that silently
// degrades into a no-op (a shape change, an empty map, a swallowed view error). With PERTURB set
// the run MUST report failures.
const PERTURB = !!process.env.PERTURB
if (PERTURB) {
  const h = Object.keys(oracle.Details)[0], o = Object.keys(oracle.Details[h])[0]
  oracle.Details[h][o].Reward.Hodler = String(BigInt(oracle.Details[h][o].Reward.Hodler) + 1n)
  oracle.Summary.Rewards = String(BigInt(oracle.Summary.Rewards) + 1n)
  oracle.Rewarded[h][o] = String(BigInt(oracle.Rewarded[h][o]) + 1n)
  console.log(`** PERTURB set — oracle Details/Summary/Rewarded shifted by 1 wei; FAILURES ARE EXPECTED **`)
}

let fails = 0
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!ok) fails++
}
let pid: string
const view = async (v: string) => {
  const r = await fetch(`${HB}/${pid}~process@1.0/as/${v}`)
  const b = await r.text(); if (!r.ok) throw new Error(`view ${v} -> ${r.status}: ${b.slice(0, 160)}`)
  return JSON.parse(b)
}

// NEVER compare these by JSON string: the node re-encodes state from Lua tables and `pairs()`
// order is not stable, so two byte-different encodings routinely carry identical data. Structural
// comparison only. (Same trap as the reward specs and the relay cross-check.)
const deepEq = (a: any, b: any): boolean => {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every(k => k in b && deepEq(a[k], b[k]))
}
const show = (v: unknown) => JSON.stringify(v)?.slice(0, 90) ?? String(v)

/** first difference between two [hodler][operator] maps, or '' */
const diffTwoLevel = (got: any, want: any, label: string) => {
  got = got || {}; want = want || {}
  const gk = Object.keys(got), wk = Object.keys(want)
  if (gk.length !== wk.length) {
    const only = wk.filter(k => !(k in got)).concat(gk.filter(k => !(k in want))).slice(0, 3)
    return `${label}: ${gk.length} hodlers != ${wk.length} (${only})`
  }
  for (const h of wk) {
    if (!(h in got)) return `${label}: missing hodler ${h}`
    const g = got[h] || {}, w = want[h] || {}
    const gik = Object.keys(g), wik = Object.keys(w)
    if (gik.length !== wik.length) return `${label}[${h.slice(0, 10)}…]: ${gik.length} ops != ${wik.length}`
    for (const o of wik) {
      if (!deepEq(g[o], w[o])) {
        return `${label}[${h.slice(0, 10)}…][${o.slice(0, 10)}…]: ${show(g[o])} != ${show(w[o])}`
      }
    }
  }
  return ''
}
const pairCount = (m: any) => Object.values(m || {}).reduce((n: number, o: any) => n + Object.keys(o || {}).length, 0)
const diffFlat = (got: any, want: any) => {
  got = got || {}; want = want || {}
  const gk = Object.keys(got), wk = Object.keys(want)
  if (gk.length !== wk.length) return `size ${gk.length} != ${wk.length}`
  for (const k of wk) if (got[k] !== want[k]) return `${k}: ${got[k]} != ${want[k]}`
  return ''
}

;(async () => {
  console.log(`node ${await fetchNodeAddress(HB)}  moduleId=${MODULE_ID}\n  owner(dev)=${DEV}`)
  const r = await spawnLuaProcess({ url: HB, signer },
    { moduleId: MODULE_ID, spawnData: seedEnvelopeFor('staking-rewards'), tags: [{ name: 'name', value: `staking-seed-${Date.now()}` }] })
  pid = r.pid
  console.log(`spawned pid=${pid}\n`)

  // 1) materialization + counts
  console.log('1) materialization + counts (status):')
  // spawnLuaProcess already forced the lazy first compute, so this is the SEED-LANDED check,
  // not a materialization wait: `initialized` separates a computed-but-empty process from a
  // seeded one, which the counts cannot.
  let status: any
  for (let i = 0; i < 40; i++) {
    try {
      const s = await view('status')
      if (s?.initialized !== false) { status = s; break }
    } catch { /* not up yet */ }
    await new Promise(z => setTimeout(z, 1500))
  }
  if (!status) { console.log('  FAIL  status never answered'); process.exit(1) }
  const ec = {
    rewarded: Object.keys(expected.state.Rewarded).length,
    claimed: Object.keys(expected.state.Claimed).length,
  }
  check(status.counts.rewardedHodlers === ec.rewarded, 'Rewarded hodler count', `${status.counts.rewardedHodlers}/${ec.rewarded}`)
  check(status.counts.claimedHodlers === ec.claimed, 'Claimed hodler count', `${status.counts.claimedHodlers}/${ec.claimed}`)
  check(status.counts.shares === 0 && status.counts.pendingShareChanges === 0, 'Shares/PendingShareChanges empty (live shape)', `${status.counts.shares}/${status.counts.pendingShareChanges}`)
  check(status.counts.pendingRounds === 0, 'PendingRounds empty', String(status.counts.pendingRounds))
  check(status.lastRoundTimestamp === expected.state.PreviousRound.Timestamp, 'PreviousRound.Timestamp seeded', String(status.lastRoundTimestamp))
  check(status.tokensPerSecond === expected.state.Configuration.TokensPerSecond, 'Configuration.TokensPerSecond seeded', status.tokensPerSecond)
  check(status.setSharesEnabled === false, 'SetSharesEnabled false (locked at the 5% Default)', String(status.setSharesEnabled))
  check(status.runningRequirement === expected.state.Configuration.Requirements.Running, 'Requirements.Running seeded', String(status.runningRequirement))

  // 2) full seed-diff — every pair of the two-level maps
  console.log('\n2) full seed-diff (dump vs expected), two-level maps pair-by-pair:')
  const dump = await view('dump')
  for (const m of ['Rewarded', 'Claimed'] as const) {
    const d = diffTwoLevel(dump[m], expected.state[m], m)
    check(d === '', `dump.${m} (${Object.keys(expected.state[m]).length} hodlers / ${pairCount(expected.state[m])} pairs)`, d || 'identical')
  }
  const dd = diffTwoLevel(dump.PreviousRound?.Details, expected.state.PreviousRound.Details, 'Details')
  check(dd === '', `dump.PreviousRound.Details (${Object.keys(expected.state.PreviousRound.Details).length} hodlers / ${pairCount(expected.state.PreviousRound.Details)} pairs) — PERSISTED, unlike relay`, dd || 'identical')
  check(deepEq(dump.Configuration, expected.state.Configuration), 'dump.Configuration', show(dump.Configuration))
  check(deepEq(dump.PreviousRound?.Summary, expected.state.PreviousRound.Summary), 'dump.PreviousRound.Summary', show(dump.PreviousRound?.Summary))

  // 3) roles seeded
  console.log('\n3) roles seeded:')
  const roles = await view('roles')
  for (const role of Object.keys(expected.roles)) {
    check(diffFlat(roles[role], expected.roles[role]) === '', `role ${role}`, Object.keys(expected.roles[role])[0])
  }

  // 4) legacynet read surface answers off migrated state
  console.log('\n4) legacynet read surface, answered off migrated state:')
  const H = round.sampleHodler
  const O = Object.keys(expected.state.Rewarded[H])[0]
  const lastRound = await view('last_round')
  check(lastRound.Timestamp === expected.state.PreviousRound.Timestamp && lastRound.Period === expected.state.PreviousRound.Period,
    'last_round (Last-Round-Metadata)', `t=${lastRound.Timestamp} period=${lastRound.Period}`)
  const snap = await view('last_snapshot')
  check(diffTwoLevel(snap.Details, expected.state.PreviousRound.Details, 'Details') === '', 'last_snapshot carries the migrated Details', `${pairCount(snap.Details)} pairs`)
  const lrd = await view(`last_round_data?address=${H}`)
  check(!!lrd?.Details, `last_round_data[${H.slice(0, 10)}…] (Last-Round-Data)`, lrd?.Details ? `${Object.keys(lrd.Details).length} operator(s)` : 'nil')
  const rewards = await view(`rewards?address=${H}`)
  check(diffFlat(rewards?.Rewarded, expected.state.Rewarded[H]) === '', `rewards[${H.slice(0, 10)}…].Rewarded (Get-Rewards)`, show(rewards?.Rewarded))
  const claimedView = await view(`claimed?address=${H}`)
  check(deepEq(claimedView?.claimed, expected.state.Claimed[H]), `claimed[${H.slice(0, 10)}…] (Get-Claimed)`, show(claimedView?.claimed))
  // Was a base-addressed point read (now/state/Rewarded/<hodler>/<operator>). Under globals
  // state is not on the message, so the same fact is asserted through the view — which measured
  // FASTER than the base read it replaces (27.6 ms vs 148 ms, D31 §5a).
  const point = rewards?.Rewarded?.[O]
  check(point === expected.state.Rewarded[H][O], `rewards[<hodler>].Rewarded[<operator>] point read`, String(point))

  // 5) the round — identical input to the luerl oracle, over the identical full seed
  console.log('\n5) byte-identical round vs the luerl oracle (same full 402KB seed, same input):')
  console.log(`  ${round.realPairs} real + ${round.freshPairs} fresh pairs, ${round.hodlers} hodlers; prev=${round.prev} t=${round.timestamp} (13-digit ms — A17)`)
  const scoresJson = JSON.stringify({ Scores: round.scores })
  const t0 = performance.now()
  await sendMessage({ url: HB, signer }, {
    pid,
    tags: [{ name: 'action', value: 'Add-Scores' }, { name: 'round-timestamp', value: String(round.timestamp) }],
    data: scoresJson,
  })
  const addMs = Math.round(performance.now() - t0)
  const t1 = performance.now()
  await sendMessage({ url: HB, signer }, {
    pid,
    tags: [{ name: 'action', value: 'Complete-Round' }, { name: 'round-timestamp', value: String(round.timestamp) }],
  })
  const completeMs = Math.round(performance.now() - t1)

  const after = await view('last_snapshot')
  check(after.Timestamp === round.timestamp, 'PreviousRound.Timestamp advanced to the 13-digit ms round', String(after.Timestamp))
  check(after.Period === oracle.Period, 'Period', `${after.Period}`)
  check(deepEq(after.Summary, oracle.Summary), 'Summary (Stakes/Ratings/Rewards)', show(after.Summary))
  const dDetails = diffTwoLevel(after.Details, oracle.Details, 'Details')
  check(dDetails === '', `every per-pair Score/Rating/Reward (${pairCount(oracle.Details)} pairs)`, dDetails || 'identical to oracle')

  const dumpAfter = await view('dump')
  const dRewarded = diffTwoLevel(dumpAfter.Rewarded, oracle.Rewarded, 'Rewarded')
  check(dRewarded === '', `cumulative Rewarded, whole map (${Object.keys(oracle.Rewarded).length} hodlers / ${pairCount(oracle.Rewarded)} pairs)`, dRewarded || 'identical to oracle')
  check(diffTwoLevel(dumpAfter.Claimed, expected.state.Claimed, 'Claimed') === '', 'Claimed untouched by a round', 'identical to seed')
  check(Object.keys(dumpAfter.PendingRounds || {}).length === 0, 'PendingRounds cleared after settle', String(Object.keys(dumpAfter.PendingRounds || {}).length))

  // the accumulation must actually have moved, or "identical" is vacuous
  const moved = Object.keys(oracle.Rewarded).filter(h =>
    !deepEq(oracle.Rewarded[h], expected.state.Rewarded[h])).length
  check(moved > 0, 'balances actually moved off the migrated priors', `${moved} hodlers changed`)
  const grew = Object.keys(oracle.Rewarded).length - Object.keys(expected.state.Rewarded).length
  console.log(`  (Rewarded grew by ${grew} hodlers — the fresh operators' own-cut self-keys)`)
  console.log(`  (Add-Scores ${addMs}ms, Complete-Round ${completeMs}ms, ${(scoresJson.length / 1024).toFixed(1)}KB score payload)`)

  console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}  —  pid=${pid}`)
  if (PERTURB) {
    console.log(fails > 0
      ? 'NEGATIVE CONTROL OK — the 1-wei perturbation was caught.'
      : 'NEGATIVE CONTROL FAILED — a perturbed oracle passed; the parity check has no teeth.')
    process.exit(fails > 0 ? 0 : 1)
  }
  process.exit(fails ? 1 : 0)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 600)); process.exit(2) })
