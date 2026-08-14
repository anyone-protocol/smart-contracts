// Stand up a complete, self-contained contract set on a LOCAL node and provision it with data
// for one operator address, so the dashboard can be exercised end to end against real contracts
// without touching stage and without needing a wallet anyone has to fund or allow-list.
//
// WHY LOCAL AND NOT hb-dev:
//   hb-dev's node refuses writes from wallets that are not allow-listed
//   ("Node will not service this request under any circumstances"), and the exemption that lets
//   arbitrary operators write is a PID CARVE-OUT templated from Consul — which a throwaway
//   process is not in and which needs cluster access to change. A stock local node has no such
//   allowlist, so ANY browser wallet can write. Verified with scripts/probe/stranger-write.ts.
//
// START THE NODE FIRST:
//   podman run -d --name hb-local --network host \
//     -e HB_ALLOW_EPHEMERAL_WALLET=true -e HB_WALLET_PATH=/app/wallet.json \
//     ghcr.io/memetic-block/hyperbeam-docker:v0.9-FINAL
//
// RUN:
//   bun run scripts/dev-dashboard-fixture.ts 0x<your browser wallet address>
//
// It prints the env block to paste in front of the dashboard's dev server.
import { EthereumSigner } from '@dha-team/arbundles'
import { Wallet, getAddress } from 'ethers'
import fs from 'fs'
import path from 'path'
import { spawnLuaProcess, sendMessage, readState } from './util/hb-client'

const HB = process.env.HB_URL || 'http://localhost:8734'
const KEY = process.env.DEPLOYER_PRIVATE_KEY
if (!KEY) throw new Error('DEPLOYER_PRIVATE_KEY required (ao/.env)')

const target = process.argv[2]
if (!target) {
  console.error('usage: bun run scripts/dev-dashboard-fixture.ts 0x<operator address>')
  process.exit(2)
}
const OPERATOR = getAddress(target)          // EIP-55, the only form the contracts store
const AO = path.resolve(import.meta.dir, '..')
const config = { url: HB, signer: new EthereumSigner(KEY.replace(/^0x/, '')) }
const DEPLOYER = new Wallet('0x' + KEY.replace(/^0x/, '')).address

// A handful of fingerprints for the operator, plus one belonging to somebody else so the
// per-address reads can be seen EXCLUDING data they should not return.
const fp = (n: number) => n.toString(16).toUpperCase().padStart(40, 'A')
const MINE = [fp(1), fp(2), fp(3), fp(4)]      // scored in the rounds -> have last-round detail
const CLAIMABLE = [fp(5), fp(6)]               // never scored -> claimable but no round detail
const THEIRS = fp(99)
const STRANGER = '0x1111111111111111111111111111111111111111'

const bundle = (name: string) =>
  fs.readFileSync(path.join(AO, `dist/${name}-native.lua`), 'utf8')

async function spawn(name: string) {
  const { pid } = await spawnLuaProcess(config, {
    luaSource: bundle(name),
    tags: [{ name: 'name', value: `${name}-fixture-${Date.now()}` }],
  })
  // Lazy eval: a fresh process has not computed slot 0 until something asks it to.
  await readState(config, pid, 'as/status').catch(() => {})
  console.log(`  ${name.padEnd(18)} ${pid}`)
  return pid
}

const send = (pid: string, action: string, data?: any, tags: Record<string, string> = {}) =>
  sendMessage(config, {
    pid,
    tags: [{ name: 'action', value: action }, ...Object.entries(tags).map(([name, value]) => ({ name, value }))],
    data: data === undefined ? '' : JSON.stringify(data),
  })

;(async () => {
  console.log(`node      : ${HB}`)
  console.log(`deployer  : ${DEPLOYER}  (Owner of all three)`)
  console.log(`operator  : ${OPERATOR}  (the wallet you will connect)\n`)

  console.log('spawning contracts...')
  const opreg = await spawn('operator-registry')
  const relay = await spawn('relay-rewards')
  const staking = await spawn('staking-rewards')

  console.log('\nprovisioning operator-registry...')
  // verified relays for the operator, one for a stranger, and two left CLAIMABLE so the
  // Submit-Fingerprint-Certificate write has something to act on.
  await send(opreg, 'Admin-Submit-Operator-Certificates',
    [...MINE.map(f => ({ f, a: OPERATOR, hw: true })),
     ...CLAIMABLE.map(f => ({ f, a: OPERATOR })),
     { f: THEIRS, a: STRANGER }])
  console.log(`  ${MINE.length} verified (hardware) + ${CLAIMABLE.length} claimable for the operator, 1 for a stranger`)

  console.log('\nprovisioning relay-rewards (two rounds, so Period is sane)...')
  const score = (n: number) => ({
    Address: OPERATOR, Network: 1000 + n, IsHardware: true, UptimeStreak: 3,
    ExitBonus: false, FamilySize: 0, LocationSize: 1,
  })
  // Round 1 pays nothing (PreviousRound.Timestamp is 0 on a fresh spawn) — it exists to give
  // round 2 a sane 900s Period instead of a decades-long one.
  const T1 = 1_780_000_000_000
  const T2 = T1 + 900_000
  for (const T of [T1, T2]) {
    const Scores: Record<string, any> = {}
    MINE.forEach((f, i) => { Scores[f] = score(i) })
    Scores[THEIRS] = { ...score(9), Address: STRANGER }
    await send(relay, 'Add-Scores', { Scores }, { 'round-timestamp': String(T) })
    await send(relay, 'Complete-Round', undefined, { 'round-timestamp': String(T) })
  }
  console.log(`  2 rounds settled, ${MINE.length} relays for the operator + 1 for a stranger`)

  console.log('\nprovisioning staking-rewards...')
  for (const T of [T1, T2]) {
    await send(staking, 'Add-Scores', {
      Scores: {
        [OPERATOR]: {
          [OPERATOR]: { Staked: '100000000000000000000', Running: 1 },
          [STRANGER]: { Staked: '50000000000000000000', Running: 1 },
        },
      },
    }, { 'round-timestamp': String(T) })
    await send(staking, 'Complete-Round', undefined, { 'round-timestamp': String(T) })
  }
  console.log('  2 rounds settled, operator staked with 2 operators (self + one other)')

  // ---- prove the reads the dashboard actually makes ----
  console.log('\nverifying the dashboard read surface:')
  const get = async (pid: string, view: string, qs = '') => {
    const r = await fetch(`${HB}/${pid}~process@1.0/as/${view}${qs}`)
    return { ok: r.ok, body: await r.text() }
  }
  const checks: [string, boolean, string][] = []
  const op = await get(opreg, 'operator', `?address=${OPERATOR}`)
  const opj = JSON.parse(op.body)
  // Admin certificates land in CLAIMABLE. A relay only becomes VERIFIED when the operator
  // themselves calls Submit-Fingerprint-Certificate — which is precisely the browser write under
  // test, so the fixture deliberately leaves every relay claimable and lets the dashboard do it.
  const claimableCount = Object.keys(opj.claimable || {}).length
  checks.push(['opreg operator (all claimable)', claimableCount === MINE.length + CLAIMABLE.length,
    `${claimableCount} claimable, ${Object.keys(opj.verified || {}).length} verified (0 until you claim)`])
  const det = await get(relay, 'last_round_details', `?address=${OPERATOR}`)
  const detj = JSON.parse(det.body)
  checks.push(['relay last_round_details?address', Object.keys(detj).length === MINE.length,
    `${Object.keys(detj).length} relays, stranger excluded: ${!detj[THEIRS]}`])
  const rew = await get(relay, 'rewards', `?address=${OPERATOR}`)
  checks.push(['relay rewards', !!JSON.parse(rew.body).reward, JSON.parse(rew.body).reward || 'none'])
  const srew = await get(staking, 'rewards', `?address=${OPERATOR}`)
  const srewj = JSON.parse(srew.body)
  checks.push(['staking rewards', Object.keys(srewj.Rewarded || {}).length > 0,
    `${Object.keys(srewj.Rewarded || {}).length} operators`])
  const snap = await get(staking, 'last_snapshot')
  checks.push(['staking last_snapshot Details', !!JSON.parse(snap.body).Details, 'present'])

  let bad = 0
  for (const [label, ok, detail] of checks) {
    if (!ok) bad++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(34)} ${detail}`)
  }

  console.log(`\n${'='.repeat(78)}`)
  console.log('Run the dashboard against this fixture:\n')
  console.log(`  cd ../../ator-relay-dashboard && \\`)
  console.log(`  NUXT_PUBLIC_HYPERBEAM_URL=${HB} \\`)
  console.log(`  NUXT_PUBLIC_OPERATOR_REGISTRY_HYPERBEAM_PROCESS_ID=${opreg} \\`)
  console.log(`  NUXT_PUBLIC_RELAY_REWARDS_HYPERBEAM_PROCESS_ID=${relay} \\`)
  console.log(`  NUXT_PUBLIC_STAKING_REWARDS_HYPERBEAM_PROCESS_ID=${staking} \\`)
  console.log(`  pnpm dev\n`)
  console.log(`Then connect ${OPERATOR}. What to check:`)
  console.log(`  reads  — ${MINE.length + CLAIMABLE.length} claimable relays; ${MINE.length} of them carry last-round detail`)
  console.log(`           (ONE request, not ${MINE.length}: watch the network tab for last_round_details?address=)`)
  console.log(`  reads  — the stranger's relay must NOT appear anywhere`)
  console.log(`  reads  — staking page shows a NON-ZERO delegated total (0 means the EIP-55 fix regressed)`)
  console.log(`  WRITE  — claim a relay: Submit-Fingerprint-Certificate moves it claimable -> verified`)
  console.log(`  WRITE  — then renounce it: Renounce-Fingerprint-Certificate moves it back`)
  console.log('='.repeat(78))
  process.exit(bad === 0 ? 0 : 1)
})()
