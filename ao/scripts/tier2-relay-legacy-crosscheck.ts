// W-A.6 — LEGACY ⇄ NATIVE reward-math cross-check (Tier-2, luerl, no node).
//
// The verification-chain audit found the weak link: the multi-branch reward math (hardware pool
// split, exit distribution, multi-fingerprint proportional division, delegate split) was verified
// native-vs-native + native-vs-node, but tied to the LEGACY reference only through the thin
// 1-fingerprint bint golden. This closes that gap: it drives the SAME realistic round through the
// LEGACY contract (Handlers shape, luerl `run` mode) AND the NATIVE port (D26 shape, luerl `native`
// mode), then diffs the per-fingerprint Details, the round Summary, and the cumulative
// TotalFingerprintReward. Both compile the frozen math against the SAME `.common.bigint`, so a
// byte-match proves the Handlers→native transcription is faithful across EVERY branch — turning the
// 300-fingerprint check from native-vs-native into native-vs-LEGACY.
//
// Design (identical inputs, injected into both so the one deliberate deviation — EIP-55 vs legacy
// 0x+ALLCAPS address encoding — can't cause a spurious diff):
//   * REAL deployed Configuration (from the seed dump): fractional powers (Family^0.5, Location^1.85),
//     4 uptime tiers {0:1,3:2,14:3,45:5} — a float-heavy config that exercises the float paths.
//   * REAL fingerprints + REAL EIP-55 operator addresses (from the seed), paired 1:1.
//   * REAL migrated balances: TotalFingerprintReward pre-seeded per fingerprint, so the cumulative
//     bigint add is checked ONTO nonzero priors (not from zero).
//   * Delegates injected DIRECTLY into both Configuration maps (EIP-55 keys) — bypassing each
//     contract's differing normalization — so the delegate OperatorTotal/DelegateTotal split is
//     exercised identically. (Set-Delegate / Update-Configuration re-key differently by design; that
//     encoding deviation is out of scope for a MATH cross-check and is covered elsewhere.)
//   * Small timestamps (PREV=1000, T=61000 → roundLength 60): roundLength is only a scalar multiplier
//     on totalRewardsPerRound and does not change branch coverage, so we keep the LEGACY contract
//     (which still carries the A17 large-int-key bug) safely away from the device hang.
//
// Compares PARSED objects (deep-equal), never raw json bytes — Lua `pairs` key order isn't stable.
// Run: [K=300] bun run scripts/tier2-relay-legacy-crosscheck.ts
import { luerl } from './util/luerl'
import fs from 'fs'
import path from 'path'

const AO = path.resolve(import.meta.dir, '..')
const K = Number(process.env.K || 300)

const seed = JSON.parse(fs.readFileSync(path.join(AO, 'dist/relay-rewards-seed.expected.json'), 'utf8'))
const seedTFR: Record<string, string> = seed.state.TotalFingerprintReward
const fps = Object.keys(seedTFR).slice(0, K)
const addrs = Object.keys(seed.state.TotalAddressReward).slice(0, K)
if (fps.length < K || addrs.length < K) { console.error(`seed too small for K=${K} (fps=${fps.length}, addrs=${addrs.length})`); process.exit(2) }

// Varied score attributes (deterministic by index → both sides identical), exercising all math
// paths: hardware on/off, every uptime tier, exit on/off, family/location spread. (Same generator
// as tier3-relay-realistic.ts.)
const TIERS = [0, 3, 14, 45]
const score = (i: number) => ({
  Address: addrs[i],
  Network: 1000 + (i * 137) % 90000,
  IsHardware: i % 3 === 0,
  UptimeStreak: TIERS[i % 4],
  ExitBonus: i % 5 === 0,
  FamilySize: i % 7,
  LocationSize: i % 11,
})
const Scores: Record<string, any> = {}
for (let i = 0; i < K; i++) Scores[fps[i]] = score(i)
const scoresJson = JSON.stringify({ Scores })

// Real deployed config + injected delegates: first 10 operators delegate 25% to addrs[K-1].
const NDELEG = 10
const delegates: Record<string, any> = {}
for (let i = 0; i < NDELEG; i++) delegates[addrs[i]] = { Address: addrs[K - 1], Share: 0.25 }
const cfg = { ...seed.state.Configuration, Delegates: delegates }
const configJson = JSON.stringify(cfg)
// NEGATIVE CONTROL: with PERTURB set, feed the NATIVE side a config that differs by 1 atomic unit
// of TokensPerSecond. Every reward shifts → the cross-check MUST report mismatches. Proves the diff
// has teeth (a passing test that can't fail is worthless).
const cfgNative = process.env.PERTURB
  ? { ...cfg, TokensPerSecond: (BigInt(cfg.TokensPerSecond) + 1n).toString() }
  : cfg

// Real migrated balances for the sampled fingerprints (cumulative add checked onto nonzero priors).
const priorTFR: Record<string, string> = {}
for (const fp of fps) priorTFR[fp] = seedTFR[fp]
const priorJson = JSON.stringify(priorTFR)

const PREV = 1000, T = 61000   // roundLength = (61000-1000)//1000 = 60

const OWNER = "'0x' .. string.rep('1', 40)"
const helpers = `
local json = require('json')
local OWNER = ${OWNER}
local function commit(c) return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } } end
local function assign(a, d, ts)
  local tags = { { name = 'Action', value = a } }
  if ts then tags[#tags + 1] = { name = 'Round-Timestamp', value = tostring(ts) } end
  return { body = { action = a, commitments = commit(OWNER), tags = tags, data = d } }
end
local configJson = [==[${configJson}]==]
local priorJson  = [==[${priorJson}]==]
local scoresJson = [==[${scoresJson}]==]
`

// --- LEGACY scenario (Handlers shape, `run` mode). State lives in the managed global RelayRewards;
//     runtime.manage() holds the LIVE reference, so post-manage injection is honored.
const legacyScen = `${helpers}
RelayRewards.Configuration = json.decode(configJson)
RelayRewards.TotalFingerprintReward = json.decode(priorJson)
RelayRewards.PreviousRound.Timestamp = ${PREV}
local function run(a, d, ts)
  local b = { process = { id = 'PID', commitments = commit(OWNER) }, state = {} }
  compute(b, assign(a, d, ts)); return b
end
run('Add-Scores', scoresJson, ${T})
run('Complete-Round', nil, ${T})
print('LEGACY_DETAILS=' .. json.encode(RelayRewards.PreviousRound.Details))
print('LEGACY_SUMMARY=' .. json.encode(RelayRewards.PreviousRound.Summary))
print('LEGACY_TFR=' .. json.encode(RelayRewards.TotalFingerprintReward))
return { pass = 1, fail = 0, failures = {} }
`

// --- NATIVE scenario (D26 shape, `native` mode). State injected via native.setStateRoot (skips migrate-on-
//     spawn); Details ride the Complete-Round OUTPUT (never persisted).
const nativeStateJson = JSON.stringify({
  Claimed: {},
  TotalAddressReward: {},
  TotalFingerprintReward: priorTFR,
  Configuration: cfgNative,
  PreviousRound: { Timestamp: PREV, Period: 0, Summary: {}, Configuration: {} },
  PendingRounds: {},
})
const nativeScen = `${helpers}
local stateJson = [==[${nativeStateJson}]==]
native.setStateRoot(json.decode(stateJson))
local base = { process = { id = 'PID', commitments = commit(OWNER) } }
compute(base, assign('Add-Scores', scoresJson, ${T}))
compute(base, assign('Complete-Round', nil, ${T}))
local out = json.decode(base.results.output.data)
print('NATIVE_DETAILS=' .. json.encode(out.Details))
print('NATIVE_SUMMARY=' .. json.encode(out.Summary))
print('NATIVE_TFR=' .. json.encode(native.stateRoot().TotalFingerprintReward))
return { pass = 1, fail = 0, failures = {} }
`

const legacyPath = path.join(AO, 'dist/relay-crosscheck-legacy-scen.lua')
const nativePath = path.join(AO, 'dist/relay-crosscheck-native-scen.lua')
fs.writeFileSync(legacyPath, legacyScen)
fs.writeFileSync(nativePath, nativeScen)

const podman = (args: string[]) => luerl(args, { timeoutMs: 600_000, maxBuffer: 256 * 1024 * 1024 })
const grep = (raw: string, tag: string) => {
  const line = raw.split('\n').find(l => l.startsWith(tag + '='))
  if (!line) { console.error(`no ${tag}= line in output:\n` + raw.slice(0, 1200)); process.exit(2) }
  return JSON.parse(line.slice(tag.length + 1))
}

console.log(`cross-check: K=${K} fingerprints, real config (TokensPerSecond=${cfg.TokensPerSecond}), ${NDELEG} delegates, roundLength 60`)
console.log('running LEGACY (Handlers shape, luerl run mode)…')
const legRaw = podman(['run', '/work', 'src/contracts/relay-rewards.lua', 'RelayRewards', '/work/dist/relay-crosscheck-legacy-scen.lua'])
const legDetails = grep(legRaw, 'LEGACY_DETAILS')
const legSummary = grep(legRaw, 'LEGACY_SUMMARY')
const legTFR = grep(legRaw, 'LEGACY_TFR')

console.log('running NATIVE (D26 shape, luerl native mode)…')
const natRaw = podman(['native', '/work', 'src/contracts/native/relay-rewards.lua', '/work/dist/relay-crosscheck-native-scen.lua'])
const natDetails = grep(natRaw, 'NATIVE_DETAILS')
const natSummary = grep(natRaw, 'NATIVE_SUMMARY')
const natTFR = grep(natRaw, 'NATIVE_TFR')

// order-independent deep equality; returns first differing path or null.
function diff(a: any, b: any, p = ''): string | null {
  if (a === b) return null
  if (typeof a !== typeof b) return `${p}: type ${typeof a} vs ${typeof b}`
  if (typeof a !== 'object' || a === null || b === null) return a === b ? null : `${p}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return `${p}: ${ka.length} keys vs ${kb.length} (${ka.filter(k => !(k in b)).concat(kb.filter(k => !(k in a))).slice(0, 4)})`
  for (const k of ka) { const d = diff(a[k], b[k], p ? `${p}.${k}` : k); if (d) return d }
  return null
}

let fails = 0
const report = (label: string, d: string | null) => {
  if (d) { fails++; console.log(`  FAIL  ${label}  — ${d}`) }
  else console.log(`  ok    ${label}`)
}

// guard against a both-undefined false-pass (diff(undefined, undefined) === null): require every
// fingerprint present on BOTH sides with a real Reward.Total before trusting the equality.
const present = fps.filter(fp => legDetails[fp]?.Reward?.Total != null && natDetails[fp]?.Reward?.Total != null).length
console.log(`\nA) per-fingerprint Details (all math branches, ${NDELEG} delegated):`)
console.log(`  ${present}/${fps.length} fingerprints present on both sides with a real Reward.Total`)
const s0 = legDetails[fps[0]]
console.log(`  sample Details[${fps[0].slice(0, 8)}…]: Rating.Network=${s0?.Rating?.Network} Reward.Total=${s0?.Reward?.Total} Reward.Hardware=${s0?.Reward?.Hardware}`)
let detBad = present < fps.length ? 1 : 0, checked = 0, delegatedSeen = 0
if (present < fps.length) console.log(`  FAIL  ${fps.length - present} fingerprints missing/empty on one side (would be a false-pass)`)
// BRANCH COVERAGE, asserted rather than assumed. The score generator varies hardware /
// exit / uptime-tier, but "both sides agree" stays true even if a branch stopped firing
// entirely — a config change (Modifiers.Hardware.Enabled=false), a different tier table,
// or an edit to the generator would silently shrink what this proves while still
// reporting 300/300. Same trap that made the staking cross-check's share run look green
// while exercising only half its share values.
const coverage = { hardware: 0, exit: 0, uptime: 0, tiers: new Set<number>() }
for (const fp of fps) {
  const d = diff(legDetails[fp], natDetails[fp], `Details[${fp.slice(0, 8)}…]`)
  checked++
  if (d) { detBad++; if (detBad <= 5) console.log(`  FAIL  ${d}`) }
  const r = legDetails[fp]?.Reward
  if (r?.Hardware && r.Hardware !== '0') coverage.hardware++
  if (r?.ExitBonus && r.ExitBonus !== '0') coverage.exit++
  if (r?.Uptime && r.Uptime !== '0') coverage.uptime++
  const tier = legDetails[fp]?.Score?.UptimeStreak
  if (typeof tier === 'number') coverage.tiers.add(tier)
  // sanity: confirm the delegate branch actually fired (DelegateTotal != '0') for delegated fps
  if (delegates[legDetails[fp]?.Address] && legDetails[fp]?.Reward?.DelegateTotal !== '0') delegatedSeen++
}
console.log(`  ${checked - (detBad - (present < fps.length ? 1 : 0))}/${checked} fingerprint Details byte-identical (legacy ⇄ native)`)
console.log(`  ${delegatedSeen}/${NDELEG} delegated fingerprints exercised the delegate split (DelegateTotal>0)`)
console.log(`  branches exercised in-round: hardware ${coverage.hardware}, exit ${coverage.exit}, ` +
  `uptime ${coverage.uptime}, tiers {${[...coverage.tiers].sort((a, b) => a - b).join(',')}}`)
const uncovered = [
  coverage.hardware === 0 && 'hardware pool split',
  coverage.exit === 0 && 'exit distribution',
  coverage.uptime === 0 && 'uptime bonus',
  coverage.tiers.size < TIERS.length && `uptime tiers (${coverage.tiers.size}/${TIERS.length})`,
].filter(Boolean) as string[]
if (uncovered.length) {
  console.log(`  FAIL  branch(es) never fired: ${uncovered.join(', ')} — the agreement above ` +
    'proves less than it appears to')
}

console.log('\nB) round Summary (aggregate ratings + rewards):')
report('PreviousRound.Summary', diff(legSummary, natSummary, 'Summary'))

console.log('\nC) cumulative TotalFingerprintReward (bigint add onto real migrated balances):')
let tfrBad = 0
for (const fp of fps) {
  if (legTFR[fp] !== natTFR[fp]) { tfrBad++; if (tfrBad <= 5) console.log(`  FAIL  TFR[${fp.slice(0, 8)}…]  legacy ${legTFR[fp]} vs native ${natTFR[fp]}`) }
  // and confirm it actually accumulated onto the prior (moved off the seed value)
}
const movedOff = fps.filter(fp => natTFR[fp] !== priorTFR[fp]).length
console.log(`  ${fps.length - tfrBad}/${fps.length} TotalFingerprintReward byte-identical (legacy ⇄ native)`)
console.log(`  ${movedOff}/${fps.length} accumulated onto the migrated prior (final != seed)`)

fails += detBad + tfrBad
const ok = fails === 0 && detBad === 0 && tfrBad === 0 && delegatedSeen === NDELEG
  && uncovered.length === 0
console.log(`\n${ok ? 'ALL PASS' : fails + ' mismatch(es)'}  —  LEGACY ⇄ NATIVE reward math, ${K} fingerprints, real config, all branches.`)
process.exit(ok ? 0 : 1)
