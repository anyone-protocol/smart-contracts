// W-A.5b (realism strengthening) — REALISTIC round byte-identical parity onto MIGRATED balances.
// Unlike tier3-relay-validate (3 fresh fps from zero), this drives a round over a large sample of
// the ACTUAL seeded fingerprints + addresses (which already carry lifetime balances) with varied
// score attributes, and proves on a live node:
//   A. per-round rewards byte-identical to a luerl oracle (round math holds at realistic size)
//   B. cumulative TotalFingerprintReward[fp] == seed[fp] + roundReward  and
//      cumulative TotalAddressReward[addr]  == seed[addr] + roundOperatorTotal
//      (i.e. bigint accumulation ONTO real migrated balances is byte-identical)
// Run: HB_URL=... MODULE_ID=<seed id> [K=300] bun run scripts/tier3-relay-realistic.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { fetchNodeAddress, spawnLuaProcess, sendMessage, readState } from './util/hb-client'
import { buildSeedBundle } from './util/native-bundle'
import { luerl } from './util/luerl'
import fs from 'fs'
import path from 'path'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID
if (!MODULE_ID) { console.error('MODULE_ID env required'); process.exit(2) }
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const signer = new EthereumSigner(KEY)
const K = Number(process.env.K || 300)

const AO = path.resolve(import.meta.dir, '..')
const expected = JSON.parse(fs.readFileSync(path.join(AO, 'dist/relay-rewards-seed.expected.json'), 'utf8'))
const seedTFR: Record<string, string> = expected.state.TotalFingerprintReward
const seedTAR: Record<string, string> = expected.state.TotalAddressReward
const PREV_TS = expected.state.PreviousRound.Timestamp
const T = PREV_TS + 3600000   // Period 3600

// Sample K real seeded fingerprints + K real seeded addresses (both carry balances), pair 1:1.
const fps = Object.keys(seedTFR).slice(0, K)
const addrs = Object.keys(seedTAR).slice(0, K)
if (fps.length < K || addrs.length < K) { console.error(`seed too small for K=${K}`); process.exit(2) }

// Varied score attributes (deterministic by index → oracle and on-node identical), exercising all
// math paths: hardware on/off, every uptime tier, exit on/off, family/location/network spread.
const TIERS = [0, 3, 14, 45]
const score = (i: number) => ({
  Address: addrs[i],
  Network: 1000 + (i * 137) % 90000,
  IsHardware: i % 3 === 0,
  UptimeStreak: TIERS[i % 4],
  ExitBonus: i % 5 === 0,
  FamilySize: i % 7,
  LocationSize: i % 11,
})
const Scores: Record<string, any> = {}
for (let i = 0; i < K; i++) Scores[fps[i]] = score(i)
const scoresJson = JSON.stringify({ Scores })

// ---- ORACLE: run the identical round on the minimal seed bundle (config + prevTimestamp) in luerl.
// Details depend only on scores+config+roundLength, so they equal the full-seed round exactly.
console.log(`building oracle for a ${K}-fingerprint round (real seeded keys)…`)
const oracleScen = `
local json = require('json')
local OWNER = '0x' .. string.rep('1', 40)
local function commit(c) return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } } end
local base = { process = { id = 'PID', commitments = commit(OWNER) } }
local sd = [==[${scoresJson}]==]
compute(base, { body = { action = 'Add-Scores', commitments = commit(OWNER), tags = { { name='Action', value='Add-Scores' }, { name='Round-Timestamp', value='${T}' } }, data = sd } })
compute(base, { body = { action = 'Complete-Round', commitments = commit(OWNER), tags = { { name='Action', value='Complete-Round' }, { name='Round-Timestamp', value='${T}' } } } })
local out = json.decode(base.results.output.data)
print('ORACLE=' .. json.encode(out.Details))
return { pass = 1, fail = 0, failures = {} }
`
const scenPath = path.join(AO, 'dist/relay-realistic-oracle-scen.lua')
fs.writeFileSync(scenPath, oracleScen)
const raw = luerl(
  ['bundle', '/work/dist/relay-oracle-min.lua', '/work/dist/relay-realistic-oracle-scen.lua'],
  { timeoutMs: 180_000, maxBuffer: 64 * 1024 * 1024 })
const line = raw.split('\n').find(l => l.startsWith('ORACLE='))
if (!line) { console.error('oracle produced no ORACLE= line:\n' + raw.slice(0, 500)); process.exit(2) }
const oracleDetails = JSON.parse(line.slice('ORACLE='.length))
console.log(`oracle ready (${Object.keys(oracleDetails).length} fingerprint rewards)\n`)

let fails = 0
const check = (ok: boolean, label: string, detail = '') => { if (!ok) { fails++; console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`) } }

let pid: string
;(async () => {
  console.log(`node ${await fetchNodeAddress(HB)}  moduleId=${MODULE_ID}  K=${K}  T=${T}`)
  const r = await spawnLuaProcess({ url: HB, signer }, { moduleId: MODULE_ID, tags: [{ name: 'name', value: `relay-real-${Date.now()}` }] })
  pid = r.pid
  console.log(`spawned pid=${pid}`)

  // wait for materialization
  for (let i = 0; i < 40; i++) { try { await readState({ url: HB }, pid, 'state/PreviousRound/Timestamp'); break } catch { await new Promise(z => setTimeout(z, 1500)) } }

  console.log('driving the realistic round on-node (full 719KB seed)…')
  const t0 = performance.now()
  await sendMessage({ url: HB, signer }, { pid, tags: [{ name: 'action', value: 'Add-Scores' }, { name: 'round-timestamp', value: String(T) }], data: scoresJson })
  await sendMessage({ url: HB, signer }, { pid, tags: [{ name: 'action', value: 'Complete-Round' }, { name: 'round-timestamp', value: String(T) }] })
  console.log(`  round settled in ${Math.round(performance.now() - t0)}ms`)

  // read the Complete-Round output (all Details) + the cumulative maps (dump)
  const snap = JSON.parse(await readState({ url: HB }, pid, 'results/output/data'))
  const dumpR = await fetch(`${HB}/${pid}~process@1.0/now/~lua@5.3a/dump`)
  const dump = JSON.parse(await dumpR.text())

  console.log('\nA) per-round rewards byte-identical to oracle (realistic size):')
  let aBad = 0
  for (const fp of fps) {
    const g = snap.Details?.[fp]?.Reward, w = oracleDetails[fp]?.Reward
    if (!g || !w || JSON.stringify(g) !== JSON.stringify(w)) { aBad++; if (aBad <= 3) check(false, `Details[${fp.slice(0,6)}…].Reward`, g ? `Total ${g.Total} vs ${w?.Total}` : 'missing') }
  }
  console.log(`  ${K - aBad}/${K} fingerprint round-rewards byte-identical to oracle`)

  console.log('\nB) cumulative accumulation ONTO migrated balances byte-identical:')
  let tfrBad = 0, tarBad = 0
  for (const fp of fps) {
    const want = (BigInt(seedTFR[fp] || '0') + BigInt(oracleDetails[fp].Reward.Total)).toString()
    if (dump.TotalFingerprintReward[fp] !== want) { tfrBad++; if (tfrBad <= 3) check(false, `TFR[${fp.slice(0,6)}…]`, `${dump.TotalFingerprintReward[fp]} != seed+reward ${want}`) }
  }
  // addresses: 1:1 pairing, no delegates in seed → TAR[addr] += OperatorTotal (= Total)
  for (let i = 0; i < K; i++) {
    const addr = addrs[i], fp = fps[i]
    const want = (BigInt(seedTAR[addr] || '0') + BigInt(oracleDetails[fp].Reward.OperatorTotal)).toString()
    if (dump.TotalAddressReward[addr] !== want) { tarBad++; if (tarBad <= 3) check(false, `TAR[${addr.slice(0,8)}…]`, `${dump.TotalAddressReward[addr]} != seed+opTotal ${want}`) }
  }
  console.log(`  ${K - tfrBad}/${K} TotalFingerprintReward == seed[fp] + roundReward`)
  console.log(`  ${K - tarBad}/${K} TotalAddressReward == seed[addr] + roundOperatorTotal`)

  const ok = aBad === 0 && tfrBad === 0 && tarBad === 0
  console.log(`\n${ok ? 'ALL PASS' : (aBad + tfrBad + tarBad) + ' mismatch(es)'}  —  realistic ${K}-fp round onto migrated balances, byte-identical.  pid=${pid}`)
  process.exit(ok ? 0 : 1)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 500)); process.exit(2) })
