// Build the PURE-SOURCE module bundle for a contract -> dist/<contract>-native.lua.
//
// This is what gets published now, for migrations as well as fresh deploys: the seed
// travels in the spawn message instead (see native-bundle.ts buildSeedEnvelope). The
// bytes are therefore identical across dev/stage/live and across reseeds, so one
// published module serves them all.
//
// Run: bun run scripts/build-native-bundle.ts <operator-registry|relay-rewards|staking-rewards>
import fs from 'node:fs'
import path from 'node:path'
import { buildBundle } from './util/native-bundle'

const CONTRACTS = ['operator-registry', 'relay-rewards', 'staking-rewards'] as const
const contract = process.argv[2]
if (!CONTRACTS.includes(contract as any)) {
  console.error(`usage: bun run scripts/build-native-bundle.ts <${CONTRACTS.join('|')}>`)
  process.exit(2)
}

const AO = path.resolve(import.meta.dir, '..')
const out = path.join(AO, 'dist', `${contract}-native.lua`)
fs.mkdirSync(path.dirname(out), { recursive: true })
const bundle = buildBundle(`src/contracts/native/${contract}.lua`)
fs.writeFileSync(out, bundle)
console.log(`wrote ${out} (${(bundle.length / 1024).toFixed(1)}KB, pure source)`)
