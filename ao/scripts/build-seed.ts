// Build a SEED module from a REAL legacynet state dump (migrate-on-spawn validation).
// Transforms the legacy OperatorRegistry state global into the native contract's state shape,
// canonicalizing every operator address to EIP-55 via ethers.getAddress (proven bit-identical
// to our on-chain .common.eip55). Emits:
//   dist/operator-registry-seed.lua           — the publishable seed bundle
//   dist/operator-registry-seed.expected.json — the canonical migrated {state, roles} (seed-diff oracle)
// Run: bun run scripts/build-seed.ts [live|stage]   (default live)
import { getAddress } from 'ethers'
import fs from 'fs'
import path from 'path'
import { buildSeedBundle } from './util/native-bundle'

const NET = (process.argv[2] || 'live') as 'live' | 'stage'
const AO = path.resolve(import.meta.dir, '..')
const DUMPS = path.join(AO, 'state-dumps/2026-07-09')
const rd = (f: string) => JSON.parse(fs.readFileSync(path.join(DUMPS, f), 'utf8'))

const state = rd(`${NET}-operator-registry.state.json`)
const rolesDump = rd(`${NET}-operator-registry.roles.json`)

// Legacy collections serialize as `[]` when empty (CU dumps an empty map as an array).
// Coerce to a plain object so Object.entries is uniform.
const asMap = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : Object.keys(asMap(v)))

let addrCount = 0
const rejects: string[] = []
// FP->address maps: keep the fingerprint key verbatim (uppercase hex, not an address);
// canonicalize the address VALUE to EIP-55. A malformed address is a migration-integrity
// failure — collect and fail loud rather than seed corrupt state.
const fpToAddr = (src: Record<string, unknown>, label: string) => {
  const out: Record<string, string> = {}
  for (const [fp, addr] of Object.entries(src)) {
    try { out[fp] = getAddress(String(addr)); addrCount++ }
    catch (e: any) { rejects.push(`${label}[${fp}] = ${addr}: ${e.shortMessage || e.message}`) }
  }
  return out
}

const migrated = {
  claimable: fpToAddr(asMap(state.ClaimableFingerprintsToOperatorAddresses), 'claimable'),
  verified: fpToAddr(asMap(state.VerifiedFingerprintsToOperatorAddresses), 'verified'),
  registrationCredits: fpToAddr(asMap(state.RegistrationCreditsFingerprintsToOperatorAddresses), 'registrationCredits'),
  verifiedHardware: Object.fromEntries(
    Object.keys(asMap(state.VerifiedHardwareFingerprints)).map(fp => [fp, true])
  ) as Record<string, boolean>,
  blocked: {} as Record<string, boolean>,
  registrationCreditsRequired: Boolean(state.RegistrationCreditsRequired),
}
// blocked: legacy is a list (or empty []) of operator addresses -> { [EIP-55 addr]: true }
for (const a of asList(state.BlockedOperatorAddresses)) {
  try { migrated.blocked[getAddress(String(a))] = true; addrCount++ }
  catch (e: any) { rejects.push(`blocked[${a}]: ${e.shortMessage || e.message}`) }
}

// roles: { [roleName]: { [EIP-55 addr]: true } } — canonicalize the holder addresses.
const roles: Record<string, Record<string, boolean>> = {}
for (const [role, holders] of Object.entries(asMap(rolesDump.Roles))) {
  roles[role] = {}
  for (const addr of Object.keys(asMap(holders))) {
    try { roles[role][getAddress(addr)] = true; addrCount++ }
    catch (e: any) { rejects.push(`roles.${role}[${addr}]: ${e.shortMessage || e.message}`) }
  }
}

if (rejects.length) {
  console.error(`FAIL: ${rejects.length} address(es) rejected during migration:`)
  for (const r of rejects.slice(0, 20)) console.error('   ', r)
  process.exit(1)
}

const counts = {
  claimable: Object.keys(migrated.claimable).length,
  verified: Object.keys(migrated.verified).length,
  verifiedHardware: Object.keys(migrated.verifiedHardware).length,
  registrationCredits: Object.keys(migrated.registrationCredits).length,
  blocked: Object.keys(migrated.blocked).length,
  registrationCreditsRequired: migrated.registrationCreditsRequired,
}

const stateJson = JSON.stringify(migrated)
const rolesJson = JSON.stringify(roles)
const bundle = buildSeedBundle(stateJson, rolesJson)

const dist = path.join(AO, 'dist')
fs.mkdirSync(dist, { recursive: true })
const luaOut = path.join(dist, 'operator-registry-seed.lua')
const expectedOut = path.join(dist, 'operator-registry-seed.expected.json')
fs.writeFileSync(luaOut, bundle)
fs.writeFileSync(expectedOut, JSON.stringify({ state: migrated, roles }, null, 0))

console.log(`=== seed built from ${NET} legacynet dump (2026-07-09) ===`)
console.log('counts:', JSON.stringify(counts))
console.log('roles :', Object.fromEntries(Object.entries(roles).map(([r, h]) => [r, Object.keys(h).length])))
console.log(`addresses canonicalized to EIP-55: ${addrCount}`)
console.log(`state json: ${(stateJson.length / 1024).toFixed(1)}KB   bundle: ${(bundle.length / 1024).toFixed(1)}KB`)
console.log(`wrote ${luaOut}`)
console.log(`wrote ${expectedOut}`)
