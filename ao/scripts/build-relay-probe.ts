// Produce dist/relay-oracle-probe.json — the luerl-side half of the relay parity check.
//
// This step previously existed only as tribal knowledge: tier3-relay-validate.ts READS
// dist/relay-oracle-probe.json, but nothing in scripts/ wrote it, so a fresh checkout could
// not run the relay vertical at all. Staking's equivalent (build-staking-oracle.ts) already
// shelled out to luerl itself; this is the same thing for relay.
//
// What it does: run spec/luerl/scenarios/relay-round-probe.lua in BUNDLE mode on top of the
// minimal seeded bundle (dist/relay-oracle-min.lua), capture its PROBE=<json> line, and store
// it. tier3-relay-validate.ts then drives the IDENTICAL round on a live node and asserts every
// value matches — proving the device VM computes the frozen math the same way.
//
// ⚠️ relay-round-probe.lua keys a table by a 13-digit ms timestamp, so it is the A17 landmine
// (luerl's pairs/next scans the array part to the largest integer key). It is FINE here because
// (a) bundle mode against relay-oracle-min.lua is its one intended invocation, and (b) the
// native relay contract carries the tostring() keying workaround. Run it any other way — e.g.
// via the Tier-2 runner in `native`/`run` mode — and it becomes a ~3.5 hour single-core spin
// with no error. spec/run-tier2.sh excludes it by name for exactly this reason.
//
// Prereq: bun run scripts/build-relay-seed.ts && bun run scripts/build-relay-oracle.ts
// Run:    bun run scripts/build-relay-probe.ts
// Env:    CONTAINER_ENGINE (podman|docker, default podman), LUERL_IMAGE, TIMEOUT (seconds)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const AO = path.resolve(import.meta.dir, '..')
const ENGINE = process.env.CONTAINER_ENGINE || 'podman'
const IMAGE = process.env.LUERL_IMAGE || 'anyone-luerl:1.3.0'
const TIMEOUT_S = Number(process.env.TIMEOUT || 900)
// SELinux relabelling is needed on Fedora-family hosts under podman; docker rejects :Z.
const MOUNT = `${AO}:/work${ENGINE.includes('podman') ? ':Z' : ''}`

const SEED = path.join(AO, 'dist/relay-oracle-min.lua')
const SCEN = 'spec/luerl/scenarios/relay-round-probe.lua'
const OUT = path.join(AO, 'dist/relay-oracle-probe.json')

if (!fs.existsSync(SEED)) {
  console.error(`missing ${SEED}`)
  console.error('run: bun run scripts/build-relay-seed.ts && bun run scripts/build-relay-oracle.ts')
  process.exit(2)
}

console.log(`${ENGINE} ${IMAGE} bundle ${path.basename(SEED)} ${path.basename(SCEN)}`)
const t0 = performance.now()
let raw: string
try {
  raw = execFileSync(
    ENGINE,
    ['run', '--rm', '-v', MOUNT, '-w', '/work', IMAGE, 'bundle', `/work/dist/${path.basename(SEED)}`, `/work/${SCEN}`],
    { encoding: 'utf8', timeout: TIMEOUT_S * 1000, maxBuffer: 512 * 1024 * 1024 }
  )
} catch (e: any) {
  // A timeout here almost always means the scenario was run against the wrong bundle.
  if (e?.signal === 'SIGTERM' || e?.code === 'ETIMEDOUT') {
    console.error(`TIMEOUT after ${TIMEOUT_S}s — see the A17 note at the top of this file.`)
    process.exit(2)
  }
  console.error(`${ENGINE} failed: ${String(e?.stderr || e?.message).slice(0, 800)}`)
  process.exit(2)
}
const secs = ((performance.now() - t0) / 1000).toFixed(1)

const line = raw.split('\n').find(l => l.startsWith('PROBE='))
if (!line) {
  console.error(`no PROBE= line in output (ran ${secs}s):\n${raw.slice(0, 2000)}`)
  process.exit(2)
}
const probe = JSON.parse(line.slice('PROBE='.length))

// A round that computed nothing would "match" a node that also did nothing, so assert the
// oracle actually produced the three fingerprints the scenario feeds, with non-zero rewards.
// Without this the parity check passes vacuously — the same trap as `.every()` on an empty array.
const FP = [ '1'.repeat(40), '2'.repeat(40), '3'.repeat(40) ]
const detailKeys = Object.keys(probe.Details ?? {})
if (detailKeys.length !== FP.length || !FP.every(f => detailKeys.includes(f))) {
  console.error(`FAIL: oracle Details has ${detailKeys.length} fingerprints, expected ${FP.length}`)
  process.exit(1)
}
const rewards = [ ...Object.values(probe.tar ?? {}), ...Object.values(probe.tfr ?? {}) ]
if (rewards.length === 0 || rewards.some(v => v === undefined || v === null || v === '0')) {
  console.error(`FAIL: oracle produced empty/zero cumulative rewards — ${JSON.stringify({ tar: probe.tar, tfr: probe.tfr })}`)
  process.exit(1)
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(probe, null, 0))
console.log(`wrote ${OUT} (${secs}s)`)
console.log(`  Period=${probe.Period}  ${detailKeys.length} fingerprints  ${rewards.length} cumulative reward entries`)
