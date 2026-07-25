// Build a SEED module for native staking-rewards from the REAL legacynet dump (migrate-on-spawn).
// Transforms live-staking-rewards.state.json → native state shape:
//   * every address key → EIP-55 via ethers.getAddress, at BOTH levels of the two-level maps
//     (Rewarded/Claimed/Details[hodler][operator]) and in Shares/PendingShareChanges
//   * PreviousRound: KEEP Details — unlike relay, staking's Details are PERSISTED (the whole state
//     is ~322KB, so there is no size pressure and Last-Snapshot/Last-Round-Data stay plain views).
//     Seeding them preserves the final legacynet round's per-hodler breakdown across the migration.
//   * PendingRounds: {} (transient; the dump has none, and a completed round leaves none)
// Emits dist/staking-rewards-seed.lua + dist/staking-rewards-seed.expected.json (seed-diff oracle).
// Run: bun run scripts/build-staking-seed.ts [live|stage]   (default live)
import { getAddress } from 'ethers'
import fs from 'fs'
import path from 'path'
import { buildSeedBundle } from './util/native-bundle'

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

const migrated = {
  Claimed: twoLevel(asMap(dump.Claimed), 'Claimed'),
  Rewarded: twoLevel(asMap(dump.Rewarded), 'Rewarded'),
  Shares: oneLevel(asMap(dump.Shares), 'Shares'),
  PendingShareChanges: oneLevel(asMap(dump.PendingShareChanges), 'PendingShareChanges'),
  Configuration: dump.Configuration,
  PreviousRound: {
    Timestamp: dump.PreviousRound?.Timestamp ?? 0,
    Period: dump.PreviousRound?.Period ?? 0,
    Summary: dump.PreviousRound?.Summary ?? {},
    Configuration: dump.PreviousRound?.Configuration ?? {},
    Details: twoLevel(asMap(dump.PreviousRound?.Details), 'PreviousRound.Details'),
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
  ['Rewarded', asMap(dump.Rewarded), migrated.Rewarded],
  ['Claimed', asMap(dump.Claimed), migrated.Claimed],
  ['PreviousRound.Details', asMap(dump.PreviousRound?.Details), migrated.PreviousRound.Details],
] as const) {
  if (Object.keys(src).length !== Object.keys(out).length || countPairs(src) !== countPairs(out)) {
    console.error(`FAIL: ${label} lost entries — ${Object.keys(src).length}/${countPairs(src)} in, ${Object.keys(out).length}/${countPairs(out)} out`)
    process.exit(1)
  }
}

const stateJson = JSON.stringify(migrated)
const rolesJson = JSON.stringify(roles)
const bundle = buildSeedBundle(stateJson, rolesJson, 'src/contracts/native/staking-rewards.lua')

const dist = path.join(AO, 'dist')
fs.mkdirSync(dist, { recursive: true })
fs.writeFileSync(path.join(dist, 'staking-rewards-seed.lua'), bundle)
fs.writeFileSync(path.join(dist, 'staking-rewards-seed.expected.json'), JSON.stringify({ state: migrated, roles }, null, 0))

console.log(`=== staking-rewards seed from ${NET} dump (2026-07-09) ===`)
console.log('counts:', JSON.stringify({
  Rewarded: `${Object.keys(migrated.Rewarded).length} hodlers / ${countPairs(migrated.Rewarded)} pairs`,
  Claimed: `${Object.keys(migrated.Claimed).length} hodlers / ${countPairs(migrated.Claimed)} pairs`,
  Details: `${Object.keys(migrated.PreviousRound.Details).length} hodlers / ${countPairs(migrated.PreviousRound.Details)} pairs`,
  Shares: Object.keys(migrated.Shares).length,
  PendingShareChanges: Object.keys(migrated.PendingShareChanges).length,
}))
console.log('roles :', Object.fromEntries(Object.entries(roles).map(([r, h]) => [r, Object.keys(h)[0]])))
console.log('PreviousRound: Timestamp', migrated.PreviousRound.Timestamp, 'Period', migrated.PreviousRound.Period, '(Details KEPT)')
console.log('config:', JSON.stringify(migrated.Configuration))
console.log(`addresses EIP-55: ${addrCount}   state json ${(stateJson.length / 1024).toFixed(1)}KB   bundle ${(bundle.length / 1024).toFixed(1)}KB`)
