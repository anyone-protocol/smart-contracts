// D11 — native contract deploy. Replaces scripts/spawn.ts, which was written for the
// genesis-wasm era and carried exactly the defaults that caused this migration:
// HB_URL fell back to an FR-operated endpoint, MODULE to a hardcoded genesis-wasm id,
// and the deployer key to a test wallet. Nothing here has a fallback.
//
// Two phases, because they need different credentials:
//
//   1. PUBLISH the module — runs on the node host, signed by the NODE wallet, which
//      writes it to the node's local cache (so the spawn resolves instantly) and
//      uploads it to Arweave for durability. `--publish-cmd` prints the exact command.
//   2. SPAWN from that module id — runs anywhere, signed by the DEPLOYER wallet, which
//      must be in the node's faff allow-list.
//
// Usage:
//   bun run scripts/deploy.ts <contract> --seed <live|stage|none> [--publish-cmd]
//   HB_URL=… DEPLOYER_PRIVATE_KEY=… MODULE_ID=… bun run scripts/deploy.ts <contract> --seed live
//
//   <contract>   operator-registry | relay-rewards | staking-rewards
//   --seed       live|stage → migrate-on-spawn from that env's 2026-07-09 dump;
//                none → empty declared state (a fresh process, not a migration)
//   --dry-run    build and report; touch nothing on the network
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { EthereumSigner } from '@dha-team/arbundles/web'
import { Wallet } from 'ethers'
import {
  createAoClient, nodeUrlFromEnv, AoValidationError,
} from '@anyone-protocol/ao-client'
import { buildBundle } from './util/native-bundle'

const AO = path.resolve(import.meta.dir, '..')

const CONTRACTS = {
  'operator-registry': { seedScript: 'build-seed.ts', global: 'OperatorRegistry' },
  'relay-rewards': { seedScript: 'build-relay-seed.ts', global: 'RelayRewards' },
  'staking-rewards': { seedScript: 'build-staking-seed.ts', global: 'StakingRewards' },
} as const
type ContractName = keyof typeof CONTRACTS

// ---------------------------------------------------------------------------
// Args + fail-closed configuration. Every value is explicit or the deploy aborts;
// H1/H2/H3 from the blast-radius audit are all "a default nobody set".
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(`--${name}`)
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

const contract = argv[0] as ContractName
if (!contract || !(contract in CONTRACTS)) {
  console.error(`usage: deploy.ts <${Object.keys(CONTRACTS).join('|')}> --seed <live|stage|none> [--publish-cmd] [--dry-run]`)
  process.exit(2)
}
const seed = opt('seed')
if (!seed || !['live', 'stage', 'none'].includes(seed)) {
  console.error('--seed is required and must be one of: live, stage, none')
  console.error('  (there is no default: "which state does this process start from" is not a question to guess at)')
  process.exit(2)
}
const dryRun = flag('dry-run')
const publishCmdOnly = flag('publish-cmd')

/**
 * Anything Forward Research operates is barred from the critical path — that is the
 * founding constraint of this migration, and the old spawn.ts defaulted straight to
 * one of their endpoints. Checked rather than trusted.
 */
const FORBIDDEN_HOSTS = [/(^|\.)forward\.computer$/i, /(^|\.)ao-testnet\.xyz$/i, /(^|\.)arweave\.dev$/i]
function assertOurNode (url: string) {
  const host = new URL(url).hostname
  for (const pattern of FORBIDDEN_HOSTS) {
    if (pattern.test(host)) {
      throw new AoValidationError(
        `refusing to deploy against ${host}: no third-party-operated infrastructure ` +
        'in the critical path. Point HB_URL at one of our own nodes.'
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 0 — build the module bundle
// ---------------------------------------------------------------------------
const dist = path.join(AO, 'dist')
fs.mkdirSync(dist, { recursive: true })

const bundlePath = seed === 'none'
  ? path.join(dist, `${contract}-native.lua`)
  : path.join(dist, `${contract}-seed.lua`)
const expectedPath = path.join(dist, `${contract}-seed.expected.json`)

console.log(`=== deploy ${contract} (seed: ${seed}) ===`)
if (seed === 'none') {
  fs.writeFileSync(bundlePath, buildBundle(`src/contracts/native/${contract}.lua`))
  console.log(`built fresh module     ${path.relative(AO, bundlePath)}`)
} else {
  // Reuse the seed builders verbatim rather than reimplementing the transform — they
  // are what the Tier-3 validations were run against, and they assert their own
  // totality (a dropped address fails the build rather than shrinking the migration).
  const script = CONTRACTS[contract].seedScript
  console.log(`building seed from the ${seed} dump via scripts/${script} …`)
  execFileSync('bun', ['run', path.join(AO, 'scripts', script), seed], {
    cwd: AO, stdio: 'inherit',
  })
  if (!fs.existsSync(bundlePath)) {
    console.error(`seed builder produced no ${path.relative(AO, bundlePath)}`)
    process.exit(1)
  }
}
const bundle = fs.readFileSync(bundlePath, 'utf8')
console.log(`module bundle          ${(bundle.length / 1024).toFixed(1)}KB`)

// ---------------------------------------------------------------------------
// Phase 1 — publish (node-host command; the node wallet signs, not ours)
// ---------------------------------------------------------------------------
const publishErl = `
{ok, Script} = file:read_file("/tmp/${contract}-module.lua"),
Msg = hb_message:commit(
  #{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>,
     <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>,
     <<"name">> => <<"${contract}">>, <<"body">> => Script },
  #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>),
{ok, _} = hb_cache:write(Msg, #{}),
Upload = (catch hb_client:upload(Msg, #{}, <<"ans104@1.0">>)),
io:format("UPLOAD=~p~n", [Upload]),
binary_to_list(hb_util:id(Msg)).
`.trim().replace(/\n/g, ' ')

if (publishCmdOnly) {
  console.log('\n--- run these on the NODE HOST (the node wallet signs the module) ---')
  console.log(`podman cp ${bundlePath} <container>:/tmp/${contract}-module.lua`)
  console.log(`podman exec <container> ./bin/hb eval '${publishErl}'`)
  console.log('\nThe printed id is MODULE_ID for the spawn phase.')
  console.log('Publishing with the NODE wallet (not ours) is deliberate: it writes the')
  console.log('module into the node\'s local cache, so the spawn resolves it immediately')
  console.log('instead of waiting on Arweave gateway propagation.')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Phase 2 — spawn
// ---------------------------------------------------------------------------
// Resolved inside a guard so a misconfiguration prints an actionable line rather than
// a stack trace — this is the failure operators will hit most often.
let HB_URL: string
try {
  HB_URL = nodeUrlFromEnv()
  assertOurNode(HB_URL)
} catch (e) {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`)
  process.exit(2)
}

const KEY = process.env.DEPLOYER_PRIVATE_KEY?.replace(/^0x/, '')
if (!KEY) {
  console.error('DEPLOYER_PRIVATE_KEY is required and has no default.')
  console.error('  The old spawn.ts fell back to a hardhat test key — a deploy signed by')
  console.error('  a throwaway wallet would set the wrong process Owner, permanently.')
  process.exit(2)
}
const MODULE_ID = process.env.MODULE_ID
if (!MODULE_ID) {
  console.error('MODULE_ID is required. Publish the module first:')
  console.error(`  bun run scripts/deploy.ts ${contract} --seed ${seed} --publish-cmd`)
  process.exit(2)
}

const deployer = new Wallet('0x' + KEY).address
const ao = createAoClient({
  url: HB_URL,
  signer: new EthereumSigner(KEY),
  logger: { warn: (m, ...r) => console.warn('  !', m, ...r) },
})

;(async () => {
  const nodeAddress = await ao.fetchNodeAddress()
  // SCHEDULER/AUTHORITY are explicit, and default to the node's own address rather
  // than to a third party. The old script resolved an "import authority" for
  // genesis-wasm; the native lua device has no such concept.
  const scheduler = process.env.SCHEDULER || nodeAddress
  const authority = process.env.AUTHORITY || nodeAddress

  console.log(`\nnode                   ${HB_URL}`)
  console.log(`node address           ${nodeAddress}`)
  console.log(`scheduler-location     ${scheduler}${process.env.SCHEDULER ? ' (explicit)' : ' (node)'}`)
  console.log(`authority              ${authority}${process.env.AUTHORITY ? ' (explicit)' : ' (node)'}`)
  console.log(`deployer (Owner)       ${deployer}`)
  console.log(`module                 ${MODULE_ID}`)

  if (scheduler !== nodeAddress) {
    console.warn('  ! scheduler-location is NOT this node — the node will not adopt the process')
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing spawned.')
    process.exit(0)
  }

  console.log('\nspawning …')
  const { processId, slot } = await ao.spawnProcess({
    moduleId: MODULE_ID,
    schedulerLocation: scheduler,
    authority,
    tags: [
      { name: 'app-name', value: 'anyone-protocol' },
      { name: 'name', value: `${contract}-${Date.now()}` },
    ],
  })
  console.log(`process id             ${processId}  (slot ${slot})`)

  // Verify it MATERIALIZED, rather than trusting a 200. Migrate-on-spawn happens on
  // first compute, so a broken seed surfaces here and nowhere earlier.
  console.log('\nverifying materialization …')
  let status: any
  for (let i = 0; i < 40; i++) {
    try { status = await ao.readView(processId, 'status'); break }
    catch { await new Promise(r => setTimeout(r, 1500)) }
  }
  if (!status) {
    console.error('FAILED: the status view never answered — the process did not materialize.')
    process.exit(1)
  }
  console.log(`  status: ${JSON.stringify(status.counts ?? status)}`)
  console.log(`  owner:  ${status.owner ?? '(not reported)'}`)

  if (seed !== 'none' && fs.existsSync(expectedPath)) {
    // Compare against what the seed builder said it emitted; a silently truncated
    // migration is the failure this catches.
    const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8')).state
    const counts = status.counts ?? {}
    // Each contract's `status` view names its counts differently, so the mapping is
    // per-contract rather than inferred. Getting this wrong is silent: an unmatched
    // name yields undefined, and undefined === undefined would "pass".
    const COUNT_MAP: Record<ContractName, [stateKey: string, countKey: string, label: string][]> = {
      'operator-registry': [
        ['claimable', 'claimable', 'claimable'],
        ['verified', 'verified', 'verified'],
        ['blocked', 'blocked', 'blocked'],
        ['verifiedHardware', 'hardware', 'verified hardware'],
        ['registrationCredits', 'credits', 'registration credits'],
      ],
      'relay-rewards': [
        ['TotalAddressReward', 'addresses', 'addresses'],
        ['TotalFingerprintReward', 'fingerprints', 'fingerprints'],
        ['Claimed', 'claimed', 'claimed'],
      ],
      'staking-rewards': [
        ['Rewarded', 'rewardedHodlers', 'Rewarded hodlers'],
        ['Claimed', 'claimedHodlers', 'Claimed hodlers'],
      ],
    }
    let bad = 0, ran = 0
    for (const [stateKey, countKey, label] of COUNT_MAP[contract]) {
      const want = expected[stateKey] ? Object.keys(expected[stateKey]).length : undefined
      const got = counts[countKey]
      if (want === undefined || got === undefined) {
        console.log(`  SKIP ${label}: not reported (state=${want}, status=${got})`)
        continue
      }
      ran++
      const ok = got === want
      if (!ok) bad++
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}/${want}`)
    }
    if (ran === 0) {
      console.error('\nFAILED: no count could be verified against the seed. A deploy that')
      console.error('cannot confirm what it migrated is not a deploy — check the status view')
      console.error('field names against COUNT_MAP.')
      process.exit(1)
    }
    if (bad) {
      console.error('\nFAILED: seeded state does not match the builder output. Do NOT publish this PID.')
      process.exit(1)
    }
  }

  const env = seed === 'none' ? '<env>' : seed
  console.log('\n=== DEPLOYED ===')
  console.log(`  ${processId}`)
  console.log('\nRecord the PID (this is what the jobspecs template from):')
  console.log(`  consul kv put smart-contracts/${env}/${contract}-address ${processId}`)
  console.log('\nReads:')
  console.log(`  ${HB_URL}/${processId}~process@1.0/now/~lua@5.3a/status`)
  process.exit(0)
})().catch(e => {
  console.error('\nDEPLOY FAILED:', String(e?.message || e))
  process.exit(1)
})
