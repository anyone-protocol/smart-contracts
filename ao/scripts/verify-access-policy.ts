// D3 — prove the "private node, public processes" access policy is actually in force
// on every environment, as a live check rather than a config review.
//
// D3 asks for two enforcement layers and says the edge "must be sufficient on its own",
// so both are checked independently:
//
//   NATIVE   the `on/request` pipeline, faff allow-list, p4 carve-outs and rate-limit
//            opts the node ACTUALLY loaded — read back from /~meta@1.0/info, not from
//            the jobspec. Config that was silently ignored looks identical on disk to
//            config that took effect; only the node can tell you which happened.
//   EDGE     the nginx whitelist, probed from the public internet. A foreign process id
//            and an unrouted path must 403 on stage/live while a whitelisted id does not,
//            which is what makes the edge sufficient standing alone.
//
// Two traps this exists to catch, both of which have already bitten this migration:
//
//   * Opt keys read via hb_opts:get must be lowercase-HYPHENATED (canonical_key maps
//     _ -> -). `faff_allow_list` is not an error — it is silently not-found, which means
//     an EMPTY allow-list, which means faff admits nobody and every deploy breaks. The
//     rate-limit trio is the canary: if those three read back, hyphenation worked.
//   * A config.json `priv_key_location` is stripped by hb_message:convert as private
//     data, so the node mints a FRESH identity. That is invisible until you notice the
//     operator address changed (it happened on 2026-07-16). Asserting the three node
//     addresses are distinct and stable is the standing regression test for it.
//
// The spawn-denial probe is deliberately spawn-PROOF: it signs a DataItem carrying no
// process tags, so faff denies it (expected), and even a broken faff could not create a
// process from a body with no `type: Process`. That is what makes it safe to point at
// live. It also asserts the probe key is NOT in the allow-list first — otherwise an
// allow-listed key would turn the negative test into a silent pass.
//
// Run: bun run scripts/verify-access-policy.ts [dev|stage|live]...   (default: all three)
//      DEPLOYER_PRIVATE_KEY is required for the spawn-denial probe; without it that
//      section is SKIPPED and the run reports as incomplete rather than passing.
//      --dos  additionally exercise the DoS posture (D3's rate-limit + body-cap clause).
//             OPT-IN because it deliberately generates load and trips the limiter for this
//             source IP for a few seconds. Default target is dev only; naming stage or live
//             with --dos is refused unless --dos-force is also given.
import 'dotenv/config'
import crypto from 'crypto'
import { EthereumSigner, createData } from '@dha-team/arbundles/web'
import { computeAddress, getAddress, hexlify } from 'ethers'

// Expected policy per environment, mirroring hyperbeam-{dev,stage,live}.hcl. Kept here
// rather than parsed from the HCL on purpose: this is the independent statement of what
// SHOULD be true, so an unreviewed jobspec edit shows up as a failure instead of being
// read back as its own expectation.
const ENVS = {
  dev: {
    host: 'hb-dev.anyone.tech',
    // Write gate rolled out? Declared, not detected: a node that silently reverted to the old
    // faff pricing device would otherwise read back as its own expectation and pass.
    // Flip per environment as the rollout proceeds (dev -> stage -> live).
    gated: false,
    // Dev's catch-all is deliberately open (standing decision, 2026-07-25) so throwaway
    // test processes are reachable without per-PID whitelist churn. Everything else —
    // faff, p4, rate limits, the Traefik caps — is identical to stage/live.
    edgeLocked: false,
    // 0xa8dC9074… is the workstation dev signer (key only in ao/.env, untracked). It
    // replaced 0xa9A1BdfA… on 2026-07-30: that key's private half is hardcoded in
    // committed scripts in this PUBLIC repo, so allow-listing it let anyone who read the
    // repo spend this node's compute. Do not re-add it here or in the jobspec.
    allowList: [
      '0xa8dC9074D9a11D5b16590cb6eBf50349D38D6BE1',
      '0xFC995EDe0DEE85203DB143314A35468d91583a52',
      '0xc84f421658dabC69Ee0440649f2f17b98D284CCC',
    ],
  },
  stage: {
    host: 'hb-stage.anyone.tech',
    // GATED since 2026-08-16. Flipping this asserts the whole gated posture: pricing-device
    // lua@5.3a, exactly the 3 contract ids in gated-processes, operator-registry set and among
    // them, every gated contract computable HERE with a seeded allowlist, and routes 1-3
    // narrowed to READ_VERBS so /push and /schedule fall through to the gate.
    gated: true,
    edgeLocked: true,
    allowList: [
      '0xFC995EDe0DEE85203DB143314A35468d91583a52',
      '0xc84f421658dabC69Ee0440649f2f17b98D284CCC',
    ],
  },
  live: {
    host: 'hb.anyone.tech',
    gated: false,
    edgeLocked: true,
    allowList: [
      '0xD2ef195d86FC9a7AA8889D163b143d5DA0d7bE65',
      '0xbB232BC269B0F3aB57e5907F414a2b30421fac07',
      '0xc540958396d16533705B4903b990BFFB742Caeb2',
    ],
  },
  // A LOCAL node standing in for a deployed one — so the gated posture can be verified BEFORE
  // it reaches dev. Populated from env vars by scripts/probe/p4-gate-e2e.ts, which renders the
  // same config shape the jobspec does. Only used when explicitly named on the command line.
  local: {
    host: process.env.LOCAL_HOST || 'localhost:8734',
    edgeLocked: false,   // no nginx in front of a local container; edge checks are skipped
    gated: (process.env.LOCAL_GATED ?? 'true') === 'true',
    allowList: (process.env.LOCAL_ALLOW_LIST || '').split(',').filter(Boolean),
  },
} as any
type EnvName = keyof typeof ENVS

// Non-chargable routes 4-6 are the same everywhere; 1-3 render from Consul KV.
// `^/$` is exactly the root path: it is what produces the 307 to /~hyperbuddy@1.0/index, and
// with the gate on a chargeable root request is refused with 400, costing the explorer its
// landing page. That regressed on stage 2026-08-19 because nothing here checked root.
const STATIC_ROUTES = ['^/$', '^/~meta@1.0', '^/~hyperbuddy@1.0', '^/~query@1.0']
const RATE_LIMIT = { 'rate-limit-requests': 100000, 'rate-limit-max': 100000, 'rate-limit-period': 60 }

// PERTURB=1 corrupts the EXPECTATIONS (never the live nodes) and asserts the run then
// fails. A checker of a remote system cannot be tested by breaking the system, so this
// is how we keep it honest: an assertion that has gone vacuous — the empty-list `.every()`
// trap that silently passed an early revision of this file — still passes under
// perturbation, and shows up as a check that failed to fail.
const PERTURB = process.env.PERTURB === '1'
if (PERTURB) {
  STATIC_ROUTES[0] = '^/~nonexistent@9.9'
  RATE_LIMIT['rate-limit-period'] = 61
  for (const e of Object.values(ENVS) as any[]) {
    e.allowList = [...e.allowList.slice(1), '0x0000000000000000000000000000000000000001']
    e.edgeLocked = !e.edgeLocked
    e.gated = !e.gated
  }
}

// An unrelated, well-known AO process. Must never be reachable through a locked edge.
const FOREIGN_PID = 'Sa0iBLPNyJQrwpTTG-tWLQU-1QeUAJlxuTakXQhSPMU'

const argv = process.argv.slice(2)
const dos = argv.includes('--dos')
const dosForce = argv.includes('--dos-force')
const targets = (argv.filter(a => !a.startsWith('--')).length
  ? argv.filter(a => !a.startsWith('--'))
  : Object.keys(ENVS)) as EnvName[]
for (const t of targets) {
  if (!(t in ENVS)) {
    console.error(`usage: verify-access-policy.ts [${Object.keys(ENVS).join('|')}]...`)
    process.exit(2)
  }
}

let fails = 0, checks = 0, skipped = 0
const check = (ok: boolean, label: string, detail = '') => {
  checks++
  if (!ok) fails++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  — ' + detail : ''}`)
}
const skip = (label: string, why: string) => {
  skipped++
  console.log(`  SKIP ${label}  — ${why}`)
}

// A local stand-in node is plain http; the deployed ones are always https behind nginx.
const scheme = (host: string) => (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
const base = (host: string) => `${scheme(host)}://${host}`

const get = async (host: string, path: string) => {
  const res = await fetch(`${base(host)}${path}`, { signal: AbortSignal.timeout(30_000) })
  return { status: res.status, text: await res.text() }
}

/** Read a node opt as JSON via the serialize device. */
const opt = async (host: string, key: string): Promise<any> => {
  const { status, text } = await get(host, `/~meta@1.0/info/${key}/serialize~json@1.0`)
  if (status !== 200) return undefined
  try { return JSON.parse(text) } catch { return undefined }
}

/**
 * Read a list-valued opt.
 *
 * The container serializes its entries two different ways depending on their type:
 *   - SCALARS inline under a plain index — `faff-allow-list` -> {"1":"0xAbC…"}
 *   - MESSAGES as a link id only        — `on/request` -> {"1+link":"<hash>"}
 * Linked entries have to be fetched per index (the hash is not the content), while
 * scalars are NOT addressable that way and 500 if you try. Handle both, or one of the
 * two shapes silently reads back as a list of empty strings.
 */
const listOf = async (host: string, key: string): Promise<any[]> => {
  const container = await opt(host, key)
  if (!container || typeof container !== 'object') return []
  const entries = Object.keys(container)
    .filter(k => /^\d+(\+link)?$/.test(k))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  return Promise.all(entries.map(k =>
    k.endsWith('+link')
      ? opt(host, `${key}/${parseInt(k, 10)}`)
      : Promise.resolve(container[k])
  ))
}

/**
 * Read a scalar opt.
 *
 * Scalars are NOT addressable as sub-paths (`/~meta@1.0/info/rate-limit-period` is a
 * 500); they exist only as keys of the top-level info message. Fetched once per host.
 */
const infoCache = new Map<string, any>()
const info = async (host: string): Promise<any> => {
  if (!infoCache.has(host)) {
    const { text } = await get(host, '/~meta@1.0/info/serialize~json@1.0')
    infoCache.set(host, JSON.parse(text))
  }
  return infoCache.get(host)
}

const statusOf = async (host: string, path: string): Promise<number> => {
  try {
    const res = await fetch(`${base(host)}${path}`, {
      redirect: 'manual', signal: AbortSignal.timeout(30_000),
    })
    return res.status
  } catch { return 0 }
}

// ---------------------------------------------------------------------------

const addresses: Record<string, string> = {}
const pidSets: Record<string, string[]> = {}

for (const env of targets) {
  const { host, allowList, edgeLocked, gated } = ENVS[env]
  console.log(`\n=== ${env}  (${host}) ===`)

  // --- identity -----------------------------------------------------------
  const { status: addrStatus, text: addrRaw } = await get(host, '/~meta@1.0/info/address')
  const address = addrRaw.trim()
  check(addrStatus === 200 && /^[A-Za-z0-9_-]{43}$/.test(address),
    'node reachable, operator address well-formed', address || `HTTP ${addrStatus}`)
  addresses[env] = address

  // --- native: on/request pipeline ---------------------------------------
  const hooks = await listOf(host, 'on/request')
  check(hooks.length === 6, 'on/request has exactly 6 hooks (5 stock + p4)',
    `got ${hooks.length}`)
  const p4 = hooks[5]                     // 0-indexed array…
  const P4_PATH = 'on/request/6'          // …but 1-based over HTTP. See below.
  if (gated) {
    // The gate is the PRICING device; faff stays as the ledger, which a binary gate never
    // consults (dev_p4 short-circuits on both `infinity` and integer 0).
    check(p4?.['pricing-device'] === 'lua@5.3a' && p4?.['ledger-device'] === 'faff@1.0',
      'final hook is p4 with the Lua write gate as pricing device',
      JSON.stringify({ p: p4?.['pricing-device'], l: p4?.['ledger-device'] }))
    // Referenced by module ID, not inlined: content-addressed, so the id pins an exact source
    // and there is no second copy of the gate to drift from runtime/write-gate.lua.
    check(/^[A-Za-z0-9_-]{43}$/.test(String(p4?.module ?? '')),
      'gate is referenced by a 43-char module id', String(p4?.module ?? '(none)'))
    const gatedPids = await listOf(host, `${P4_PATH}/gated-processes`)
    check(gatedPids.length === 3 && gatedPids.every(p => /^[A-Za-z0-9_-]{43}$/.test(String(p))),
      'gate protects exactly the 3 contract ids', gatedPids.join(' '))
    // Without this the operator fallthrough silently never happens: admins and owners keep
    // working on all three contracts, so the node looks healthy while EVERY operator is refused
    // on relay-rewards and staking-rewards.
    const opreg = p4?.['operator-registry']
    check(/^[A-Za-z0-9_-]{43}$/.test(String(opreg ?? '')) && gatedPids.includes(opreg),
      'operator-registry is set and is one of the gated ids', String(opreg ?? '(none)'))
    // COVERAGE — the gate is only meaningful if this node can actually READ the allowlists it
    // gates on. If the gated processes are not computable here, every allowlist read fails, the
    // gate fail-closes, and EVERY behavioural check below passes because everything is refused.
    // Green for entirely the wrong reason. (Hit exactly this on dev, whose routes point at the
    // STAGE contract ids that dev does not host — all three 500.)
    const reachable = await Promise.all(
      gatedPids.map(p => get(host, `/${p}~process@1.0/compute/allowlistId`)))
    check(reachable.every(r => r.status === 200 && /^[A-Za-z0-9_-]{43}$/.test(r.text.trim())),
      'every gated contract is computable HERE and has a seeded allowlist',
      reachable.map(r => r.status).join(' '))

    const deployWallets = await listOf(host, `${P4_PATH}/deploy-wallets`)
    check(deployWallets.length > 0 && deployWallets.every(a => {
      try { return getAddress(String(a)) === a } catch { return false }
    }), 'deploy-wallets is non-empty and EIP-55 (spawns are impossible without it)',
      `${deployWallets.length} entries`)
  } else {
    check(p4?.['pricing-device'] === 'faff@1.0' && p4?.['ledger-device'] === 'faff@1.0',
      'final hook is p4 with faff pricing + ledger devices',
      JSON.stringify(p4 ?? null))
  }

  // --- native: faff allow-list -------------------------------------------
  const faff = await listOf(host, 'faff-allow-list')
  check(faff.length > 0, 'faff-allow-list is non-empty (empty = key was silently not-found)',
    `${faff.length} entries`)
  const badForm = faff.filter(a => {
    try { return getAddress(a) !== a } catch { return true }
  })
  check(badForm.length === 0, 'every allow-list entry is EIP-55 checksummed',
    badForm.length ? badForm.join(', ') : `${faff.length} ok`)
  check(new Set(faff).size === faff.length, 'no duplicate allow-list entries')
  const wantList = [...allowList].sort().join(',')
  const gotList = [...faff].sort().join(',')
  check(wantList === gotList, 'allow-list matches the expected set for this environment',
    wantList === gotList ? `${faff.length} addresses` : `got ${gotList}`)

  // --- native: p4 carve-outs ---------------------------------------------
  const routes = (await listOf(host, 'p4-non-chargable-routes')).map(r => r?.template)
  check(routes.length === 7, 'p4-non-chargable-routes has exactly 7 entries', `got ${routes.length}`)
  // `.every()` is true for an empty list, so each assertion below is paired with a
  // length guard — otherwise a container that failed to parse reads as a clean pass.
  check(routes.length > 0 && routes.every(t => typeof t === 'string' && t.startsWith('^/')),
    'every route template is anchored at ^/ (unanchored regexes match anywhere)',
    routes.filter(t => !t?.startsWith('^/')).join(', ') || `all ${routes.length} anchored`)
  // Routes 1-3 carry the contract ids. UNGATED they are blanket `^/<pid>` — which exempts
  // WRITES as well as reads, and is the hole the gate closes. GATED they must be narrowed to
  // read verbs only, so `/push` and `/schedule` fall through to the gate.
  // The read-verb alternation the narrowed routes must carry. It is a constant because the
  // assertion below and the pid extraction have to agree; they drifted apart once already.
  const READ_VERBS = '~process@1.0/(now|compute|slot|as)'
  const pids = routes.slice(0, 3).map(t =>
    String(t).replace(/^\^\//, '').replace(/~process@1\.0\/\((?:[a-z|]+)\)$/, ''))
  check(pids.length === 3 && pids.every(p => /^[A-Za-z0-9_-]{43}$/.test(p)),
    'routes 1-3 rendered real 43-char process ids from Consul KV',
    pids.join(' '))
  const readOnly = routes.slice(0, 3).every(t => String(t).endsWith(READ_VERBS))
  if (gated) {
    check(readOnly,
      `contract routes are narrowed to READ verbs ${READ_VERBS} — writes reach the gate`,
      routes.slice(0, 3).join(' '))
  } else {
    check(!readOnly,
      'contract routes are still blanket (pre-gate posture)', routes.slice(0, 3).join(' '))
  }
  pidSets[env] = pids
  check(STATIC_ROUTES.every(s => routes.includes(s)),
    'routes 4-7 are ^/$, ~meta@1.0, ~hyperbuddy@1.0, ~query@1.0',
    routes.slice(3).join(' '))

  // BEHAVIOURAL, not just config: the root request must still redirect to Hyperbuddy. The gate
  // refuses a chargeable root with 400, and asserting the route list alone would not prove the
  // redirect survives. 307 is the healthy answer; 400 means the gate ate it, 404 means node-host
  // regressed.
  const rootCode = await statusOf(host, '/')
  check(rootCode === 307,
    'root redirects to Hyperbuddy (307), not eaten by the gate (400) or node-host (404)',
    `got ${rootCode}`)

  // --- native: hyphenation canary ----------------------------------------
  // These read back only if canonical_key resolved them; an underscored spelling
  // would be silently not-found and fall through to the node default.
  const nodeInfo = await info(host)
  for (const [k, want] of Object.entries(RATE_LIMIT)) {
    check(nodeInfo[k] === want, `${k} = ${want} (lowercase-hyphenated opt key took effect)`,
      `got ${nodeInfo[k]}`)
  }

  // --- edge ---------------------------------------------------------------
  // A local stand-in has no nginx in front of it, so edge assertions would be vacuous.
  const hasEdge = env !== 'local'
  if (!hasEdge) skip('edge checks', 'local node has no nginx in front of it')
  if (hasEdge) {
  check(await statusOf(host, '/~meta@1.0/info') === 200, 'edge allows /~meta@1.0')
  check(await statusOf(host, '/~hyperbuddy@1.0') === 200, 'edge allows /~hyperbuddy@1.0')

  // Spawns POST to a bare /push with the target in the body, so the edge cannot gate
  // them by PID and must let them through to be authorized natively by faff.
  const pushStatus = await statusOf(host, '/push')
  check(pushStatus !== 403, 'edge allows /push (spawn path, authorized natively)',
    `HTTP ${pushStatus}`)

  // The whitelisted ids must reach the node — this is the coverage assertion that gives
  // the two 403 checks below their teeth. Without it, an edge that 403s EVERYTHING would
  // pass the containment checks while being completely broken.
  const wlStatuses = await Promise.all(
    pids.map(p => statusOf(host, `/${p}~process@1.0/now/serialize~json@1.0`))
  )
  check(wlStatuses.every(s => s !== 403), 'edge admits all 3 whitelisted process ids',
    wlStatuses.join(' '))

  if (gated) {
    // The lockdown, stated directly: our contracts keep free public reads (D3), and nothing
    // else on the node does. A generic read carve-out would quietly make this node a free read
    // service for processes we have nothing to do with.
    // Probe EVERY read verb consumers use, not just `now`. The gate refuses anything unsigned
    // outright, with no read/write discrimination, so a verb missing from the carve-out is a
    // hard 400 rather than a slow path. Checking only `now` is what let the D32 move to
    // `as/<view>` go unnoticed here: `now` stayed in the carve-out the whole time.
    for (const rp of ['as/status', 'now/serialize~json@1.0', 'compute/allowlistId', 'slot/current']) {
      const ourReads = await Promise.all(
        pids.map(p => statusOf(host, `/${p}~process@1.0/${rp}`)))
      check(ourReads.every(s => s !== 400), `unsigned reads of OUR contracts stay free (${rp})`,
        ourReads.join(' '))
    }
  }

  const foreignStatus = await statusOf(host, `/${FOREIGN_PID}~process@1.0/now`)
  const randomStatus = await statusOf(host, '/some/unrouted/path')
  if (edgeLocked) {
    check(foreignStatus === 403, 'edge BLOCKS a foreign process id', `HTTP ${foreignStatus}`)
    check(randomStatus === 403, 'edge BLOCKS an unrouted path', `HTTP ${randomStatus}`)
  } else {
    check(foreignStatus !== 403 && randomStatus !== 403,
      'dev edge is open by design (standing decision, not a regression)',
      `foreign ${foreignStatus}, unrouted ${randomStatus}`)
  }

  }

  // --- DoS posture (opt-in: generates real load) ---------------------------
  // D3 asks for "rate limiting and body-size caps as DoS posture". Both are edge
  // controls, so both are probed from outside.
  if (dos && (env === 'dev' || dosForce)) {
    // Body cap: nginx `client_max_body_size 10m` and Traefik's 10MB buffering limit.
    // 11MB must be refused by the edge; the node must never see it.
    const big = new Uint8Array(11 * 1024 * 1024).fill(97)
    const bigRes = await fetch(`${base(host)}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/ans104' },
      body: big,
      signal: AbortSignal.timeout(120_000),
    }).catch(() => null)
    check(bigRes?.status === 413, 'edge rejects an 11MB body with 413 (10MB cap)',
      `HTTP ${bigRes?.status ?? 'connection reset'}`)

    // Rate limit: Traefik `average=30, burst=60` per source. To exercise it the probe
    // must actually EXCEED 30 req/s — measure the achieved rate and refuse to draw a
    // conclusion below the threshold. An earlier version of this check silently
    // "passed" while only reaching ~17 req/s, because the endpoint it hammered
    // returned a large payload and the payload, not the limiter, was the bottleneck.
    // Hence the tiny endpoint below, and the explicit rate assertion.
    const N = 400
    const t0 = Date.now()
    const codes = await Promise.all(Array.from({ length: N }, () =>
      fetch(`${base(host)}/~meta@1.0/info/address`, { signal: AbortSignal.timeout(60_000) })
        .then(r => r.status).catch(() => 0)
    ))
    const secs = (Date.now() - t0) / 1000
    const rate = N / secs
    const limited = codes.filter(c => c === 429).length
    const served = codes.filter(c => c === 200).length

    check(rate > 30, 'probe exceeded the 30 req/s limit (else the test proves nothing)',
      `${rate.toFixed(1)} req/s over ${secs.toFixed(1)}s`)
    if (rate > 30) {
      check(limited > 0, 'edge rate-limits with 429 above the configured average',
        `${limited} x 429, ${served} x 200`)
      check(served > 0, 'rate limiting is a throttle, not an outage (some requests served)',
        `${served} served`)
    } else {
      skip('edge rate-limits with 429', `only reached ${rate.toFixed(1)} req/s — inconclusive`)
    }

    // The bucket is per-source and short-lived; a brief idle must restore service.
    await new Promise(r => setTimeout(r, 8000))
    check(await statusOf(host, '/~meta@1.0/info/address') === 200,
      'rate limiter recovers after a short idle')
  } else if (dos) {
    skip(`DoS posture on ${env}`, 'load test restricted to dev; pass --dos-force to override')
  }

  // --- spawn restriction --------------------------------------------------
  // The negative test needs a signer that is allow-listed NOWHERE, so generate a throwaway
  // one per run instead of borrowing DEPLOYER_PRIVATE_KEY. That key used to be a safe
  // stand-in only by accident: on 2026-07-30 the workstation key was added to dev's
  // allow-list, which would have silently flipped the denial check below into a false pass
  // — precisely the failure the coverage assertion exists to catch. An ephemeral key cannot
  // be on any list by construction, needs no secret present to run, and keeps this
  // meaningful on every environment.
  {
    const key = crypto.randomBytes(32).toString('hex')
    const signer = new EthereumSigner(key)
    // Derive from the secp256k1 public key properly (keccak of the uncompressed point).
    // Slicing the last 20 bytes off the public key yields a plausible-looking but WRONG
    // address, which would quietly break the allow-list coverage assertion below.
    const probeAddr = computeAddress(hexlify(signer.publicKey))
    // Coverage assertion: a signer that IS allow-listed would be admitted, turning the
    // denial check below into a false pass.
    const usable = !faff.includes(probeAddr)
    check(usable, 'probe signer is NOT in the allow-list (negative test is meaningful)', probeAddr)

    if (usable) {
      const item = createData(new Uint8Array(0) as never, signer, {
        tags: [{ name: 'action', value: 'faff-denial-probe' }],
      })
      await item.sign(signer)
      const res = await fetch(`${base(host)}/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/ans104' },
        body: item.getRaw() as unknown as BodyInit,
        signal: AbortSignal.timeout(30_000),
      })
      check(res.status === 400, 'faff denies a signed request from a non-allow-listed key',
        `HTTP ${res.status}`)
      check(res.headers.get('process') === null, 'denied request created no process')
    }

    // D3 requires that arbitrary operator wallets CAN still message our processes —
    // authorization is the contract's ACL, not the node's job — while everything else is
    // refused. That is the p4 carve-out's whole purpose, and it is per-path, so it is
    // testable without a live contract: the same non-allow-listed signer must be admitted
    // past faff for a carved-out id and refused for a foreign one. A 500 here means the
    // request got past faff and died later (the legacy ids are not hosted); what matters
    // is only that it is NOT faff's 400 refusal.
    if (usable && pids.length === 3) {
      const probe = async (pid: string) => {
        const it = createData(new Uint8Array(0) as never, signer, {
          tags: [{ name: 'action', value: 'carveout-probe' }],
        })
        await it.sign(signer)
        const r = await fetch(`${base(host)}/${pid}~process@1.0/push`, {
          method: 'POST',
          headers: { 'content-type': 'application/ans104' },
          body: it.getRaw() as unknown as BodyInit,
          signal: AbortSignal.timeout(30_000),
        })
        const b = (await r.text()).replace(/\s+/g, ' ')
        return {
          faffDenied: r.status === 400 && /will not service/i.test(b),
          edgeDenied: r.status === 403,
          status: r.status,
        }
      }
      const carved = await Promise.all(pids.map(probe))
      if (gated) {
        // THE ASSERTION INVERTS. Ungated, D3 wanted arbitrary operator wallets admitted past
        // faff so the CONTRACT's ACL could authorize them — which is exactly what let any wallet
        // burn a slot per message. Gated, an unknown wallet must be refused BEFORE a slot is
        // created; real operators are admitted by the allowlist, which this probe's ephemeral
        // key can never be on.
        check(carved.every(c => c.faffDenied || c.edgeDenied),
          'an unknown wallet is REFUSED for our contract ids (no slot created)',
          `${carved.filter(c => c.faffDenied || c.edgeDenied).length}/3 refused`)
      } else {
        check(carved.every(c => !c.faffDenied && !c.edgeDenied),
          'arbitrary wallet is admitted past faff for whitelisted process ids',
          `${carved.filter(c => !c.faffDenied && !c.edgeDenied).length}/3 admitted`)
      }

      // Coverage assertion: without this, a node admitting EVERYTHING would pass the line
      // above while enforcing nothing. WHICH layer refuses depends on the environment —
      // on a locked edge nginx 403s the foreign id before faff ever sees it, so expecting
      // faff's 400 there would fail for the wrong reason. Assert refusal, name the layer.
      const foreign = await probe(FOREIGN_PID)
      check(edgeLocked ? foreign.edgeDenied : foreign.faffDenied,
        `the same wallet is refused for a foreign process id (${edgeLocked ? 'at the edge' : 'by faff'})`,
        `HTTP ${foreign.status}`)
    }

    // dev_faff:is_admissible is `lists:all` over the signer list, so an EMPTY signer list
    // passes vacuously — unsigned requests are admitted by faff. Documented upstream
    // behaviour; what matters for D3 is that it is not an authorization bypass, i.e. the
    // request still cannot produce a process. Asserting that here so a future HyperBEAM
    // release that starts honouring unsigned spawns is caught.
    const un = await fetch(`${base(host)}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device: 'process@1.0', type: 'Process', variant: 'ao.N.1' }),
      signal: AbortSignal.timeout(30_000),
    })
    check(un.headers.get('process') === null && un.status >= 400,
      'unsigned spawn creates no process (faff fails open, scheduler does not)',
      `HTTP ${un.status}`)
  }
}

// --- cross-environment ----------------------------------------------------
if (targets.length > 1) {
  console.log('\n=== cross-environment ===')
  const addrs = targets.map(e => addresses[e]).filter(Boolean)
  check(new Set(addrs).size === addrs.length,
    'every node has a DISTINCT operator identity (config.flat kept priv_key_location)',
    targets.map(e => `${e}=${addresses[e]?.slice(0, 12)}…`).join(' '))

  // Guarded on non-emptiness: two failed reads both yield '' and would otherwise
  // "agree" (or, for the live comparison, differ) for entirely the wrong reason.
  if (targets.includes('dev') && targets.includes('stage')) {
    check(pidSets.dev?.length === 3 && pidSets.dev.join() === pidSets.stage?.join(),
      'dev tracks the stage contract ids, as documented')
  }
  if (targets.includes('stage') && targets.includes('live')) {
    check(pidSets.stage?.length === 3 && pidSets.live?.length === 3 &&
      pidSets.stage.join() !== pidSets.live.join(),
      'stage and live whitelist DIFFERENT contract ids')
  }
}

if (PERTURB) {
  // Under perturbation every environment should fail on the corrupted expectations:
  // the allow-list set, the rate-limit period, a static route, and the edge posture.
  const want = targets.length * 4
  const ok = fails >= want
  console.log(
    `\n${ok ? 'PERTURB OK' : 'PERTURB WEAK'} — ${fails} checks failed, expected at least ` +
    `${want} (${targets.length} envs x allow-list, rate-limit, static route, edge posture)`
  )
  process.exit(ok ? 0 : 1)
}

console.log(
  `\n${fails === 0 && skipped === 0 ? 'ALL PASS' : fails === 0 ? 'PASS (incomplete)' : 'FAILED'}` +
  ` — ${checks - fails}/${checks} checks passed` +
  (skipped ? `, ${skipped} skipped` : '') +
  ` across ${targets.join(', ')}`
)
process.exit(fails === 0 && skipped === 0 ? 0 : 1)
