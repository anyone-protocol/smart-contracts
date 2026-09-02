// Build a SEED module for native staking-rewards from the REAL legacynet dump (migrate-on-spawn).
// Transforms live-staking-rewards.state.json → native state shape:
//   * every address key → EIP-55 via ethers.getAddress, at BOTH levels of the dump's two-level
//     maps (Rewarded/Claimed/Details[hodler][operator]) and in Shares/PendingShareChanges
//   * D32 FLATTENING: those pair maps are then emitted as `[hodler/operator]`, and Details as
//     parallel typed maps (Staked/Restaked/Running/Share/Rating/RewardHodler/RewardOperator).
//     The nested form cost 3,336 live Lua tables and luerl's GC mark is quadratic in that.
//     Storage only — the contract's views reassemble the legacy nested shape.
//   * PreviousRound: KEEP Details — unlike relay, staking's Details are PERSISTED (the whole state
//     is ~322KB, so there is no size pressure and Last-Snapshot/Last-Round-Data stay plain views).
//     Seeding them preserves the final legacynet round's per-hodler breakdown across the migration.
//   * PendingRounds: {} (transient; the dump has none, and a completed round leaves none)
// Emits dist/staking-rewards-seed.lua + dist/staking-rewards-seed.expected.json (seed-diff oracle).
// Run: bun run scripts/build-staking-seed.ts [live|stage]   (default live)
import { getAddress } from 'ethers'
import fs from 'fs'
import path from 'path'
import { buildSeedBundle, buildSeedEnvelope } from './util/native-bundle'

const NET = (process.argv[2] || 'live') as 'live' | 'stage'
const AO = path.resolve(import.meta.dir, '..')
const DUMPS = path.join(AO, 'state-dumps/2026-07-09')
const rd = (f: string) => JSON.parse(fs.readFileSync(path.join(DUMPS, f), 'utf8'))

const dump = rd(`${NET}-staking-rewards.state.json`)
const rolesDump = rd(`${NET}-staking-rewards.roles.json`)

const asMap = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {}

const rejects: string[] = []
let addrCount = 0
const eip55 = (addr: string, label: string): string | null => {
  try { const c = getAddress(addr); addrCount++; return c }
  catch (e: any) { rejects.push(`${label}[${addr}]: ${e.shortMessage || e.message}`); return null }
}

/** [address] = value → EIP-55 keys, values verbatim. */
const oneLevel = <T>(src: Record<string, T>, label: string) => {
  const out: Record<string, T> = {}
  for (const [addr, v] of Object.entries(src)) {
    const c = eip55(addr, label); if (c) out[c] = v
  }
  return out
}

/** [hodler][operator] = value → EIP-55 keys at BOTH levels, values verbatim. */
const twoLevel = <T>(src: Record<string, Record<string, T>>, label: string) => {
  const out: Record<string, Record<string, T>> = {}
  for (const [hodler, ops] of Object.entries(src)) {
    const h = eip55(hodler, label); if (!h) continue
    const inner: Record<string, T> = {}
    for (const [op, v] of Object.entries(asMap(ops))) {
      const o = eip55(op, `${label}[${hodler}]`); if (o) inner[o] = v
    }
    out[h] = inner
  }
  return out
}

/** Nested EIP-55 pair map → the flat `[hodler/operator]` map the contract stores (D32). */
const flatten = <T>(nested: Record<string, Record<string, T>>) => {
  const out: Record<string, T> = {}
  for (const [h, ops] of Object.entries(nested)) for (const [o, v] of Object.entries(ops)) out[`${h}/${o}`] = v
  return out
}
/** Details records → seven parallel typed maps. Running/Share stay NUMBERS: stringifying a
 *  float and parsing it back is not guaranteed to round-trip identically under luerl. */
const splitDetails = (nested: Record<string, Record<string, any>>) => {
  const d = {
    Staked: {} as Record<string, string>, Restaked: {} as Record<string, string>,
    Running: {} as Record<string, number>, Share: {} as Record<string, number>,
    Rating: {} as Record<string, string>,
    RewardHodler: {} as Record<string, string>, RewardOperator: {} as Record<string, string>,
  }
  for (const [h, ops] of Object.entries(nested)) {
    for (const [o, rec] of Object.entries(ops)) {
      const k = `${h}/${o}`
      d.Staked[k] = rec?.Score?.Staked
      d.Restaked[k] = rec?.Score?.Restaked
      d.Running[k] = rec?.Score?.Running
      d.Share[k] = rec?.Score?.Share
      d.Rating[k] = rec?.Rating
      d.RewardHodler[k] = rec?.Reward?.Hodler
      d.RewardOperator[k] = rec?.Reward?.Operator
    }
  }
  return d
}

const nestedClaimed = twoLevel(asMap(dump.Claimed), 'Claimed')
const nestedRewarded = twoLevel(asMap(dump.Rewarded), 'Rewarded')
const nestedDetails = twoLevel(asMap(dump.PreviousRound?.Details), 'PreviousRound.Details')

const migrated = {
  Claimed: flatten(nestedClaimed),
  Rewarded: flatten(nestedRewarded),
  Shares: oneLevel(asMap(dump.Shares), 'Shares'),
  PendingShareChanges: oneLevel(asMap(dump.PendingShareChanges), 'PendingShareChanges'),
  Configuration: dump.Configuration,
  PreviousRound: {
    Timestamp: dump.PreviousRound?.Timestamp ?? 0,
    Period: dump.PreviousRound?.Period ?? 0,
    Summary: dump.PreviousRound?.Summary ?? {},
    Configuration: dump.PreviousRound?.Configuration ?? {},
    Details: splitDetails(nestedDetails),
  },
  PendingRounds: {},
}

// roles: { [role]: { [EIP-55 addr]: true } }
const roles: Record<string, Record<string, boolean>> = {}
for (const [role, holders] of Object.entries(asMap(rolesDump.Roles))) {
  roles[role] = {}
  for (const addr of Object.keys(asMap(holders))) {
    const c = eip55(addr, `roles.${role}`); if (c) roles[role][c] = true
  }
}

if (rejects.length) {
  console.error(`FAIL: ${rejects.length} address(es) rejected:`)
  for (const r of rejects.slice(0, 20)) console.error('   ', r)
  process.exit(1)
}

// A dropped key would silently shrink the migration; assert the transform is total.
const countPairs = (m: Record<string, Record<string, unknown>>) =>
  Object.values(m).reduce((n, ops) => n + Object.keys(ops).length, 0)
for (const [label, src, out] of [
  ['Rewarded', asMap(dump.Rewarded), nestedRewarded],
  ['Claimed', asMap(dump.Claimed), nestedClaimed],
  ['PreviousRound.Details', asMap(dump.PreviousRound?.Details), nestedDetails],
] as const) {
  if (Object.keys(src).length !== Object.keys(out).length || countPairs(src) !== countPairs(out)) {
    console.error(`FAIL: ${label} lost entries — ${Object.keys(src).length}/${countPairs(src)} in, ${Object.keys(out).length}/${countPairs(out)} out`)
    process.exit(1)
  }
}
// ...and that the D32 flattening is itself total. A collision or a dropped pair here would be
// invisible in the counts above, because those check the NESTED intermediates.
for (const [label, nested, flat] of [
  ['Rewarded', nestedRewarded, migrated.Rewarded],
  ['Claimed', nestedClaimed, migrated.Claimed],
] as const) {
  if (countPairs(nested) !== Object.keys(flat).length) {
    console.error(`FAIL: ${label} flatten lost pairs — ${countPairs(nested)} nested, ${Object.keys(flat).length} flat`)
    process.exit(1)
  }
}
for (const [field, m] of Object.entries(migrated.PreviousRound.Details)) {
  if (Object.keys(m).length !== countPairs(nestedDetails)) {
    console.error(`FAIL: Details.${field} has ${Object.keys(m).length} keys, expected ${countPairs(nestedDetails)}`)
    process.exit(1)
  }
}

const stateJson = JSON.stringify(migrated)
const rolesJson = JSON.stringify(roles)
const bundle = buildSeedBundle(stateJson, rolesJson, 'src/contracts/native/staking-rewards.lua')

const dist = path.join(AO, 'dist')
fs.mkdirSync(dist, { recursive: true })
fs.writeFileSync(path.join(dist, 'staking-rewards-seed.lua'), bundle)
fs.writeFileSync(path.join(dist, 'staking-rewards-seed.envelope.json'), buildSeedEnvelope(stateJson, rolesJson))
fs.writeFileSync(path.join(dist, 'staking-rewards-seed.expected.json'), JSON.stringify({ state: migrated, roles }, null, 0))

console.log(`=== staking-rewards seed from ${NET} dump (2026-07-09) ===`)
console.log('counts:', JSON.stringify({
  Rewarded: `${Object.keys(nestedRewarded).length} hodlers / ${Object.keys(migrated.Rewarded).length} pairs (flat)`,
  Claimed: `${Object.keys(nestedClaimed).length} hodlers / ${Object.keys(migrated.Claimed).length} pairs (flat)`,
  Details: `${Object.keys(nestedDetails).length} hodlers / ${Object.keys(migrated.PreviousRound.Details.Rating).length} pairs (7 parallel maps)`,
  Shares: Object.keys(migrated.Shares).length,
  PendingShareChanges: Object.keys(migrated.PendingShareChanges).length,
}))
console.log('roles :', Object.fromEntries(Object.entries(roles).map(([r, h]) => [r, Object.keys(h)[0]])))
console.log('PreviousRound: Timestamp', migrated.PreviousRound.Timestamp, 'Period', migrated.PreviousRound.Period, '(Details KEPT)')
console.log('config:', JSON.stringify(migrated.Configuration))
console.log(`addresses EIP-55: ${addrCount}   state json ${(stateJson.length / 1024).toFixed(1)}KB   bundle ${(bundle.length / 1024).toFixed(1)}KB`)
