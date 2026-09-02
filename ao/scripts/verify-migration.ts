// D12 + D13 (+ the D10 negative-fixture item) — prove a respawned process is a faithful
// migration of the legacynet dump, as a CHAIN OF CUSTODY from the manifest hash all the
// way to live state on the node.
//
// A note on D12's wording. The SOW asks for "post-init View-State output hashed against
// the manifest sha256". That was written before D26 and the EIP-55 decision, and taken
// literally it is now unsatisfiable: the native state is a DELIBERATE transform of the
// dump (addresses canonicalized to EIP-55, relay's Details dropped, PendingRounds
// transient), so its bytes cannot equal the dump's. Hashing anyway would either fail
// always or require hashing something so massaged the hash proves nothing.
//
// What replaces it is stronger, because it checks every link rather than one endpoint:
//
//   1. MANIFEST      the dump files still hash to the manifest sha256   (source integrity)
//   2. TRANSFORM     re-running the seed builder reproduces the same seed byte-for-byte
//                                                                       (deterministic)
//   3. STATE         live on-node state deep-equals the transform's output, every key
//                                                                       (nothing lost)
//   4. ROLES         the ACL is restored (D12: "roles.json restored and spot-checked")
//   5. TAIL          D13 — every tail message predates the dump, and every one succeeded
//                    except the known-benign failures. This is the machine-checkable form
//                    of the "no replay required" determination, which until now was a
//                    human judgement recorded in a doc.
//   6. FAIL-CLOSED   replay the benign failures against the live process and assert they
//                    STILL fail, with the same reason. The message tails' real negative
//                    fixtures, per D10.
//
// Run: HB_URL=… PID=<pid> bun run scripts/verify-migration.ts <contract> --seed <live|stage>
//      [--skip-replay]   (6 writes to the process; the writes fail closed, so state is
//                         unchanged, but skip it if you want a pure read-only pass)
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { EthereumSigner } from '@dha-team/arbundles/web'
import {
  createAoClient, nodeUrlFromEnv, AoContractError,
} from '@anyone-protocol/ao-client'

const AO = path.resolve(import.meta.dir, '..')
const DUMPS = path.join(AO, 'state-dumps/2026-07-09')

const CONTRACTS = {
  'operator-registry': { seedScript: 'build-seed.ts', dumpName: 'operator-registry' },
  'relay-rewards': { seedScript: 'build-relay-seed.ts', dumpName: 'relay-rewards' },
  'staking-rewards': { seedScript: 'build-staking-seed.ts', dumpName: 'staking-rewards' },
} as const
type ContractName = keyof typeof CONTRACTS

const argv = process.argv.slice(2)
const contract = argv[0] as ContractName
const seedOpt = argv.indexOf('--seed')
const net = seedOpt >= 0 ? argv[seedOpt + 1] : undefined
const skipReplay = argv.includes('--skip-replay')
if (!contract || !(contract in CONTRACTS) || !net || !['live', 'stage'].includes(net)) {
  console.error(`usage: verify-migration.ts <${Object.keys(CONTRACTS).join('|')}> --seed <live|stage> [--skip-replay]`)
  console.error('env: HB_URL, PID, DEPLOYER_PRIVATE_KEY (for the fail-closed replay)')
  process.exit(2)
}
const PID = process.env.PID
if (!PID) { console.error('PID env required (the respawned process to verify)'); process.exit(2) }

let fails = 0, checks = 0
const check = (ok: boolean, label: string, detail = '') => {
  checks++
  if (!ok) fails++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  — ' + detail : ''}`)
}

/** Structural equality. Never compare device output by JSON string: the node re-encodes
 *  from Lua tables and `pairs()` order is not stable. */
const deepEq = (a: any, b: any): boolean => {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every(k => k in b && deepEq(a[k], b[k]))
}

/** First structural difference, as a path — so a failure says WHERE, not just "differs". */
function firstDiff (got: any, want: any, p = ''): string | null {
  if (deepEq(got, want)) return null
  if (typeof got !== 'object' || typeof want !== 'object' || got === null || want === null) {
    return `${p}: ${JSON.stringify(got)?.slice(0, 60)} != ${JSON.stringify(want)?.slice(0, 60)}`
  }
  const kg = Object.keys(got), kw = Object.keys(want)
  if (kg.length !== kw.length) {
    const only = kw.filter(k => !(k in got)).concat(kg.filter(k => !(k in want))).slice(0, 3)
    return `${p || '<root>'}: ${kg.length} keys != ${kw.length} (${only.join(', ')})`
  }
  for (const k of kw) {
    const d = firstDiff(got[k], want[k], p ? `${p}.${k}` : k)
    if (d) return d
  }
  return null
}

const sha256File = (f: string) =>
  createHash('sha256').update(fs.readFileSync(f)).digest('hex')

;(async () => {
  const HB_URL = nodeUrlFromEnv()
  const ao = createAoClient({
    url: HB_URL,
    signer: process.env.DEPLOYER_PRIVATE_KEY
      ? new EthereumSigner(process.env.DEPLOYER_PRIVATE_KEY.replace(/^0x/, ''))
      : undefined,
  })
  const dumpName = CONTRACTS[contract].dumpName
  console.log(`=== migration verification: ${contract} (${net}) ===`)
  console.log(`process ${PID}\nnode    ${HB_URL}\n`)

  // 1) MANIFEST — is our source still the artifact we captured on 2026-07-09?
  console.log('1) manifest integrity (dump files vs recorded sha256):')
  const manifest = JSON.parse(fs.readFileSync(path.join(DUMPS, 'manifest.json'), 'utf8'))
  const entry = manifest.dumps.find((d: any) => d.network === net && d.name === dumpName)
  if (!entry) { console.error(`  no manifest entry for ${net}/${dumpName}`); process.exit(1) }
  for (const kind of ['state', 'roles'] as const) {
    const rec = entry[kind]
    const file = path.join(DUMPS, rec.file)
    const got = sha256File(file)
    check(got === rec.sha256, `${rec.file}`, got === rec.sha256 ? `sha256 ${got.slice(0, 16)}…` : `${got.slice(0, 16)}… != ${rec.sha256.slice(0, 16)}…`)
  }
  console.log(`  dumped ${entry.dumpedAt} from ${entry.processId}`)
  console.log(`  legacynet process owner: ${entry.processOwner}`)

  // 2) TRANSFORM — dump → native seed must be deterministic, or "verified once" means nothing
  console.log('\n2) transform determinism (rebuild the seed, compare):')
  const expectedPath = path.join(AO, 'dist', `${contract}-seed.expected.json`)
  const before = fs.existsSync(expectedPath) ? fs.readFileSync(expectedPath, 'utf8') : null
  execFileSync('bun', ['run', path.join(AO, 'scripts', CONTRACTS[contract].seedScript), net],
    { cwd: AO, stdio: 'pipe' })
  const after = fs.readFileSync(expectedPath, 'utf8')
  check(before === null || before === after, 'seed rebuild is byte-identical',
    before === null ? '(no prior build to compare)' : `${(after.length / 1024).toFixed(1)}KB`)
  const expected = JSON.parse(after)

  // 3) STATE — every key of the transform's output present and equal on the live node
  console.log('\n3) state fidelity (live node vs transform output, structural):')
  const live: any = await ao.readView(PID, 'dump')
  for (const key of Object.keys(expected.state)) {
    const d = firstDiff(live[key], expected.state[key], key)
    const size = typeof expected.state[key] === 'object' && expected.state[key] !== null
      ? `${Object.keys(expected.state[key]).length} entries` : String(expected.state[key])
    check(d === null, `${key} (${size})`, d ?? 'identical')
  }
  const extra = Object.keys(live).filter(k => !(k in expected.state))
  check(extra.length === 0, 'no unexpected top-level state keys', extra.length ? extra.join(', ') : 'none')

  // 4) ROLES — D12's "roles.json restored and spot-checked"
  console.log('\n4) ACL restored:')
  const roles: any = await ao.readView(PID, 'roles')
  for (const role of Object.keys(expected.roles)) {
    const d = firstDiff(roles[role], expected.roles[role], role)
    check(d === null, `role ${role}`, d ?? Object.keys(expected.roles[role]).join(', '))
  }

  // 5) TAIL — D13. The tails are a verification record, not a replay queue; this asserts
  //    the two properties that justify not replaying them.
  console.log('\n5) message tail as verification record (D13):')
  const tailPath = path.join(DUMPS, `${net}-${dumpName}.message-tail.json`)
  const tail = JSON.parse(fs.readFileSync(tailPath, 'utf8'))
  const dumpedAt = Date.parse(entry.dumpedAt)
  const late = tail.messages.filter((m: any) => m.timestamp > dumpedAt)
  check(late.length === 0,
    `all ${tail.messages.length} tail messages predate the dump`,
    late.length ? `${late.length} AFTER ${entry.dumpedAt} — their effects would be MISSING` : entry.dumpedAt)

  const failed = tail.messages.filter((m: any) => m.resultError)
  const byAction: Record<string, number> = {}
  for (const m of tail.messages) byAction[m.action] = (byAction[m.action] || 0) + 1
  console.log(`  actions: ${JSON.stringify(byAction)}`)
  check(failed.length === 0 || failed.every((m: any) => m.action === 'Claim-Rewards'),
    'no unexplained failures in the tail',
    failed.length ? `${failed.length} failed, all Claim-Rewards (benign — see 6)` : 'none failed')
  // Every rewards process ended on a completed round — that is WHY no replay is needed.
  const lastAction = tail.messages[tail.messages.length - 1]?.action
  if (contract !== 'operator-registry') {
    check(lastAction === 'Complete-Round', 'ended on a completed round (no mid-batch freeze)', String(lastAction))
  } else {
    console.log(`  last action: ${lastAction} (op-registry has no rounds)`)
  }

  // 6) FAIL-CLOSED — the tails' real negative fixtures, replayed against the live process.
  const benign = failed.map((m: any) => {
    const clean = String(m.resultError).replace(/\[[0-9;]*m/g, '')
    const match = clean.match(/No rewards for (0x[0-9a-fA-F]{40})/)
    return { sender: m.sender, address: match?.[1], reason: match?.[0] }
  }).filter((b: any) => b.address)
  const uniqueAddrs = [...new Set(benign.map((b: any) => b.address as string))]

  if (skipReplay || uniqueAddrs.length === 0) {
    console.log(`\n6) fail-closed replay: ${skipReplay ? 'skipped (--skip-replay)' : 'no benign failures in this tail'}`)
  } else if (!process.env.DEPLOYER_PRIVATE_KEY) {
    console.log('\n6) fail-closed replay: SKIPPED — DEPLOYER_PRIVATE_KEY not set')
  } else {
    console.log(`\n6) benign failures replayed — must STILL fail closed (D10 negative fixtures):`)
    console.log(`  ${failed.length} failure(s) in the tail across ${uniqueAddrs.length} address(es)`)
    for (const addr of uniqueAddrs) {
      const n = benign.filter((b: any) => b.address === addr).length
      try {
        await ao.sendMessage({
          processId: PID,
          action: 'Claim-Rewards',
          tags: [{ name: 'address', value: addr }],
        })
        check(false, `Claim-Rewards ${addr.slice(0, 10)}… (${n}× in tail)`, 'SUCCEEDED — it must not')
      } catch (e) {
        const isContract = e instanceof AoContractError
        // legacynet reported the address in 0x+ALLCAPS; the port canonicalizes to EIP-55,
        // so compare case-insensitively — the assertion is the same, the encoding is the
        // one deliberate deviation.
        const reason = isContract ? (e as AoContractError).reason : String(e)
        const matches = /no rewards for/i.test(reason) && reason.toLowerCase().includes(addr.toLowerCase())
        check(isContract && matches, `Claim-Rewards ${addr.slice(0, 10)}… (${n}× in tail)`,
          reason.slice(0, 80))
      }
    }
  }

  console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}  —  ${checks} checks, ${contract} ${net} → ${PID}`)
  process.exit(fails ? 1 : 0)
})().catch(e => {
  console.error('\nVERIFICATION ERROR:', String(e?.message || e))
  process.exit(2)
})
