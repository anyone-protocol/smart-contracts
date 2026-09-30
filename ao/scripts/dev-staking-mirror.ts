// Mirror a REAL staking round onto a local node, with the per-operator relay counts added.
//
// WHY THIS EXISTS
//   The dashboard's staking page cannot be driven by a synthetic fixture. Its operator rows come
//   from `getStakes` on the Hodler contract on SEPOLIA and from api-service — neither of which a
//   local node serves — so `currentOperator` stays null and every stat renders `--`. See the
//   local-dashboard-test-rig notes.
//
//   The way round it is a HYBRID: let the EVM reads hit real sepolia (they are public), and point
//   only the AO reads at a local node. For `currentOperator` to resolve, the local staking
//   contract must know the SAME operators sepolia does — so this replays a real round from stage
//   rather than inventing one.
//
//   `Network` is what stage does not have yet: this is how you see the new counts rendered in a
//   browser BEFORE the contract is deployed.
//
// COUNTS
//   `Score.Running` in a real round IS running/expected, already reduced. Recovering a plausible
//   (running, expected) pair is therefore just asking for the fraction back — limit_denominator in
//   spirit, done here with a small search. 0.91304347826087 comes back as 21/23, which is what
//   that operator actually had.
//
// RUN
//   bun run scripts/dev-staking-mirror.ts [--source https://hb-stage.anyone.tech]
import { EthereumSigner } from '@dha-team/arbundles'
import fs from 'fs'
import path from 'path'
import { spawnLuaProcess, sendMessage, readState } from './util/hb-client'

const HB = process.env.HB_URL || 'http://localhost:8734'
const SOURCE = process.env.SOURCE_HB || 'https://hb-stage.anyone.tech'
const SOURCE_PID = process.env.SOURCE_PID || '41eqpwcMIyMhCAElq-M3jHMrMSTVENujZDJ09Vnd0nE'
const KEY = process.env.DEPLOYER_PRIVATE_KEY
if (!KEY) throw new Error('DEPLOYER_PRIVATE_KEY required (ao/.env)')

const AO = path.resolve(import.meta.dir, '..')
const config = { url: HB, signer: new EthereumSigner(KEY.replace(/^0x/, '')) }

/** Smallest sane (running, expected) whose quotient matches `ratio`. */
function recoverCounts(ratio: number): { running: number; expected: number } {
  if (ratio <= 0) return { running: 0, expected: 1 }
  if (ratio >= 1) return { running: 1, expected: 1 }
  let best = { running: 0, expected: 1 }
  let bestErr = Infinity
  for (let expected = 1; expected <= 60; expected++) {
    const running = Math.round(ratio * expected)
    const err = Math.abs(running / expected - ratio)
    if (err < bestErr - 1e-12) { bestErr = err; best = { running, expected } }
    if (bestErr < 1e-9) break
  }
  return best
}

const send = (pid: string, action: string, data?: any, tags: Record<string, string> = {}) =>
  sendMessage(config, {
    pid,
    tags: [{ name: 'action', value: action }, ...Object.entries(tags).map(([name, value]) => ({ name, value }))],
    data: data === undefined ? '' : JSON.stringify(data),
  })

;(async () => {
  console.log(`source : ${SOURCE}/${SOURCE_PID}`)
  console.log(`target : ${HB}\n`)

  const res = await fetch(`${SOURCE}/${SOURCE_PID}~process@1.0/as/last_snapshot`)
  if (!res.ok) throw new Error(`could not read the source round: ${res.status}`)
  const snap = await res.json()
  const details = snap.Details || {}
  const hodlers = Object.keys(details)
  if (!hodlers.length) throw new Error('source round has no Details to mirror')

  // Scores, verbatim from the source round.
  const Scores: Record<string, any> = {}
  const ratios: Record<string, number> = {}
  let pairs = 0
  for (const hodler of hodlers) {
    Scores[hodler] = {}
    for (const [operator, rec] of Object.entries<any>(details[hodler])) {
      Scores[hodler][operator] = { Staked: rec.Score.Staked, Running: rec.Score.Running }
      ratios[operator] = rec.Score.Running
      pairs++
    }
  }

  // The counts stage does not carry yet, recovered from each operator's ratio.
  const Network: Record<string, any> = {}
  for (const [operator, ratio] of Object.entries(ratios)) {
    const { running, expected } = recoverCounts(Number(ratio))
    Network[operator] = { Expected: expected, Running: running, Found: expected }
  }
  console.log(`mirroring ${hodlers.length} hodlers / ${pairs} pairs / ${Object.keys(Network).length} operators`)

  const source = fs.readFileSync(path.join(AO, 'dist/staking-rewards-native.lua'), 'utf8')
  const { pid } = await spawnLuaProcess(config, {
    luaSource: source,
    tags: [{ name: 'name', value: `staking-mirror-${Date.now()}` }],
  })
  await readState(config, pid, 'as/status').catch(() => {})
  console.log(`spawned  ${pid}`)

  // Match the source round's configuration so rewards and the running threshold line up.
  const cfg = snap.Configuration || {}
  await send(pid, 'Update-Configuration', {
    TokensPerSecond: cfg.TokensPerSecond,
    Requirements: cfg.Requirements,
  })
  if (cfg.Shares?.Enabled) {
    await send(pid, 'Toggle-Feature-Shares', { Enabled: true })
    await send(pid, 'Update-Shares-Configuration', cfg.Shares)
  }

  // Two rounds so Period is the source's, not a decades-long first-round gap.
  const T2 = Number(snap.Timestamp)
  const T1 = T2 - Number(snap.Period || 900) * 1000
  for (const T of [T1, T2]) {
    await send(pid, 'Add-Scores', { Scores, Network }, { 'round-timestamp': String(T) })
    await send(pid, 'Complete-Round', undefined, { 'round-timestamp': String(T) })
  }

  const out = await (await fetch(`${HB}/${pid}~process@1.0/as/last_snapshot`)).json()
  const net = out.Network || {}
  console.log(`\nmirrored round: ${Object.keys(out.Details || {}).length} hodlers, ${Object.keys(net).length} operators with counts`)
  const sample = Object.keys(net).slice(0, 4)
  for (const o of sample) {
    const c = net[o]
    console.log(`  ${o}  ${c.Running}/${c.Expected} = ${((c.Running / c.Expected) * 100).toFixed(2)}%`)
  }

  console.log(`\n${'='.repeat(78)}`)
  console.log('Run the dashboard against this (EVM reads still hit real sepolia):\n')
  console.log(`  NUXT_PUBLIC_HYPERBEAM_URL=${HB} \\`)
  console.log(`  NUXT_PUBLIC_STAKING_REWARDS_HYPERBEAM_PROCESS_ID=${pid} \\`)
  console.log(`  NUXT_PUBLIC_HODLER_CONTRACT=0xB2B365DC481E9527366b29dE9394663A05743Aa9 \\`)
  console.log(`  <dashboard build or dev server>\n`)
  console.log('Then connect a wallet that HAS sepolia stakes, e.g. read-only')
  console.log('0x03d3A2b237106b228f2d6307fF33c6b2F3448E38.')
  console.log('='.repeat(78))
})()
