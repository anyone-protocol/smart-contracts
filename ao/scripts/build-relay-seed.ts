// Build a SEED module for native relay-rewards from the REAL legacynet dump (migrate-on-spawn).
// Transforms live-relay-rewards.state.json → native state shape:
//   * addresses (TotalAddressReward/Claimed keys, Delegates) → EIP-55 via ethers.getAddress
//   * TotalFingerprintReward: fingerprint keys verbatim
//   * PreviousRound: KEEP {Timestamp, Period, Summary, Configuration}, DROP the 3.6MB Details
//   * PendingRounds: {} (transient; never seeded)
// Emits dist/relay-rewards-seed.lua + dist/relay-rewards-seed.expected.json (seed-diff oracle).
// Run: bun run scripts/build-relay-seed.ts [live|stage]   (default live)
import { getAddress } from 'ethers'
import fs from 'fs'
import path from 'path'
import { buildSeedBundle } from './util/native-bundle'

const NET = (process.argv[2] || 'live') as 'live' | 'stage'
const AO = path.resolve(import.meta.dir, '..')
const DUMPS = path.join(AO, 'state-dumps/2026-07-09')
const rd = (f: string) => JSON.parse(fs.readFileSync(path.join(DUMPS, f), 'utf8'))

const dump = rd(`${NET}-relay-rewards.state.json`)
const rolesDump = rd(`${NET}-relay-rewards.roles.json`)

const asMap = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {}

const rejects: string[] = []
let addrCount = 0
// address-keyed bigint-string map → EIP-55 keys (values verbatim)
const addrMap = (src: Record<string, any>, label: string) => {
  const out: Record<string, string> = {}
  for (const [addr, v] of Object.entries(src)) {
    try { out[getAddress(addr)] = String(v); addrCount++ }
    catch (e: any) { rejects.push(`${label}[${addr}]: ${e.shortMessage || e.message}`) }
  }
  return out
}
// Configuration.Delegates: { [opAddr]: { Address, Share } } → EIP-55 keys + EIP-55 Address
const delegateMap = (src: Record<string, any>) => {
  const out: Record<string, any> = {}
  for (const [opAddr, d] of Object.entries(src)) {
    out[getAddress(opAddr)] = { Address: getAddress(d.Address), Share: d.Share }; addrCount += 2
  }
  return out
}

const cfg = { ...dump.Configuration, Delegates: delegateMap(asMap(dump.Configuration.Delegates)) }
const prevCfg = dump.PreviousRound?.Configuration
  ? { ...dump.PreviousRound.Configuration, Delegates: delegateMap(asMap(dump.PreviousRound.Configuration.Delegates)) }
  : {}

const migrated = {
  Claimed: addrMap(asMap(dump.Claimed), 'Claimed'),
  TotalAddressReward: addrMap(asMap(dump.TotalAddressReward), 'TotalAddressReward'),
  TotalFingerprintReward: { ...asMap(dump.TotalFingerprintReward) },   // fingerprint keys verbatim
  Configuration: cfg,
  PreviousRound: {   // summary ONLY — Details dropped (D27)
    Timestamp: dump.PreviousRound?.Timestamp ?? 0,
    Period: dump.PreviousRound?.Period ?? 0,
    Summary: dump.PreviousRound?.Summary ?? {},
    Configuration: prevCfg,
  },
  PendingRounds: {},
}

// roles: { [role]: { [EIP-55 addr]: true } }
const roles: Record<string, Record<string, boolean>> = {}
for (const [role, holders] of Object.entries(asMap(rolesDump.Roles))) {
  roles[role] = {}
  for (const addr of Object.keys(asMap(holders))) {
    try { roles[role][getAddress(addr)] = true; addrCount++ }
    catch (e: any) { rejects.push(`roles.${role}[${addr}]: ${e.shortMessage || e.message}`) }
  }
}

if (rejects.length) {
  console.error(`FAIL: ${rejects.length} address(es) rejected:`)
  for (const r of rejects.slice(0, 20)) console.error('   ', r)
  process.exit(1)
}

const stateJson = JSON.stringify(migrated)
const rolesJson = JSON.stringify(roles)
const bundle = buildSeedBundle(stateJson, rolesJson, 'src/contracts/native/relay-rewards.lua')

const dist = path.join(AO, 'dist')
fs.mkdirSync(dist, { recursive: true })
fs.writeFileSync(path.join(dist, 'relay-rewards-seed.lua'), bundle)
fs.writeFileSync(path.join(dist, 'relay-rewards-seed.expected.json'), JSON.stringify({ state: migrated, roles }, null, 0))

const counts = {
  TotalAddressReward: Object.keys(migrated.TotalAddressReward).length,
  Claimed: Object.keys(migrated.Claimed).length,
  TotalFingerprintReward: Object.keys(migrated.TotalFingerprintReward).length,
  delegates: Object.keys(migrated.Configuration.Delegates).length,
}
console.log(`=== relay-rewards seed from ${NET} dump (2026-07-09) ===`)
console.log('counts:', JSON.stringify(counts))
console.log('roles :', Object.fromEntries(Object.entries(roles).map(([r, h]) => [r, Object.keys(h)[0]])))
console.log('PreviousRound: Timestamp', migrated.PreviousRound.Timestamp, 'Period', migrated.PreviousRound.Period, '(Details dropped)')
console.log(`addresses EIP-55: ${addrCount}   state json ${(stateJson.length / 1024).toFixed(1)}KB   bundle ${(bundle.length / 1024).toFixed(1)}KB`)
