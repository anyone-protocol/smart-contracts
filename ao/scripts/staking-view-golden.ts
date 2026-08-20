// STAKING VIEW GOLDEN — the 1:1 gate for the D32 key-flattening refactor.
//
// The flattening changes how staking stores state (`[hodler][operator]` -> `[hodler/operator]`,
// and `PreviousRound.Details` into typed parallel maps). Storage is ours to change; what must
// NOT move is what a consumer sees. This captures exactly that and nothing else.
//
// Two independent checks, because they fail differently:
//
//   1. DUMP-ANCHORED (absolute).  Every view's answer is asserted against the migration SEED,
//      which is the deterministic transform of the real legacynet dump
//      (state-dumps/2026-07-09/live-staking-rewards.state.json). verify-migration already
//      chains seed->dump (step 2 transform determinism, step 3 state fidelity), so agreeing
//      with the seed IS agreeing with legacynet. We cannot spawn a legacynet process any more,
//      and we do not need to: the dump is that process's state.
//
//   2. GOLDEN DIFF (relative).  Every view's raw JSON is recorded to
//      dist/staking-view-golden.json. Capture on the CURRENT contract, refactor, re-capture,
//      diff. Catches anything the assertions did not think to ask about — key order, number
//      formatting, null vs absent, a count that silently starts counting pairs instead of
//      hodlers.
//
// Both are captured BEFORE and AFTER a real round (buildRound, the same fixture the Tier-3
// oracle uses), because the write path reshapes Rewarded/Claimed/Details and that is where a
// flattening bug would actually land.
//
//   MODULE_ID=<id> HB_URL=http://localhost:8734 bun run scripts/staking-view-golden.ts
//   MODULE_ID=<id> ... bun run scripts/staking-view-golden.ts --check    # diff vs the golden
//   MODULE_ID=<id> ... bun run scripts/staking-view-golden.ts --resample # rotate the sample too
//
// The sampled address set is INHERITED from an existing golden in both modes, so a re-baseline
// stays comparable to what it replaces. --resample opts out, and makes the result incomparable
// to every earlier capture.
import fs from 'node:fs'
import path from 'node:path'
import { EthereumSigner } from '@dha-team/arbundles'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from './util/hb-client'
import { buildRound } from './util/staking-round'

const AO = path.resolve(import.meta.dir, '..')
const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID
if (!MODULE_ID) { console.error('MODULE_ID env required (publish the staking module first)'); process.exit(2) }
const KEY = (process.env.DEPLOYER_PRIVATE_KEY
  || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const signer = new EthereumSigner(KEY)
const CHECK = process.argv.includes('--check')
// Rotate the sampled address set instead of inheriting the golden's. Deliberate act: it makes the
// next diff incomparable to every earlier capture, so it must be asked for, never defaulted to.
const RESAMPLE = process.argv.includes('--resample')
const GOLDEN = path.join(AO, 'spec/fixtures/staking-view-golden.json')

const seedEnvelope = JSON.parse(
  fs.readFileSync(path.join(AO, 'dist/staking-rewards-seed.envelope.json'), 'utf8'))
const seedRaw = seedEnvelope.state

// The seed STORES the D32 flat shape (`[hodler/operator]`, Details as parallel typed maps).
// Views must answer in the ORIGINAL nested shape, so un-flatten here and assert against that.
// This is deliberately an independent reimplementation of the contract's reassembly — if both
// had the same bug they would agree with each other and still be wrong, so the golden file
// (captured from the pre-flattening contract) is what catches that.
const unflatten = <T>(flat: Record<string, T>): Record<string, Record<string, T>> => {
  const out: Record<string, Record<string, T>> = {}
  for (const [k, v] of Object.entries(flat ?? {})) {
    const i = k.indexOf('/')
    const h = k.slice(0, i), o = k.slice(i + 1)
    ;(out[h] ??= {})[o] = v
  }
  return out
}
const unflattenDetails = (d: any): Record<string, Record<string, any>> => {
  const out: Record<string, Record<string, any>> = {}
  for (const k of Object.keys(d?.Rating ?? {})) {
    const i = k.indexOf('/')
    const h = k.slice(0, i), o = k.slice(i + 1)
    ;(out[h] ??= {})[o] = {
      Score: { Staked: d.Staked[k], Restaked: d.Restaked[k], Running: d.Running[k], Share: d.Share[k] },
      Rating: d.Rating[k],
      Reward: { Hodler: d.RewardHodler[k], Operator: d.RewardOperator[k] },
    }
  }
  return out
}
const seed = {
  ...seedRaw,
  Rewarded: unflatten(seedRaw.Rewarded),
  Claimed: unflatten(seedRaw.Claimed),
  PreviousRound: { ...seedRaw.PreviousRound, Details: unflattenDetails(seedRaw.PreviousRound.Details) },
}

let pass = 0, fail = 0
const failures: string[] = []
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++
  else { fail++; failures.push(`${name}${detail ? '  — ' + detail : ''}`); console.log(`   ✗ ${name}  ${detail}`) }
}
/** Structural equality, key order insensitive — the node re-encodes from Lua tables and
 *  `pairs()` order is not stable, so a JSON string compare would fail for no reason. */
const eq = (a: any, b: any): boolean => {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every(k => eq(a[k], b[k]))
}
/** Canonical form for the golden file: sorted keys, so a diff shows real changes only. */
const canon = (v: any): any =>
  Array.isArray(v) ? v.map(canon)
    : (v && typeof v === 'object')
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]))
      : v

const P = (pid: string) => `${HB}/${pid}~process@1.0`
async function view (pid: string, name: string, qs = ''): Promise<any> {
  const r = await fetch(`${P(pid)}/as/${name}${qs}`, { headers: { accept: 'application/json' } })
  const body = await r.text()
  if (!r.ok) return { __status: r.status, __body: body.slice(0, 120) }
  try { return JSON.parse(body) } catch { return { __unparsed: body.slice(0, 200) } }
}

/** A deterministic address sample that covers every branch the views have. Sorted first, so
 *  the same addresses are picked on every run and the golden is stable. */
function sampleAddresses () {
  const rewardedHodlers = Object.keys(seed.Rewarded).sort()
  const claimedHodlers = Object.keys(seed.Claimed).sort()
  const detailHodlers = Object.keys(seed.PreviousRound.Details).sort()
  const claimedSet = new Set(claimedHodlers)
  const detailSet = new Set(detailHodlers)

  const withClaimed = rewardedHodlers.filter(h => claimedSet.has(h))
  const withoutClaimed = rewardedHodlers.filter(h => !claimedSet.has(h))
  const withDetails = rewardedHodlers.filter(h => detailSet.has(h))
  // The self-key case: an operator's own cut lives at Rewarded[op][op]. Distinct code path.
  const selfKey = rewardedHodlers.filter(h => seed.Rewarded[h][h] !== undefined)
  // Multi-operator hodlers exercise the per-operator reassembly, not just a single entry.
  const multiOp = rewardedHodlers.filter(h => Object.keys(seed.Rewarded[h]).length > 1)

  const picked = new Map<string, string>()
  const take = (label: string, list: string[], n = 2) =>
    list.slice(0, n).forEach((a, i) => picked.set(a, `${label}${n > 1 ? `#${i}` : ''}`))
  take('rewarded+claimed', withClaimed)
  take('rewarded-no-claimed', withoutClaimed)
  take('with-details', withDetails)
  take('self-key', selfKey)
  take('multi-operator', multiOp)
  // Widen the net well past the hand-picked branches: a flattening bug that only shows up on
  // one odd address would otherwise slip through a 10-address sample.
  rewardedHodlers.filter((_, i) => i % 37 === 0).slice(0, 20)
    .forEach(a => { if (!picked.has(a)) picked.set(a, 'spread') })
  return [...picked.entries()].sort(([a], [b]) => a.localeCompare(b))
}

/** Every view, for every sampled address, plus the parameterless ones. */
async function capture (pid: string, phase: string, addrs: [string, string][]) {
  const out: Record<string, any> = {}
  out['status'] = await view(pid, 'status')
  out['last_round'] = await view(pid, 'last_round')
  out['last_snapshot'] = await view(pid, 'last_snapshot')
  out['shares'] = await view(pid, 'shares')
  out['roles'] = await view(pid, 'roles')
  for (const [addr] of addrs) {
    out[`rewards:${addr}`] = await view(pid, 'rewards', `?address=${addr}`)
    out[`claimed:${addr}`] = await view(pid, 'claimed', `?address=${addr}`)
    out[`last_round_data:${addr}`] = await view(pid, 'last_round_data', `?address=${addr}`)
    out[`shares:${addr}`] = await view(pid, 'shares', `?address=${addr}`)
  }
  // Edge inputs — absent, lowercase (EIP-55 canonicalization), bad checksum, missing param.
  const someone = addrs[0][0]
  out['edge:absent'] = await view(pid, 'rewards', `?address=0x${'ab'.repeat(20)}`)
  out['edge:lowercase'] = await view(pid, 'rewards', `?address=${someone.toLowerCase()}`)
  out['edge:badchecksum'] = await view(pid, 'rewards', `?address=0xZZ${'1'.repeat(38)}`)
  out['edge:noparam'] = await view(pid, 'rewards')
  console.log(`  captured ${Object.keys(out).length} view responses (${phase})`)
  return out
}

/** The absolute check: does the view agree with the dump-derived seed? */
function assertAgainstSeed (snap: Record<string, any>, addrs: [string, string][], label: string) {
  console.log(`\n${label} — views vs the migration seed (dump-derived):`)
  for (const [addr, branch] of addrs) {
    const r = snap[`rewards:${addr}`]
    check(`rewards[${addr.slice(0, 10)}…].Rewarded (${branch})`,
      eq(r?.Rewarded, seed.Rewarded[addr] ?? {}), JSON.stringify(r?.Rewarded)?.slice(0, 80))
    check(`rewards[${addr.slice(0, 10)}…].Claimed (${branch})`,
      eq(r?.Claimed, seed.Claimed[addr] ?? {}), JSON.stringify(r?.Claimed)?.slice(0, 80))

    const c = snap[`claimed:${addr}`]
    const wantClaimed = seed.Claimed[addr]
    check(`claimed[${addr.slice(0, 10)}…]`,
      c?.address === addr && (wantClaimed === undefined ? c?.claimed === undefined : eq(c?.claimed, wantClaimed)),
      JSON.stringify(c)?.slice(0, 80))

    const d = snap[`last_round_data:${addr}`]
    const wantDetails = seed.PreviousRound.Details[addr]
    if (wantDetails === undefined) {
      check(`last_round_data[${addr.slice(0, 10)}…] absent`, d === null || d?.Details === undefined,
        JSON.stringify(d)?.slice(0, 80))
    } else {
      check(`last_round_data[${addr.slice(0, 10)}…].Details`, eq(d?.Details, wantDetails),
        JSON.stringify(d?.Details)?.slice(0, 100))
    }
  }
  // Whole-round views.
  const lr = snap['last_round']
  check('last_round.Timestamp', lr?.Timestamp === seed.PreviousRound.Timestamp, String(lr?.Timestamp))
  check('last_round.Period', lr?.Period === seed.PreviousRound.Period, String(lr?.Period))
  check('last_round.Summary', eq(lr?.Summary, seed.PreviousRound.Summary), JSON.stringify(lr?.Summary))
  const ls = snap['last_snapshot']
  check('last_snapshot.Details (whole map)', eq(ls?.Details, seed.PreviousRound.Details),
    `${Object.keys(ls?.Details ?? {}).length} hodlers vs ${Object.keys(seed.PreviousRound.Details).length}`)
  check('last_snapshot.Summary', eq(ls?.Summary, seed.PreviousRound.Summary))
  // status counts HODLERS, not pairs — the exact thing a naive flattening breaks.
  const st = snap['status']
  check('status.counts.rewardedHodlers counts HODLERS not pairs',
    st?.counts?.rewardedHodlers === Object.keys(seed.Rewarded).length,
    `${st?.counts?.rewardedHodlers} vs ${Object.keys(seed.Rewarded).length}`)
  check('status.counts.claimedHodlers counts HODLERS not pairs',
    st?.counts?.claimedHodlers === Object.keys(seed.Claimed).length,
    `${st?.counts?.claimedHodlers} vs ${Object.keys(seed.Claimed).length}`)
  check('status.lastRoundTimestamp', st?.lastRoundTimestamp === seed.PreviousRound.Timestamp)
}

;(async () => {
  console.log(`node ${await fetchNodeAddress(HB)}  module ${MODULE_ID.slice(0, 12)}…`)
  console.log(`seed: ${Object.keys(seed.Rewarded).length} rewarded hodlers, `
    + `${Object.keys(seed.PreviousRound.Details).length} detail hodlers`)

  const { pid } = await spawnLuaProcess({ url: HB, signer }, {
    moduleId: MODULE_ID,
    spawnData: JSON.stringify(seedEnvelope),
    tags: [{ name: 'name', value: `staking-golden-${Date.now()}` }],
  })
  console.log(`pid ${pid}`)

  // REUSE the golden's address list whenever a golden exists — in BOTH modes. Recomputing it
  // lets the sample drift with the seed shape and reports harness noise as behavior change:
  // the flattened seed has 2 fewer Rewarded hodlers, so every index-based pick shifts and the
  // "diffs" are simply different addresses being compared (208 of them on the first run).
  //
  // This guard was originally --check only, which left the RE-BASELINE path drifting: capturing
  // a new golden silently rotated 13 of 21 addresses, so the very next --check compared a
  // different sample and the continuity the golden exists to provide was gone. Re-baselining is
  // exactly when the sample must be held fixed. Pass --resample to rotate it deliberately.
  let addrs = sampleAddresses()
  if (!RESAMPLE && fs.existsSync(GOLDEN)) {
    const g = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))
    const fromGolden = (g.meta?.addresses ?? []).map((a: string) => {
      const m = a.match(/^(\S+) \((.*)\)$/)
      return [m ? m[1] : a, m ? m[2] : 'golden'] as [string, string]
    })
    if (fromGolden.length) {
      addrs = fromGolden
      console.log(`  reusing the golden's ${addrs.length} addresses`
        + `${CHECK ? '' : ' (re-baseline holds the sample fixed; --resample to rotate)'}`)
    }
  }
  console.log(`sampled ${addrs.length} addresses across branches: `
    + [...new Set(addrs.map(([, b]) => b.replace(/#\d+$/, '')))].join(', '))

  console.log('\n[1] pre-round capture')
  const before = await capture(pid, 'pre-round', addrs)
  assertAgainstSeed(before, addrs, '[1] pre-round')

  // A real round over the real seed — the write path is where flattening actually bites.
  console.log('\n[2] driving a real round (same fixture as the Tier-3 oracle)')
  const round = buildRound(seedRaw)
  console.log(`  ${round.realPairs} real + ${round.freshPairs} fresh pairs, ${round.hodlers} hodlers, t=${round.timestamp}`)
  await sendMessage({ url: HB, signer }, {
    pid,
    tags: [{ name: 'action', value: 'Add-Scores' }, { name: 'round-timestamp', value: String(round.timestamp) }],
    data: JSON.stringify({ Scores: round.scores }),
  })
  const staged = await view(pid, 'status')
  check('round staged (pendingRounds == 1)', staged?.counts?.pendingRounds === 1,
    String(staged?.counts?.pendingRounds))
  await sendMessage({ url: HB, signer }, {
    pid,
    tags: [{ name: 'action', value: 'Complete-Round' }, { name: 'round-timestamp', value: String(round.timestamp) }],
  })

  console.log('\n[3] post-round capture')
  const after = await capture(pid, 'post-round', addrs)
  const st = after['status']
  check('round settled (pendingRounds == 0)', st?.counts?.pendingRounds === 0, String(st?.counts?.pendingRounds))
  check('round settled (lastRoundTimestamp advanced)', st?.lastRoundTimestamp === round.timestamp,
    String(st?.lastRoundTimestamp))

  const snapshot = canon({
    meta: {
      module: MODULE_ID,
      seedRewardedHodlers: Object.keys(seed.Rewarded).length,
      seedDetailHodlers: Object.keys(seed.PreviousRound.Details).length,
      roundTimestamp: round.timestamp,
      addresses: addrs.map(([a, b]) => `${a} (${b})`),
    },
    before,
    after,
  })

  if (CHECK) {
    if (!fs.existsSync(GOLDEN)) { console.error(`\nno golden at ${GOLDEN} — run without --check first`); process.exit(2) }
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))
    // The golden is deliberately NOT re-captured after the D32 flattening — it is the
    // pre-flattening truth, and re-recording it would erase the evidence it exists to hold.
    // The one accepted difference is named here instead, so every OTHER drift still fails.
    //
    // Legacynet created `Rewarded[h] = {}` before its `bint.ispos` guard, leaving 2 empty
    // hodler rows in the dump. A pair-keyed map cannot hold a hodler with no pairs, so they
    // are dropped and the hodler count falls by exactly 2. See the contract header.
    const EMPTY_HODLER_ROWS = 2
    const accepted = (key: string, g: any, n: any): string | null => {
      if (key !== 'status') return null
      const gc = g?.counts?.rewardedHodlers, nc = n?.counts?.rewardedHodlers
      if (typeof gc !== 'number' || typeof nc !== 'number') return null
      if (gc - nc !== EMPTY_HODLER_ROWS) return null
      // Everything else about status must still match exactly.
      const gRest = { ...g, counts: { ...g.counts, rewardedHodlers: nc } }
      if (!eq(gRest, n)) return null
      return `rewardedHodlers ${gc} -> ${nc} (${EMPTY_HODLER_ROWS} empty legacynet rows dropped)`
    }
    // meta carries the module id and round timestamp, which legitimately differ per run.
    const drift: string[] = []
    for (const phase of ['before', 'after'] as const) {
      const g = golden[phase] ?? {}, n = (snapshot as any)[phase] ?? {}
      for (const k of new Set([...Object.keys(g), ...Object.keys(n)])) {
        if (eq(g[k], n[k])) continue
        const why = accepted(k, g[k], n[k])
        if (why) { console.log(`   ~ ${phase}.${k}: ACCEPTED — ${why}`); continue }
        drift.push(`${phase}.${k}\n      golden: ${JSON.stringify(g[k])?.slice(0, 220)}\n      now:    ${JSON.stringify(n[k])?.slice(0, 220)}`)
      }
    }
    console.log(`\n[4] golden diff: ${drift.length === 0 ? 'IDENTICAL' : `${drift.length} view(s) MOVED`}`)
    drift.forEach(d => console.log(`   ✗ ${d}`))
    fail += drift.length
  } else {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true })
    fs.writeFileSync(GOLDEN, JSON.stringify(snapshot, null, 2))
    console.log(`\n[4] golden written: ${GOLDEN} (${(fs.statSync(GOLDEN).size / 1024).toFixed(0)} KB)`)
  }

  console.log(`\n${'='.repeat(60)}\nSTAKING VIEW GOLDEN: ${pass} passed / ${fail} failed`)
  if (fail) { console.log('FAILURES:'); failures.forEach(f => console.log(`  - ${f}`)) }
  console.log(`pid ${pid}`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('FATAL', String(e?.stack || e?.message || e).slice(0, 800)); process.exit(2) })
