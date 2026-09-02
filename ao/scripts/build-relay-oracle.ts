// Build a MINIMAL oracle bundle for the Tier-3 parity check: the native relay-rewards contract
// seeded with ONLY the live Configuration + PreviousRound (empty reward maps). Fresh test
// fingerprints/addresses accrue identically here and in the full 719KB seed (their round reward
// depends only on Configuration + roundLength), but this runs FAST in luerl (the full seed's
// 800KB bundle parse/decode times out). Emits dist/relay-oracle-min.lua.
// Run: bun run scripts/build-relay-oracle.ts
import fs from 'fs'
import path from 'path'
import { buildSeedBundle } from './util/native-bundle'

const AO = path.resolve(import.meta.dir, '..')
const expected = JSON.parse(fs.readFileSync(path.join(AO, 'dist/relay-rewards-seed.expected.json'), 'utf8'))
const s = expected.state

const minimal = {
  Claimed: {},
  TotalAddressReward: {},
  TotalFingerprintReward: {},
  Configuration: s.Configuration,          // EXACT live config (drives the math)
  PreviousRound: s.PreviousRound,          // Timestamp/Period/Summary/Configuration (sets roundLength)
  PendingRounds: {},
}
const bundle = buildSeedBundle(JSON.stringify(minimal), '{}', 'src/contracts/native/relay-rewards.lua')
const out = path.join(AO, 'dist/relay-oracle-min.lua')
fs.writeFileSync(out, bundle)
console.log(`wrote ${out} (${(bundle.length / 1024).toFixed(1)}KB)`)
console.log(`Configuration.TokensPerSecond=${s.Configuration.TokensPerSecond}  PreviousRound.Timestamp=${s.PreviousRound.Timestamp}`)
