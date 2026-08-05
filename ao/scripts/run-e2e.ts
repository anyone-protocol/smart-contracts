// D10 E2E — one entry point for the full end-to-end suite against a live HyperBEAM node.
//
// The E2E assertions themselves already lived in the tier3-* verticals; what was missing was
// a way to RUN them as a suite. Each vertical needed a different module id, produced by a
// manual publish, in an order that was not written down anywhere — the same shape of problem
// spec/run-tier2.sh solved for Tier-2, and with the same failure mode: a mis-invoked or
// skipped stage reading as success.
//
// SOW D10 asks for: spawn -> init-from-dump -> real EVM-signed operator flows (registration,
// score rounds, claims) -> state assertions, plus the message tails' real negative fixtures
// (benign Claim-Rewards that must keep failing closed). The stage-node run of this same suite
// is re-homed to D14 (agreed 2026-07-26); this runs it against any reachable node.
//
// MODULE REGISTRATION. Every vertical spawns BY MODULE ID, and a spawnable module must be a
// SIGNED ans104 module message committed into the node's own cache — the `bin/hb eval` path,
// which runs INSIDE the node container. There is no HTTP shortcut: an inline (luaSource) spawn
// does not make the module resolvable by id (see the moduleIdFor note in util/hb-client.ts —
// the by-id spawn is accepted and only fails at compute time, which makes this easy to get
// wrong). So:
//
//   * local container  -> pass --publish-container <name>; this script does the publish itself.
//   * hb-dev/hb-stage  -> the publish is one `nomad alloc exec … ./bin/hb eval` per module,
//                         which needs cluster access. Run those, then pass the ids in via
//                         MODULE_ID_{NATIVE,OPREG,RELAY,STAKING}. Use --print-publish-commands
//                         to emit the exact commands.
//
// Usage:
//   bun run scripts/run-e2e.ts --publish-container hb-e2e     # self-contained, local node
//   MODULE_ID_RELAY=… bun run scripts/run-e2e.ts --only relay # remote node, ids supplied
//   bun run scripts/run-e2e.ts --print-publish-commands       # emit the eval commands, exit
//   bun run scripts/run-e2e.ts --only relay,staking           # a subset (reports what it skipped)
//   bun run scripts/run-e2e.ts --keep-artifacts               # do not rebuild existing dist/
//   bun run scripts/run-e2e.ts --publish-container hb-e2e --sustained
//                                                             # + the multi-round verticals
//                                                             #   (minutes, not seconds)
//
// Env:
//   HB_URL                node base url. REQUIRED — no default, on purpose (see below).
//   E2E_PRIVATE_KEY       EVM key that signs. Falls back to the tier3 dev key. Its ADDRESS is
//                         printed before the first write and must be on the node's faff
//                         allow-list, or every spawn 400s.
//   CONTAINER_ENGINE      podman (default) | docker — for the luerl oracle steps.
//
// A note on why HB_URL has no default. smart-contracts/ao/.env sets both HB_URL and
// DEPLOYER_PRIVATE_KEY, and bun autoloads it when the project root resolves to ao/ — so which
// node you hit and which key signs could depend on where you invoked from, with nothing in the
// output saying so. That cost real time twice (bogus faff-400s that looked like policy
// findings). This script takes HB_URL explicitly, reads its own E2E_PRIVATE_KEY rather than
// DEPLOYER_PRIVATE_KEY, and prints the resolved address before touching the node.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { EthereumSigner } from '@dha-team/arbundles'
import { Wallet } from 'ethers'
import { fetchNodeAddress, spawnLuaProcess } from './util/hb-client'
import { seedEnvelopeFor } from './util/native-bundle'

const AO = path.resolve(import.meta.dir, '..')
const argv = process.argv.slice(2)
const onlyArg = argv.indexOf('--only')
const ONLY = onlyArg >= 0 ? (argv[onlyArg + 1] ?? '').split(',').filter(Boolean) : []
const KEEP = argv.includes('--keep-artifacts')
const PRINT_CMDS = argv.includes('--print-publish-commands')
// Opt-in, because it is minutes rather than seconds: the sustained verticals drive many rounds
// at realistic width to exercise slot accumulation, claim semantics, the actions the parity
// verticals never call, and (when we control the container) a mid-life node restart. The default
// run stays fast so it remains usable as a pre-push check.
const SUSTAINED = argv.includes('--sustained')
const SUSTAINED_ROUNDS = process.env.SUSTAINED_ROUNDS || '10'
const pubArg = argv.indexOf('--publish-container')
const PUBLISH_CONTAINER = pubArg >= 0 ? (argv[pubArg + 1] ?? '') : ''
const ENGINE = process.env.CONTAINER_ENGINE || 'podman'

// `needs` is the VERTICAL key this module feeds, which is not always the module's own key —
// the native operator-registry module backs the vertical called `surface`. Keying the --only
// check off the module name instead silently skips a module its own vertical needs.
// Modules are PURE SOURCE — the migration seed rides each spawn message instead (see
// native-bundle.ts buildSeedEnvelope). So `surface` and `opreg` share ONE registration:
// the same operator-registry module backs both, seeded or not.
const MODULE_SPECS = [
  { key: 'native', needs: 'surface', env: 'MODULE_ID_NATIVE', label: 'native-opreg', file: 'dist/operator-registry-native.lua' },
  { key: 'opreg', needs: 'opreg', env: 'MODULE_ID_OPREG', label: 'opreg-src', file: 'dist/operator-registry-native.lua' },
  { key: 'relay', needs: 'relay', env: 'MODULE_ID_RELAY', label: 'relay-src', file: 'dist/relay-rewards-native.lua' },
  { key: 'staking', needs: 'staking', env: 'MODULE_ID_STAKING', label: 'staking-src', file: 'dist/staking-rewards-native.lua' },
] as const

/**
 * The Erlang the node evaluates to turn a lua file into a spawnable module: commit it as a
 * signed ans104 module message and write it to the local cache. The id is written to a FILE
 * rather than printed, because `bin/hb eval` runs over rpc — io:format lands on the node's
 * console (container logs), not in the eval's output, which makes log-scraping racy.
 *
 * Upload to the bundler is deliberately omitted: it needs a funded wallet and is a durability
 * concern (W6/D21-D25), not a testing one. The cache write is what makes by-id spawn resolve.
 */
const publishErl = (luaPath: string, idPath: string, name: string) => `
{ok, Script} = file:read_file("${luaPath}"),
Msg = hb_message:commit(
  #{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>,
     <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>,
     <<"name">> => <<"${name}">>, <<"body">> => Script },
  #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>),
{ok, _} = hb_cache:write(Msg, #{}),
ok = file:write_file("${idPath}", hb_util:id(Msg)).
`.trim().replace(/\n/g, ' ')

// Emitted without touching a node, so it works from a laptop with no cluster access.
if (PRINT_CMDS) {
  console.log('\nPublish each module ON THE NODE, then pass the printed ids back in via MODULE_ID_*.')
  console.log('For dev/stage replace `podman exec <container>` with `nomad alloc exec -task hyperbeam <alloc>`.\n')
  for (const m of MODULE_SPECS) {
    console.log(`# ${m.label}`)
    console.log(`podman cp ${m.file} <container>:/tmp/${m.label}.lua`)
    console.log(`podman exec <container> ./bin/hb eval '${publishErl(`/tmp/${m.label}.lua`, `/tmp/${m.label}.id`, m.label)}'`)
    console.log(`podman exec <container> cat /tmp/${m.label}.id   # -> export ${m.env}=<id>\n`)
  }
  process.exit(0)
}

const HB = process.env.HB_URL
if (!HB) {
  console.error('HB_URL is required (e.g. http://localhost:8734 or https://hb-dev.anyone.tech)')
  console.error('It has no default on purpose — see the header note about ao/.env.')
  process.exit(2)
}
const KEY = (process.env.E2E_PRIVATE_KEY
  || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const SIGNER_ADDR = new Wallet(KEY).address
const KEY_SOURCE = process.env.E2E_PRIVATE_KEY ? 'E2E_PRIVATE_KEY' : 'built-in tier3 dev key'

const bun = (rel: string, args: string[] = [], env: Record<string, string> = {}, timeoutS = 900) =>
  execFileSync('bun', ['run', rel, ...args], {
    cwd: AO,
    encoding: 'utf8',
    timeout: timeoutS * 1000,
    maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, ...env },
  })

// ---------------------------------------------------------------- results

type State = 'PASS' | 'FAIL' | 'ERROR' | 'SKIP'
interface Result { stage: string, state: State, detail: string, secs: number }
const results: Result[] = []
const record = (stage: string, state: State, detail: string, secs = 0) => {
  results.push({ stage, state, detail, secs })
  const mark = { PASS: 'PASS ', FAIL: 'FAIL ', ERROR: 'ERROR', SKIP: 'skip ' }[state]
  console.log(`  ${mark} ${stage}${detail ? ' — ' + detail : ''}${secs ? `  (${secs.toFixed(1)}s)` : ''}`)
}

// Failing stages write their FULL captured output here. The console line is a 3-line tail,
// which is enough to recognise a failure but never enough to diagnose one — and re-running a
// 20-minute suite to see what it said is the kind of friction that gets suites ignored.
const LOGDIR = path.join(AO, 'dist/e2e-logs')

/** Run a step; any throw becomes ERROR, never a silent pass. */
async function step (stage: string, fn: () => Promise<string> | string): Promise<boolean> {
  const t0 = performance.now()
  try {
    const detail = await fn()
    record(stage, 'PASS', detail, (performance.now() - t0) / 1000)
    return true
  } catch (e: any) {
    const msg = String(e?.stdout || '') + String(e?.stderr || e?.message || e)
    // A vertical that exits 1 has FAILED its assertions; anything else is an ERROR in the
    // harness itself. Both are non-zero exits, but they mean very different things.
    const state: State = e?.status === 1 ? 'FAIL' : 'ERROR'
    let tail = msg.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)
    try {
      fs.mkdirSync(LOGDIR, { recursive: true })
      const f = path.join(LOGDIR, `${stage.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.log`)
      fs.writeFileSync(f, msg)
      tail += `  [full: ${path.relative(AO, f)}]`
    } catch { /* diagnostics are best-effort; never mask the original failure */ }
    record(stage, state, tail, (performance.now() - t0) / 1000)
    return false
  }
}

// ---------------------------------------------------------------- stage 0: preflight

console.log(`\n=== D10 E2E ===`)
console.log(`node    : ${HB}`)
console.log(`signer  : ${SIGNER_ADDR}  (from ${KEY_SOURCE})`)
console.log(`engine  : ${ENGINE}`)

const signer = new EthereumSigner(KEY)
const config = { url: HB, signer }
const stamp = String(process.hrtime.bigint())

console.log(`\n[0] preflight`)
let nodeAddr = ''
await step('node reachable', async () => {
  nodeAddr = await fetchNodeAddress(HB)
  return `operator ${nodeAddr}`
})
if (!nodeAddr) {
  console.error('\nnode unreachable — aborting before any writes.')
  process.exit(2)
}

// Prove the signer is admitted BEFORE spending minutes building artifacts. A faff refusal here
// is a 400 "Node will not service this request under any circumstances" and means SIGNER_ADDR
// is not on this node's allow-list — not that anything is broken.
const admitted = await step('signer admitted (tiny throwaway spawn)', async () => {
  const probeSrc = `local m = {}\nfunction m.init(s) return s end\nfunction m.compute(s, a) return s end\nreturn m\n`
  const r = await spawnLuaProcess(config, {
    luaSource: probeSrc,
    tags: [{ name: 'name', value: `e2e-preflight-${stamp}` }],
  })
  return `pid ${r.pid.slice(0, 12)}…`
})
if (!admitted) {
  console.error(`\nThe node refused a spawn from ${SIGNER_ADDR}.`)
  console.error('If that is a 400, this address is not on the node\'s faff allow-list.')
  console.error('Set E2E_PRIVATE_KEY to an allow-listed key. Aborting before the long stages.')
  process.exit(2)
}

// ---------------------------------------------------------------- stage 1: artifacts

// Each artifact plus the builder chain that produces it. Order matters: the oracles read the
// seeds' expected.json, so seeds build first.
// `needs` ties an artifact to the vertical(s) that consume it, so --only does not spend
// minutes building an oracle nothing in this run will read.
const ARTIFACTS: Array<{ file: string, build: () => void, label: string, needs: string[] }> = [
  {
    label: 'native operator-registry bundle',
    file: 'dist/operator-registry-native.lua',
    needs: ['surface', 'opreg'],
    build: () => { bun('scripts/build-native-bundle.ts', ['operator-registry'], {}, 300) },
  },
  {
    label: 'native relay-rewards bundle',
    file: 'dist/relay-rewards-native.lua',
    needs: ['relay'],
    build: () => { bun('scripts/build-native-bundle.ts', ['relay-rewards'], {}, 300) },
  },
  {
    label: 'native staking-rewards bundle',
    file: 'dist/staking-rewards-native.lua',
    needs: ['staking'],
    build: () => { bun('scripts/build-native-bundle.ts', ['staking-rewards'], {}, 300) },
  },
  {
    label: 'operator-registry seed (live dump)',
    file: 'dist/operator-registry-seed.envelope.json',
    needs: ['opreg'],
    build: () => { bun('scripts/build-seed.ts', ['live'], {}, 300) },
  },
  {
    label: 'relay-rewards seed (live dump)',
    file: 'dist/relay-rewards-seed.envelope.json',
    needs: ['relay'],
    build: () => { bun('scripts/build-relay-seed.ts', ['live'], {}, 300) },
  },
  {
    label: 'staking-rewards seed (live dump)',
    file: 'dist/staking-rewards-seed.envelope.json',
    needs: ['staking'],
    build: () => { bun('scripts/build-staking-seed.ts', ['live'], {}, 300) },
  },
  {
    label: 'relay parity oracle',
    file: 'dist/relay-oracle-probe.json',
    needs: ['relay'],
    build: () => {
      bun('scripts/build-relay-oracle.ts', [], {}, 300)
      bun('scripts/build-relay-probe.ts', [], { CONTAINER_ENGINE: ENGINE }, 900)
    },
  },
  {
    label: 'staking parity oracle',
    file: 'dist/staking-oracle-probe.json',
    needs: ['staking'],
    build: () => { bun('scripts/build-staking-oracle.ts', [], { CONTAINER_ENGINE: ENGINE }, 900) },
  },
]

const selected = (k: string) => ONLY.length === 0 || ONLY.includes(k)

console.log(`\n[1] artifacts${KEEP ? ' (--keep-artifacts: only building what is missing)' : ''}`)
for (const a of ARTIFACTS) {
  if (!a.needs.some(selected)) { record(a.label, 'SKIP', `not needed by --only ${ONLY.join(',')}`); continue }
  const abs = path.join(AO, a.file)
  if (KEEP && fs.existsSync(abs)) {
    record(a.label, 'SKIP', `present: ${a.file}`)
    continue
  }
  await step(a.label, () => {
    a.build()
    if (!fs.existsSync(abs)) throw new Error(`builder ran but ${a.file} does not exist`)
    return `${a.file} (${(fs.statSync(abs).size / 1024).toFixed(0)}KB)`
  })
}

// ---------------------------------------------------------------- stage 2: module registration

/** Publish inside a container we control, and read the id back from the file it wrote. */
function publishInContainer (container: string, rel: string, label: string): string {
  const inLua = `/tmp/e2e-${label}.lua`
  const inId = `/tmp/e2e-${label}.id`
  execFileSync(ENGINE, ['cp', path.join(AO, rel), `${container}:${inLua}`], { timeout: 300_000 })
  execFileSync(ENGINE, ['exec', container, './bin/hb', 'eval', publishErl(inLua, inId, label)],
    { encoding: 'utf8', timeout: 600_000 })
  const id = execFileSync(ENGINE, ['exec', container, 'cat', inId], { encoding: 'utf8', timeout: 60_000 }).trim()
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error(`published id looks wrong: ${JSON.stringify(id.slice(0, 60))}`)
  return id
}

console.log(`\n[2] module registration${PUBLISH_CONTAINER ? ` (publishing into ${PUBLISH_CONTAINER})` : ' (ids from MODULE_ID_* env)'}`)
const MODULES: Record<string, string | null> = {}
// Modules are pure source, so two specs can name the SAME file — `surface` and `opreg` both
// run the operator-registry contract and differ only in whether their spawn carries a seed.
// Register each distinct file once and share the id; registering twice would mint two module
// ids for identical source, which is exactly the per-migration-artifact problem we removed.
const byFile = new Map<string, string>()
for (const m of MODULE_SPECS) {
  if (!selected(m.needs)) { record(`register ${m.label}`, 'SKIP', `--only ${ONLY.join(',')}`); MODULES[m.key] = null; continue }
  const already = byFile.get(m.file)
  if (already) {
    MODULES[m.key] = already
    record(`register ${m.label}`, 'PASS', `reused ${m.file} -> ${already.slice(0, 12)}…`)
    continue
  }
  const fromEnv = process.env[m.env]
  if (fromEnv) {
    MODULES[m.key] = fromEnv
    byFile.set(m.file, fromEnv)
    record(`register ${m.label}`, 'PASS', `${m.env}=${fromEnv.slice(0, 12)}…`)
    continue
  }
  if (!PUBLISH_CONTAINER) {
    record(`register ${m.label}`, 'ERROR', `no ${m.env} and no --publish-container (see --print-publish-commands)`)
    MODULES[m.key] = null
    continue
  }
  if (!fs.existsSync(path.join(AO, m.file))) {
    record(`register ${m.label}`, 'ERROR', `missing ${m.file}`)
    MODULES[m.key] = null
    continue
  }
  MODULES[m.key] = null
  await step(`register ${m.label}`, () => {
    const id = publishInContainer(PUBLISH_CONTAINER, m.file, m.label)
    MODULES[m.key] = id
    byFile.set(m.file, id)
    return `${(fs.statSync(path.join(AO, m.file)).size / 1024).toFixed(0)}KB -> ${id.slice(0, 12)}…`
  })
}

// ---------------------------------------------------------------- stage 3: verticals

interface Vertical {
  key: string
  label: string
  script: string
  moduleId: string | null
  /** contract name for the verify-migration follow-up, if this vertical seeds one */
  migrates?: 'operator-registry' | 'relay-rewards' | 'staking-rewards'
  timeoutS: number
  /** positional args for the script (the sustained vertical takes the contract name) */
  args?: string[]
  /** extra env on top of HB_URL / MODULE_ID / DEPLOYER_PRIVATE_KEY */
  env?: Record<string, string>
}

const VERTICALS: Vertical[] = [
  { key: 'surface', label: 'native surface + ACL (EVM-signed registration)', script: 'scripts/tier3-validate.ts', moduleId: MODULES.native, timeoutS: 900 },
  { key: 'opreg', label: 'operator-registry seed (init-from-dump)', script: 'scripts/tier3-seed-validate.ts', moduleId: MODULES.opreg, migrates: 'operator-registry', timeoutS: 900 },
  { key: 'relay', label: 'relay-rewards seed + score round parity', script: 'scripts/tier3-relay-validate.ts', moduleId: MODULES.relay, migrates: 'relay-rewards', timeoutS: 1800 },
  { key: 'staking', label: 'staking-rewards seed + score round parity', script: 'scripts/tier3-staking-validate.ts', moduleId: MODULES.staking, migrates: 'staking-rewards', timeoutS: 1800 },
]

// No `migrates`: these mutate hard by design (many settled rounds, claims, a config round-trip),
// so a verify-migration follow-up on their pid would fail as a migration defect when it is
// nothing of the kind — the same trap already documented for the parity verticals.
if (SUSTAINED) {
  for (const c of ['relay', 'staking'] as const) {
    VERTICALS.push({
      key: `sustained-${c}`,
      label: `${c}-rewards sustained (${SUSTAINED_ROUNDS} rounds, all actions, ACL, restart)`,
      script: 'scripts/tier3-sustained.ts',
      moduleId: c === 'relay' ? MODULES.relay : MODULES.staking,
      timeoutS: 5400,
      args: [c],
      // Without a container we cannot restart the node, so section G self-skips.
      env: { ROUNDS: SUSTAINED_ROUNDS, CONTAINER: PUBLISH_CONTAINER },
    })
  }
}

const pids: Record<string, string> = {}

console.log(`\n[3] verticals`)
for (const v of VERTICALS) {
  if (!selected(v.key)) { record(v.label, 'SKIP', `--only ${ONLY.join(',')}`); continue }
  if (!v.moduleId) { record(v.label, 'ERROR', 'no module id (registration failed)'); continue }
  // If an artifact this vertical consumes never got built, say so. Running anyway produces an
  // ENOENT stack trace from deep inside the vertical, which reads like a new problem rather
  // than the downstream consequence of the artifact failure already reported above.
  const missing = ARTIFACTS
    .filter(a => a.needs.includes(v.key) && !fs.existsSync(path.join(AO, a.file)))
    .map(a => a.file)
  if (missing.length) {
    record(v.label, 'ERROR', `prerequisite artifact missing: ${missing.join(', ')} — see the artifact stage above`)
    continue
  }
  await step(v.label, () => {
    const out = bun(v.script, v.args ?? [],
      { HB_URL: HB, MODULE_ID: v.moduleId!, DEPLOYER_PRIVATE_KEY: KEY, ...(v.env ?? {}) }, v.timeoutS)
    // The verticals do not agree on how they print the pid: the seed ones use `pid=<id>`,
    // tier3-validate uses `pid = <id>` and later `pids: main=<id> views=<id>`. Tolerate all
    // three rather than silently failing to find one.
    const pid = [...out.matchAll(/\b(?:pid|main)\s*=\s*([A-Za-z0-9_-]{43})\b/g)].pop()?.[1]
    if (pid) pids[v.key] = pid
    // These scripts exit 0 on success, so reaching here means pass — but a run that printed
    // no pid at all did not spawn, and must not read as a clean pass. Carry the vertical's
    // output on the error: this throw is ours, so there is no e.stdout for step() to log.
    if (!pid) {
      const err: any = new Error('vertical exited 0 but printed no pid')
      err.stdout = out
      throw err
    }
    return `pid ${pid.slice(0, 12)}…`
  })
}

// ---------------------------------------------------------------- stage 4: migration + negatives

// Each verify-migration gets a FRESHLY SPAWNED process, NOT the one its vertical just used.
// The verticals mutate state by design — relay and staking drive a full scoring round, and the
// opreg vertical writes a new cert — so asking "is this a faithful copy of the dump?" about a
// process that has since been written to is guaranteed to fail. It fails in a way that looks
// like a migration defect (extra reward keys, a moved PreviousRound.Timestamp) rather than a
// test-ordering artifact, which is exactly the kind of red that gets "fixed" by weakening the
// assertion. Stage 3 asks whether it behaves correctly; stage 4 asks whether it migrated
// faithfully. Different questions, so: different processes.
console.log(`\n[4] migration chain-of-custody + fail-closed negative fixtures (fresh spawns)`)
for (const v of VERTICALS) {
  if (!v.migrates) continue
  if (!selected(v.key)) { record(`verify-migration ${v.migrates}`, 'SKIP', `--only ${ONLY.join(',')}`); continue }
  const moduleId = MODULES[v.key]
  if (!moduleId) { record(`verify-migration ${v.migrates}`, 'ERROR', 'no module id'); continue }
  await step(`verify-migration ${v.migrates}`, async () => {
    const fresh = await spawnLuaProcess(config, {
      moduleId,
      // The module is pure source now, so the seed has to ride the spawn message —
      // without it this would verify an EMPTY process and pass nothing meaningful.
      spawnData: seedEnvelopeFor(v.migrates!),
      tags: [{ name: 'name', value: `e2e-verify-${v.key}-${stamp}` }],
    })
    bun('scripts/verify-migration.ts', [v.migrates!, '--seed', 'live'],
      { HB_URL: HB, PID: fresh.pid, DEPLOYER_PRIVATE_KEY: KEY }, 900)
    return `fresh pid ${fresh.pid.slice(0, 12)}…`
  })
}

// ---------------------------------------------------------------- stage 5: aggregate

const n = (s: State) => results.filter(r => r.state === s).length
const failed = n('FAIL') + n('ERROR')

console.log(`\n=== summary ===`)
for (const r of results.filter(r => r.state === 'FAIL' || r.state === 'ERROR')) {
  console.log(`  ${r.state}  ${r.stage} — ${r.detail}`)
}
if (n('SKIP')) {
  // Never let a skipped stage read as coverage.
  console.log(`  ${n('SKIP')} stage(s) SKIPPED — not evidence of anything:`)
  for (const r of results.filter(r => r.state === 'SKIP')) console.log(`      ${r.stage} (${r.detail})`)
}
console.log(`\n${n('PASS')} passed, ${n('FAIL')} failed, ${n('ERROR')} errored, ${n('SKIP')} skipped`)
console.log(`node ${HB}  signer ${SIGNER_ADDR}`)
process.exit(failed ? 1 : 0)
