// QUALIFY-NODE — one reproducible procedure to bless a HyperBEAM image for production.
//
// The question this answers is "can we run THIS image on stage and live?", and until now the
// honest answer was that every piece of evidence existed and no procedure assembled them. Tier-2,
// run-e2e, the golden, verify-access-policy and the 19 probes each answer part of it; nothing ran
// them in order, and — the larger gap — nothing RECORDED what a good result looks like. The cost
// numbers this migration actually cares about (per-message cost FLAT rather than growing, a trie
// point-lookup that does not scale with the operator set) lived in docs and in people's heads, so
// "did this version regress?" was not a mechanically answerable question. It is now:
//
//   bun run scripts/qualify-node.ts --image <ref> --record-baseline   # bless a version
//   bun run scripts/qualify-node.ts --image <ref>                     # compare against it
//
// WHAT IS BEING QUALIFIED IS AN IMAGE, NOT A DEPLOYMENT. The primary mode boots a container from
// the image under test, drives everything against it, and tears it down. That is deliberate: a
// deployed node conflates the image with its environment (Consul-templated PIDs, the nginx edge,
// a funded bundler), and a regression in one reads as a regression in the other. `--url` mode
// exists for the checks that can only be made against a real environment, and every phase it
// cannot run reports SKIP with a reason rather than quietly shrinking the evidence.
//
// -------------------------------------------------------------------- what gates, and what does not
//
// The single most important thing here is the split between metrics that GATE and metrics that are
// merely RECORDED, because getting it wrong produces a suite nobody trusts:
//
//   * ABSOLUTE LATENCY IS NOT COMPARABLE BETWEEN RUNS. gc-cost-curve's own header says so — the
//     numbers move with host load and state size. A baseline recorded on a laptop and compared on
//     CI would fail for reasons that have nothing to do with the image. So every absolute
//     millisecond figure here is `record`: measured, printed with its delta, never able to fail a
//     run.
//   * WHAT GATES IS SHAPE. Growth ratios, scaling ratios, pass/fail COUNTS, and identity. Those
//     are host-independent, and they are also exactly where the failures we have actually seen
//     would land: the un-collected luerl snapshot showed up as a growth curve, not a slow message.
//
// The policy lives in METRICS below rather than in the baseline JSON on purpose — a tolerance band
// is a judgement that should be reviewed in a diff of this file, not silently widened in a fixture.
//
// -------------------------------------------------------------------- the checks nothing else makes
//
// Two phases are new here rather than delegated, because no existing script covers them and both
// are precisely the kind of thing a version bump breaks:
//
//   TOOLCHAIN.  Reads the upstream commit, the applied-patch fingerprint, the luerl version and
//               the erts version out of the image itself. The Dockerfile leaves /app as a git
//               working tree with the patches applied but uncommitted, so `git diff` IS the patch
//               set and its sha256 is a single handle on "which patches are in this image". It
//               also asserts the image's luerl matches the version spec/run-tier2.sh pins
//               (LUERL_IMAGE): the whole point of Tier-2 is to run what the node runs, so a
//               VERSION bump that moves luerl silently turns Tier-2 into a test of a VM we do not
//               ship. That is a hard failure with an actionable message, not a note.
//   CONFIG.     Boots a second, short-lived container against a production-SHAPED opt surface
//               (spec/fixtures/node-qualify-policy.json — real structure, placeholder values) and
//               asserts every key reads back from ~meta@1.0/info. This is the standing regression
//               test for the trap verify-access-policy documents: opts read via hb_opts:get must
//               be lowercase-HYPHENATED, and a key the node does not recognise is not an error —
//               it is silently not-found, i.e. an EMPTY allow-list, i.e. a node that admits
//               nobody. Values are placeholders because the question is whether the image loads
//               the SHAPE; the real values are environment policy and belong to
//               verify-access-policy.
//
// Tier-1 is not driven from here: it is pure Lua and version-insensitive. Tier-2 IS, and is run
// as its own phase — it executes in the pinned luerl container rather than the node, which only
// means something because `toolchain` asserts that pin equals the luerl the image ships.
//
// -------------------------------------------------------------------- usage
//
//   --image <ref>          image to qualify; started locally as a container (primary mode)
//   --url <url>            qualify an already-running node instead (fewer phases; see modes)
//   --env dev|stage|live   with --url: also run verify-access-policy against that environment
//   --allow-remote-writes  with a non-loopback --url: run the phases that spawn and write there
//   --baseline <file>      compare against this baseline (default spec/fixtures/node-baseline.json)
//   --record-baseline      write the baseline instead of comparing (refuses on any failure/skip)
//   --record-partial       with --record-baseline: record deliberately-partial evidence anyway
//   --only a,b  --skip a,b select phases (ids printed by --list)
//   --list                 print the phase table and exit
//   --quick                smaller economics samples; NOT baseline-comparable, and refuses to record
//   --keep                 leave the container running for inspection
//   --stream               tee every subprocess to the console (default: capture, tail on failure)
//   --port <n>             host port for the container under test (default 8735)
//   --from-image <ref>     the image CURRENTLY DEPLOYED. Enables the `trie-crossing` phase, which
//                          is the only check that can see an upgrade break EXISTING processes.
//
// Env: E2E_PRIVATE_KEY, else DEPLOYER_PRIVATE_KEY from ao/.env, else a built-in dev key that the
//      run warns about loudly (see the note by BUILTIN_DEV_KEY). CONTAINER_ENGINE.
import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Wallet } from 'ethers'

const AO = path.resolve(import.meta.dir, '..')
const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(n)
const opt = (n: string, d = '') => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] ?? d) : d }
const list = (n: string) => (opt(n) || '').split(',').map(s => s.trim()).filter(Boolean)

const IMAGE = opt('--image')
const FROM_IMAGE = opt('--from-image')
const URL_ARG = opt('--url')
const ENV_NAME = opt('--env')
const BASELINE_PATH = path.resolve(AO, opt('--baseline', 'spec/fixtures/node-baseline.json'))
const RECORD = flag('--record-baseline')
const ONLY = list('--only')
const SKIP = list('--skip')
const QUICK = flag('--quick')
const KEEP = flag('--keep')
const STREAM = flag('--stream')
const PORT = Number(opt('--port', '8735'))
const ENGINE = process.env.CONTAINER_ENGINE || 'podman'
const CONTAINER = opt('--container', 'hb-qualify')
const POLICY_CONTAINER = `${CONTAINER}-policy`

// SIGNER RESOLUTION, and why the order is this way round.
//
// run-e2e reads E2E_PRIVATE_KEY rather than DEPLOYER_PRIVATE_KEY so that an ambient ao/.env cannot
// silently decide who signs. That is right for a suite whose assertions are signer-independent —
// but this driver also runs the STAKING GOLDEN, and the golden is signer-BOUND: the `status` view
// reports the process `owner`, so a capture made with one key diffs against a run made with
// another. Two views move, nothing is wrong with the image, and the run reports NOT QUALIFIED.
//
// So DEPLOYER_PRIVATE_KEY (what ao/.env supplies, and what every recorded fixture in this repo was
// captured with) is preferred over the built-in fallback, and E2E_PRIVATE_KEY still overrides
// everything for a deliberate choice. The resolved address is printed before any write either way.
//
// The built-in is a LAST resort and says so out loud: 0xa9A1BdfA75… is the key whose private half
// is hardcoded in committed scripts in this PUBLIC repo. It was removed from every node's faff
// allow-list on 2026-07-30 and must not go back, so a run that lands on it will be refused by any
// real node and will diff the golden on `owner`.
const BUILTIN_DEV_KEY = '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37'
const KEY_SOURCE = process.env.E2E_PRIVATE_KEY ? 'E2E_PRIVATE_KEY'
  : process.env.DEPLOYER_PRIVATE_KEY ? 'DEPLOYER_PRIVATE_KEY (ao/.env)'
    : 'built-in tier3 dev key'
const KEY = (process.env.E2E_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || BUILTIN_DEV_KEY).replace(/^0x/, '')
const SIGNER = new Wallet(KEY).address

// Cleared at the start of every run. The e2e suite writes logs only on failure, which means a
// green run leaves the PREVIOUS run's files sitting there looking current — that has cost real
// diagnosis time. Wiping up front makes "a file exists here" mean "this run produced it".
const LOGDIR = path.join(AO, 'dist/qualify-logs')

// ==================================================================== metric policy

type MetricKind = 'identity' | 'gate' | 'record'
interface Metric {
  label: string
  kind: MetricKind
  /** which direction is a REGRESSION, for gate metrics compared against a baseline */
  worse?: 'higher' | 'lower'
  /** fractional band around the baseline before `worse` trips (default 0 = exact) */
  tol?: number
  /** absolute allowance added to the band, so small numbers do not trip on noise */
  floor?: number
  /** hard limit independent of any baseline — the value that is wrong on its own terms */
  ceiling?: number
  /** boolean metrics that must hold regardless of baseline */
  mustBe?: boolean
  /**
   * String metrics that must EQUAL the baseline. Distinct from `identity`, and the distinction is
   * the whole point of the fingerprint phase: `toolchain.*` describes the build you are
   * deliberately qualifying, so a change there is expected and merely reported. `fingerprint.*`
   * asks whether a DEPLOYED node is the build you already blessed, so a change there IS the
   * finding and must fail.
   */
  mustMatchBaseline?: boolean
  unit?: string
}

// Rationale for the numeric gates:
//   gc.growth      ratio of the last-10 to the first-10 message latency over 50 accumulated
//                  slots. The GC-patched image measures ~flat; the stock image grew ~5x
//                  (554 ms -> 2,700 ms). The 1.50 CEILING does the real work: far above patched
//                  noise, far below stock behaviour, and independent of any baseline.
//                  The baseline-relative band is deliberately loose, because the ratio is noisy:
//                  five runs of the SAME image measured 0.77, 0.85, 0.87, 1.03 and 1.08, a spread
//                  of 1.4x. A ±20% band would have false-failed a 1.08 run against a 0.77
//                  baseline (threshold 1.074), so it is ±40% plus a 0.20 absolute allowance —
//                  still comfortably inside the ceiling, so nothing is actually loosened.
//   trie.hitScaling point-lookup latency at the LARGEST key count divided by the smallest. The
//                  gate design rests on this being ~1: a radix lookup is O(key length). If it
//                  starts scaling with the operator set, every chargeable write pays for it.
const METRICS: Record<string, Metric> = {
  'toolchain.upstream':  { label: 'upstream commit', kind: 'identity' },
  'toolchain.patchSha':  { label: 'applied-patch fingerprint', kind: 'identity' },
  'toolchain.patchFiles':{ label: 'patched files', kind: 'identity' },
  'toolchain.luerl':     { label: 'luerl version', kind: 'identity' },
  'toolchain.erts':      { label: 'erts version', kind: 'identity' },
  'toolchain.tier2Pin':  { label: 'tier-2 runner luerl matches the image', kind: 'gate', mustBe: true },

  // Provenance only: WHICH image we crossed from. The gate is the phase's pass/fail, not this —
  // the value legitimately changes on every upgrade, so gating on it would fail every real run.
  'trieCrossing.from':   { label: 'crossed from image', kind: 'record' },

  'tier2.passed':        { label: 'tier-2 luerl conformance assertions passed', kind: 'gate', worse: 'lower' },
  'tier2.failed':        { label: 'tier-2 luerl conformance failures', kind: 'gate', ceiling: 0 },
  'tier2.scenarios':     { label: 'tier-2 scenarios run', kind: 'gate', worse: 'lower' },

  'fingerprint.optSurface':    { label: 'build-default opt surface (sha)', kind: 'gate', mustMatchBaseline: true },
  'fingerprint.optCount':      { label: 'build-default opt keys', kind: 'record' },
  'fingerprint.deviceSurface': { label: 'preloaded device surface (sha)', kind: 'gate', mustMatchBaseline: true },
  'fingerprint.deviceCount':   { label: 'preloaded devices', kind: 'record' },
  'fingerprint.configOnly':    { label: 'opts present that only configuration explains', kind: 'record' },
  'fingerprint.digestDeclared': { label: 'node self-declares the image digest it booted with', kind: 'record' },

  'identity.luaDevice':  { label: 'no load-bearing device reports device_not_loadable', kind: 'gate', mustBe: true },
  'identity.devicesProven': { label: 'load-bearing devices positively confirmed loadable', kind: 'record' },
  'identity.rootServed': { label: 'root path served (not 404)', kind: 'gate', mustBe: true },
  'identity.noCommentOpts': { label: 'opts derived from config comments', kind: 'gate', ceiling: 0 },

  'config.inForce':      { label: 'production opts read back', kind: 'gate', worse: 'lower' },
  'config.missing':      { label: 'production opts NOT in force', kind: 'gate', ceiling: 0 },

  'smoke.failed':        { label: 'smoke checks failed', kind: 'gate', ceiling: 0 },
  'verticals.passed':    { label: 'e2e stages passed', kind: 'gate', worse: 'lower' },
  'verticals.failed':    { label: 'e2e stages failed', kind: 'gate', ceiling: 0 },
  'verticals.skipped':   { label: 'e2e stages skipped', kind: 'record' },
  'golden.failed':       { label: 'golden view diffs', kind: 'gate', ceiling: 0 },
  'policy.passed':       { label: 'access-policy checks passed', kind: 'gate', worse: 'lower' },
  'policy.failed':       { label: 'access-policy checks failed', kind: 'gate', ceiling: 0 },
  'policy.perturb':      { label: 'access-policy PERTURB self-test detects corruption', kind: 'gate', mustBe: true },
  'restore.identical':   { label: 'state byte-identical across restart', kind: 'gate', mustBe: true },
  'restore.failed':      { label: 'restore-fidelity checks failed', kind: 'gate', ceiling: 0 },

  'gc.growth':           { label: 'per-message cost growth over 50 slots', kind: 'gate', worse: 'higher', tol: 0.40, floor: 0.20, ceiling: 1.50, unit: 'x' },
  'gc.first10ms':        { label: 'first-10 message avg', kind: 'record', unit: 'ms' },
  'gc.last10ms':         { label: 'last-10 message avg', kind: 'record', unit: 'ms' },
  'trie.hitScaling':     { label: 'trie point-lookup scaling, max keys / min keys', kind: 'gate', worse: 'higher', tol: 0.30, floor: 0.25, ceiling: 2.0, unit: 'x' },
  'trie.hitMs':          { label: 'trie point-lookup at the largest key count', kind: 'record', unit: 'ms' },
  'trie.updateMs':       { label: 'trie single-key update at the largest key count', kind: 'record', unit: 'ms' },
}

const measured: Record<string, number | string | boolean> = {}
/** Full surface lists, kept out of `metrics` so a mismatch can be reported BY NAME. */
const surfaces: { opts?: string[], devices?: string[] } = {}
/** The loaded baseline, needed inside a phase rather than only at report time. */
let baselineRef: any = null
const metric = (k: string, v: number | string | boolean) => {
  if (!METRICS[k]) throw new Error(`undeclared metric ${k} — add it to METRICS with a gate policy`)
  measured[k] = v
}

// ==================================================================== plumbing

type State = 'PASS' | 'FAIL' | 'ERROR' | 'SKIP'
interface Result { id: string, label: string, state: State, detail: string, secs: number, skipKind?: 'mode' | 'selection' }
const results: Result[] = []
const record = (id: string, label: string, state: State, detail: string, secs = 0, skipKind?: 'mode' | 'selection') => {
  results.push({ id, label, state, detail, secs, skipKind })
  const mark = { PASS: 'PASS ', FAIL: 'FAIL ', ERROR: 'ERROR', SKIP: 'skip ' }[state]
  console.log(`  ${mark} ${label}${detail ? ' — ' + detail : ''}${secs ? `  (${secs.toFixed(1)}s)` : ''}`)
}

interface Ran { code: number, out: string }

/**
 * Run a subprocess, capturing stdout+stderr together (metrics are parsed out of them) while
 * optionally teeing to the console. execFileSync would be simpler but blocks with no output for
 * the twenty minutes the e2e phase takes, which reads as a hang.
 */
function run (cmd: string, args: string[], o: { cwd?: string, env?: Record<string, string>, timeoutS?: number, log?: string } = {}): Promise<Ran> {
  return new Promise<Ran>(resolve => {
    const p = spawn(cmd, args, {
      cwd: o.cwd ?? AO,
      env: { ...process.env, ...(o.env ?? {}) },
    })
    let out = ''
    const timer = setTimeout(() => { p.kill('SIGKILL'); out += `\n[qualify-node] TIMEOUT after ${o.timeoutS}s\n` },
      (o.timeoutS ?? 1800) * 1000)
    const take = (b: Buffer) => { const s = b.toString(); out += s; if (STREAM) process.stdout.write(s) }
    p.stdout.on('data', take)
    p.stderr.on('data', take)
    p.on('error', e => { clearTimeout(timer); resolve({ code: 127, out: out + String(e) }) })
    p.on('close', code => { clearTimeout(timer); resolve({ code: code ?? 1, out }) })
  }).then(r => {
    if (o.log) logged(o.log, r.out)
    return r
  })
}

/** Synchronous engine call for the short container-control commands. */
const engine = (args: string[], timeoutS = 120) =>
  execFileSync(ENGINE, args, { encoding: 'utf8', timeout: timeoutS * 1000, maxBuffer: 64 * 1024 * 1024 })

/**
 * Write a subprocess's full output where it can be read, and return a tail worth printing.
 *
 * Called on EVERY subprocess, not only failing ones. run-e2e writes its logs on failure alone,
 * which means a green run leaves the previous run's files sitting there looking current — that has
 * cost real diagnosis time. Here the log directory is wiped at startup and every phase writes, so
 * a file's presence means this run produced it and a suspiciously fast pass can be audited instead
 * of being taken on trust.
 */
function logged (id: string, out: string): string {
  let tail = out.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300)
  try {
    fs.mkdirSync(LOGDIR, { recursive: true })
    const f = path.join(LOGDIR, `${id}.log`)
    fs.writeFileSync(f, out)
    tail += `  [full: ${path.relative(AO, f)}]`
  } catch { /* diagnostics are best-effort; never mask the original failure */ }
  return tail
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Parse one number out of a subprocess's output, or throw — an absent line must never read as 0. */
function must (out: string, re: RegExp, what: string): string {
  const m = out.match(re)
  if (!m) throw new Error(`could not find ${what} in the output — the upstream script's format changed; ` +
    `fix the pattern in qualify-node.ts rather than letting the metric silently vanish`)
  return m[1]
}

// ==================================================================== node opt readers
//
// Reading opts back is not `accept: application/json` on /~meta@1.0/info. That renders the
// message, and list-valued opts come back as `+link` POINTERS whose hashes are not the content —
// so `faff-allow-list` and `p4-non-chargable-routes` read as undefined and a perfectly healthy
// node looks like it silently dropped its entire access policy. (That false positive is exactly
// what this driver reported on its first run.) The shape knowledge below is verify-access-policy's,
// kept in step with it deliberately: the two are the only readers of this surface.
//
//   scalars   exist ONLY as keys of the top-level info message; `/info/<key>` alone 500s
//   lists     serialize as {"1": "0xAbC…"} for scalar entries and {"1+link": "<hash>"} for
//             message entries, which must be fetched per index
const optJson = async (base: string, key: string): Promise<any> => {
  try {
    const r = await fetch(`${base}/~meta@1.0/info/${key}/serialize~json@1.0`, { signal: AbortSignal.timeout(30_000) })
    if (!r.ok) return undefined
    return JSON.parse(await r.text())
  } catch { return undefined }
}

const infoJson = async (base: string): Promise<any> => {
  const r = await fetch(`${base}/~meta@1.0/info/serialize~json@1.0`, { signal: AbortSignal.timeout(30_000) })
  if (!r.ok) throw new Error(`/~meta@1.0/info returned ${r.status}`)
  return JSON.parse(await r.text())
}

const optList = async (base: string, key: string): Promise<any[]> => {
  const container = await optJson(base, key)
  if (!container || typeof container !== 'object') return []
  const entries = Object.keys(container)
    .filter(k => /^\d+(\+link)?$/.test(k))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  return Promise.all(entries.map(k =>
    k.endsWith('+link') ? optJson(base, `${key}/${parseInt(k, 10)}`) : Promise.resolve(container[k])))
}

// ==================================================================== phases

interface Ctx {
  url: string
  modules: Record<string, string>
  container: string | null
}

interface Phase {
  id: string
  label: string
  modes: Array<'image' | 'url'>
  /** Return a reason to SKIP, or null to run. Reported as SKIP, never as a silent pass. */
  skipReason?: () => string | null
  /** false for phases that read the image without running it — lets `--only toolchain` skip the boot */
  needsNode?: boolean
  /** true if the phase SPAWNS PROCESSES OR WRITES on the node it is pointed at */
  writes?: boolean
  run: (c: Ctx) => Promise<string>
}

const MODE: 'image' | 'url' = IMAGE ? 'image' : 'url'

// In --image mode the node is a container this process just created and will destroy, so writing to
// it is free. In --url mode it is somebody's node, and several phases are not observers: `smoke`
// spawns a process, `verticals` spawns seven and drives real rounds, `economics` sends 50 writes to
// a ~1 MB seeded registry and seeds a 20,000-key trie. Pointed at stage or live that is real state
// on a production scheduler, permanently, at that node's expense.
//
// So a remote URL runs the read-only phases by default and refuses the rest unless the caller says
// out loud that it meant to. Loopback is exempt: that is a local node under the caller's control.
const REMOTE = MODE === 'url' && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(URL_ARG)
const ALLOW_REMOTE_WRITES = flag('--allow-remote-writes')

const PHASES: Phase[] = [
  // ---------------------------------------------------------------- toolchain
  {
    id: 'toolchain',
    label: 'image provenance + toolchain versions',
    modes: ['image'],
    needsNode: false,
    run: async () => {
      const sh = (script: string) =>
        engine(['run', '--rm', '--entrypoint', 'sh', IMAGE, '-c', script], 300).trim()

      const upstream = sh('git -C /app rev-parse HEAD')
      const patchSha = sh('git -C /app diff | sha256sum').split(/\s+/)[0]
      const patchFiles = sh('git -C /app diff --name-only | sort | tr "\\n" " "').trim() || '(none — VANILLA)'
      const luerl = sh('sed -n "s/.*{<<\\"luerl\\">>,{pkg,<<\\"luerl\\">>,<<\\"\\([^\\"]*\\)\\">>}.*/\\1/p" /app/rebar.lock | head -1')
      const erts = sh('ls -d /app/_build/default/rel/hb/erts-* | head -1 | sed "s/.*erts-//"')

      metric('toolchain.upstream', upstream)
      metric('toolchain.patchSha', patchSha)
      metric('toolchain.patchFiles', patchFiles)
      metric('toolchain.luerl', luerl)
      metric('toolchain.erts', erts)

      // spec/run-tier2.sh runs scenarios inside LUERL_IMAGE, pinned to "the exact luerl
      // HyperBEAM v0.9-FINAL pins in its rebar.lock". If the image under test moved off that
      // version, Tier-2 is exercising a VM we do not ship and its green is meaningless.
      const pin = (process.env.LUERL_IMAGE || 'anyone-luerl:1.3.0').split(':').pop()
      const agrees = pin === luerl
      metric('toolchain.tier2Pin', agrees)
      if (!agrees) {
        throw new Error(`image ships luerl ${luerl} but spec/run-tier2.sh pins LUERL_IMAGE=…:${pin}. ` +
          `Build anyone-luerl:${luerl} and re-pin run-tier2.sh, or Tier-2 tests a VM this image does not run.`)
      }
      return `upstream ${upstream.slice(0, 12)}  luerl ${luerl}  erts ${erts}  patches [${patchFiles.trim()}] sha ${patchSha.slice(0, 12)}`
    },
  },

  // ---------------------------------------------------------------- tier-2 conformance
  {
    id: 'tier2',
    label: 'tier-2 luerl conformance scenarios',
    modes: ['image', 'url'],
    // Runs in the pinned luerl container, not the node — but `toolchain` has already asserted
    // that pin equals the version the image ships, which is what makes this a statement about
    // the image rather than about some other VM. Run the two together or neither.
    needsNode: false,
    run: async () => {
      const r = await run('spec/run-tier2.sh', [], { timeoutS: 3600, log: 'tier2' })
      const m = r.out.match(/Tier-2:\s*(\d+) passed,\s*(\d+) failed,\s*(\d+) errored across (\d+) scenarios/)
      if (!m) throw new Error(`run-tier2.sh printed no summary line — ${logged('tier2', r.out)}`)
      metric('tier2.passed', Number(m[1]))
      metric('tier2.failed', Number(m[2]) + Number(m[3]))
      metric('tier2.scenarios', Number(m[4]))
      if (r.code !== 0) throw new Error(`${m[0]} — ${logged('tier2', r.out)}`)
      return m[0]
    },
  },

  // ---------------------------------------------------------------- identity
  {
    id: 'identity',
    label: 'node identity + device surface',
    modes: ['image', 'url'],
    run: async (c) => {
      const info = await infoJson(c.url)
      const addr = String(info?.address || info?.Address || '')
      if (!/^[A-Za-z0-9_-]{43}$/.test(addr)) throw new Error(`no operator address in ~meta@1.0/info: ${JSON.stringify(info).slice(0, 200)}`)

      // The lua device is the compute method for every process we run, and ~process@1.0 is what
      // routes to it. Their absence is the one failure that makes every later phase fail for the
      // same uninformative reason, so it is caught here.
      //
      // Detected by resolving the device rather than by reading the preloaded-devices list: that
      // list renders as `+link` pointers, so the names are not in it.
      //
      // THREE outcomes, not two. A loadable device answers /~<device>/info with 200 and an absent
      // one 500s with `device_not_loadable` — but on a locked-down node the request never reaches
      // the node at all: stage and live answer 403 from nginx, because D3 makes the edge the sole
      // control for unsigned traffic and `/~lua@5.3a` is not on its whitelist. Reading that 403 as
      // "the device is missing" failed a perfectly healthy stage node on the first --url run.
      //
      // So the gate asserts the falsifiable claim — no load-bearing device REPORTED itself
      // unloadable — and an unaskable probe is reported as unproven rather than counted either way.
      const deviceState = async (dev: string): Promise<'loadable' | 'absent' | string> => {
        const r = await fetch(`${c.url}/~${dev}/info`, { headers: { accept: 'application/json' } })
        if (r.status === 200) return 'loadable'
        const body = (await r.text()).slice(0, 500)
        if (/device_not_loadable|module_not_admissable/.test(body)) return 'absent'
        return `unproven (HTTP ${r.status})`
      }
      const devices = { 'lua@5.3a': await deviceState('lua@5.3a'), 'process@1.0': await deviceState('process@1.0') }
      const absent = Object.entries(devices).filter(([, v]) => v === 'absent').map(([k]) => k)
      const unproven = Object.entries(devices).filter(([, v]) => v !== 'loadable' && v !== 'absent')
      metric('identity.luaDevice', absent.length === 0)
      metric('identity.devicesProven', Object.values(devices).filter(v => v === 'loadable').length)
      if (absent.length) throw new Error(`${absent.join(' and ')} report device_not_loadable — nothing can compute`)

      // A `.flat` config is parsed as `key: value` with NO comment syntax, so a `#` line that
      // happens to contain a colon becomes a real opt named after the comment text — silently.
      // This caught two junk opts in this repo's own fixture on 2026-08-26. Assert the absence
      // rather than trusting review, because the node reports it as ordinary configuration.
      const junk = Object.keys(info).filter(k => k.trim().startsWith('#'))
      metric('identity.noCommentOpts', junk.length)
      if (junk.length) throw new Error(`the node loaded ${junk.length} opt(s) derived from CONFIG COMMENTS: ` +
        `${junk.map(k => JSON.stringify(k.slice(0, 60))).join(', ')}. A .flat config has no comment syntax.`)

      // A 404 at / was a real production symptom (missing node-host). Any 2xx/3xx is fine; the
      // check is that the node answers rather than which renderer it chose.
      const root = await fetch(`${c.url}/`, { redirect: 'manual' })
      metric('identity.rootServed', root.status !== 404)
      if (root.status === 404) throw new Error('root path 404s — node-host is probably unset (see hyperbeam operations README)')

      const devNote = unproven.length
        ? `devices UNPROVEN (${unproven.map(([k, v]) => `${k}: ${v}`).join(', ')} — an edge is refusing the probe)`
        : 'lua@5.3a + process@1.0 loadable'
      return `operator ${addr.slice(0, 12)}…  ${devNote}  root ${root.status}  no comment-derived opts`
    },
  },

  // ---------------------------------------------------------------- observable build surface
  {
    id: 'fingerprint',
    label: 'observable build surface (opts + devices)',
    modes: ['image', 'url'],
    run: async (c) => {
      // THE ONLY BUILD EVIDENCE A DEPLOYED NODE CAN GIVE YOU.
      //
      // `toolchain` answers "which build is this?" by reading the image — `git diff` in /app, the
      // rebar.lock, the erts directory. None of that is reachable over HTTP, so against
      // hb-stage or hb-live it is simply unavailable, and asking a node to state its own version
      // is not an option either: HyperBEAM exposes no build string anywhere. (Checked: not in
      // ~meta@1.0/info, not in the ~hyperbuddy@1.0/metrics scrape, which is 5,206 lines of
      // cowboy/erlang_vm/process telemetry and no version label.)
      //
      // What a node WILL tell you is the shape of the build it is running, and two independent
      // parts of that shape survive the locked-down edge on stage and live:
      //
      //   opt surface     every key hb_opts.erl knows about, read off the info map. Changes
      //                   whenever upstream adds, removes or renames an option.
      //   device surface  every preloaded device NAME, enumerated through the `+link` pointers
      //                   under preloaded-devices. Changes whenever the device table changes.
      //
      // Measured 2026-08-26: the qualified image and all three deployed nodes agree exactly —
      // 67 build-default opts (sha 4d2ba896…) and 61 devices (sha 31a35f74…).
      //
      // WHAT THIS PROVES, AND WHAT IT DOES NOT. It proves the node is running the same upstream
      // VERSION FAMILY as the blessed image. It does NOT prove the same image: hb-dev runs
      // 9f6e199b (v0.9-FINAL plus patch 0004) and stage/live run 7e4f2d1e (without it), and they
      // fingerprint identically — correctly, because that patch touches neither opts nor devices.
      // Exact image identity is not observable over HTTP at all; see the note this phase prints.
      const info = await infoJson(c.url)

      // Config-owned keys are subtracted, or this measures our jobspec rather than the build. The
      // local qualification container and stage differ by exactly six such keys (stage sets
      // node-host, faff-allow-list, p4-non-chargable-routes and the rate-limit trio; the local one
      // sets relay-allow-commit-request), and leaving them in makes two identical builds look
      // different. Anything NOT in this list came from hb_opts.erl defaults.
      const CONFIG_OWNED = new Set([
        // set by spec/fixtures/node-qualify.flat and node-qualify-policy.json
        'priv_key_location', 'port', 'scheduler-default-commitment-spec', 'relay-allow-commit-request',
        'bundler-ans104', 'node-host', 'on', 'faff-allow-list', 'p4-non-chargable-routes',
        'rate-limit-requests', 'rate-limit-max', 'rate-limit-period',
        // per-node identity and per-request rendering artefacts, not configuration and not build
        'address', 'commitment-device', 'ao-types', 'hb-config-location', 'initialized',
        'node-history', 'identities', 'status',
        // the self-declared image pin described below — configuration, so never a build signal
        'image-digest',
      ])

      const rawKeys = Object.keys(info)
        .filter(k => !k.startsWith('#'))
        .map(k => k.endsWith('+link') ? k.slice(0, -5) : k)
      const buildKeys = [...new Set(rawKeys)].filter(k => !CONFIG_OWNED.has(k)).sort()
      const configOnly = [...new Set(rawKeys)].filter(k => CONFIG_OWNED.has(k)).sort()

      // Device NAMES, not the container's link hashes: the hashes are content addresses of the
      // rendered messages and move with unrelated detail, while the names are the surface.
      //
      // BEST-EFFORT, and it has already stopped working once. On v0.9-FINAL the device list is an
      // enumerable opt; on edge (checked at 14e9f68a, 2026-08-26) `preloaded-devices` does not
      // exist at all — upstream moved preloaded devices into a prebuilt LMDB store, which shows up
      // as the new `preloaded-store` opt (hb_store_lmdb, _build/preloaded-store, read-only). The
      // names are simply not exposed over HTTP on that build. Nor can they be probed one by one
      // through a locked edge, since /~<device>/info is not on the nginx whitelist.
      //
      // So this reports unavailability with the real reason instead of throwing. The opt surface
      // above is the fingerprint that works everywhere; this is a second signal when it is offered.
      let names: string[] = []
      let deviceWhy = ''
      const container = await optJson(c.url, 'preloaded-devices')
      const idx = Object.keys(container ?? {})
        .map(k => k.split('+')[0])
        .filter(k => /^\d+$/.test(k))
        .map(Number)
        .sort((a, b) => a - b)
      if (!container) {
        deviceWhy = buildKeys.includes('preloaded-store')
          ? 'this build has no `preloaded-devices` opt; devices live in the `preloaded-store` LMDB store and are not enumerable over HTTP'
          : 'the `preloaded-devices` opt did not resolve'
      } else if (!idx.length) {
        deviceWhy = '`preloaded-devices` resolved but exposes no indexed entries'
      } else {
        // Sequential on purpose: this is ~61 requests, and against a remote node behind an edge a
        // burst is both rude and a good way to meet the rate limiter we configured ourselves.
        for (const i of idx) {
          const m = await optJson(c.url, `preloaded-devices/${i}`)
          if (m?.name) names.push(String(m.name))
        }
        names.sort()
        if (!names.length) deviceWhy = 'indexed entries resolved but carried no `name` (an edge may be refusing the per-index reads)'
      }

      const sha = (xs: string[]) => crypto.createHash('sha256').update(xs.join('\n')).digest('hex').slice(0, 16)
      metric('fingerprint.optSurface', sha(buildKeys))
      metric('fingerprint.optCount', buildKeys.length)
      // Never hash an empty list into a real-looking sha: '(not enumerable)' cannot be mistaken
      // for agreement with a baseline that recorded actual devices.
      metric('fingerprint.deviceSurface', names.length ? sha(names) : '(not enumerable)')
      metric('fingerprint.deviceCount', names.length)
      metric('fingerprint.configOnly', configOnly.length)
      surfaces.opts = buildKeys
      surfaces.devices = names

      // Name what moved. A bare hash mismatch is undiagnosable, and the most likely cause of one
      // is not a different build at all — it is an environment setting an opt that CONFIG_OWNED
      // above does not list yet.
      const prev = (baselineRef?.surfaces ?? {}) as { opts?: string[], devices?: string[] }
      const diffs: string[] = []
      for (const [what, now, before] of [['opt', buildKeys, prev.opts], ['device', names, prev.devices]] as const) {
        if (!before) continue
        // Do NOT diff devices we could not enumerate. Otherwise a build that simply stopped
        // exposing the list reports every device in the baseline as GONE — 61 of them on the
        // first edge run — which reads as a catastrophic removal instead of what it is.
        if (what === 'device' && deviceWhy) continue
        const added = now.filter(k => !before.includes(k))
        const gone = before.filter(k => !now.includes(k))
        if (added.length) diffs.push(`${what}s ADDED since the baseline: ${added.join(', ')}`)
        if (gone.length) diffs.push(`${what}s GONE since the baseline: ${gone.join(', ')}`)
      }
      // WHETHER A CHANGED SURFACE IS A FAILURE DEPENDS ON THE QUESTION BEING ASKED.
      //
      //   --image  you are qualifying a CANDIDATE. A different surface is the expected state of
      //            affairs, exactly as it is for toolchain.*, so it is reported in full and the
      //            phase passes. --record-baseline then blesses it.
      //   --url    you are asking whether a DEPLOYED node is the build you already blessed. A
      //            different surface is the answer 'no', so it fails.
      //
      // Both print the same diff, by name. Only the verdict differs.
      const surfaceChanged = diffs.length > 0
      if (surfaceChanged && MODE === 'url') {
        throw new Error(diffs.join(' | ') +
          ' — if these are configuration keys rather than upstream ones, add them to CONFIG_OWNED in this phase')
      }
      if (surfaceChanged) for (const d of diffs) console.log(`    ${d}`)
      if (deviceWhy) console.log(`    devices NOT enumerable: ${deviceWhy}`)

      // THE PIECE HTTP CANNOT GIVE YOU, and the cheap way to get it anyway.
      //
      // Nothing above distinguishes two builds of the same upstream version that differ only in
      // our patches, because those patches change neither opts nor devices. The exact image is
      // simply not observable from outside the container.
      //
      // It becomes observable if the jobspec declares it. Adding one line to config.json next to
      // the image pin —
      //
      //     "image-digest": "sha256:7e4f2d1e…"
      //
      // — makes the node report it at /~meta@1.0/info/image-digest, and because HyperBEAM reads
      // its config at BOOT, what it reports is the digest the RUNNING process started with. That
      // catches the failure this whole question is really about: the pin was updated and the
      // allocation never actually cycled, so the new image was never running.
      //
      // It is self-asserted and says so: it proves the declared pin and the running process agree,
      // not that the bytes match. Chained with the surfaces above and, where writes are allowed,
      // the behavioural probes, that is a real answer. Without it, a run says so out loud rather
      // than implying an identity it did not check.
      const declared = info['image-digest'] ? String(info['image-digest']) : ''
      metric('fingerprint.digestDeclared', declared ? 'declared' : 'NOT DECLARED')
      if (declared && baselineRef?.image?.digest && declared !== baselineRef.image.digest) {
        throw new Error(`node declares image-digest ${declared} but the baseline blessed ` +
          `${baselineRef.image.digest}. Three things cause this and they are not equally bad: the ` +
          `allocation is running an image nobody qualified; the pin was changed without cycling the ` +
          `allocation; or config.json's image-digest has drifted from the config block's image line, ` +
          `which are ~40 lines apart in the jobspec and are not derived from one another. Check the ` +
          `jobspec's two literals agree BEFORE concluding anything about the running node.`)
      }

      const devicePart = names.length ? `${names.length} devices (${sha(names)})` : 'devices not enumerable'
      const verdict = surfaceChanged
        ? '  — build surface DIFFERS from the baseline (see above); expected when qualifying a new version'
        : MODE === 'url'
          ? (declared
              ? '  — surfaces AND the declared image pin match the blessed baseline'
              : '  — same VERSION FAMILY as the baseline; the exact image is NOT proven (no image-digest declared in config.json)')
          : ''
      return `${buildKeys.length} build opts (${sha(buildKeys)})  ·  ${devicePart}` + verdict
    },
  },

  // ---------------------------------------------------------------- config surface
  {
    id: 'config',
    label: 'production opt surface actually in force',
    modes: ['image'],
    // Boots its OWN container against the policy config; the open one is irrelevant to it.
    needsNode: false,
    run: async () => {
      const policy = path.join(AO, 'spec/fixtures/node-qualify-policy.json')
      const wanted = JSON.parse(fs.readFileSync(policy, 'utf8'))
      const port = PORT + 1
      try { engine(['rm', '-f', POLICY_CONTAINER]) } catch { /* not running */ }
      engine(['run', '-d', '--name', POLICY_CONTAINER,
        '-p', `${port}:8734`,
        '-e', 'HB_ALLOW_EPHEMERAL_WALLET=true',
        '-e', 'HB_CONFIG=/app/_build/default/rel/hb/config.flat,/app/_build/default/rel/hb/config.json',
        '-v', `${path.join(AO, 'spec/fixtures/node-qualify.flat')}:/app/_build/default/rel/hb/config.flat:ro,Z`,
        '-v', `${policy}:/app/_build/default/rel/hb/config.json:ro,Z`,
        IMAGE], 300)
      try {
        const base = `http://127.0.0.1:${port}`
        if (!await waitForNode(base, 180)) throw new Error('policy container never became ready')
        const info = await infoJson(base)

        // Walk the production shape and ask, of every key, whether the node has it. Values are
        // placeholders, so what is compared is presence and CARDINALITY — the failure being
        // guarded against is an opt that vanished, not one that holds the wrong address.
        const missing: string[] = []
        const present: string[] = []

        const walk = async (want: any, prefix: string): Promise<void> => {
          for (const [k, v] of Object.entries(want)) {
            const key = prefix ? `${prefix}/${k}` : k
            if (typeof v === 'string' || typeof v === 'number') {
              // Scalars exist only as keys of their containing message.
              const holder = prefix ? await optJson(base, prefix) : info
              const got = holder?.[k]
              if (got === undefined || got === null) missing.push(key)
              else if (String(got) !== String(v)) missing.push(`${key} (=${JSON.stringify(String(got)).slice(0, 40)}, want ${JSON.stringify(v)})`)
              else present.push(key)
            } else if (Array.isArray(v)) {
              const got = await optList(base, key)
              if (got.length !== v.length) missing.push(`${key} (${got.length} entries, want ${v.length})`)
              else present.push(`${key}[${got.length}]`)
            } else if (v && typeof v === 'object') {
              const got = await optJson(base, key)
              if (!got || typeof got !== 'object') { missing.push(`${key} (not a message)`); continue }
              present.push(key)
              await walk(v, key)
            }
          }
        }
        await walk(wanted, '')

        // One depth probe with teeth. `on/request` is a list of MESSAGES, each behind a link, and
        // the p4 entry is where the write gate's whole configuration lives. A shallow "the list is
        // 6 long" check would pass even if every entry had lost its fields, so the p4 entry's own
        // keys are asserted: this is the deepest nesting any environment actually configures.
        const requests = await optList(base, 'on/request')
        // Identified by `pricing-device`, NOT by `device`: the serialize~json device overwrites
        // `device` with its own name on everything it renders, so every entry reads back as
        // "json@1.0" and matching on it finds nothing. `pricing-device` is unique to the p4 entry.
        const p4 = requests.find((r: any) => r && r['pricing-device'] !== undefined)
        const p4Want = ['pricing-device', 'ledger-device', 'module', 'gated-processes', 'operator-registry', 'deploy-wallets']
        if (!p4) missing.push('on/request[p4] (the write-gate entry is absent)')
        else {
          const gone = p4Want.filter(k => p4[k] === undefined && p4[`${k}+link`] === undefined)
          if (gone.length) missing.push(`on/request[p4] lost ${gone.join(', ')}`)
          // The pricing device is the gate. A node that silently reverted to stock faff pricing
          // would keep every key above and still charge nothing.
          else if (p4['pricing-device'] !== 'lua@5.3a') missing.push(`on/request[p4] pricing-device=${p4['pricing-device']}, want lua@5.3a`)
          else present.push(`on/request[p4]{${p4Want.length}}`)
        }

        metric('config.inForce', present.length)
        metric('config.missing', missing.length)
        if (missing.length) {
          throw new Error(`${missing.length} production opt(s) did NOT take effect on this image: ${missing.join(', ')}. ` +
            `hb_opts:get canonicalises _ to -, and an unrecognised key is silently not-found rather than an error ` +
            `— for faff-allow-list that means a node that admits nobody.`)
        }
        return `${present.length} opt paths in force, including the nested p4 write-gate entry`
      } finally {
        if (!KEEP) { try { engine(['rm', '-f', POLICY_CONTAINER]) } catch { /* best effort */ } }
      }
    },
  },

  // ---------------------------------------------------------------- module registration
  {
    id: 'modules',
    label: 'build + publish the three native modules into the node cache',
    modes: ['image'],
    run: async (c) => {
      const specs = [
        { key: 'NATIVE', contract: 'operator-registry', file: 'dist/operator-registry-native.lua' },
        { key: 'RELAY', contract: 'relay-rewards', file: 'dist/relay-rewards-native.lua' },
        { key: 'STAKING', contract: 'staking-rewards', file: 'dist/staking-rewards-native.lua' },
      ]
      const ids: string[] = []
      for (const s of specs) {
        const built = await run('bun', ['run', 'scripts/build-native-bundle.ts', s.contract], { timeoutS: 600, log: `modules-${s.contract}` })
        if (built.code !== 0) throw new Error(`build-native-bundle ${s.contract} failed: ${logged(`modules-${s.contract}`, built.out)}`)
        const id = publishInContainer(c.container!, s.file, `qualify-${s.contract}`)
        c.modules[s.key] = id
        ids.push(`${s.contract}=${id.slice(0, 10)}…`)
      }
      // `surface` and `opreg` are the same operator-registry source, seeded or not — one
      // registration backs both, exactly as run-e2e does it.
      c.modules.OPREG = c.modules.NATIVE
      return ids.join('  ')
    },
  },

  // ---------------------------------------------------------------- smoke
  {
    id: 'smoke',
    label: 'image smoke: spawn, compute, read, write, revert',
    modes: ['image', 'url'],
    writes: true,
    run: async (c) => {
      const { EthereumSigner } = await import('@dha-team/arbundles')
      const { spawnLuaProcess, sendMessage } = await import('./util/hb-client')
      const config = { url: c.url, signer: new EthereumSigner(KEY) } as any

      // A module that keeps a counter in BASE STATE and errors on a poisoned action. Small on
      // purpose: this phase is the fail-fast that runs before the twenty-minute stages, so it
      // must exercise the compute path end to end without depending on any built artifact.
      // Signature and the message.body.action convention match the other probes' contracts.
      // The counter lives on `process` rather than in a Lua upvalue deliberately: an upvalue
      // would additionally depend on snapshot/restore, and a smoke failure should mean "this
      // image cannot compute", not "this image cannot resume".
      //
      // The rejected action goes through pcall rather than a bare error(). Error semantics on
      // hyperbeam are MODULE-OWNED — a raw error() 500s at compute and wedges the process at that
      // slot, so every later push 400s. Our contracts do not do that; they trap and return the
      // unchanged state, and that is the behaviour worth smoke-testing. (Measured on the
      // v0.9-FINAL image, 2026-08-26: a bare error() left the process unable to accept any
      // further message, which is a property of the contract style, not of the image.)
      const src = [
        'function compute(process, message, opts)',
        '  local body = message and message.body or {}',
        '  local action = body.action',
        '  process.count = process.count or 0',
        '  if action == "Boom" then',
        '    local ok = pcall(function() error("qualify-smoke deliberate error") end)',
        '    process.results = { output = { body = "rejected:" .. tostring(ok) } }',
        '    return process',
        '  end',
        '  if action == "Bump" then process.count = process.count + 1 end',
        '  process.results = { output = { body = tostring(process.count) } }',
        '  return process',
        'end',
      ].join('\n')

      let pass = 0, fail = 0
      const ok = (what: string, cond: boolean, detail = '') => {
        if (cond) pass++; else { fail++; console.log(`    FAIL ${what}${detail ? ' — ' + detail : ''}`) }
      }

      const { pid } = await spawnLuaProcess(config, {
        luaSource: src, tags: [{ name: 'name', value: `qualify-smoke-${Date.now()}` }],
      })
      ok('spawn + first compute', !!pid)

      // NO accept header. `accept: application/json` wraps a SCALAR in a full commitment
      // envelope, so this read comes back as kilobytes of signature with the answer buried in a
      // `body` field — and a substring test against that envelope passes for the wrong reasons.
      const readOut = async () => {
        const r = await fetch(`${c.url}/${pid}~process@1.0/now/results/output/body`)
        return (await r.text()).trim()
      }

      await sendMessage(config, { pid, tags: [{ name: 'action', value: 'Bump' }] })
      const one = await readOut()
      ok('write lands and state advances', one === '1', `got ${JSON.stringify(one.slice(0, 60))}`)

      const boom = await sendMessage(config, { pid, tags: [{ name: 'action', value: 'Boom' }] }).catch(() => null)
      const rejected = await readOut()
      ok('a trapped handler error is reported, not fatal', rejected === 'rejected:false',
        `got ${JSON.stringify(rejected.slice(0, 60))} boom=${boom ? 'accepted' : 'refused'}`)

      await sendMessage(config, { pid, tags: [{ name: 'action', value: 'Bump' }] })
      const two = await readOut()
      ok('state survived the rejection and the VM still computes', two === '2', `got ${JSON.stringify(two.slice(0, 60))}`)

      metric('smoke.failed', fail)
      if (fail) throw new Error(`${fail} smoke check(s) failed`)
      return `${pass} checks, pid ${pid.slice(0, 12)}…`
    },
  },

  // ---------------------------------------------------------------- trie survives an upgrade
  //
  // 🚨 THE ONLY PHASE THAT TESTS AN UPGRADE RATHER THAN AN IMAGE. Every other phase boots the
  // candidate clean, so all of them pass an image that cannot continue the processes we are
  // already running. That gap cost us operator-registry on stage AND live on 2026-08-28:
  // v0.9-FINAL -> 14e9f68a moved devices out of compiled beams into the LMDB preloaded-store, and
  // the first message afterwards that WROTE `~trie@1.0` failed with
  // `Erlang error while running Lua: undef`, wedging the process permanently. Reproduced on
  // UNPATCHED images, so it is upstream, not our patches.
  //
  // What makes it easy to miss, and why the check has to be shaped exactly like this:
  //   - a READ of the trie succeeds across the boundary;
  //   - a WRITE that grants nothing (`prev == addr`) also succeeds;
  //   - only a write that actually grants fails. So the probe must build trie state on the OLD
  //     image, cross, and then GRANT.
  //   - `as/` keeps serving the last computed state with HTTP 200 throughout, so only `now/`
  //     reveals it.
  //
  // Verified to discriminate: exit 1 on the known-bad v0.9-FINAL -> 14e9f68a crossing, exit 0 on
  // a same-image control.
  {
    id: 'trie-crossing',
    label: 'existing processes survive the upgrade (trie write across images)',
    modes: ['image'],
    needsNode: false,
    writes: false,
    skipReason: () => FROM_IMAGE
      ? null
      : 'no --from-image: pass the CURRENTLY DEPLOYED image to test that this one can continue its processes',
    run: async () => {
      const r = await run('bun', ['run', 'scripts/probe/opreg-wedge-repro.ts',
        '--history', '3', '--expect-healthy', '--from-image', FROM_IMAGE!],
        { env: { IMAGE: IMAGE!, CONTAINER_ENGINE: ENGINE }, timeoutS: 1800, log: 'trie-crossing' })
      metric('trieCrossing.from', FROM_IMAGE!.slice(-16))
      if (r.code !== 0) {
        throw new Error('a process whose trie was written by the deployed image CANNOT be ' +
          `continued by this one — upgrading would wedge it permanently. ${logged('trie-crossing', r.out)}`)
      }
      return 'granting write survives the crossing'
    },
  },

  // ---------------------------------------------------------------- contract verticals
  {
    id: 'verticals',
    label: 'contract verticals (run-e2e)',
    modes: ['image', 'url'],
    writes: true,
    run: async (c) => {
      const env: Record<string, string> = { HB_URL: c.url, E2E_PRIVATE_KEY: KEY, CONTAINER_ENGINE: ENGINE }
      for (const [k, v] of Object.entries(c.modules)) env[`MODULE_ID_${k}`] = v
      const args = ['run', 'scripts/run-e2e.ts', '--keep-artifacts']
      // In url mode the ids must come from the environment; run-e2e reports its own ERROR if
      // they are absent, which is clearer than anything this driver could say.
      const r = await run('bun', args, { env, timeoutS: QUICK ? 2400 : 5400, log: 'verticals' })
      const summary = must(r.out, /(\d+ passed, \d+ failed, \d+ errored, \d+ skipped)/, 'the e2e summary line')
      const [p, f, e, s] = summary.match(/\d+/g)!.map(Number)
      metric('verticals.passed', p)
      metric('verticals.failed', f + e)
      metric('verticals.skipped', s)
      if (r.code !== 0) throw new Error(`${summary} — ${logged('verticals', r.out)}`)
      return summary
    },
  },

  // ---------------------------------------------------------------- golden views
  {
    id: 'golden',
    label: 'staking view golden (--check)',
    modes: ['image', 'url'],
    writes: true,
    run: async (c) => {
      const mod = c.modules.STAKING || process.env.MODULE_ID_STAKING
      if (!mod) throw new Error('no staking module id (run the `modules` phase, or set MODULE_ID_STAKING)')
      const r = await run('bun', ['run', 'scripts/staking-view-golden.ts', '--check'],
        { env: { HB_URL: c.url, MODULE_ID: mod, DEPLOYER_PRIVATE_KEY: KEY }, timeoutS: 1800, log: 'golden' })
      // --check is authoritative; a whole-file diff is NOT (re-baselining silently rotates the
      // sampled address set, so two goldens can differ for reasons that are not regressions).
      const diffs = r.code === 0 ? 0 : 1
      metric('golden.failed', diffs)
      if (r.code !== 0) throw new Error(logged('golden', r.out))
      return 'every view matches the recorded golden'
    },
  },

  // ---------------------------------------------------------------- economics
  {
    id: 'economics',
    label: 'version-sensitive cost shape (gc curve + trie scaling)',
    modes: ['image', 'url'],
    writes: true,
    run: async (c) => {
      const mod = c.modules.NATIVE || process.env.MODULE_ID_NATIVE
      if (!mod) throw new Error('no operator-registry module id (run the `modules` phase, or set MODULE_ID_NATIVE)')

      const writes = QUICK ? '15' : '50'
      const gc = await run('bun', ['run', 'scripts/probe/gc-cost-curve.ts'],
        { env: { HB_URL: c.url, MODULE_ID: mod, WRITES: writes, DEPLOYER_PRIVATE_KEY: KEY }, timeoutS: 3600, log: 'economics-gc' })
      if (gc.code !== 0) throw new Error(`gc-cost-curve failed: ${logged('economics-gc', gc.out)}`)
      metric('gc.growth', Number(must(gc.out, /GROWTH\s*:\s*([\d.]+)x/, 'the gc growth ratio')))
      metric('gc.first10ms', Number(must(gc.out, /first-10 avg\s*:\s*(\d+)\s*ms/, 'the gc first-10 average')))
      metric('gc.last10ms', Number(must(gc.out, /last-10 avg\s*:\s*(\d+)\s*ms/, 'the gc last-10 average')))

      const counts = QUICK ? '1000,4000' : '1000,8000,20000'
      const trie = await run('bun', ['run', 'scripts/probe/trie-scale.ts'],
        { env: { HB_URL: c.url, N: counts, DEPLOYER_PRIVATE_KEY: KEY }, timeoutS: 5400, log: 'economics-trie' })
      if (trie.code !== 0) throw new Error(`trie-scale failed: ${logged('economics-trie', trie.out)}`)
      // Rows look like:  " 20000   41231ms     38ms     31ms     29ms     412ms      501ms  ok:…"
      const rows = [...trie.out.matchAll(/^\s*(\d+)\s+(\d+)ms\s+(\d+)ms\s+(\d+)ms\s+(\d+)ms\s+(\d+)ms/gm)]
        .map(m => ({ n: Number(m[1]), hit: Number(m[3]), update: Number(m[5]) }))
      if (rows.length < 2) throw new Error('trie-scale produced fewer than two key counts — cannot compute a scaling ratio')
      rows.sort((a, b) => a.n - b.n)
      const lo = rows[0], hi = rows[rows.length - 1]
      // Guard the ratio's denominator: a sub-millisecond `lo` would make any `hi` look like a
      // catastrophic regression. Floor at 1 ms, which is well below any measured value.
      metric('trie.hitScaling', Number((hi.hit / Math.max(lo.hit, 1)).toFixed(3)))
      metric('trie.hitMs', hi.hit)
      metric('trie.updateMs', hi.update)

      return `gc growth ${measured['gc.growth']}x  ·  trie ${lo.n}->${hi.n} keys: ${lo.hit}->${hi.hit} ms (${measured['trie.hitScaling']}x)`
    },
  },

  // ---------------------------------------------------------------- restore fidelity
  {
    id: 'restore',
    label: 'restore fidelity across a node restart',
    modes: ['image'],
    run: async (c) => {
      const r = await run('bun', ['run', 'scripts/probe/gc-restore-fidelity.ts'],
        { env: { HB_URL: c.url, CONTAINER: c.container!, DEPLOYER_PRIVATE_KEY: KEY, WRITES: QUICK ? '4' : '8' }, timeoutS: 1800, log: 'restore' })
      const summary = must(r.out, /=== (\d+ passed, \d+ failed[^=]*) ===/, 'the restore-fidelity summary')
      const nums = summary.match(/\d+/g)!.map(Number)
      metric('restore.failed', nums[1] + (nums[2] ?? 0))
      metric('restore.identical', /full state BYTE-IDENTICAL across restart/.test(r.out) && r.code === 0)
      if (r.code !== 0) throw new Error(`${summary.trim()} — ${logged('restore', r.out)}`)
      return summary.trim()
    },
  },

  // ---------------------------------------------------------------- access policy
  {
    id: 'policy',
    label: 'access policy against a real environment',
    modes: ['url'],
    run: async () => {
      if (!ENV_NAME) throw new Error('--env dev|stage|live is required for the policy phase (it asserts environment-specific policy)')
      const r = await run('bun', ['run', 'scripts/verify-access-policy.ts', ENV_NAME], { timeoutS: 1200, log: 'policy' })
      const summary = must(r.out, /—\s*(\d+)\/(\d+) checks passed/, 'the access-policy summary')
      const m = r.out.match(/—\s*(\d+)\/(\d+) checks passed/)!
      metric('policy.passed', Number(m[1]))
      metric('policy.failed', Number(m[2]) - Number(m[1]))
      if (r.code !== 0) throw new Error(logged('policy', r.out))

      // The self-test. A policy suite that cannot fail is not evidence, and this one has a
      // built-in way to prove it still can.
      const pert = await run('bun', ['run', 'scripts/verify-access-policy.ts', ENV_NAME], { env: { PERTURB: '1' }, timeoutS: 1200, log: 'policy-perturb' })
      const detects = /PERTURB OK/.test(pert.out)
      metric('policy.perturb', detects)
      if (!detects) throw new Error(`PERTURB did not detect corrupted expectations — ${logged('policy-perturb', pert.out)}`)
      return `${m[1]}/${m[2]} checks passed on ${ENV_NAME}, PERTURB self-test detects corruption`
    },
  },
]

// ==================================================================== container lifecycle

function publishInContainer (container: string, rel: string, label: string): string {
  const inLua = `/tmp/${label}.lua`
  const inId = `/tmp/${label}.id`
  const erl = `
{ok, Script} = file:read_file("${inLua}"),
Msg = hb_message:commit(
  #{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>,
     <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>,
     <<"name">> => <<"${label}">>, <<"body">> => Script },
  #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>),
{ok, _} = hb_cache:write(Msg, #{}),
ok = file:write_file("${inId}", hb_util:id(Msg)).
`.trim().replace(/\n/g, ' ')
  engine(['cp', path.join(AO, rel), `${container}:${inLua}`], 300)
  engine(['exec', container, './bin/hb', 'eval', erl], 600)
  const id = engine(['exec', container, 'cat', inId], 60).trim()
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error(`published id looks wrong: ${JSON.stringify(id.slice(0, 60))}`)
  return id
}

async function waitForNode (base: string, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds; i++) {
    try {
      const r = await fetch(`${base}/~meta@1.0/info`, { signal: AbortSignal.timeout(3000) })
      if (r.ok) return true
    } catch { /* not up yet */ }
    await sleep(1000)
  }
  return false
}

async function startContainer (): Promise<string> {
  try { engine(['rm', '-f', CONTAINER]) } catch { /* not running */ }
  console.log(`  starting ${CONTAINER} from ${IMAGE} on port ${PORT}…`)
  engine(['run', '-d', '--name', CONTAINER,
    '-p', `${PORT}:8734`,
    '-e', 'HB_ALLOW_EPHEMERAL_WALLET=true',
    '-v', `${path.join(AO, 'spec/fixtures/node-qualify.flat')}:/app/_build/default/rel/hb/config.flat:ro,Z`,
    IMAGE], 900)
  const base = `http://127.0.0.1:${PORT}`
  if (!await waitForNode(base, 300)) {
    // The container's own log is the only thing that explains this, and it is long — put it
    // where it can be read rather than inlining a screenful into an exception message.
    const logs = (() => { try { return engine(['logs', CONTAINER], 120) } catch (e: any) { return String(e?.stdout || e) } })()
    throw new Error(`container never became ready after 300s — ${logged('boot', logs)}`)
  }
  return base
}

// ==================================================================== baseline comparison

interface Baseline {
  recorded: string
  mode: string
  image: { ref: string, digest: string } | null
  host: { platform: string, arch: string, cpus: number, note: string }
  phases: Record<string, State>
  metrics: Record<string, number | string | boolean>
  /** Full opt/device name lists, so a fingerprint mismatch can be reported by NAME, not by hash. */
  surfaces?: { opts?: string[], devices?: string[] }
}

const pct = (now: number, base: number) => base === 0 ? (now === 0 ? '0%' : 'n/a') : `${now >= base ? '+' : ''}${(((now - base) / base) * 100).toFixed(1)}%`

interface Cmp { key: string, base: any, now: any, kind: MetricKind, verdict: 'ok' | 'REGRESSED' | 'new' | 'changed' | 'ABSENT', why: string }

/** Which phase is expected to emit a metric, so a vanished one can be attributed. */
const ownerOf = (key: string): string => {
  const p = key.split('.')[0]
  if (p === 'gc' || p === 'trie') return 'economics'
  return p
}

function compare (baseline: Baseline | null): Cmp[] {
  const out: Cmp[] = []

  // A metric the baseline has and this run does not is a hole in the evidence, and the summary's
  // pass/fail counts cannot show it — the phase can go green while quietly no longer measuring
  // the thing. Attribute it: if the owning phase was SKIPPED that is already reported, but if it
  // PASSED without emitting, the extraction broke and the run must not read as a comparison.
  for (const key of Object.keys(baseline?.metrics ?? {})) {
    if (key in measured) continue
    const owner = ownerOf(key)
    const ph = results.find(r => r.id === owner)
    // Three reasons a baseline metric can be missing, and they mean different things:
    //   the phase was skipped   -> already reported as a skip; nothing further to say
    //   the phase FAILED        -> a consequence of that failure, not a second finding
    //   the phase PASSED anyway -> the extraction broke, and the run must not read as a
    //                              comparison it did not actually make
    const st = ph?.state
    out.push({
      key, base: baseline!.metrics[key], now: undefined, kind: METRICS[key]?.kind ?? 'record',
      verdict: st === 'PASS' ? 'REGRESSED' : 'ABSENT',
      why: !ph || st === 'SKIP' ? `phase ${owner} did not run`
        : st === 'PASS' ? `phase ${owner} passed but stopped emitting this metric`
          : `phase ${owner} failed before emitting it`,
    })
  }

  for (const [key, v] of Object.entries(measured)) {
    const m = METRICS[key]
    const base = baseline?.metrics?.[key]
    let verdict: Cmp['verdict'] = 'ok'
    let why = ''

    if (m.kind === 'identity') {
      if (base === undefined) { verdict = 'new'; why = 'not in baseline' }
      else if (String(base) !== String(v)) { verdict = 'changed'; why = 'differs from baseline' }
      out.push({ key, base, now: v, kind: m.kind, verdict, why })
      continue
    }

    if (m.kind === 'record') {
      why = typeof v === 'number' && typeof base === 'number' ? pct(v, base) : (base === undefined ? 'not in baseline' : '')
      out.push({ key, base, now: v, kind: m.kind, verdict: 'ok', why })
      continue
    }

    // gate
    // mustMatchBaseline gates only when validating a DEPLOYMENT. When qualifying an image the
    // surface is expected to move, so it is reported like an identity metric instead.
    if (m.mustMatchBaseline && base !== undefined && String(base) !== String(v)) {
      if (MODE === 'url') { verdict = 'REGRESSED'; why = 'differs from the blessed baseline' }
      else { verdict = 'changed'; why = 'differs from baseline (expected when qualifying a new version)' }
    }
    else if (m.mustBe !== undefined && v !== m.mustBe) { verdict = 'REGRESSED'; why = `must be ${m.mustBe}` }
    else if (m.ceiling !== undefined && typeof v === 'number' && v > m.ceiling) { verdict = 'REGRESSED'; why = `exceeds hard ceiling ${m.ceiling}` }
    else if (base === undefined) { verdict = 'new'; why = 'not in baseline' }
    else if (typeof v === 'number' && typeof base === 'number' && m.worse) {
      const tol = m.tol ?? 0, floor = m.floor ?? 0
      if (m.worse === 'higher' && v > base * (1 + tol) + floor) { verdict = 'REGRESSED'; why = `${pct(v, base)} vs baseline (band +${(tol * 100).toFixed(0)}%${floor ? ` +${floor}` : ''})` }
      else if (m.worse === 'lower' && v < base * (1 - tol) - floor) { verdict = 'REGRESSED'; why = `${pct(v, base)} vs baseline (band -${(tol * 100).toFixed(0)}%${floor ? ` -${floor}` : ''})` }
      else why = pct(v, base)
    }
    out.push({ key, base, now: v, kind: m.kind, verdict, why })
  }
  return out
}

// ==================================================================== main

;(async () => {
  if (flag('--list')) {
    console.log('\nid           modes        label')
    for (const p of PHASES) console.log(`${p.id.padEnd(12)} ${p.modes.join(',').padEnd(12)} ${p.label}`)
    process.exit(0)
  }
  if (!IMAGE && !URL_ARG) {
    console.error('one of --image <ref> or --url <url> is required.  --list shows the phases.')
    process.exit(2)
  }
  if (IMAGE && URL_ARG) {
    console.error('--image and --url are mutually exclusive: one qualifies an image, the other an existing node.')
    process.exit(2)
  }
  if (RECORD && QUICK) {
    console.error('--quick uses smaller samples and is NOT comparable to a full run; it cannot record a baseline.')
    process.exit(2)
  }

  fs.rmSync(LOGDIR, { recursive: true, force: true })

  let digest = ''
  if (IMAGE) {
    try {
      digest = JSON.parse(engine(['inspect', IMAGE, '--format', '{{json .RepoDigests}}']))?.[0]?.split('@')[1] || ''
    } catch { /* a locally-built image has no repo digest; the patch fingerprint still identifies it */ }
  }

  console.log('\n=== QUALIFY NODE ===')
  console.log(`mode    : ${MODE}`)
  console.log(`target  : ${IMAGE || URL_ARG}${digest ? `\ndigest  : ${digest}` : ''}`)
  console.log(`signer  : ${SIGNER}  (from ${KEY_SOURCE})`)
  if (KEY === BUILTIN_DEV_KEY) {
    console.log('          WARNING: that is the public-repo key, removed from every faff allow-list on 2026-07-30.')
    console.log('          Fine against a throwaway local container; every real node will refuse it, and the')
    console.log('          staking golden will diff on `owner`. Set DEPLOYER_PRIVATE_KEY or E2E_PRIVATE_KEY.')
  }
  console.log(`host    : ${os.platform()}/${os.arch()}, ${os.cpus().length} cpus  —  absolute latencies are host-bound and are RECORDED, never gated`)
  if (QUICK) console.log('sampling: QUICK — smaller economics samples, not comparable to a full baseline')
  if (REMOTE && !ALLOW_REMOTE_WRITES) {
    console.log('writes  : SKIPPED — that URL is a remote node. smoke/verticals/golden/economics spawn')
    console.log('          processes and drive real rounds on whatever they are pointed at. Pass')
    console.log('          --allow-remote-writes to run them there anyway.')
  } else if (REMOTE) {
    console.log('writes  : ENABLED against a REMOTE node (--allow-remote-writes). This will create')
    console.log('          processes and drive rounds on that scheduler, permanently.')
  }

  let baseline: Baseline | null = null
  if (RECORD && fs.existsSync(BASELINE_PATH)) {
    // Loaded for NAMING only: the fingerprint phase reports which opts/devices moved relative to
    // the previous baseline. It is deliberately not assigned to `baseline`, so nothing here gates
    // a recording run against the record it is about to replace.
    try { baselineRef = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) } catch { /* ignore */ }
  }
  if (!RECORD) {
    if (fs.existsSync(BASELINE_PATH)) {
      baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
      baselineRef = baseline
      console.log(`baseline: ${path.relative(AO, BASELINE_PATH)} recorded ${baseline!.recorded}` +
        (baseline!.image?.digest ? ` for ${baseline!.image.digest.slice(0, 19)}…` : ''))
    } else {
      console.log(`baseline: NONE at ${path.relative(AO, BASELINE_PATH)} — every metric will report as \`new\`.`)
      console.log('          Record one against the image production currently runs before trusting a comparison.')
    }
  }

  const ctx: Ctx = { url: URL_ARG, modules: {}, container: null }

  const willRun = (p: Phase) =>
    (!ONLY.length || ONLY.includes(p.id)) && !SKIP.includes(p.id) && p.modes.includes(MODE)
  const needsNode = PHASES.some(p => willRun(p) && p.needsNode !== false)

  let booted = true
  try {
    if (IMAGE && needsNode) {
      console.log('\n[boot]')
      try {
        ctx.url = await startContainer()
        ctx.container = CONTAINER
        record('boot', 'container ready', 'PASS', ctx.url)
      } catch (e: any) {
        // A boot failure is a qualification RESULT — this image does not start — not a crash.
        // Letting it escape produced an unhandled rejection and a stack trace pointing at
        // whichever line the file happened to have, which says nothing about the image.
        booted = false
        record('boot', 'container ready', 'FAIL', String(e?.message || e).slice(0, 400))
      }
    }

    for (const p of PHASES) {
      if (ONLY.length && !ONLY.includes(p.id)) { record(p.id, p.label, 'SKIP', `--only ${ONLY.join(',')}`, 0, 'selection'); continue }
      if (SKIP.includes(p.id)) { record(p.id, p.label, 'SKIP', `--skip ${SKIP.join(',')}`, 0, 'selection'); continue }
      if (!p.modes.includes(MODE)) { record(p.id, p.label, 'SKIP', `${MODE} mode cannot run this phase (needs ${p.modes.join('/')})`, 0, 'mode'); continue }
      if (p.writes && REMOTE && !ALLOW_REMOTE_WRITES) {
        record(p.id, p.label, 'SKIP', 'writes to a REMOTE node — pass --allow-remote-writes to run it there', 0, 'selection')
        continue
      }
      if (p.needsNode !== false && !ctx.url) { record(p.id, p.label, 'SKIP', booted ? 'no node URL' : 'the container failed to boot'); continue }
      const why = p.skipReason?.()
      if (why) { record(p.id, p.label, 'SKIP', why, 0, 'selection'); continue }
      console.log(`\n[${p.id}]`)
      const t0 = performance.now()
      try {
        const detail = await p.run(ctx)
        record(p.id, p.label, 'PASS', detail, (performance.now() - t0) / 1000)
      } catch (e: any) {
        const msg = String(e?.message || e).slice(0, 400)
        record(p.id, p.label, 'FAIL', msg, (performance.now() - t0) / 1000)
      }
    }
  } finally {
    if (IMAGE && needsNode && !KEEP) {
      try { engine(['rm', '-f', CONTAINER]) } catch { /* best effort */ }
      try { engine(['rm', '-f', POLICY_CONTAINER]) } catch { /* best effort */ }
    } else if (KEEP && IMAGE && needsNode) {
      console.log(`\n--keep: ${CONTAINER} left running at ${ctx.url}`)
    }
  }

  // ---------------------------------------------------------------- report

  const cmps = compare(baseline)
  if (cmps.length) {
    console.log('\n=== metrics ===')
    const w = Math.max(...cmps.map(c => c.key.length))
    const fmtv = (v: any) => v === undefined ? '—' : String(v)
    console.log(`${'metric'.padEnd(w)}  ${'baseline'.padStart(12)}  ${'this run'.padStart(12)}  kind      note`)
    for (const c of cmps) {
      const mark = c.verdict === 'REGRESSED' ? 'REGRESSED — ' : c.verdict === 'changed' ? 'CHANGED — '
        : c.verdict === 'ABSENT' ? 'absent — ' : ''
      console.log(`${c.key.padEnd(w)}  ${fmtv(c.base).padStart(12)}  ${fmtv(c.now).padStart(12)}  ${c.kind.padEnd(8)}  ${mark}${c.why}`)
    }
  }

  const n = (s: State) => results.filter(r => r.state === s).length
  const regressed = cmps.filter(c => c.verdict === 'REGRESSED')
  const changed = cmps.filter(c => c.verdict === 'changed')
  const phaseFailed = n('FAIL') + n('ERROR')

  console.log('\n=== summary ===')
  for (const r of results.filter(r => r.state === 'FAIL' || r.state === 'ERROR')) console.log(`  ${r.state}  ${r.id} — ${r.detail}`)
  if (n('SKIP')) {
    console.log(`  ${n('SKIP')} phase(s) SKIPPED — not evidence of anything:`)
    for (const r of results.filter(r => r.state === 'SKIP')) console.log(`      ${r.id} (${r.detail})`)
  }
  if (changed.length) {
    console.log(`\n  This build DIFFERS from the baseline build:`)
    for (const c of changed) console.log(`      ${c.key}: ${c.base} -> ${c.now}`)
    console.log('  That is expected when qualifying a new version; everything above is a cross-version comparison.')
  }
  console.log(`\n${n('PASS')} phases passed, ${phaseFailed} failed, ${n('SKIP')} skipped` +
    `${regressed.length ? `, ${regressed.length} metric(s) REGRESSED` : ''}`)

  // ---------------------------------------------------------------- baseline write

  if (RECORD) {
    // A baseline is a claim that this image is good. Recording one from a run that failed or
    // skipped its way to a small number of green ticks would bake that hole in permanently, and
    // every later comparison would inherit it silently.
    if (phaseFailed || regressed.length) {
      console.error(`\nREFUSING to record a baseline: ${phaseFailed} phase(s) failed, ${regressed.length} metric(s) breached a hard ceiling.`)
      process.exit(1)
    }
    // A phase the current MODE cannot run is not a hole in this baseline — an image baseline is
    // simply not the artefact that records nginx edge behaviour. A phase excluded by --only/--skip
    // IS a hole, and blocks recording unless the caller says it meant to.
    const chosenOut = results.filter(r => r.state === 'SKIP' && r.skipKind === 'selection').map(r => r.id)
    const modeOut = results.filter(r => r.state === 'SKIP' && r.skipKind === 'mode').map(r => r.id)
    if (chosenOut.length && !flag('--record-partial')) {
      console.error(`\nREFUSING to record a baseline with deselected phases: ${chosenOut.join(', ')}.`)
      console.error('Run the full set, or pass --record-partial to record deliberately-partial evidence.')
      process.exit(1)
    }
    const skipped = [...chosenOut, ...modeOut]
    const out: Baseline = {
      recorded: new Date().toISOString(),
      mode: MODE,
      image: IMAGE ? { ref: IMAGE, digest } : null,
      host: {
        platform: os.platform(), arch: os.arch(), cpus: os.cpus().length,
        note: 'Absolute latencies below were measured HERE. They are recorded for context and are ' +
          'never gated — only ratios, counts and identity gate. See METRICS in scripts/qualify-node.ts.',
      },
      phases: Object.fromEntries(results.map(r => [r.id, r.state])),
      metrics: measured,
      surfaces,
    }
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + '\n')
    console.log(`\nbaseline written: ${path.relative(AO, BASELINE_PATH)}` +
      (chosenOut.length ? `  (PARTIAL — deselected: ${chosenOut.join(', ')})` : '') +
      (modeOut.length ? `  (${MODE} mode does not cover: ${modeOut.join(', ')})` : ''))
    process.exit(0)
  }

  const verdict = phaseFailed || regressed.length ? 'NOT QUALIFIED'
    : n('SKIP') ? 'INCOMPLETE — passed what it ran, but did not run everything'
      : 'QUALIFIED'
  console.log(`\n${verdict}`)
  process.exit(phaseFailed || regressed.length ? 1 : 0)
})()
