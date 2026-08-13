// Tier-3 relay-rewards vertical: spawn the seeded native relay-rewards (real 719KB legacynet
// state, minus Details) by-id and prove on a live node:
//   1. materialization + counts (status view)
//   2. seed-diff: TotalAddressReward/Claimed/TotalFingerprintReward vs dist/...expected.json
//   3. roles seeded (Add-Scores/Complete-Round/Claim-Rewards)
//   4. BYTE-IDENTICAL round: drive the IDENTICAL round the luerl oracle ran and assert every
//      Details reward + cumulative TotalAddress/FingerprintReward equals dist/relay-oracle-probe.json
//      (proves the device VM computes the frozen math the same at scale, incl. the A17 fix)
// Run: HB_URL=http://localhost:8734 MODULE_ID=<seed id> bun run scripts/tier3-relay-validate.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { Wallet } from 'ethers'
import { fetchNodeAddress, spawnLuaProcess, sendMessage, readState } from './util/hb-client'
import { seedEnvelopeFor } from './util/native-bundle'
import fs from 'fs'
import path from 'path'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID
if (!MODULE_ID) { console.error('MODULE_ID env required'); process.exit(2) }
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const signer = new EthereumSigner(KEY)
const DEV = new Wallet('0x' + KEY).address

const AO = path.resolve(import.meta.dir, '..')
const expected = JSON.parse(fs.readFileSync(path.join(AO, 'dist/relay-rewards-seed.expected.json'), 'utf8'))
const oracle = JSON.parse(fs.readFileSync(path.join(AO, 'dist/relay-oracle-probe.json'), 'utf8'))

// The round the oracle ran (must match spec/luerl/scenarios/relay-round-probe.lua exactly).
const AA = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const BB = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const FP1 = '1'.repeat(40), FP2 = '2'.repeat(40), FP3 = '3'.repeat(40)
const T = 1783067641960
const SCORES = {
  [FP1]: { Address: AA, Network: 1000000, IsHardware: true,  UptimeStreak: 14, ExitBonus: true,  FamilySize: 3, LocationSize: 5 },
  [FP2]: { Address: BB, Network: 500000,  IsHardware: false, UptimeStreak: 3,  ExitBonus: false, FamilySize: 1, LocationSize: 2 },
  [FP3]: { Address: AA, Network: 800000,  IsHardware: false, UptimeStreak: 0,  ExitBonus: false, FamilySize: 1, LocationSize: 1 },
}

let fails = 0
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!ok) fails++
}
let pid: string
const view = async (v: string) => {
  const r = await fetch(`${HB}/${pid}~process@1.0/as/${v}`)
  const b = await r.text(); if (!r.ok) throw new Error(`view ${v} -> ${r.status}: ${b.slice(0, 120)}`)
  return JSON.parse(b)
}
const diffMap = (got: Record<string, unknown>, want: Record<string, unknown>) => {
  got = got || {}; want = want || {}
  const gk = Object.keys(got), wk = Object.keys(want)
  if (gk.length !== wk.length) return `size ${gk.length} != ${wk.length}`
  for (const k of wk) if (got[k] !== want[k]) return `${k}: ${got[k]} != ${want[k]}`
  return ''
}

;(async () => {
  console.log(`node ${await fetchNodeAddress(HB)}  moduleId=${MODULE_ID}\n  owner(dev)=${DEV}`)
  const r = await spawnLuaProcess({ url: HB, signer }, { moduleId: MODULE_ID, spawnData: seedEnvelopeFor('relay-rewards'), tags: [{ name: 'name', value: `relay-seed-${Date.now()}` }] })
  pid = r.pid
  console.log(`spawned pid=${pid}\n`)

  // 1) materialization + counts
  console.log('1) materialization + counts (status):')
  // spawnLuaProcess already forced the lazy first compute, so this is the SEED-LANDED check,
  // not a materialization wait: `initialized` separates a computed-but-empty process from a
  // seeded one, which the counts cannot.
  let status: any
  for (let i = 0; i < 40; i++) {
    try {
      const s = await view('status')
      if (s?.initialized !== false) { status = s; break }
    } catch { /* not up yet */ }
    await new Promise(z => setTimeout(z, 1500))
  }
  if (!status) { console.log('  FAIL  status never answered'); process.exit(1) }
  const ec = {
    addresses: Object.keys(expected.state.TotalAddressReward).length,
    fingerprints: Object.keys(expected.state.TotalFingerprintReward).length,
    claimed: Object.keys(expected.state.Claimed).length,
  }
  check(status.counts.addresses === ec.addresses, 'TotalAddressReward count', `${status.counts.addresses}/${ec.addresses}`)
  check(status.counts.fingerprints === ec.fingerprints, 'TotalFingerprintReward count', `${status.counts.fingerprints}/${ec.fingerprints}`)
  check(status.counts.claimed === ec.claimed, 'Claimed count', `${status.counts.claimed}/${ec.claimed}`)
  check(status.lastRoundTimestamp === expected.state.PreviousRound.Timestamp, 'PreviousRound.Timestamp seeded', String(status.lastRoundTimestamp))
  check(status.tokensPerSecond === expected.state.Configuration.TokensPerSecond, 'Configuration.TokensPerSecond seeded', status.tokensPerSecond)

  // 2) seed-diff (dump vs expected) — the big maps
  console.log('\n2) full seed-diff (dump vs expected):')
  const dump = await view('dump')
  for (const m of ['TotalAddressReward', 'Claimed', 'TotalFingerprintReward'] as const) {
    const d = diffMap(dump[m], expected.state[m])
    check(d === '', `dump.${m} (${Object.keys(expected.state[m]).length} entries)`, d || 'identical')
  }

  // 3) roles seeded
  console.log('\n3) roles seeded:')
  const roles = await view('roles')
  for (const role of Object.keys(expected.roles)) {
    check(diffMap(roles[role], expected.roles[role]) === '', `role ${role}`, Object.keys(expected.roles[role])[0])
  }

  // fresh-address precondition (oracle assumes AA/BB/FP1-3 not in seed)
  console.log('\n4) fresh test keys (round rewards start from 0):')
  const tarAApre = (await view(`rewards?address=${AA}`).catch(() => ({})))?.reward
  check(tarAApre === undefined || tarAApre === null, 'AA absent pre-round', String(tarAApre))

  // 5) BYTE-IDENTICAL round: drive the identical round, compare to the luerl oracle
  console.log('\n5) byte-identical round (drive on-node, compare to luerl oracle):')
  const t0 = performance.now()
  await sendMessage({ url: HB, signer }, { pid, tags: [{ name: 'action', value: 'Add-Scores' }, { name: 'round-timestamp', value: String(T) }], data: JSON.stringify({ Scores: SCORES }) })
  await sendMessage({ url: HB, signer }, { pid, tags: [{ name: 'action', value: 'Complete-Round' }, { name: 'round-timestamp', value: String(T) }] })
  const roundMs = Math.round(performance.now() - t0)

  const outText = await readState({ url: HB }, pid, 'results/output/data')
  const snap = JSON.parse(outText)
  check(snap.Period === oracle.Period, 'Period', `${snap.Period}`)
  for (const fp of [FP1, FP2, FP3]) {
    const g = snap.Details?.[fp]?.Reward, w = oracle.Details[fp].Reward
    check(!!g && diffMap(g, w) === '', `Details[${fp.slice(0, 4)}…].Reward`, g ? (diffMap(g, w) || `Total=${g.Total}`) : 'missing')
    const gr = snap.Details?.[fp]?.Rating, wr = oracle.Details[fp].Rating
    check(!!gr && JSON.stringify(gr) === JSON.stringify(wr), `Details[${fp.slice(0, 4)}…].Rating`, gr ? JSON.stringify(gr) : 'missing')
  }
  // Cumulative maps == oracle. Were base-addressed point reads (now/state/TotalAddressReward/…);
  // under globals state is not on the message, so the same values come through the `rewards`
  // view, which measured faster than the base read anyway (D31 §5a).
  for (const [addr, label] of [[AA, 'AA'], [BB, 'BB']] as const) {
    const got = (await view(`rewards?address=${addr}`))?.reward
    check(got === oracle.tar[addr], `TotalAddressReward[${label}]`, `${got}`)
  }
  for (const fp of [FP1, FP2, FP3]) {
    const got = (await view(`rewards?fingerprint=${fp}`))?.reward
    check(got === oracle.tfr[fp], `TotalFingerprintReward[${fp.slice(0, 4)}…]`, `${got}`)
  }
  console.log(`  (round add+complete ${roundMs}ms)`)

  // Details NOT persisted
  // Details ARE persisted now, but only as the pre-encoded `DetailsJson` string — never as a
  // live Lua table, which is the shape that cost ~30,000 tables per slot.
  // NB: `dump` above is the PRE-round (seeded) state, so this asserts the legacynet dump's
  // nested Details never made it into state at seed time.
  check(dump.PreviousRound?.Details === undefined, 'Details never persisted as a TABLE', 'ok')
  // Post-round shape needs a FRESH dump. DetailsJson is fingerprint -> pre-encoded STRING; the
  // values being strings is the whole point — no nested tables for a slot to walk, no encode on
  // the read path.
  const postDump = await view('dump')
  const dj = postDump.PreviousRound?.DetailsJson
  const djVals = dj && typeof dj === 'object' ? Object.values(dj) : []
  check(djVals.length === 3 && djVals.every(v => typeof v === 'string'),
    'DetailsJson persisted as per-fingerprint strings',
    `${djVals.length} entries, all strings: ${djVals.every(v => typeof v === 'string')}`)

  // 6) SETTLE-SLOT POINTER round trip. Details are deliberately absent from state, so the only
  // thing making them retrievable is `Complete-Round` recording the slot it landed on. This is
  // the read a consumer actually performs: view -> slot number -> that slot's output. It is
  // asserted here rather than in Tier-1/2 because the slot only exists on a real assignment.
  // 6a) The DASHBOARD read path: one relay's line, straight from state, no encode on read.
  // This is the legacynet `Last-Round-Data` shape (it took a Fingerprint too).
  console.log('\n6a) last_round_details?fingerprint= (per-relay point read):')
  for (const fp of [FP1, FP2, FP3]) {
    const r = await fetch(`${HB}/${pid}~process@1.0/as/last_round_details?fingerprint=${fp}`)
    const t = await r.text()
    check(r.ok, `Details[${fp.slice(0, 4)}…] readable`, `${r.status} ${t.length}B`)
    // A re-encode would hand back a quoted string literal rather than an object.
    check(t.startsWith('{'), `Details[${fp.slice(0, 4)}…] is an object, not a quoted string`,
      t.slice(0, 32))
    // Byte-identical to what the settle-slot output carries: one encode, two read paths.
    check(JSON.stringify(JSON.parse(t)) === JSON.stringify(snap.Details[fp]),
      `Details[${fp.slice(0, 4)}…] matches the settle-slot output exactly`, 'ok')
  }
  const dRes = await fetch(`${HB}/${pid}~process@1.0/as/last_round_details?fingerprint=${'F'.repeat(40)}`)
  check((await dRes.text()) === '[]', 'unknown fingerprint answers empty', 'ok')

  // 6c) The convenience hop: last_snapshot, and its 302. The Location is RELATIVE (a view never
  // sees the process id), so the only thing that proves it works is following it for real.
  console.log('\n6c) last_snapshot (+ ?redirect=true):')
  const ptrRes = await fetch(`${HB}/${pid}~process@1.0/as/last_snapshot`)
  const ptr = JSON.parse(await ptrRes.text())
  check(ptrRes.ok && ptr.Slot > 0, 'last_snapshot returns the settle slot', `slot ${ptr.Slot}`)
  check(ptr.Path === `compute&slot=${ptr.Slot}/results/output`, 'Path is composable', ptr.Path)

  const redirUrl = `${HB}/${pid}~process@1.0/as/last_snapshot?redirect=true`
  const noFollow = await fetch(redirUrl, { redirect: 'manual' })
  const loc = noFollow.headers.get('location')
  check(noFollow.status === 302, 'redirect=true answers 302', `${noFollow.status}`)
  check(loc === `../compute&slot=${ptr.Slot}/results/output`, 'relative Location', String(loc))
  // Follow it the way a browser or fetch() would — this is the actual claim under test.
  const followed = await fetch(redirUrl)
  const fText = await followed.text()
  check(followed.ok, 'following the redirect lands on the slot output', `${followed.status}`)
  const fJson = followed.ok ? JSON.parse(fText) : {}
  check(fJson.Timestamp === T, 'redirect target is THIS round', `${fJson.Timestamp}`)
  check(!!fJson.Details && Object.keys(fJson.Details).length === 3,
    'redirect target carries the full Details', `${Object.keys(fJson.Details || {}).length} entries`)
  // The POINT of aiming at `results/output` rather than `.../data`: the parent honours the
  // content-type Complete-Round declares, the leaf does not. Assert the header, not just the
  // payload — a probe that only checks the body cannot see this regress.
  check((followed.headers.get('content-type') || '').includes('application/json'),
    'redirect target is served application/json', String(followed.headers.get('content-type')))
  // ...and the payload is byte-identical to the leaf, so nothing was traded for the header.
  const leaf = await fetch(`${HB}/${pid}~process@1.0/compute&slot=${ptr.Slot}/results/output/data`)
  const leafText = await leaf.text()
  check(leafText === fText, 'parent and leaf return identical bytes', `${leafText.length} B`)
  check((leaf.headers.get('content-type') || '').includes('text/plain'),
    'the leaf is still text/plain (unchanged for the controller)', String(leaf.headers.get('content-type')))

  console.log('\n6b) settle-slot pointer (last_round.Slot -> that slot\'s output):')
  const lastRound = await view('last_round')
  const slot = lastRound?.Slot
  check(Number.isInteger(slot) && slot > 0, 'last_round.Slot is a positive integer', String(slot))
  const atSlot = await fetch(`${HB}/${pid}~process@1.0/compute&slot=${slot}/results/output/data`)
  const atSlotText = await atSlot.text()
  check(atSlot.ok, `slot ${slot} output readable`, `${atSlot.status}`)
  const atSlotJson = atSlot.ok ? JSON.parse(atSlotText) : {}
  check(atSlotJson.Timestamp === T, 'slot output is THIS round', `${atSlotJson.Timestamp} vs ${T}`)
  check(atSlotJson.Slot === slot, 'slot output self-identifies', `${atSlotJson.Slot}`)
  for (const fp of [FP1, FP2, FP3]) {
    check(!!atSlotJson.Details?.[fp], `Details[${fp.slice(0, 4)}…] retrievable from the slot`, 'ok')
  }

  console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}  —  pid=${pid}`)
  process.exit(fails ? 1 : 0)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 500)); process.exit(2) })
