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
  const r = await fetch(`${HB}/${pid}~process@1.0/now/~lua@5.3a/${v}`)
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
  const r = await spawnLuaProcess({ url: HB, signer }, { moduleId: MODULE_ID, tags: [{ name: 'name', value: `relay-seed-${Date.now()}` }] })
  pid = r.pid
  console.log(`spawned pid=${pid}\n`)

  // 1) materialization + counts
  console.log('1) materialization + counts (status):')
  let status: any
  for (let i = 0; i < 40; i++) {
    try { status = await view('status'); break } catch { await new Promise(z => setTimeout(z, 1500)) }
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
  const tarAApre = await readState({ url: HB }, pid, `state/TotalAddressReward/${AA}`).catch(() => '')
  check(!tarAApre || tarAApre === 'not_found' || tarAApre.trim() === '', 'AA absent pre-round', tarAApre.slice(0, 20))

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
  // cumulative maps (base-addressed point reads) == oracle
  for (const [addr, label] of [[AA, 'AA'], [BB, 'BB']] as const) {
    const got = (await readState({ url: HB }, pid, `state/TotalAddressReward/${addr}`)).trim()
    check(got === oracle.tar[addr], `TotalAddressReward[${label}]`, `${got}`)
  }
  for (const fp of [FP1, FP2, FP3]) {
    const got = (await readState({ url: HB }, pid, `state/TotalFingerprintReward/${fp}`)).trim()
    check(got === oracle.tfr[fp], `TotalFingerprintReward[${fp.slice(0, 4)}…]`, `${got}`)
  }
  console.log(`  (round add+complete ${roundMs}ms)`)

  // Details NOT persisted
  check(dump.PreviousRound?.Details === undefined, 'Details never persisted in state', 'ok')

  console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}  —  pid=${pid}`)
  process.exit(fails ? 1 : 0)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 500)); process.exit(2) })
