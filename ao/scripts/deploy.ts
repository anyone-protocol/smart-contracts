// D11 — native contract deploy. Replaces scripts/spawn.ts, which was written for the
// genesis-wasm era and carried exactly the defaults that caused this migration:
// HB_URL fell back to an FR-operated endpoint, MODULE to a hardcoded genesis-wasm id,
// and the deployer key to a test wallet. Nothing here has a fallback.
//
// Two phases, because they need different credentials:
//
//   1. PUBLISH the module, producing a MODULE_ID.
//   2. SPAWN from that module id — runs anywhere, signed by the DEPLOYER wallet, which
//      must be in the node's faff allow-list.
//
// ─── There are TWO different module ids, and picking the wrong one is unrecoverable ─────
//
// A module can be made resolvable two ways, and they do NOT produce the same id:
//
//   * DURABLE (--publish): the module is signed client-side and posted to a bundler, so it
//     lands on Arweave. Its id is the signed ans104 item id. ANY node resolves it by id via
//     hb_store_gateway — verified: a cold node with an empty cache fetched and computed one
//     in ~1.2s. This is the only id that is safe for a real deploy.
//
//   * NODE-LOCAL (--publish-cmd): `bin/hb eval` on the node host commits the module with the
//     NODE wallet and hb_cache:write's it. Its id is hb_util:id(Msg) — a DIFFERENT value,
//     and one that exists ONLY in that node's cache.
//
// Spawning a process against a node-local id means the module lives in exactly one cache.
// A rebuilt node, a fresh Nomad alloc, or a second node in the redundancy pair CANNOT resolve
// it, and the process can never compute another slot. That silently defeats D5's cold-start
// guarantee, and it is not detectable from the process itself — which is why phase 2 refuses
// to spawn against a module that is not on Arweave unless you say so explicitly.
//
// (The old flow also ran hb_client:upload inside that eval, ostensibly "for durability". It
// did not do what it looked like: `bin/hb eval` starts a VM that never boots the hb
// application, so it loads NO config and always resolves bundler-ans104 to the compiled-in
// default — verified 2026-07-27. It has been removed rather than left as a false comfort.)
//
// Usage:
//   bun run scripts/deploy.ts <contract> --seed <live|stage|none> --publish
//   bun run scripts/deploy.ts <contract> --seed <live|stage|none> --publish-cmd   # test only
//   HB_URL=… DEPLOYER_PRIVATE_KEY=… MODULE_ID=… bun run scripts/deploy.ts <contract> --seed live
//
//   <contract>   operator-registry | relay-rewards | staking-rewards
//   --seed       live|stage → migrate-on-spawn from that env's 2026-07-09 dump;
//                none → empty declared state (a fresh process, not a migration)
//   --publish    publish durably via BUNDLER (needs PUBLISH_KEY); prints the MODULE_ID
//   --publish-cmd  print the node-host eval for a NODE-LOCAL id (fast, NOT cold-start safe)
//   --allow-unpublished-module  spawn against a module that is not on Arweave (test only)
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
  console.error(`usage: deploy.ts <${Object.keys(CONTRACTS).join('|')}> --seed <live|stage|none>`)
  console.error('       [--publish]                  publish durably via BUNDLER (needs PUBLISH_KEY)')
  console.error('       [--publish-cmd]              node-host eval for a NODE-LOCAL id (test only)')
  console.error('       [--allow-unpublished-module] spawn against a module not on Arweave (test only)')
  console.error('       [--dry-run]')
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

// The published module is ALWAYS pure source — identical bytes whether this is a
// migration or a fresh deploy. The seed rides the SPAWN MESSAGE instead of being
// embedded, because a seeded module re-ran json.decode over the whole dump on every
// READ (the module is reloaded per read; the declared state is consumed once, at
// slot 0). Measured on the real registry: 2.60s/read embedded vs 0.43s, same state.
// It also makes the module reusable across envs and reseeds instead of a per-migration
// artifact. See runtime/native.lua and native-bundle.ts buildSeedEnvelope.
const bundlePath = path.join(dist, `${contract}-native.lua`)
const envelopePath = path.join(dist, `${contract}-seed.envelope.json`)
const expectedPath = path.join(dist, `${contract}-seed.expected.json`)

console.log(`=== deploy ${contract} (seed: ${seed}) ===`)
fs.writeFileSync(bundlePath, buildBundle(`src/contracts/native/${contract}.lua`))
console.log(`built module (source)  ${path.relative(AO, bundlePath)}`)

let seedEnvelope: string | undefined
if (seed !== 'none') {
  // Reuse the seed builders verbatim rather than reimplementing the transform — they
  // are what the Tier-3 validations were run against, and they assert their own
  // totality (a dropped address fails the build rather than shrinking the migration).
  const script = CONTRACTS[contract].seedScript
  console.log(`building seed from the ${seed} dump via scripts/${script} …`)
  execFileSync('bun', ['run', path.join(AO, 'scripts', script), seed], {
    cwd: AO, stdio: 'inherit',
  })
  if (!fs.existsSync(envelopePath)) {
    console.error(`seed builder produced no ${path.relative(AO, envelopePath)}`)
    process.exit(1)
  }
  seedEnvelope = fs.readFileSync(envelopePath, 'utf8')
  console.log(`seed envelope          ${(seedEnvelope.length / 1024).toFixed(1)}KB (spawn data)`)
}
const bundle = fs.readFileSync(bundlePath, 'utf8')
console.log(`module bundle          ${(bundle.length / 1024).toFixed(1)}KB`)

// ---------------------------------------------------------------------------
// Phase 1 — publish
// ---------------------------------------------------------------------------

// 1a. DURABLE. Delegates to publish-module.ts so there is one implementation of signing,
// posting and settlement verification rather than a second copy that can drift.
if (flag('publish')) {
  if (!process.env.BUNDLER) {
    console.error('\nBUNDLER is required for --publish (e.g. https://up.arweave.net, or our own).')
    console.error('  It has no default: which bundler carries our modules is not a question to guess at.')
    process.exit(2)
  }
  console.log(`\npublishing durably via ${process.env.BUNDLER} …`)
  execFileSync('bun', [
    'run', path.join(AO, 'scripts', 'publish-module.ts'), bundlePath,
    '--manifest', path.join(dist, `${contract}-publish.json`),
    ...(dryRun ? ['--wait', '0'] : []),
  ], { cwd: AO, stdio: 'inherit' })
  console.log('\nUse the settled item id above as MODULE_ID for the spawn phase.')
  process.exit(0)
}

// 1b. NODE-LOCAL. Fast, but the id exists only in this node's cache — see the header.
// hb_client:upload is deliberately NOT called here: from `bin/hb eval` it always targets
// the compiled-in default bundler regardless of node config, so it looked like durability
// and was not.
const publishErl = `
{ok, Script} = file:read_file("/tmp/${contract}-module.lua"),
Msg = hb_message:commit(
  #{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>,
     <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>,
     <<"name">> => <<"${contract}">>, <<"body">> => Script },
  #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>),
{ok, _} = hb_cache:write(Msg, #{}),
binary_to_list(hb_util:id(Msg)).
`.trim().replace(/\n/g, ' ')

if (publishCmdOnly) {
  console.log('\n--- run these on the NODE HOST (the node wallet signs the module) ---')
  console.log(`podman cp ${bundlePath} <container>:/tmp/${contract}-module.lua`)
  console.log(`podman exec <container> ./bin/hb eval '${publishErl}'`)
  console.log('\n⚠️  The printed id is NODE-LOCAL. It exists only in that node\'s cache, is NOT')
  console.log('    on Arweave, and no other node — including a rebuilt one — can resolve it.')
  console.log('    Use this for local testing and fast iteration only.')
  console.log('\n    For anything that must survive a node rebuild (i.e. any real deploy), use:')
  console.log(`      BUNDLER=… PUBLISH_KEY=… bun run scripts/deploy.ts ${contract} --seed ${seed} --publish`)
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
  console.error(`  BUNDLER=… PUBLISH_KEY=… bun run scripts/deploy.ts ${contract} --seed ${seed} --publish`)
  process.exit(2)
}

/**
 * Refuse to spawn a process whose module is not retrievable from Arweave.
 *
 * A module that exists only in one node's cache makes the process unrecoverable the moment
 * that cache is lost — a rebuilt node cannot compute another slot, and nothing about the
 * process says so. The failure appears at cold start, which is the worst possible time and
 * exactly what D5 is supposed to guarantee against. Checked here because this is the last
 * point where it is cheap to fix.
 */
async function assertModuleIsDurable (id: string) {
  if (flag('allow-unpublished-module')) {
    console.warn('  ! --allow-unpublished-module: NOT checking that the module is on Arweave.')
    console.warn('  ! If this module is node-local, the process dies with that node\'s cache.')
    return
  }
  const res = await fetch('https://arweave.net/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `{ transaction(id: "${id}") { id } }` }),
    signal: AbortSignal.timeout(45_000),
  }).catch(() => null)
  const found = res?.ok && !!(await res.json().catch(() => null) as any)?.data?.transaction
  if (found) {
    console.log(`module durability      on Arweave (indexed)`)
    return
  }
  console.error(`\nrefusing to spawn: module ${id} is not indexed on Arweave.`)
  console.error('  A node-local module id (from --publish-cmd) exists in exactly one node\'s')
  console.error('  cache. Spawning against it produces a process that a rebuilt node can never')
  console.error('  compute — the D5 cold-start guarantee would be silently void.')
  console.error('')
  console.error('  Publish it durably first:')
  console.error(`    BUNDLER=… PUBLISH_KEY=… bun run scripts/deploy.ts ${contract} --seed ${seed} --publish`)
  console.error('  Settlement takes hours; re-check with:')
  console.error(`    bun run scripts/publish-module.ts --check-only ${id}`)
  console.error('')
  console.error('  For a throwaway test deploy, pass --allow-unpublished-module.')
  process.exit(1)
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
  await assertModuleIsDurable(MODULE_ID)

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
    // The migration seed. Consumed by the runtime at slot 0 and never again.
    data: seedEnvelope,
    tags: [
      { name: 'app-name', value: 'anyone-protocol' },
      { name: 'name', value: `${contract}-${Date.now()}` },
    ],
  })
  console.log(`process id             ${processId}  (slot ${slot})`)

  // Verify it MATERIALIZED, rather than trusting a 200. `spawnProcess` already forced the
  // lazy first compute (that is a spawn-level guarantee now, not a caller's job), so this is
  // the SEED-LANDED confirmation: `status.initialized` separates a computed-but-empty process
  // from a seeded one, which the counts cannot. Migrate-on-spawn happens on that first
  // compute, so a broken seed surfaces here and nowhere earlier.
  console.log('\nverifying materialization …')
  let status: any
  try { status = await ao.materialize(processId, { attempts: 40, delayMs: 1500 }) }
  catch (e) {
    console.error(`FAILED: the process did not materialize — ${(e as Error).message}`)
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

  // ─── the WRITE GATE's view of this process ──────────────────────────────────────────────
  //
  // The gate reads the contract, so a deploy that materialised state correctly can still be
  // unusable by everyone but us. Both reads below are the EXACT paths runtime/write-gate.lua
  // uses; asserting them here is the only place the gate's inputs are checked against a real
  // process before its id reaches Consul.
  //
  // Neither answers before slot 0 has been computed — a never-computed process 508s with
  // "Request creates infinite recursion" on every `compute/…` path, the committer read
  // included. The status view above already forced that compute, which is why this runs after
  // it and not before. (Measured: scripts/probe/seed-on-spawn.ts.)
  console.log('\nverifying the write gate can read this process …')
  const gateGet = async (p: string) => {
    try {
      const r = await fetch(`${HB_URL}/${p}`, { signal: AbortSignal.timeout(120_000) })
      return r.ok ? (await r.text()).trim() : null
    } catch { return null }
  }
  let gateBad = 0
  const gateCheck = (ok: boolean, label: string, detail = '') => {
    if (!ok) gateBad++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`)
  }

  // isOwner — the invariant that keeps a contract from ever being locked out by its own gate.
  const committer = await gateGet(
    `${processId}~process@1.0/compute/process/commitments/${processId}/committer`)
  gateCheck(committer === deployer, 'Owner readable from the spawn commitment',
    committer === deployer ? deployer : `got ${committer ?? '(no answer)'}, want ${deployer}`)

  // The allowlist seeds at slot 0, alongside state. No message is needed to build it.
  const allowlistId = await gateGet(`${processId}~process@1.0/compute/allowlistId`)
  gateCheck(!!allowlistId && /^[A-Za-z0-9_-]{43}$/.test(allowlistId),
    'allowlist trie materialised', allowlistId ?? '(no answer)')

  // The gate's per-address read. Admission is a positive integer refcount; a 404 (absent) and
  // 'B<n>' (blocked) both read as denied.
  const admits = async (addr: string) => {
    const v = await gateGet(`${processId}~process@1.0/compute/allowlistId/~trie@1.0/${addr}`)
    return { ok: !!v && !v.startsWith('B') && Number(v) >= 1, v }
  }

  if (allowlistId && /^[A-Za-z0-9_-]{43}$/.test(allowlistId)) {
    const owner = await admits(deployer)
    gateCheck(owner.ok, 'deployer admitted by the gate read path', owner.v ?? '(absent)')

    // The deployer alone proves nothing: it is granted unconditionally as the Owner, so this
    // block would pass green on a seed that populated NOTHING ELSE — the exact failure that
    // locks every operator and admin out of a contract whose state migrated perfectly.
    if (seedEnvelope) {
      const envelope = JSON.parse(seedEnvelope)

      // Every ACL role holder, contract-independently. These are our controller/admin wallets.
      const holders = new Set<string>()
      for (const byRole of Object.values<any>(envelope.acl?.roles ?? {})) {
        for (const addr of Object.keys(byRole ?? {})) holders.add(addr)
      }
      let holderBad = 0
      for (const addr of holders) if (!(await admits(addr)).ok) holderBad++
      gateCheck(holders.size > 0 && holderBad === 0,
        `all ${holders.size} seeded ACL role holders admitted`,
        holderBad ? `${holderBad} NOT admitted` : '')

      // Operators live only in operator-registry, and they are the bulk of the allowlist —
      // ~830 addresses whose refcount is their fingerprint count. Sample rather than sweep:
      // one read is ~35 ms, and a seed that dropped operators drops all of them, not a few.
      if (contract === 'operator-registry') {
        const verified: Record<string, string> = envelope.state?.verified ?? {}
        const sample = [...new Set(Object.values(verified))].slice(0, 5)
        let opBad = 0
        for (const addr of sample) if (!(await admits(addr)).ok) opBad++
        gateCheck(sample.length > 0 && opBad === 0,
          `sampled ${sample.length} seeded operators admitted`,
          opBad ? `${opBad} NOT admitted` : '')
      }
    }
  }

  if (gateBad) {
    console.error('\nFAILED: the write gate cannot read this process. Publishing this PID into')
    console.error('gated-processes would refuse every operator write, because the gate fails')
    console.error('CLOSED. Do NOT write this id to Consul.')
    process.exit(1)
  }

  const env = seed === 'none' ? '<env>' : seed
  console.log('\n=== DEPLOYED ===')
  console.log(`  ${processId}`)

  // Record the PID in Consul when the job supplies a key. Deliberately AFTER every check above:
  // the jobspecs template `gated-processes` from this key, so an id the gate cannot read must
  // never reach it. The exits above are what guarantee that.
  //
  // No dummy default. If a key is named, the write is required — a deploy that reports success
  // while silently writing nowhere is worse than one that fails.
  const consulKey = process.env.CONTRACT_CONSUL_KEY
  if (consulKey) {
    const { CONSUL_IP, CONSUL_PORT, CONSUL_TOKEN } = process.env
    if (!CONSUL_IP || !CONSUL_PORT) {
      console.error(`\nCONTRACT_CONSUL_KEY is set (${consulKey}) but CONSUL_IP/CONSUL_PORT are not.`)
      console.error('Refusing to finish: the PID would go unrecorded and the deploy would still')
      console.error(`look successful. Record it manually: consul kv put ${consulKey} ${processId}`)
      process.exit(1)
    }
    const { default: Consul } = await import('consul')
    const consul = new Consul({ host: CONSUL_IP, port: CONSUL_PORT })
    // Omit the token rather than passing undefined: the client forwards it straight into the
    // x-consul-token header, and `undefined` is rejected as an invalid header value. Omitting is
    // also better than the legacy 'no-token' placeholder, which sends a real header that an
    // ACL-enabled Consul then has to reject on its own terms.
    const ok = await consul.kv.set({
      key: consulKey,
      value: processId,
      ...(CONSUL_TOKEN ? { token: CONSUL_TOKEN } : {}),
    })
    if (!ok) {
      console.error(`\nFAILED to write ${consulKey} to Consul. The process is deployed and`)
      console.error(`verified, so this is safe to retry: consul kv put ${consulKey} ${processId}`)
      process.exit(1)
    }
    console.log(`\n  consul: ${consulKey} = ${processId}`)
  } else {
    console.log('\nRecord the PID (this is what the jobspecs template from):')
    console.log(`  consul kv put smart-contracts/${env}/${contract}-address ${processId}`)
  }
  console.log('\nReads:')
  console.log(`  ${HB_URL}/${processId}~process@1.0/as/status`)
  process.exit(0)
})().catch(e => {
  console.error('\nDEPLOY FAILED:', String(e?.message || e))
  process.exit(1)
})
