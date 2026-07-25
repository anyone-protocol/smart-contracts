// W-B — LEGACY ⇄ NATIVE reward-math cross-check for staking-rewards (Tier-2, luerl, no node).
//
// The staking counterpart of scripts/tier2-relay-legacy-crosscheck.ts, and the same argument: the
// native reward math is a VERBATIM frozen copy of legacynet `Complete-Round`, so the residual risk
// is a transcription typo that the busted/luerl specs (which assert the port against itself) cannot
// see. This drives the SAME realistic round through the LEGACY contract (Handlers shape, luerl `run`
// mode, `StakingRewards` global) AND the NATIVE port (D26 shape, luerl `native` mode, `base.state`),
// then diffs the per-pair Details, the round Summary, and the cumulative Rewarded map. Both compile
// the frozen math against the SAME `.common.bigint`, so a match proves the transcription is faithful
// across every branch.
//
// Inputs are REAL, straight from the 2026-07-09 live dump — no synthetic universe:
//   * REAL Configuration (TokensPerSecond 57870370370370370, Requirements.Running 0.5, Shares
//     {Enabled, Default 0.05, SetSharesEnabled=false, ChangeDelaySeconds 604800}).
//   * REAL (hodler, operator) pairs drawn from `Rewarded` — 865 exist, of which 220 are SELF-pairs
//     (hodler == operator, the operator's own-cut key) and 148 hodlers hold multiple operators.
//   * The FULL REAL `Rewarded` (562 hodlers) and `Claimed` (400) maps seeded as priors, so the
//     cumulative bigint add lands on nonzero migrated balances and every `restaked` branch fires
//     from real data: claimed present (Rewarded−Claimed), claimed absent (Rewarded), and no prior
//     at all (0) via deliberately fresh pairs.
//
// Three runs:
//   A  live config verbatim               — the production-faithful round (Share = Default 0.05).
//   B  SetSharesEnabled + per-operator Shares {0, 0.1, 0.5, 1.0} — exercises the operator-share
//      branch and its edges (0% and 100% cuts), which run A cannot reach (live has it disabled).
//      C  pending share-change delay      — asserts the ONE INTENDED DEVIATION and its direction:
//      legacy compares ms + SECONDS against ms, so a configured delay elapses ~1000× early; the
//      native port converts to ms. C fails if native applies early (the fix regressed) AND if
//      legacy holds (the bug stopped reproducing, meaning the fixture no longer proves anything).
//
// ADDRESS ENCODING is the one other deliberate deviation: legacy normalizes to 0x+ALLCAPS,
// native canonicalizes to EIP-55. Priors are therefore seeded to each side in ITS OWN encoding and
// keys are lowercased before diffing, so the MATH is compared apples-to-apples. (Encoding fidelity
// is covered separately and exhaustively by scripts/validate-address-migration.ts — 1724/1724
// addresses byte-preserved.)
//
// Small timestamps (PREV=1000, T=61000 → roundLength 60): roundLength is only a scalar multiplier on
// totalRewardsPerRound and changes no branch, so we keep the LEGACY contract — which still carries
// the A17 large-int-table-key bug — safely away from the device hang. Intermediates still exceed
// 64-bit by many orders of magnitude (totalRewards × Rating ≈ 1e39), so the bigint path is exercised.
//
// Compares PARSED objects (deep-equal), never raw json bytes — Lua `pairs` key order isn't stable.
// Run: [K=300] [PERTURB=1] bun run scripts/tier2-staking-legacy-crosscheck.ts
import { execFileSync } from 'node:child_process'
import { getAddress } from 'ethers'
import fs from 'fs'
import path from 'path'

const AO = path.resolve(import.meta.dir, '..')
const K = Number(process.env.K || 300)

const dump = JSON.parse(fs.readFileSync(
  path.join(AO, 'state-dumps/2026-07-09/live-staking-rewards.state.json'), 'utf8'))
const realRewarded: Record<string, Record<string, string>> = dump.Rewarded
const realClaimed: Record<string, Record<string, string>> = dump.Claimed
const realConfig = dump.Configuration

// ---------------------------------------------------------------------------------------------
// Round construction. Deterministic by index, so both sides see byte-identical input.
// ---------------------------------------------------------------------------------------------
const allPairs: { h: string; o: string }[] = []
for (const h of Object.keys(realRewarded)) for (const o of Object.keys(realRewarded[h])) allPairs.push({ h, o })
const allOps = [...new Set(allPairs.map(p => p.o))]
if (allPairs.length < K) { console.error(`dump has only ${allPairs.length} pairs, K=${K}`); process.exit(2) }

// Running is the gate on Requirements.Running (0.5): below → rating 0 (and the reward branch still
// runs, yielding 0), at the boundary → included, above → included.
const running = (i: number) => (i % 9 === 0 ? 0.25 : i % 9 === 1 ? 0.5 : 1)
const staked = (i: number) => String(BigInt(100 + (i * 137) % 9900) * 10n ** 18n)

const scores: Record<string, Record<string, { Staked: string; Running: number }>> = {}
let freshPairs = 0
for (let i = 0; i < K; i++) {
  const p = allPairs[i]
  ;(scores[p.h] ||= {})[p.o] = { Staked: staked(i), Running: running(i) }
  // every 4th hodler also stakes to an operator it has NO prior with → restaked = 0 branch
  if (i % 4 === 0) {
    const fresh = allOps[(i * 7) % allOps.length]
    if (!realRewarded[p.h]?.[fresh] && !scores[p.h][fresh]) {
      scores[p.h][fresh] = { Staked: staked(i + 1), Running: 1 }
      freshPairs++
    }
  }
}

// Coverage of the branches this round actually reaches (reported, not assumed).
let nPairs = 0, nSelf = 0, nClaimed = 0, nBelow = 0, nBoundary = 0
const multiOp = Object.values(scores).filter(ops => Object.keys(ops).length > 1).length
for (const [h, ops] of Object.entries(scores)) for (const [o, s] of Object.entries(ops)) {
  nPairs++
  if (h === o) nSelf++
  if (realClaimed[h]?.[o] != null && realRewarded[h]?.[o] != null) nClaimed++
  if (s.Running < 0.5) nBelow++
  if (s.Running === 0.5) nBoundary++
}

// ---------------------------------------------------------------------------------------------
// Priors, seeded to each side in its own address encoding.
// ---------------------------------------------------------------------------------------------
const toEip55 = (m: Record<string, Record<string, string>>) => {
  const out: Record<string, Record<string, string>> = {}
  for (const [h, ops] of Object.entries(m)) {
    const inner: Record<string, string> = {}
    for (const [o, v] of Object.entries(ops)) inner[getAddress(o)] = v
    out[getAddress(h)] = inner
  }
  return out
}
const legacyRewarded = realRewarded, legacyClaimed = realClaimed
const nativeRewarded = toEip55(realRewarded), nativeClaimed = toEip55(realClaimed)

const PREV = 1000, T = 61000    // roundLength = (61000 - 1000) // 1000 = 60

// ---------------------------------------------------------------------------------------------
// Scenario plumbing.
// ---------------------------------------------------------------------------------------------
const lit = (o: unknown) => {
  const j = JSON.stringify(o)
  if (j.includes(']==]')) throw new Error('payload contains ]==] — long-bracket delimiter unsafe')
  return `[==[${j}]==]`
}
const OWNER = "'0x' .. string.rep('1', 40)"
const preamble = `
local json = require('json')
local OWNER = ${OWNER}
local function commit(c) return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } } end
local function assign(a, d, ts)
  local tags = { { name = 'Action', value = a } }
  if ts then tags[#tags + 1] = { name = 'Round-Timestamp', value = tostring(ts) } end
  return { body = { action = a, commitments = commit(OWNER), tags = tags, data = d } }
end
`

type Run = {
  config: any
  shares: Record<string, number>
  pending: Record<string, { Share: number; RequestedTimestamp: number }>
  scoresJson: string
  perturb?: boolean
}

function legacyScenario(r: Run) {
  return `${preamble}
StakingRewards.Configuration       = json.decode(${lit(r.config)})
StakingRewards.Rewarded            = json.decode(${lit(legacyRewarded)})
StakingRewards.Claimed             = json.decode(${lit(legacyClaimed)})
StakingRewards.Shares              = json.decode(${lit(r.shares)})
StakingRewards.PendingShareChanges = json.decode(${lit(r.pending)})
StakingRewards.PendingRounds       = {}
StakingRewards.PreviousRound = { Timestamp = ${PREV}, Period = 0, Summary = {}, Configuration = {}, Details = {} }
local function run(a, d, ts)
  local b = { process = { id = 'PID', commitments = commit(OWNER) }, state = {} }
  compute(b, assign(a, d, ts)); return b
end
run('Add-Scores', ${lit(JSON.parse(r.scoresJson))}, ${T})
run('Complete-Round', nil, ${T})
print('OUT_DETAILS=' .. json.encode(StakingRewards.PreviousRound.Details))
print('OUT_SUMMARY=' .. json.encode(StakingRewards.PreviousRound.Summary))
print('OUT_PERIOD=' .. json.encode(StakingRewards.PreviousRound.Period))
print('OUT_REWARDED=' .. json.encode(StakingRewards.Rewarded))
print('OUT_CLAIMED=' .. json.encode(StakingRewards.Claimed))
print('OUT_SHARES=' .. json.encode(StakingRewards.Shares))
print('OUT_PENDING=' .. json.encode(StakingRewards.PendingShareChanges))
return { pass = 1, fail = 0, failures = {} }
`
}

function nativeScenario(r: Run) {
  const cfg = r.perturb
    ? { ...r.config, TokensPerSecond: (BigInt(r.config.TokensPerSecond) + 1n).toString() }
    : r.config
  const state = {
    Claimed: nativeClaimed,
    Rewarded: nativeRewarded,
    Shares: Object.fromEntries(Object.entries(r.shares).map(([k, v]) => [getAddress(k), v])),
    PendingShareChanges: Object.fromEntries(
      Object.entries(r.pending).map(([k, v]) => [getAddress(k), v])),
    Configuration: cfg,
    PreviousRound: { Timestamp: PREV, Period: 0, Summary: {}, Configuration: {}, Details: {} },
    PendingRounds: {},
  }
  return `${preamble}
local base = { process = { id = 'PID', commitments = commit(OWNER) }, state = json.decode(${lit(state)}) }
compute(base, assign('Add-Scores', ${lit(JSON.parse(r.scoresJson))}, ${T}))
compute(base, assign('Complete-Round', nil, ${T}))
print('OUT_DETAILS=' .. json.encode(base.state.PreviousRound.Details))
print('OUT_SUMMARY=' .. json.encode(base.state.PreviousRound.Summary))
print('OUT_PERIOD=' .. json.encode(base.state.PreviousRound.Period))
print('OUT_REWARDED=' .. json.encode(base.state.Rewarded))
print('OUT_CLAIMED=' .. json.encode(base.state.Claimed))
print('OUT_SHARES=' .. json.encode(base.state.Shares))
print('OUT_PENDING=' .. json.encode(base.state.PendingShareChanges))
return { pass = 1, fail = 0, failures = {} }
`
}

const podman = (args: string[]) => execFileSync('podman',
  ['run', '--rm', '-v', `${AO}:/work:Z`, '-w', '/work', 'anyone-luerl:1.3.0', ...args],
  { encoding: 'utf8', timeout: 900000, maxBuffer: 512 * 1024 * 1024 })

const grep = (raw: string, tag: string) => {
  const line = raw.split('\n').find(l => l.startsWith(tag + '='))
  if (!line) { console.error(`no ${tag}= line in output:\n` + raw.slice(0, 2000)); process.exit(2) }
  return JSON.parse(line.slice(tag.length + 1))
}

type Side = { details: any; summary: any; period: any; rewarded: any; claimed: any; shares: any; pending: any }
function parse(raw: string): Side {
  return {
    details: grep(raw, 'OUT_DETAILS'), summary: grep(raw, 'OUT_SUMMARY'),
    period: grep(raw, 'OUT_PERIOD'), rewarded: grep(raw, 'OUT_REWARDED'),
    claimed: grep(raw, 'OUT_CLAIMED'), shares: grep(raw, 'OUT_SHARES'),
    pending: grep(raw, 'OUT_PENDING'),
  }
}

function execute(tag: string, r: Run): { legacy: Side; native: Side } {
  const lp = path.join(AO, `dist/staking-crosscheck-${tag}-legacy-scen.lua`)
  const np = path.join(AO, `dist/staking-crosscheck-${tag}-native-scen.lua`)
  fs.writeFileSync(lp, legacyScenario(r))
  fs.writeFileSync(np, nativeScenario(r))
  const legacy = parse(podman(['run', '/work', 'src/contracts/staking-rewards.lua', 'StakingRewards', `/work/${path.relative(AO, lp)}`]))
  const native = parse(podman(['native', '/work', 'src/contracts/native/staking-rewards.lua', `/work/${path.relative(AO, np)}`]))
  return { legacy, native }
}

// ---------------------------------------------------------------------------------------------
// Diffing. Keys lowercased at every level (the deliberate encoding deviation), values compared
// exactly — reward amounts are strings and must match character-for-character.
// ---------------------------------------------------------------------------------------------
const lower = (v: any): any => {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(lower)
  const out: any = {}
  for (const [k, val] of Object.entries(v)) out[/^0x[0-9a-fA-F]{40}$/.test(k) ? k.toLowerCase() : k] = lower(val)
  return out
}

function diff(a: any, b: any, p = ''): string | null {
  if (a === b) return null
  if (typeof a !== typeof b) return `${p}: type ${typeof a} vs ${typeof b}`
  if (typeof a !== 'object' || a === null || b === null) return `${p}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) {
    const only = ka.filter(k => !(k in b)).concat(kb.filter(k => !(k in a))).slice(0, 4)
    return `${p}: ${ka.length} keys vs ${kb.length} (${only})`
  }
  for (const k of ka) { const d = diff(a[k], b[k], p ? `${p}.${k}` : k); if (d) return d }
  return null
}

let failures = 0
const check = (label: string, d: string | null) => {
  if (d) { failures++; console.log(`  FAIL  ${label} — ${d}`) } else console.log(`  ok    ${label}`)
}

// ---------------------------------------------------------------------------------------------
console.log(`staking legacy ⇄ native cross-check — K=${K} seed pairs from the live dump`)
console.log(`  round: ${nPairs} scored (hodler,operator) pairs across ${Object.keys(scores).length} hodlers`)
console.log(`  branch coverage: ${nSelf} self-pairs (operator own-cut key), ${multiOp} multi-operator hodlers,`)
console.log(`                   ${nClaimed} with a real Claimed prior (Rewarded−Claimed), ${freshPairs} fresh (restaked 0),`)
console.log(`                   ${nBelow} below the Running gate (rating 0), ${nBoundary} exactly at it`)
console.log(`  priors: ${Object.keys(realRewarded).length} Rewarded hodlers, ${Object.keys(realClaimed).length} Claimed`)
console.log(`  config: TokensPerSecond=${realConfig.TokensPerSecond}, roundLength=60`)
if (process.env.PERTURB) console.log('  ** PERTURB set — native TokensPerSecond +1 wei; mismatches are EXPECTED **')

const scoresJson = JSON.stringify({ Scores: scores })
const perturb = !!process.env.PERTURB

// --- A: live config verbatim -----------------------------------------------------------------
console.log('\nA) live configuration verbatim (Shares.Default 0.05, SetSharesEnabled=false)')
const A = execute('a', { config: realConfig, shares: {}, pending: {}, scoresJson, perturb })

const aLegDetails = lower(A.legacy.details), aNatDetails = lower(A.native.details)
const flat = (d: any) => { const o: Record<string, any> = {}; for (const h of Object.keys(d)) for (const op of Object.keys(d[h])) o[`${h}|${op}`] = d[h][op]; return o }
const aLegFlat = flat(aLegDetails), aNatFlat = flat(aNatDetails)
// guard against a both-missing false pass: every pair must exist on BOTH sides with a real Reward
const keys = Object.keys(aLegFlat)
const present = keys.filter(k => aLegFlat[k]?.Reward?.Hodler != null && aNatFlat[k]?.Reward?.Hodler != null).length
console.log(`  ${present}/${nPairs} pairs present on both sides with a real Reward (false-pass guard)`)
if (present !== nPairs) { failures++; console.log(`  FAIL  ${nPairs - present} pairs missing on one side`) }
const sample = aLegFlat[keys[0]]
console.log(`  sample Details[${keys[0].slice(0, 10)}…]: Rating=${sample?.Rating} Reward.Hodler=${sample?.Reward?.Hodler} Reward.Operator=${sample?.Reward?.Operator} Restaked=${sample?.Score?.Restaked}`)
let detBad = 0
for (const k of keys) { const d = diff(aLegFlat[k], aNatFlat[k], `Details[${k.slice(0, 10)}…]`); if (d) { detBad++; if (detBad <= 5) console.log(`  FAIL  ${d}`) } }
console.log(`  ${keys.length - detBad}/${keys.length} pair Details identical (legacy ⇄ native)`)
failures += detBad
check('PreviousRound.Summary', diff(A.legacy.summary, A.native.summary, 'Summary'))
check('PreviousRound.Period', diff(A.legacy.period, A.native.period, 'Period'))
check('Rewarded (cumulative, onto migrated balances)', diff(lower(A.legacy.rewarded), lower(A.native.rewarded), 'Rewarded'))
check('Claimed (untouched by a round)', diff(lower(A.legacy.claimed), lower(A.native.claimed), 'Claimed'))
// the accumulation must actually have moved off the seeded priors, or "identical" is vacuous
const movedOff = Object.keys(lower(A.native.rewarded)).filter(h => {
  const seeded = lower(nativeRewarded)[h]
  return seeded && JSON.stringify(lower(A.native.rewarded)[h]) !== JSON.stringify(seeded)
}).length
console.log(`  ${movedOff} hodlers accumulated onto their migrated prior (final != seed)`)
if (movedOff === 0) { failures++; console.log('  FAIL  no balance moved — the round did nothing') }

// --- B: operator shares ----------------------------------------------------------------------
console.log('\nB) SetSharesEnabled + per-operator Shares {0, 0.1, 0.5, 1.0} (share branch + edges)')
const SHARE_SET = [0, 0.1, 0.5, 1.0]
const bShares: Record<string, number> = {}
const scoredOps = [...new Set(Object.values(scores).flatMap(ops => Object.keys(ops)))]
// every 5th operator is left WITHOUT a share so the Default-fallback branch fires alongside the
// explicit ones. (Stride and set size must stay coprime, or whole share values silently go unused.)
scoredOps.forEach((o, i) => { if (i % 5 !== 0) bShares[o] = SHARE_SET[i % SHARE_SET.length] })
const bConfig = { ...realConfig, Shares: { ...realConfig.Shares, SetSharesEnabled: true } }
const B = execute('b', { config: bConfig, shares: bShares, pending: {}, scoresJson, perturb })
const bLegFlat = flat(lower(B.legacy.details)), bNatFlat = flat(lower(B.native.details))
const bKeys = Object.keys(bLegFlat)
let bBad = 0
for (const k of bKeys) { const d = diff(bLegFlat[k], bNatFlat[k], `Details[${k.slice(0, 10)}…]`); if (d) { bBad++; if (bBad <= 5) console.log(`  FAIL  ${d}`) } }
console.log(`  ${bKeys.length - bBad}/${bKeys.length} pair Details identical with per-operator shares`)
failures += bBad
const sharesSeen = new Set(bKeys.map(k => bLegFlat[k]?.Score?.Share))
console.log(`  distinct Share values exercised in-round: ${[...sharesSeen].sort().join(', ')}`)
// share 1.0 → the whole reward is the operator's; share 0 → none of it. Both must appear, or the
// edges weren't reached and "identical" proves less than it looks.
const fullCut = bKeys.filter(k => bLegFlat[k]?.Score?.Share === 1 && bLegFlat[k]?.Reward?.Hodler === '0').length
const zeroCut = bKeys.filter(k => bLegFlat[k]?.Score?.Share === 0 && bLegFlat[k]?.Reward?.Operator === '0').length
console.log(`  edges reached: ${fullCut} pairs at Share=1.0 (Hodler cut 0), ${zeroCut} at Share=0 (Operator cut 0)`)
if (fullCut === 0 || zeroCut === 0) { failures++; console.log('  FAIL  share edges not exercised') }
check('Summary with per-operator shares', diff(B.legacy.summary, B.native.summary, 'Summary'))
check('Rewarded with per-operator shares', diff(lower(B.legacy.rewarded), lower(B.native.rewarded), 'Rewarded'))

// --- C: the one intended deviation ------------------------------------------------------------
// The delay window has to straddle the two readings for the divergence to be visible:
//   legacy applies when Requested + D <= T ; native applies when Requested + 1000·D <= T.
// With Requested=1000 and T=61000 that means 60 < D <= 60000, so C uses D = 3600 (a plausible
// 1-hour delay) rather than the live 604800. The live 7-day value would need 13-digit ms
// timestamps, which trip the LEGACY contract's A17 large-int-table-key hang under luerl — the
// realistic-ms cases therefore live in the Tier-1/Tier-2 NATIVE specs, where no legacy contract
// is present to hang. The arithmetic under test is identical either way.
const C_DELAY = 3600
console.log('\nC) pending share-change delay — the ONE INTENDED DEVIATION (ms/seconds unit fix)')
const op0 = scoredOps[0], op1 = scoredOps[1]
const cPending = {
  [op0]: { Share: 0.42, RequestedTimestamp: PREV },
  [op1]: { Share: 0.11, RequestedTimestamp: PREV },
}
const cConfig = { ...realConfig, Shares: { ...realConfig.Shares, ChangeDelaySeconds: C_DELAY } }
const cScores = { Scores: { [Object.keys(scores)[0]]: scores[Object.keys(scores)[0]] } }
const C = execute('c', { config: cConfig, shares: {}, pending: cPending, scoresJson: JSON.stringify(cScores) })
const cLegShares = lower(C.legacy.shares), cNatShares = lower(C.native.shares)
const cLegPending = lower(C.legacy.pending), cNatPending = lower(C.native.pending)
const legApplied = Object.keys(cLegShares).length, natApplied = Object.keys(cNatShares).length
console.log(`  ChangeDelaySeconds=${C_DELAY}s (1 hour); requested at t=${PREV}ms, round at t=${T}ms — 60s of real time later`)
console.log(`  legacy applied ${legApplied}/2 share changes (${Object.keys(cLegPending).length} still pending)`)
console.log(`  native applied ${natApplied}/2 share changes (${Object.keys(cNatPending).length} still pending)`)
if (legApplied === 2 && natApplied === 0) {
  console.log('  ok    legacy applies a 1-HOUR delay after 60s (ms + SECONDS bug); native correctly holds')
} else {
  failures++
  console.log(`  FAIL  expected legacy 2 / native 0 — got legacy ${legApplied} / native ${natApplied}`)
  if (natApplied > 0) console.log('        native applied early: the ms unit fix has REGRESSED')
  if (legApplied < 2) console.log('        legacy did not apply: the bug being corrected is not reproducing — check the fixture')
}

// ---------------------------------------------------------------------------------------------
const expectFailures = perturb
const ok = expectFailures ? failures > 0 : failures === 0
console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' mismatch(es)'}  —  LEGACY ⇄ NATIVE staking reward math, ${nPairs} pairs, real config + real migrated balances.`)
if (expectFailures) console.log(ok ? 'NEGATIVE CONTROL OK — the perturbed run was caught.' : 'NEGATIVE CONTROL FAILED — a perturbed run passed; the diff has no teeth.')
process.exit(ok ? 0 : 1)
